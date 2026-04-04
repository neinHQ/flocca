
const axios = require('axios');
const z = require('zod');
const { McpServer } = require(require('path').join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js'));
const { StdioServerTransport } = require(require('path').join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/stdio.js'));

const SERVER_INFO = { name: 'jira-mcp', version: '1.0.0' };

const PROXY_URL = process.env.FLOCCA_PROXY_URL;
const USER_ID = process.env.FLOCCA_USER_ID;

let config = {
    email: process.env.JIRA_EMAIL,
    token: process.env.JIRA_API_TOKEN || process.env.JIRA_TOKEN,
    url: process.env.JIRA_SITE_URL || process.env.JIRA_URL,
    deploymentMode: (process.env.JIRA_DEPLOYMENT_MODE || 'cloud').toLowerCase()
};

// Override config if Proxy is active
if (PROXY_URL && USER_ID) {
    config.url = PROXY_URL;
    // We don't need email/token locally
}
config.url = normalizeBaseUrl(config.url);

function getHeaders() {
    if (PROXY_URL && USER_ID) {
        return {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Flocca-User-ID': USER_ID
        };
    }

    if (!config.token || !config.url) throw new Error("Jira Not Configured. Missing token or url.");
    const baseHeaders = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };
    // Cloud default path: email + API token => Basic auth.
    if (config.email) {
        const auth = Buffer.from(`${config.email}:${config.token}`).toString('base64');
        return { ...baseHeaders, 'Authorization': `Basic ${auth}` };
    }
    // Server/Data Center PAT path: Bearer token.
    return { ...baseHeaders, 'Authorization': `Bearer ${config.token}` };
}

function getHeaderCandidates() {
    if (PROXY_URL && USER_ID) return [getHeaders()];
    if (!config.token || !config.url) throw new Error("Jira Not Configured. Missing token or url.");

    const baseHeaders = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };
    const candidates = [];

    const basicCandidate = config.email
        ? { ...baseHeaders, 'Authorization': `Basic ${Buffer.from(`${config.email}:${config.token}`).toString('base64')}` }
        : undefined;
    const bearerCandidate = { ...baseHeaders, 'Authorization': `Bearer ${config.token}` };

    // Server/Data Center commonly uses PAT/Bearer; Cloud commonly uses Basic.
    if (config.deploymentMode === 'server' || config.deploymentMode === 'self_hosted') {
        candidates.push(bearerCandidate);
        if (basicCandidate) candidates.push(basicCandidate);
    } else {
        if (basicCandidate) candidates.push(basicCandidate);
        candidates.push(bearerCandidate);
    }

    return candidates;
}

function normalizeBaseUrl(url) {
    const trimmed = (url || '').trim().replace(/\/+$/, '');
    if (!trimmed) return trimmed;
    if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
    return trimmed;
}

function getApiVersions() {
    if (config.deploymentMode === 'server' || config.deploymentMode === 'self_hosted') return ['2', '3'];
    return ['3', '2'];
}

async function jiraGet(pathSuffix, options = {}) {
    const versions = getApiVersions();
    let lastError;
    const headerCandidates = getHeaderCandidates();

    for (const version of versions) {
        for (const headers of headerCandidates) {
            try {
                const url = `${config.url}/rest/api/${version}/${pathSuffix.replace(/^\/+/, '')}`;
                return await axios.get(url, {
                    ...options,
                    headers: { ...(options.headers || {}), ...headers }
                });
            } catch (err) {
                lastError = err;
                const status = err?.response?.status;
                // If endpoint doesn't exist, try next API version.
                if (status === 404 || status === 405) break;
                // If auth mode failed, try next header candidate.
                if (status === 401 || status === 403) continue;
                throw err;
            }
        }
    }

    throw lastError || new Error('Jira request failed');
}

function normalizeError(err) {
    const msg = err.response?.data?.errorMessages?.join(', ') || JSON.stringify(err.response?.data) || err.message;
    return { isError: true, content: [{ type: 'text', text: `Jira Error: ${msg}` }] };
}

async function jiraPost(pathSuffix, body, options = {}) {
    const versions = getApiVersions();
    let lastError;
    const headerCandidates = getHeaderCandidates();
    for (const version of versions) {
        for (const headers of headerCandidates) {
            try {
                const url = `${config.url}/rest/api/${version}/${pathSuffix.replace(/^\/+/, '')}`;
                return await axios.post(url, body, { ...options, headers: { ...(options.headers || {}), ...headers } });
            } catch (err) {
                lastError = err;
                const status = err?.response?.status;
                if (status === 404 || status === 405) break;
                if (status === 401 || status === 403) continue;
                throw err;
            }
        }
    }
    throw lastError || new Error('Jira POST request failed');
}

