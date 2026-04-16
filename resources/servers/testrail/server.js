const axios = require('axios');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const SERVER_INFO = { name: 'testrail-mcp', version: '2.0.0' };

const SERVER_INFO = { name: 'testrail-mcp', version: '2.0.0' };

function normalizeUrl(url) {
    if (!url) return '';
    return url.trim()
        .replace(/\/index\.php\?\/api\/v2$/i, '')
        .replace(/\/api\/v2$/i, '')
        .replace(/\/index\.php$/i, '')
        .replace(/\/+$/, '');
}

function createTestRailServer() {
    let sessionConfig = {
        baseUrl: process.env.TESTRAIL_BASE_URL,
        username: process.env.TESTRAIL_USERNAME,
        apiKey: process.env.TESTRAIL_API_KEY,
        projectId: process.env.TESTRAIL_PROJECT_ID ? Number(process.env.TESTRAIL_PROJECT_ID) : undefined,
        proxyUrl: process.env.FLOCCA_PROXY_URL,
        userId: process.env.FLOCCA_USER_ID
    };

    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });
    let api = null;

    function getHeaderCandidates() {
        const candidates = [];
        const { username, apiKey, userId, proxyUrl } = sessionConfig;

        if (proxyUrl && userId) {
            candidates.push({ 'X-Flocca-User-ID': userId });
        }

        if (username && apiKey) {
            const auth = Buffer.from(`${username}:${apiKey}`).toString('base64');
            candidates.push({ 'Authorization': `Basic ${auth}` });
        }

        return candidates;
    }

    function getBaseUrlCandidates() {
        const candidates = [];
        const { proxyUrl, baseUrl } = sessionConfig;

        if (proxyUrl) {
            candidates.push(proxyUrl.replace(/\/+$/, '') + '/index.php?/api/v2');
        }

        if (baseUrl) {
            const normalized = normalizeUrl(baseUrl);
            candidates.push(`${normalized}/index.php?/api/v2`);
            // Some enterprise versions might use just /api/v2
            candidates.push(`${normalized}/api/v2`);
        }

        return [...new Set(candidates)];
    }

    async function ensureConnected() {
        const headers = getHeaderCandidates();
        if (headers.length === 0) {
            // Re-read env for dynamic updates
            sessionConfig.baseUrl = process.env.TESTRAIL_BASE_URL;
            sessionConfig.username = process.env.TESTRAIL_USERNAME;
            sessionConfig.apiKey = process.env.TESTRAIL_API_KEY;
            sessionConfig.proxyUrl = process.env.FLOCCA_PROXY_URL;
            sessionConfig.userId = process.env.FLOCCA_USER_ID;
            if (getHeaderCandidates().length === 0) {
                throw new Error("TestRail Not Configured. Provide TESTRAIL_USERNAME/API_KEY or Proxy.");
            }
        }

        if (!api) {
            const urls = getBaseUrlCandidates();
            api = axios.create({
                baseURL: urls[0],
                headers: { ...headers[0], 'Content-Type': 'application/json' },
                timeout: 10000
            });
        }
        return api;
    }

    async function testrailRequest(config) {
        await ensureConnected();
        const headers = getHeaderCandidates();
        const urls = getBaseUrlCandidates();
        
        let lastError;
        for (const url of urls) {
            for (const header of headers) {
                try {
                    return await axios({
                        ...config,
                        baseURL: url,
                        headers: { ...config.headers, ...header, 'Content-Type': 'application/json' },
                        timeout: config.timeout || 10000
                    });
                } catch (e) {
                    lastError = e;
                    if (e.response?.status === 401 || e.response?.status === 404) continue;
                    throw e;
                }
            }
        }
        throw lastError;
    }

    function normalizeError(err) {
        const data = err.response?.data || {};
        const msg = data.error || err.message || JSON.stringify(data);
        return { isError: true, content: [{ type: 'text', text: `TestRail Error: ${msg}` }] };
    }

    // --- TOOLS ---
    server.tool('testrail_health', {}, async () => {
        try {
            await testrailRequest({ method: 'GET', url: 'get_projects' });
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, mode: sessionConfig.proxyUrl ? 'proxy' : 'direct' }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('testrail_configure',
        {
            base_url: z.string().optional(),
            username: z.string().optional(),
            api_key: z.string().optional(),
            project_id: z.number().int().optional()
        },
        async (args) => {
            if (args.base_url) sessionConfig.baseUrl = args.base_url;
            if (args.username) sessionConfig.username = args.username;
            if (args.api_key) sessionConfig.apiKey = args.api_key;
            if (args.project_id) sessionConfig.projectId = args.project_id;
            api = null; // Reset client
            try {
                await testrailRequest({ method: 'GET', url: 'get_projects' });
                return { content: [{ type: 'text', text: "TestRail configured and verified successfully." }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('testrail_list_test_cases',
        {
            project_id: z.number().int().optional(),
            suite_id: z.number().int().optional(),
            section_id: z.number().int().optional(),
            limit: z.number().int().optional().default(50)
        },
        async (args) => {
            try {
                const pid = args.project_id || sessionConfig.projectId;
                if (!pid) throw new Error("project_id is required");
                
                const params = { limit: args.limit };
                if (args.suite_id) params.suite_id = args.suite_id;
                if (args.section_id) params.section_id = args.section_id;

                const res = await testrailRequest({ method: 'GET', url: `get_cases/${pid}`, params });
                const cases = (res.data.cases || res.data || []).map(c => ({
                    id: c.id,
                    title: c.title,
                    type_id: c.type_id,
                    priority_id: c.priority_id
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ cases }, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('testrail_get_test_case',
        { case_id: z.number().int() },
        async (args) => {
            try {
                const res = await testrailRequest({ method: 'GET', url: `get_case/${args.case_id}` });
                return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('testrail_create_test_case',
        {
            section_id: z.number().int(),
            title: z.string(),
            custom_steps: z.string().optional(),
            custom_expected: z.string().optional(),
            confirm: z.boolean().describe('Confirm mutation (safety gate)')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set confirm:true to create this test case." }] };
            try {
                const data = {
                    title: args.title,
                    custom_steps: args.custom_steps,
                    custom_expected: args.custom_expected
                };
                const res = await testrailRequest({ method: 'POST', url: `add_case/${args.section_id}`, data });
                return { content: [{ type: 'text', text: JSON.stringify({ id: res.data.id, url: res.data.url }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('testrail_create_test_run',
        {
            project_id: z.number().int().optional(),
            name: z.string(),
            description: z.string().optional(),
            suite_id: z.number().int().optional(),
            include_all: z.boolean().optional().default(true),
            case_ids: z.array(z.number().int()).optional(),
            confirm: z.boolean().describe('Confirm mutation (safety gate)')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set confirm:true to create this test run." }] };
            try {
                const pid = args.project_id || sessionConfig.projectId;
                if (!pid) throw new Error("project_id is required");
                
                const data = {
                    name: args.name,
                    description: args.description,
                    suite_id: args.suite_id,
                    include_all: args.include_all,
                    case_ids: args.case_ids
                };
                const res = await testrailRequest({ method: 'POST', url: `add_run/${pid}`, data });
                return { content: [{ type: 'text', text: JSON.stringify({ id: res.data.id, url: res.data.url }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('testrail_add_test_result',
        {
            test_id: z.number().int(),
            status: z.enum(['passed', 'blocked', 'untested', 'retest', 'failed']),
            comment: z.string().optional(),
            elapsed: z.string().optional(),
            version: z.string().optional(),
            defects: z.string().optional(),
            confirm: z.boolean().describe('Confirm mutation (safety gate)')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set confirm:true to add result." }] };
            const statusMap = { passed: 1, blocked: 2, untested: 3, retest: 4, failed: 5 };
            try {
                const data = {
                    status_id: statusMap[args.status],
                    comment: args.comment,
                    elapsed: args.elapsed,
                    version: args.version,
                    defects: args.defects
                };
                const res = await testrailRequest({ method: 'POST', url: `add_result/${args.test_id}`, data });
                return { content: [{ type: 'text', text: JSON.stringify({ id: res.data.id, status_id: res.data.status_id }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('testrail_close_test_run',
        {
            run_id: z.number().int(),
            confirm: z.boolean().describe('Confirm mutation (safety gate)')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set confirm:true to close this run." }] };
            try {
                const res = await testrailRequest({ method: 'POST', url: `close_run/${args.run_id}` });
                return { content: [{ type: 'text', text: JSON.stringify({ id: res.data.id, is_completed: res.data.is_completed }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('testrail_map_automated_results',
        {
            run_id: z.number().int(),
            results: z.array(z.object({
                case_id: z.number().int(),
                status: z.enum(['passed', 'blocked', 'untested', 'retest', 'failed']),
                comment: z.string().optional()
            })),
            confirm: z.boolean().describe('Confirm mutation (safety gate)')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set confirm:true to post batch results." }] };
            const statusMap = { passed: 1, blocked: 2, untested: 3, retest: 4, failed: 5 };
            try {
                const payload = {
                    results: args.results.map(r => ({
                        case_id: r.case_id,
                        status_id: statusMap[r.status],
                        comment: r.comment
                    }))
                };
                const res = await testrailRequest({ method: 'POST', url: `add_results_for_cases/${args.run_id}`, data: payload });
                return { content: [{ type: 'text', text: JSON.stringify({ count: res.data.length || 0 }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.__test = {
        sessionConfig,
        ensureConnected,
        testrailRequest,
        getHeaderCandidates,
        getBaseUrlCandidates,
        setConfig: (next) => { sessionConfig = { ...sessionConfig, ...next }; api = null; },
        getConfig: () => ({ ...sessionConfig })
    };

    return server;
}

if (require.main === module) {
    const serverInstance = createTestRailServer();
    const transport = new StdioServerTransport();
    serverInstance.connect(transport).then(() => {
        console.error('TestRail MCP server running on stdio');
    }).catch(error => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createTestRailServer };
