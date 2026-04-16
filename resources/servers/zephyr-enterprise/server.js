const path = require('path');
const z = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const SERVER_INFO = { name: 'zephyr-enterprise-mcp', version: '2.0.0' };
const API_FAMILY = { PUBLIC: 'public', FLEX: 'flex' };

function createZephyrEnterpriseServer() {
    let sessionConfig = {
        base_url: process.env.ZEPHYR_ENT_BASE_URL,
        username: process.env.ZEPHYR_ENT_USERNAME,
        token: process.env.ZEPHYR_ENT_TOKEN,
        password: process.env.ZEPHYR_ENT_PASSWORD,
        project_id: process.env.ZEPHYR_ENT_PROJECT_ID ? parseInt(process.env.ZEPHYR_ENT_PROJECT_ID) : undefined,
        api_family: undefined,
        release_id: process.env.ZEPHYR_ENT_RELEASE_ID ? parseInt(process.env.ZEPHYR_ENT_RELEASE_ID) : undefined,
        identity: undefined,
        proxyUrl: process.env.FLOCCA_PROXY_URL,
        userId: process.env.FLOCCA_USER_ID
    };

    function getHeaderCandidates() {
        if (sessionConfig.proxyUrl && sessionConfig.userId) {
            return [{ 'Content-Type': 'application/json', 'X-Flocca-User-ID': sessionConfig.userId }];
        }
        const baseHeaders = { 'Content-Type': 'application/json' };
        const candidates = [];
        const bearer = sessionConfig.token ? { ...baseHeaders, 'Authorization': `Bearer ${sessionConfig.token}` } : null;
        const basic = sessionConfig.username ? { ...baseHeaders, 'Authorization': `Basic ${Buffer.from(`${sessionConfig.username}:${sessionConfig.password || ''}`).toString('base64')}` } : null;

        if (bearer) candidates.push(bearer);
        if (basic) candidates.push(basic);
        return candidates;
    }

    function normalizeBaseUrl(baseUrl) {
        const raw = String(baseUrl || '').trim().replace(/\/+$/, '');
        if (!raw) return raw;
        return raw.replace(/\/public\/rest\/api\/1\.0$/i, '').replace(/\/flex\/services\/rest\/latest$/i, '').replace(/\/+$/, '');
    }

    async function ensureConnected() {
        if (!sessionConfig.base_url || getHeaderCandidates().length === 0) {
            sessionConfig.base_url = normalizeBaseUrl(process.env.ZEPHYR_ENT_BASE_URL);
            sessionConfig.username = process.env.ZEPHYR_ENT_USERNAME;
            sessionConfig.token = process.env.ZEPHYR_ENT_TOKEN;
            sessionConfig.password = process.env.ZEPHYR_ENT_PASSWORD;
            sessionConfig.proxyUrl = process.env.FLOCCA_PROXY_URL;
            sessionConfig.userId = process.env.FLOCCA_USER_ID;
            if (!sessionConfig.base_url || getHeaderCandidates().length === 0) {
                throw new Error('Zephyr Enterprise Not Configured. Provide Base URL and Credentials (or Proxy).');
            }
        }

        if (!sessionConfig.api_family) {
            const h = getHeaderCandidates();
            const baseURL = normalizeBaseUrl(sessionConfig.proxyUrl && sessionConfig.userId ? sessionConfig.proxyUrl : sessionConfig.base_url);
            try {
                const url = `${baseURL}/public/rest/api/1.0/projects`;
                const resp = await fetch(url, { headers: h[0] });
                sessionConfig.api_family = resp.ok ? API_FAMILY.PUBLIC : API_FAMILY.FLEX;
                sessionConfig.identity = sessionConfig.username || 'api_user';
            } catch (e) {
                sessionConfig.api_family = API_FAMILY.FLEX;
                sessionConfig.identity = sessionConfig.username || 'api_user';
            }
        }
    }

    async function zFetch(pathPart, { method = 'GET', query, body, headers } = {}) {
        await ensureConnected();
        const baseURL = normalizeBaseUrl(sessionConfig.proxyUrl && sessionConfig.userId ? sessionConfig.proxyUrl : sessionConfig.base_url);
        const url = new URL(`${baseURL}/${pathPart.replace(/^\/+/, '')}`);
        if (query) Object.entries(query).forEach(([k, v]) => { if (v !== undefined) url.searchParams.set(k, v); });
        
        const candidates = getHeaderCandidates();
        let lastErr;

        for (const h of candidates) {
            try {
                const resp = await fetch(url.toString(), {
                    method,
                    headers: { ...h, ...(headers || {}) },
                    body: body ? JSON.stringify(body) : undefined
                });
                if (!resp.ok) {
                    if (resp.status === 401 && candidates.length > 1) continue;
                    const text = await resp.text();
                    const err = { message: text || resp.statusText, http_status: resp.status };
                    throw err;
                }
                return resp.status === 204 ? {} : await resp.json();
            } catch (err) {
                lastErr = err;
                if (err.http_status === 401 && candidates.length > 1) continue;
                throw err;
            }
        }
        throw lastErr;
    }

    async function zFetchWithFallback(pathParts, options = {}) {
        let lastErr;
        for (const pathPart of pathParts) {
            try { return await zFetch(pathPart, options); } catch (err) {
                lastErr = err;
                if (err.http_status === 404) continue;
                throw err;
            }
        }
        throw lastErr;
    }

    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    // --- SYSTEM ---
    server.tool('zephyr_enterprise_health', {}, async () => {
        try { 
            await ensureConnected(); 
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, identity: sessionConfig.identity, api_family: sessionConfig.api_family, mode: sessionConfig.proxyUrl ? 'proxy' : 'direct' }) }] }; 
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    server.tool('zephyr_enterprise_configure', {
        base_url: z.string().optional(),
        username: z.string().optional(),
        token: z.string().optional(),
        password: z.string().optional(),
        project_id: z.number().optional()
    }, async (args) => {
        if (args.base_url) sessionConfig.base_url = normalizeBaseUrl(args.base_url);
        if (args.username) sessionConfig.username = args.username;
        if (args.token) sessionConfig.token = args.token;
        if (args.password) sessionConfig.password = args.password;
        if (args.project_id) sessionConfig.project_id = args.project_id;
        sessionConfig.api_family = undefined; // Trigger re-detection
        try {
            await ensureConnected();
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, identity: sessionConfig.identity }) }] };
        } catch (e) {
            return { isError: true, content: [{ type: 'text', text: e.message }] };
        }
    });

    server.tool('zephyr_enterprise_get_context', {}, async () => {
        try { 
            const path = sessionConfig.api_family === API_FAMILY.FLEX ? 'flex/services/rest/latest/project' : 'public/rest/api/1.0/projects';
            const data = await zFetch(path);
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    // --- DISCOVERY ---
    server.tool('zephyr_enterprise_list_projects', {}, async () => {
        try { 
            const data = await zFetchWithFallback(['public/rest/api/1.0/projects', 'flex/services/rest/latest/project']);
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    server.tool('zephyr_enterprise_list_folders', { project_id: z.number().optional() }, async (args) => {
        try {
            const pid = args.project_id || sessionConfig.project_id;
            const data = await zFetch(`public/rest/api/1.0/folders?projectId=${pid}`);
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    server.tool('zephyr_enterprise_list_tcr_folders', { release_id: z.number().optional(), parent_id: z.number().optional() }, async (args) => {
        try {
            const rid = args.release_id || sessionConfig.release_id;
            let path = sessionConfig.api_family === API_FAMILY.FLEX ? `flex/services/rest/latest/testcasetree?releaseid=${rid}` : `public/rest/api/1.0/folders?releaseId=${rid}`;
            if (args.parent_id) path = sessionConfig.api_family === API_FAMILY.FLEX ? `flex/services/rest/latest/testcasetree/${args.parent_id}` : `public/rest/api/1.0/folders/${args.parent_id}`;
            const data = await zFetch(path);
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    server.tool('zephyr_enterprise_create_tcr_folder', { 
        name: z.string(), 
        description: z.string().optional(), 
        release_id: z.number().optional(), 
        parent_id: z.number().optional(), 
        confirm: z.boolean() 
    }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: `CONFIRMATION_REQUIRED: Create folder "${args.name}"? Set confirm: true to proceed.` }] };
        try {
            const rid = args.release_id || sessionConfig.release_id;
            const parentId = args.parent_id || 0;
            const path = sessionConfig.api_family === API_FAMILY.FLEX 
                ? `flex/services/rest/latest/testcasetree?parentid=${parentId}`
                : `public/rest/api/1.0/folders`;
            
            const payload = sessionConfig.api_family === API_FAMILY.FLEX
                ? { name: args.name, description: args.description || '', type: parentId === 0 ? 'Phase' : 'Module', releaseId: rid }
                : { name: args.name, description: args.description || '', projectId: sessionConfig.project_id, releaseId: rid, parentId: parentId };

            const data = await zFetch(path, { method: 'POST', body: payload });
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    server.tool('zephyr_enterprise_search_test_cases', { query: z.string(), limit: z.number().optional() }, async (args) => {
        try {
            const path = sessionConfig.api_family === API_FAMILY.FLEX ? `flex/services/rest/latest/advancesearch?word=${args.query}&entitytype=testcase` : 'public/rest/api/1.0/testcases/search';
            const body = sessionConfig.api_family === API_FAMILY.FLEX ? undefined : { search: args.query, projectId: sessionConfig.project_id, maxRecords: args.limit || 50 };
            const data = await zFetch(path, { method: sessionConfig.api_family === API_FAMILY.FLEX ? 'GET' : 'POST', body });
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    server.tool('zephyr_enterprise_get_test_case', { id: z.number() }, async (args) => {
        try {
            const path = sessionConfig.api_family === API_FAMILY.FLEX ? `/flex/services/rest/latest/testcase/${args.id}` : `/public/rest/api/1.0/testcases/${args.id}`;
            const data = await zFetch(path);
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    // --- MUTATIONS ---
    server.tool('zephyr_enterprise_create_test_case',
        {
            name: z.string(),
            description: z.string().optional(),
            folder_id: z.number().optional(),
            steps: z.array(z.object({ step: z.string(), data: z.string().optional(), result: z.string().optional() })).optional(),
            confirm: z.boolean().describe('Safety gate')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
            try {
                const path = sessionConfig.api_family === API_FAMILY.FLEX ? 'flex/services/rest/latest/testcase' : 'public/rest/api/1.0/testcase';
                const body = sessionConfig.api_family === API_FAMILY.FLEX 
                    ? { tcrCatalogTreeId: args.folder_id, testcase: { name: args.name, description: args.description } }
                    : { name: args.name, description: args.description, folderId: args.folder_id, projectId: sessionConfig.project_id };
                const data = await zFetch(path, { method: 'POST', body });
                
                const testCaseId = (Array.isArray(data) && data[0]?.testcase?.id) || data.id || data.testcase?.id;

                if (args.steps && args.steps.length > 0 && testCaseId) {
                    const stepPath = sessionConfig.api_family === API_FAMILY.FLEX ? `flex/services/rest/latest/teststep/${testCaseId}` : `public/rest/api/1.0/teststep/${testCaseId}`;
                    const stepsRes = await Promise.all(args.steps.map(s => 
                        zFetch(stepPath, { 
                            method: 'POST', 
                            body: { step: s.step, data: s.data || '', result: s.result || '' } 
                        }).catch(e => ({ error: e.message }))
                    ));
                    return { content: [{ type: 'text', text: JSON.stringify({ testcase: data, steps: stepsRes }) }] };
                }

                return { content: [{ type: 'text', text: JSON.stringify(data) }] };
            } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
        }
    );

    server.tool('zephyr_enterprise_update_test_case', { 
        id: z.number(), 
        name: z.string().optional(), 
        steps: z.array(z.object({ step: z.string(), data: z.string().optional(), result: z.string().optional() })).optional(),
        confirm: z.boolean() 
    }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
        try {
            let data = { id: args.id };

            if (args.name) {
                const path = sessionConfig.api_family === API_FAMILY.FLEX ? 'flex/services/rest/latest/testcase' : `public/rest/api/1.0/testcases/${args.id}`;
                const body = sessionConfig.api_family === API_FAMILY.FLEX ? { testcase: { testcaseId: args.id, name: args.name } } : { name: args.name };
                data = await zFetch(path, { method: 'PUT', body });
            }

            if (args.steps && args.steps.length > 0) {
                const stepPath = sessionConfig.api_family === API_FAMILY.FLEX ? `flex/services/rest/latest/teststep/${args.id}` : `public/rest/api/1.0/teststep/${args.id}`;
                const stepsRes = await Promise.all(args.steps.map(s => 
                    zFetch(stepPath, { 
                        method: 'POST', 
                        body: { step: s.step, data: s.data || '', result: s.result || '' } 
                    }).catch(e => ({ error: e.message }))
                ));
                return { content: [{ type: 'text', text: JSON.stringify({ testcase: data, added_steps: stepsRes }) }] };
            }

            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    server.tool('zephyr_enterprise_create_cycle', { name: z.string(), confirm: z.boolean() }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
        try {
            const data = await zFetch('public/rest/api/1.0/cycles', { method: 'POST', body: { name: args.name, projectId: sessionConfig.project_id } });
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    server.tool('zephyr_enterprise_add_phase_to_cycle', { cycle_id: z.number(), name: z.string(), confirm: z.boolean() }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
        try {
            const data = await zFetch(`public/rest/api/1.0/cycle/${args.cycle_id}/phase`, { method: 'POST', body: { name: args.name } });
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    server.tool('zephyr_enterprise_add_test_cases_to_cycle', { cycle_id: z.number(), test_case_ids: z.array(z.number()), confirm: z.boolean() }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
        try {
            const data = await zFetch('public/rest/api/1.0/executions', { method: 'POST', body: { cycleId: args.cycle_id, testCaseIds: args.test_case_ids, projectId: sessionConfig.project_id } });
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    server.tool('zephyr_enterprise_update_execution', { execution_id: z.number(), status: z.string(), confirm: z.boolean() }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
        try {
            const data = await zFetch(`public/rest/api/1.0/executions/${args.execution_id}`, { method: 'PUT', body: { status: args.status } });
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    server.tool('zephyr_enterprise_attach_evidence', { execution_id: z.number(), name: z.string(), content_type: z.string(), data_base64: z.string(), confirm: z.boolean() }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
        try {
            await fetch(`${sessionConfig.base_url}/public/rest/api/1.0/executions/${args.execution_id}/attachments`, {
                method: 'POST',
                headers: { 'Authorization': sessionConfig.token ? `Bearer ${sessionConfig.token}` : undefined, 'X-Zephyr-Filename': args.name, 'Content-Type': args.content_type },
                body: Buffer.from(args.data_base64, 'base64')
            });
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    server.tool('zephyr_enterprise_publish_automation_results', { results: z.array(z.any()), confirm: z.boolean() }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
        try {
            const body = { projectId: sessionConfig.project_id, testCases: args.results };
            const data = await zFetch('public/rest/api/1.0/automation/executions', { method: 'POST', body });
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    server.tool('zephyr_enterprise_create_release',
        {
            name: z.string(),
            description: z.string().optional(),
            confirm: z.boolean()
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
            try {
                const path = sessionConfig.api_family === API_FAMILY.FLEX ? 'flex/services/rest/v3/release' : 'public/rest/api/1.0/releases';
                const body = sessionConfig.api_family === API_FAMILY.FLEX ? { release: { name: args.name, projectId: sessionConfig.project_id } } : { name: args.name, projectId: sessionConfig.project_id };
                const data = await zFetch(path, { method: 'POST', body });
                return { content: [{ type: 'text', text: JSON.stringify(data) }] };
            } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
        }
    );

    server.tool('zephyr_enterprise_update_release', { id: z.number(), name: z.string(), confirm: z.boolean() }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
        try {
            const data = await zFetch(`public/rest/api/1.0/releases/${args.id}`, { method: 'PUT', body: { name: args.name } });
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    server.tool('zephyr_enterprise_delete_release', { id: z.number(), confirm: z.boolean() }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
        try {
            await zFetch(`public/rest/api/1.0/releases/${args.id}`, { method: 'DELETE' });
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    server.tool('zephyr_enterprise_update_test_step', { test_step_id: z.number(), step: z.string(), confirm: z.boolean() }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
        try {
            const stepPath = sessionConfig.api_family === API_FAMILY.FLEX ? `flex/services/rest/latest/teststep/${args.test_step_id}` : `public/rest/api/1.0/teststep/${args.test_step_id}`;
            const data = await zFetch(stepPath, { method: 'PUT', body: { step: args.step } });
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    server.tool('zephyr_enterprise_add_test_step', { 
        test_case_id: z.number(), 
        step: z.string(), 
        data: z.string().optional(),
        result: z.string().optional(),
        confirm: z.boolean() 
    }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
        try {
            const body = { step: args.step, data: args.data || '', result: args.result || '' };
            const stepPath = sessionConfig.api_family === API_FAMILY.FLEX ? `flex/services/rest/latest/teststep/${args.test_case_id}` : `public/rest/api/1.0/teststep/${args.test_case_id}`;
            const data = await zFetch(stepPath, { method: 'POST', body });
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    server.tool('zephyr_enterprise_link_defect', { execution_id: z.number(), defect_id: z.string(), confirm: z.boolean() }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
        try {
            const data = await zFetch(`public/rest/api/1.0/executions/${args.execution_id}/execute`, { method: 'PUT', body: { updateDefectList: "true", defectList: [args.defect_id] } });
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    server.tool('zephyr_enterprise_link_requirement', { test_case_id: z.number(), requirement_id: z.string(), confirm: z.boolean() }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
        try {
            const data = await zFetch('public/rest/api/1.0/requirements/map', { method: 'POST', body: { testcaseIds: [args.test_case_id], requirementIds: [args.requirement_id] } });
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    // --- DISCOVERY/METADATA ---
    server.tool('zephyr_enterprise_list_cycles', { release_id: z.number().optional() }, async (args) => {
        try {
            const rid = args.release_id || sessionConfig.release_id;
            const data = await zFetch(`public/rest/api/1.0/cycles/search?versionId=${rid}&projectId=${sessionConfig.project_id}`);
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    server.tool('zephyr_enterprise_list_executions', { cycle_id: z.number() }, async (args) => {
        try {
            const data = await zFetch(`public/rest/api/1.0/executions/search?projectId=${sessionConfig.project_id}&cycleId=${args.cycle_id}`);
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    server.tool('zephyr_enterprise_get_job_status', { ticket_id: z.string() }, async (args) => {
        try {
            const data = await zFetch(`public/rest/api/1.0/jobprogress/${args.ticket_id}`);
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    server.tool('zephyr_enterprise_list_releases', { project_id: z.number().optional() }, async (args) => {
        try {
            const pid = args.project_id || sessionConfig.project_id;
            const data = await zFetch(`public/rest/api/1.0/releases?projectId=${pid}`);
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    server.tool('zephyr_enterprise_list_users', {}, async () => {
        try {
            const data = await zFetch('public/rest/api/1.0/users');
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    server.tool('zephyr_enterprise_get_me', {}, async () => {
        try {
            const data = await zFetch('public/rest/api/1.0/users/me');
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    server.tool('zephyr_enterprise_list_custom_fields', {}, async () => {
        try {
            const data = await zFetch('public/rest/api/1.0/customfields');
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    server.tool('zephyr_enterprise_get_test_steps', { test_case_id: z.number() }, async (args) => {
        try {
            const data = await zFetch(`public/rest/api/1.0/teststep/${args.test_case_id}`);
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    });

    server.__test = {
        sessionConfig,
        normalizeBaseUrl,
        getHeaderCandidates,
        zFetch,
        zFetchWithFallback,
        setConfig: (next) => { sessionConfig = { ...sessionConfig, ...next }; },
        getConfig: () => ({ ...sessionConfig })
    };

    return server;
}

if (require.main === module) {
    const serverInstance = createZephyrEnterpriseServer();
    const transport = new StdioServerTransport();
    serverInstance.connect(transport);
}

module.exports = { createZephyrEnterpriseServer };