async function jiraPut(pathSuffix, body, options = {}) {
    const versions = getApiVersions();
    let lastError;
    const headerCandidates = getHeaderCandidates();
    for (const version of versions) {
        for (const headers of headerCandidates) {
            try {
                const url = `${config.url}/rest/api/${version}/${pathSuffix.replace(/^\/+/, '')}`;
                return await axios.put(url, body, { ...options, headers: { ...(options.headers || {}), ...headers } });
            } catch (err) {
                lastError = err;
                const status = err?.response?.status;
                if (status === 404 || status === 405) break;
                if (status === 401 || status === 403) continue;
                throw err;
            }
        }
    }
    throw lastError || new Error('Jira PUT request failed');
}

async function jiraAgileGet(pathSuffix, options = {}) {
    const headerCandidates = getHeaderCandidates();
    let lastError;
    for (const headers of headerCandidates) {
        try {
            const url = `${config.url}/rest/agile/1.0/${pathSuffix.replace(/^\/+/, '')}`;
            return await axios.get(url, { ...options, headers: { ...(options.headers || {}), ...headers } });
        } catch (err) {
            lastError = err;
            const status = err?.response?.status;
            if (status === 401 || status === 403) continue;
            throw err;
        }
    }
    throw lastError || new Error('Jira Agile request failed');
}

