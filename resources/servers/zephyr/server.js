const path = require('path');
const z = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const SERVER_INFO = { name: 'zephyr-mcp', version: '2.0.0' };

function createZephyrServer() {
    const sessionConfig = {
        site_url: process.env.ZEPHYR_SITE_URL || undefined,
        token: process.env.ZEPHYR_TOKEN || undefined,
        jira_project_key: process.env.ZEPHYR_JIRA_PROJECT_KEY || undefined,
        zephyr_project_key: undefined,
        identity: undefined,
        read_only: false
    };

    function normalizeSiteUrl(siteUrl) {
        const raw = String(siteUrl || '').trim().replace(/\/+$/, '');
        if (!raw) return raw;
        return raw.replace(/\/rest\/atm\/1\.0$/i, '').replace(/\/rest\/api\/3$/i, '').replace(/\/+$/, '');
    }

    function normalizeError(message, code = 'ZEPHYR_ERROR', details, http_status) {
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { message, code, details, http_status } }) }] };
    }

    async function ensureConnected() {
        if (!sessionConfig.site_url || !sessionConfig.token) {
            // Re-read env for dynamic updates
            sessionConfig.site_url = normalizeSiteUrl(process.env.ZEPHYR_SITE_URL || sessionConfig.site_url);
            sessionConfig.token = process.env.ZEPHYR_TOKEN || sessionConfig.token;
            sessionConfig.jira_project_key = process.env.ZEPHYR_JIRA_PROJECT_KEY || sessionConfig.jira_project_key;
        }
        if (!sessionConfig.identity && sessionConfig.token) {
            try {
                const url = `${sessionConfig.site_url.replace(/\/+$/, '')}/rest/api/3/myself`;
                const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${sessionConfig.token}` } });
                const me = await resp.json();
                sessionConfig.identity = me.accountId || me.emailAddress || 'unknown';
                sessionConfig.zephyr_project_key = sessionConfig.jira_project_key;
            } catch (e) { sessionConfig.identity = 'auth_user'; }
        }
    }

    async function zephyrFetch(pathPart, { method = 'GET', query, body, rawBody } = {}) {
        await ensureConnected();
        const url = new URL(`${sessionConfig.site_url.replace(/\/+$/, '')}${pathPart.startsWith('/') ? '' : '/'}${pathPart}`);
        if (query) Object.entries(query).forEach(([k, v]) => { if (v !== undefined) url.searchParams.set(k, v); });
        const resp = await fetch(url.toString(), {
            method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionConfig.token}` },
            body: rawBody || (body ? JSON.stringify(body) : undefined)
        });
        if (!resp.ok) {
            const text = await resp.text();
            throw { message: text || resp.statusText, http_status: resp.status };
        }
        return resp.status === 204 ? {} : await resp.json();
    }

    async function zephyrFetchWithFallback(pathParts, options = {}) {
        let lastErr;
        for (const pathPart of pathParts) {
            try { return await zephyrFetch(pathPart, options); } catch (err) {
                lastErr = err;
                if (err.http_status === 404) continue;
                throw err;
            }
        }
        throw lastErr;
    }

    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    server.tool('zephyr_health', {}, async () => {
        try { await ensureConnected(); return { content: [{ type: 'text', text: JSON.stringify({ ok: true, identity: sessionConfig.identity }) }] }; }
        catch (e) { return normalizeError(e.message); }
    });

    server.tool('zephyr_get_context', {}, async () => {
        try {
            const projects = await zephyrFetch('/rest/atm/1.0/testproject');
            return { content: [{ type: 'text', text: JSON.stringify({ projects }) }] };
        } catch (e) { return normalizeError(e.message); }
    });

    server.tool('zephyr_list_folders', { project_key: z.string().optional() }, async (args) => {
        try {
            const proj = args.project_key || sessionConfig.zephyr_project_key;
            const data = await zephyrFetch('/rest/atm/1.0/folder/testcase', { query: { projectKey: proj } });
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return normalizeError(e.message); }
    });

    server.tool('zephyr_search_test_cases', { query: z.string(), project_key: z.string().optional() }, async (args) => {
        try {
            const proj = args.project_key || sessionConfig.zephyr_project_key;
            const data = await zephyrFetchWithFallback(['/rest/atm/1.0/testcase/search'], { method: 'POST', body: { projectKey: proj, query: args.query } });
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return normalizeError(e.message); }
    });

    server.tool('zephyr_get_test_case', { key: z.string() }, async (args) => {
        try {
            const data = await zephyrFetchWithFallback([`/rest/atm/1.0/testcase/${args.key}`]);
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return normalizeError(e.message); }
    });

    server.tool('zephyr_create_test_case',
        {
            title: z.string(),
            objective: z.string().optional(),
            precondition: z.string().optional(),
            steps: z.array(z.object({ action: z.string(), data: z.string().optional(), expected: z.string().optional() })).optional(),
            labels: z.array(z.string()).optional(),
            folder_id: z.string().optional(),
            project_key: z.string().optional(),
            links: z.object({ jira_issue_keys: z.array(z.string()) }).optional(),
            confirm: z.boolean().describe('Safety gate')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
            try {
                const proj = args.project_key || sessionConfig.zephyr_project_key;
                const payload = {
                    projectKey: proj,
                    name: args.title,
                    objective: args.objective,
                    precondition: args.precondition,
                    labels: args.labels,
                    folderId: args.folder_id || sessionConfig.default_folder_id,
                    testScript: args.steps ? { type: 'STEP_BY_STEP', steps: args.steps.map((s, i) => ({ index: i + 1, action: s.action, data: s.data, expectedResult: s.expected })) } : undefined
                };
                const data = await zephyrFetchWithFallback(['/rest/atm/1.0/testcase', '/rest/atm/1.0/testcases'], { method: 'POST', body: payload });
                return { content: [{ type: 'text', text: JSON.stringify(data) }] };
            } catch (e) { return normalizeError(e.message); }
        }
    );

    server.tool('zephyr_update_execution_status',
        {
            execution_id: z.string(),
            status: z.enum(['PASS', 'FAIL', 'BLOCKED', 'UNEXECUTED', 'IN_PROGRESS']),
            comment: z.string().optional(),
            evidence: z.object({
                attachments: z.array(z.object({ name: z.string(), content_type: z.string(), data_base64: z.string() }))
            }).optional(),
            confirm: z.boolean()
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
            try {
                const payload = { status: args.status, comment: args.comment };
                const data = await zephyrFetchWithFallback([`/rest/atm/1.0/testexecution/${args.execution_id}`], { method: 'PUT', body: payload });
                return { content: [{ type: 'text', text: JSON.stringify(data) }] };
            } catch (e) { return normalizeError(e.message); }
        }
    );

    // Metadata
    server.tool('zephyr_list_priorities', {}, async () => {
        try {
            const data = await zephyrFetch('/rest/atm/1.0/testcase/priority');
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return normalizeError(e.message); }
    });

    server.__test = {
        sessionConfig,
        ensureConnected,
        zephyrFetch,
        setConfig: (next) => { Object.assign(sessionConfig, next); },
        getConfig: () => ({ ...sessionConfig })
    };

    return server;
}

if (require.main === module) {
    const serverInstance = createZephyrServer();
    const transport = new StdioServerTransport();
    serverInstance.connect(transport);
}
module.exports = { createZephyrServer };