async function main() {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    const configureToolConfig = {
        description: 'Configure Jira',
        inputSchema: {
            email: z.string().optional(),
            token: z.string(),
            url: z.string(),
            deployment_mode: z.string().optional()
        }
    };
    const configureToolHandler = async (args) => {
        config.email = args.email;
        config.token = args.token;
        config.url = normalizeBaseUrl(args.url);
        if (args.deployment_mode) config.deploymentMode = args.deployment_mode.toLowerCase();
        try {
            await jiraGet('myself', { headers: getHeaders() });
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, status: 'authenticated' }) }] };
        } catch (e) {
            config.token = undefined;
            return normalizeError(e);
        }
    };

    const searchIssuesToolConfig = {
        description: 'Search Issues (JQL)',
        inputSchema: {
            jql: z.string(),
            limit: z.number().int().positive().optional()
        }
    };
    const searchIssuesToolHandler = async (args) => {
        try {
            const res = await jiraGet('search', {
                headers: getHeaders(),
                params: { jql: args.jql, maxResults: args.limit || 10 }
            });
            return { content: [{ type: 'text', text: JSON.stringify(res.data.issues) }] };
        } catch (e) { return normalizeError(e); }
    };

    const getIssueToolConfig = {
        description: 'Get Issue Details',
        inputSchema: {
            issue_key: z.string().optional(),
            issueKey: z.string().optional()
        }
    };
    const getIssueToolHandler = async (args) => {
        try {
            const issueKey = args.issue_key || args.issueKey;
            if (!issueKey) {
                throw new Error('issue_key (or issueKey) is required');
            }
            const res = await jiraGet(`issue/${issueKey}`, { headers: getHeaders() });
            return { content: [{ type: 'text', text: JSON.stringify(res.data) }] };
        } catch (e) { return normalizeError(e); }
    };

    const healthToolConfig = {
        description: 'Health Check for Jira',
        inputSchema: z.object({}).optional()
    };
    const healthToolHandler = async () => {
        try {
            await jiraGet('myself', { headers: getHeaders() });
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
        } catch (e) { return normalizeError(e); }
    };

    // VS Code/Copilot-compatible tool names.
    server.registerTool('jira_health', healthToolConfig, healthToolHandler);
    server.registerTool('jira_configure', configureToolConfig, configureToolHandler);
    server.registerTool('jira_search_issues', searchIssuesToolConfig, searchIssuesToolHandler);
    server.registerTool('jira_get_issue', getIssueToolConfig, getIssueToolHandler);

    // ── Context Layer ──────────────────────────────────────────────────────────

    server.registerTool('jira_get_myself',
        { description: 'Return the currently authenticated Jira user — useful for auto-assigning issues.', inputSchema: z.object({}) },
        async () => {
            try {
                const res = await jiraGet('myself', { headers: getHeaders() });
                return { content: [{ type: 'text', text: JSON.stringify(res.data) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.registerTool('jira_list_projects',
        { description: 'List all accessible Jira projects.', inputSchema: z.object({ limit: z.number().int().positive().optional() }) },
        async (args) => {
            try {
                const res = await jiraGet('project/search', { headers: getHeaders(), params: { maxResults: args.limit || 50 } });
                return { content: [{ type: 'text', text: JSON.stringify(res.data.values || res.data) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.registerTool('jira_list_issue_types',
        { description: 'List issue types for a project (Bug, Story, Task, Epic, etc.).', inputSchema: z.object({ project_key: z.string().optional() }) },
        async (args) => {
            try {
                const path = args.project_key ? `issuetype/project?projectId=${args.project_key}` : 'issuetype';
                const res = await jiraGet(path, { headers: getHeaders() });
                return { content: [{ type: 'text', text: JSON.stringify(res.data) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.registerTool('jira_search_users',
        { description: 'Search for Jira users by name or email for assignee lookups.', inputSchema: z.object({ query: z.string(), limit: z.number().int().positive().optional() }) },
        async (args) => {
            try {
                const res = await jiraGet('user/search', { headers: getHeaders(), params: { query: args.query, maxResults: args.limit || 10 } });
                return { content: [{ type: 'text', text: JSON.stringify(res.data) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // ── Action Layer ───────────────────────────────────────────────────────────

    server.registerTool('jira_create_issue',
        {
            description: 'Create a new Jira issue (Bug, Story, Task, etc.).',
            inputSchema: z.object({
                project_key: z.string(),
                summary: z.string(),
                issue_type: z.string().default('Bug'),
                description: z.string().optional(),
                priority: z.string().optional(),
                assignee_account_id: z.string().optional(),
                labels: z.array(z.string()).optional(),
                additional_fields: z.record(z.any()).optional()
            })
        },
        async (args) => {
            try {
                const fields = {
                    project: { key: args.project_key },
                    summary: args.summary,
                    issuetype: { name: args.issue_type },
                    ...(args.description ? { description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: args.description }] }] } } : {}),
                    ...(args.priority ? { priority: { name: args.priority } } : {}),
                    ...(args.assignee_account_id ? { assignee: { accountId: args.assignee_account_id } } : {}),
                    ...(args.labels ? { labels: args.labels } : {}),
                    ...(args.additional_fields || {})
                };
                const res = await jiraPost('issue', { fields }, { headers: getHeaders() });
                return { content: [{ type: 'text', text: JSON.stringify({ key: res.data.key, id: res.data.id, self: res.data.self }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.registerTool('jira_update_issue',
        {
            description: 'Update fields on an existing Jira issue.',
            inputSchema: z.object({
                issue_key: z.string(),
                summary: z.string().optional(),
                description: z.string().optional(),
                priority: z.string().optional(),
                assignee_account_id: z.string().optional(),
                labels: z.array(z.string()).optional(),
                additional_fields: z.record(z.any()).optional()
            })
        },
        async (args) => {
            try {
                const fields = {
                    ...(args.summary ? { summary: args.summary } : {}),
                    ...(args.description ? { description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: args.description }] }] } } : {}),
                    ...(args.priority ? { priority: { name: args.priority } } : {}),
                    ...(args.assignee_account_id ? { assignee: { accountId: args.assignee_account_id } } : {}),
                    ...(args.labels ? { labels: args.labels } : {}),
                    ...(args.additional_fields || {})
                };
                await jiraPut(`issue/${args.issue_key}`, { fields }, { headers: getHeaders() });
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, key: args.issue_key }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.registerTool('jira_list_transitions',
        { description: 'List valid workflow transitions for an issue (required before calling jira_transition_issue).', inputSchema: z.object({ issue_key: z.string() }) },
        async (args) => {
            try {
                const res = await jiraGet(`issue/${args.issue_key}/transitions`, { headers: getHeaders() });
                return { content: [{ type: 'text', text: JSON.stringify(res.data.transitions || []) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.registerTool('jira_transition_issue',
        {
            description: 'Move an issue to a new workflow status. Use jira_list_transitions first to get valid transition IDs.',
            inputSchema: z.object({ issue_key: z.string(), transition_id: z.string() })
        },
        async (args) => {
            try {
                await jiraPost(`issue/${args.issue_key}/transitions`, { transition: { id: args.transition_id } }, { headers: getHeaders() });
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, key: args.issue_key, transition_id: args.transition_id }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // ── Traceability Layer ─────────────────────────────────────────────────────

    server.registerTool('jira_add_comment',
        {
            description: 'Add a comment to a Jira issue.',
            inputSchema: z.object({ issue_key: z.string(), body: z.string() })
        },
        async (args) => {
            try {
                const comment = { body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: args.body }] }] } };
                const res = await jiraPost(`issue/${args.issue_key}/comment`, comment, { headers: getHeaders() });
                return { content: [{ type: 'text', text: JSON.stringify({ id: res.data.id, created: res.data.created }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.registerTool('jira_link_issues',
        {
            description: 'Link two Jira issues (e.g., "blocks", "is blocked by", "relates to").',
            inputSchema: z.object({
                link_type: z.string().describe('e.g. "blocks", "Duplicate", "relates to"'),
                inward_issue_key: z.string(),
                outward_issue_key: z.string(),
                comment: z.string().optional()
            })
        },
        async (args) => {
            try {
                const body = {
                    type: { name: args.link_type },
                    inwardIssue: { key: args.inward_issue_key },
                    outwardIssue: { key: args.outward_issue_key },
                    ...(args.comment ? { comment: { body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: args.comment }] }] } } } : {})
                };
                await jiraPost('issueLink', body, { headers: getHeaders() });
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, linked: `${args.inward_issue_key} → ${args.outward_issue_key}` }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.registerTool('jira_add_attachment',
        {
            description: 'Attach a file (log, screenshot, etc.) to a Jira issue via base64-encoded content.',
            inputSchema: z.object({
                issue_key: z.string(),
                filename: z.string(),
                content_type: z.string().default('application/octet-stream'),
                data_base64: z.string()
            })
        },
        async (args) => {
            try {
                const FormData = require('form-data');
                const form = new FormData();
                const buffer = Buffer.from(args.data_base64, 'base64');
                form.append('file', buffer, { filename: args.filename, contentType: args.content_type });
                const headerCandidates = getHeaderCandidates();
                const versions = getApiVersions();
                let lastErr;
                for (const version of versions) {
                    for (const headers of headerCandidates) {
                        try {
                            const url = `${config.url}/rest/api/${version}/issue/${args.issue_key}/attachments`;
                            const res = await axios.post(url, form, { headers: { ...headers, ...form.getHeaders(), 'X-Atlassian-Token': 'no-check' } });
                            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, attachments: res.data.map(a => ({ id: a.id, filename: a.filename })) }) }] };
                        } catch (err) {
                            lastErr = err;
                            const status = err?.response?.status;
                            if (status === 404 || status === 405) break;
                            if (status === 401 || status === 403) continue;
                            throw err;
                        }
                    }
                }
                throw lastErr;
            } catch (e) { return normalizeError(e); }
        }
    );

    // ── Agile Layer ────────────────────────────────────────────────────────────

    server.registerTool('jira_list_boards',
        { description: 'List Scrum/Kanban boards. Use project_key to narrow results.', inputSchema: z.object({ project_key: z.string().optional(), limit: z.number().int().positive().optional() }) },
        async (args) => {
            try {
                const params = { maxResults: args.limit || 25 };
                if (args.project_key) params.projectKeyOrId = args.project_key;
                const res = await jiraAgileGet('board', { headers: getHeaders(), params });
                return { content: [{ type: 'text', text: JSON.stringify(res.data.values || []) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.registerTool('jira_list_sprints',
        {
            description: 'List sprints for a board. Use jira_list_boards to find board IDs.',
            inputSchema: z.object({ board_id: z.number().int(), state: z.enum(['active', 'closed', 'future']).optional() })
        },
        async (args) => {
            try {
                const params = { maxResults: 25 };
                if (args.state) params.state = args.state;
                const res = await jiraAgileGet(`board/${args.board_id}/sprint`, { headers: getHeaders(), params });
                return { content: [{ type: 'text', text: JSON.stringify(res.data.values || []) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.registerTool('jira_get_sprint_issues',
        {
            description: 'Get all issues in a sprint. Use jira_list_sprints to find sprint IDs.',
            inputSchema: z.object({ sprint_id: z.number().int(), jql: z.string().optional(), limit: z.number().int().positive().optional() })
        },
        async (args) => {
            try {
                const params = { maxResults: args.limit || 50 };
                if (args.jql) params.jql = args.jql;
                const res = await jiraAgileGet(`sprint/${args.sprint_id}/issue`, { headers: getHeaders(), params });
                return { content: [{ type: 'text', text: JSON.stringify(res.data.issues || []) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    const transport = new StdioServerTransport();
    await server.connect(transport);
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = {
    main,
    __test: {
        normalizeBaseUrl,
        getApiVersions,
        jiraGet,
        setConfig: (next) => { config = { ...config, ...next }; },
        getConfig: () => ({ ...config })
    }
};
