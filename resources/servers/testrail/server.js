const path = require('path');

const { McpServer } = require(path.join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js'));
const { StdioServerTransport } = require(path.join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/stdio.js'));

const SERVER_INFO = { name: 'testrail-mcp', version: '0.1.0' };

const sessionConfig = {
    baseUrl: process.env.TESTRAIL_BASE_URL,
    auth: (process.env.TESTRAIL_USERNAME && process.env.TESTRAIL_API_KEY) ? {
        username: process.env.TESTRAIL_USERNAME,
        api_key: process.env.TESTRAIL_API_KEY,
        type: 'apikey'
    } : undefined,
    projectId: process.env.TESTRAIL_PROJECT_ID ? Number(process.env.TESTRAIL_PROJECT_ID) : undefined,
    suiteId: process.env.TESTRAIL_SUITE_ID ? Number(process.env.TESTRAIL_SUITE_ID) : undefined,
    runDefaults: undefined
};

class TRLError extends Error {
    constructor(message, { code = 500, details } = {}) {
        super(message);
        this.code = code;
        this.details = details;
    }
}

function requireConfigured() {
    if (!sessionConfig.baseUrl || !sessionConfig.auth || !sessionConfig.projectId) {
        throw new TRLError('TestRail is not configured. Call testrail.configure first.', { code: 400 });
    }
}

function authHeaders() {
    if (!sessionConfig.auth) return {};
    const { username, api_key } = sessionConfig.auth;
    const encoded = Buffer.from(`${username}:${api_key}`).toString('base64');
    return { Authorization: `Basic ${encoded}` };
}

function errorResult(err, operation) {
    const payload = {
        error: {
            message: err.message || 'TestRail error',
            code: err.code || 500,
            details: err.details,
            operation
        }
    };
    return { isError: true, content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

async function trlFetch(pathPart, { method = 'GET', body, query } = {}) {
    const url = new URL(`${sessionConfig.baseUrl}/${pathPart}`);
    if (query) {
        Object.entries(query).forEach(([k, v]) => {
            if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
        });
    }

    const resp = await fetch(url.toString(), {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders()
        },
        body: body ? JSON.stringify(body) : undefined
    });

    let data;
    try {
        data = await resp.json();
    } catch (e) {
        data = {};
    }

    if (!resp.ok) {
        throw new TRLError(data.error || `HTTP ${resp.status}`, { code: resp.status, details: data });
    }
    if (data.error) {
        throw new TRLError(data.error, { code: resp.status, details: data });
    }
    return data;
}

async function validateConfig(args) {
    const { base_url, auth, project_id } = args;
    if (!base_url || !auth || !auth.username || !auth.api_key || !project_id) {
        throw new TRLError('Missing required configuration fields', { code: 400 });
    }
    // Simple validation: fetch projects
    const encoded = Buffer.from(`${auth.username}:${auth.api_key}`).toString('base64');
    const resp = await fetch(`${base_url}/index.php?/api/v2/get_projects`, {
        headers: { Authorization: `Basic ${encoded}` }
    });
    if (!resp.ok) {
        throw new TRLError('Authentication failed', { code: resp.status, details: await resp.text() });
    }
    const projects = await resp.json();
    const found = (projects || []).find((p) => p.id === project_id);
    if (!found) {
        throw new TRLError('Project not found or inaccessible', { code: 404 });
    }
}

async function main() {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    server.registerTool(
        'testrail.health',
        {
            description: 'Health check for TestRail MCP server.',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false }
        },
        async () => ({ content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] })
    );

    server.registerTool(
        'testrail.configure',
        {
            description: 'Configure TestRail connection for this session.',
            inputSchema: {
                type: 'object',
                properties: {
                    base_url: { type: 'string' },
                    auth: {
                        type: 'object',
                        properties: {
                            type: { type: 'string', enum: ['apikey'], default: 'apikey' },
                            username: { type: 'string' },
                            api_key: { type: 'string' }
                        },
                        required: ['username', 'api_key']
                    },
                    project_id: { type: 'number' },
                    suite_id: { type: 'number' },
                    run_defaults: { type: 'object' }
                },
                required: ['base_url', 'auth', 'project_id'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                await validateConfig(args);
                sessionConfig.baseUrl = args.base_url.replace(/\/+$/, '');
                sessionConfig.auth = args.auth;
                sessionConfig.projectId = args.project_id;
                sessionConfig.suiteId = args.suite_id;
                sessionConfig.runDefaults = args.run_defaults;
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
            } catch (err) {
                return errorResult(err, 'testrail.configure');
            }
        }
    );

    server.registerTool(
        'testrail.listTestCases',
        {
            description: 'List TestRail test cases with optional suite/section filters.',
            inputSchema: {
                type: 'object',
                properties: {
                    suite_id: { type: 'number' },
                    section_id: { type: 'number' },
                    limit: { type: 'number' },
                    offset: { type: 'number' }
                },
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const suiteId = args.suite_id || sessionConfig.suiteId;
                const query = {};
                if (args.section_id) query.section_id = args.section_id;
                if (args.limit) query.limit = args.limit;
                if (args.offset) query.offset = args.offset;
                const pathPart = suiteId
                    ? `index.php?/api/v2/get_cases/${sessionConfig.projectId}&suite_id=${suiteId}`
                    : `index.php?/api/v2/get_cases/${sessionConfig.projectId}`;
                const data = await trlFetch(pathPart, { query });
                const cases = (data || []).map((c) => ({
                    id: c.id,
                    title: c.title,
                    type_id: c.type_id,
                    priority_id: c.priority_id,
                    section_id: c.section_id,
                    custom_automation_type: c.custom_automation_type
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ cases }) }] };
            } catch (err) {
                return errorResult(err, 'testrail.listTestCases');
            }
        }
    );

    server.registerTool(
        'testrail.getTestCase',
        {
            description: 'Get full details for a TestRail case.',
            inputSchema: { type: 'object', properties: { case_id: { type: 'number' } }, required: ['case_id'], additionalProperties: false }
        },
        async (args) => {
            try {
                requireConfigured();
                const data = await trlFetch(`index.php?/api/v2/get_case/${args.case_id}`);
                const result = {
                    id: data.id,
                    title: data.title,
                    custom_preconds: data.custom_preconds,
                    custom_steps: data.custom_steps,
                    custom_expected: data.custom_expected,
                    custom_automation_type: data.custom_automation_type,
                    custom_fields: Object.fromEntries(Object.entries(data).filter(([k]) => k.startsWith('custom_')))
                };
                return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            } catch (err) {
                return errorResult(err, 'testrail.getTestCase');
            }
        }
    );

    server.registerTool(
        'testrail.createTestCase',
        {
            description: 'Create a new TestRail case.',
            inputSchema: {
                type: 'object',
                properties: {
                    suite_id: { type: 'number' },
                    section_id: { type: 'number' },
                    title: { type: 'string' },
                    custom_steps: { type: 'array', items: { type: 'string' } },
                    custom_expected: { type: 'string' },
                    fields: { type: 'object' }
                },
                required: ['section_id', 'title'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const payload = {
                    title: args.title,
                    ...(args.custom_steps ? { custom_steps: args.custom_steps } : {}),
                    ...(args.custom_expected ? { custom_expected: args.custom_expected } : {}),
                    ...(args.fields || {})
                };
                if (args.suite_id) payload.suite_id = args.suite_id;
                const data = await trlFetch(`index.php?/api/v2/add_case/${args.section_id}`, {
                    method: 'POST',
                    body: payload
                });
                return { content: [{ type: 'text', text: JSON.stringify({ id: data.id, url: data.url }) }] };
            } catch (err) {
                return errorResult(err, 'testrail.createTestCase');
            }
        }
    );

    server.registerTool(
        'testrail.createTestRun',
        {
            description: 'Create a test run.',
            inputSchema: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    case_ids: { type: 'array', items: { type: 'number' } },
                    description: { type: 'string' },
                    include_all: { type: 'boolean' },
                    suite_id: { type: 'number' }
                },
                required: ['name'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const payload = {
                    name: args.name,
                    include_all: args.include_all ?? false,
                    ...(args.case_ids ? { case_ids: args.case_ids } : {}),
                    ...(args.description ? { description: args.description } : {}),
                    ...(args.suite_id ? { suite_id: args.suite_id } : {}),
                    ...(sessionConfig.runDefaults || {})
                };
                const data = await trlFetch(`index.php?/api/v2/add_run/${sessionConfig.projectId}`, {
                    method: 'POST',
                    body: payload
                });
                return { content: [{ type: 'text', text: JSON.stringify({ id: data.id, url: data.url }) }] };
            } catch (err) {
                return errorResult(err, 'testrail.createTestRun');
            }
        }
    );

    server.registerTool(
        'testrail.closeTestRun',
        {
            description: 'Close a test run.',
            inputSchema: { type: 'object', properties: { run_id: { type: 'number' } }, required: ['run_id'], additionalProperties: false }
        },
        async (args) => {
            try {
                requireConfigured();
                const data = await trlFetch(`index.php?/api/v2/close_run/${args.run_id}`, { method: 'POST' });
                return { content: [{ type: 'text', text: JSON.stringify({ id: data.id, is_completed: data.is_completed }) }] };
            } catch (err) {
                return errorResult(err, 'testrail.closeTestRun');
            }
        }
    );

    server.registerTool(
        'testrail.addTestResult',
        {
            description: 'Add a test result to a test.',
            inputSchema: {
                type: 'object',
                properties: {
                    test_id: { type: 'number' },
                    status: { type: 'string', enum: ['passed', 'failed', 'blocked', 'retest'] },
                    comment: { type: 'string' },
                    elapsed: { type: 'string' },
                    defects: { type: 'string' }
                },
                required: ['test_id', 'status'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const statusMap = { passed: 1, blocked: 2, untested: 3, retest: 4, failed: 5 };
                const payload = {
                    status_id: statusMap[args.status],
                    ...(args.comment ? { comment: args.comment } : {}),
                    ...(args.elapsed ? { elapsed: args.elapsed } : {}),
                    ...(args.defects ? { defects: args.defects } : {})
                };
                const data = await trlFetch(`index.php?/api/v2/add_result/${args.test_id}`, {
                    method: 'POST',
                    body: payload
                });
                return { content: [{ type: 'text', text: JSON.stringify({ id: data.id, status_id: data.status_id }) }] };
            } catch (err) {
                return errorResult(err, 'testrail.addTestResult');
            }
        }
    );

    server.registerTool(
        'testrail.mapAutomatedResults',
        {
            description: 'Map automated test results to TestRail cases and post in batch.',
            inputSchema: {
                type: 'object',
                properties: {
                    run_id: { type: 'number' },
                    results: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                case_id: { type: 'number' },
                                status: { type: 'string', enum: ['passed', 'failed', 'blocked', 'retest'] },
                                comment: { type: 'string' }
                            },
                            required: ['case_id', 'status']
                        }
                    }
                },
                required: ['run_id', 'results'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const statusMap = { passed: 1, blocked: 2, retest: 4, failed: 5 };
                const payload = {
                    results: args.results.map((r) => ({
                        case_id: r.case_id,
                        status_id: statusMap[r.status],
                        comment: r.comment
                    }))
                };
                const data = await trlFetch(`index.php?/api/v2/add_results_for_cases/${args.run_id}`, {
                    method: 'POST',
                    body: payload
                });
                return { content: [{ type: 'text', text: JSON.stringify({ count: (data || []).length }) }] };
            } catch (err) {
                return errorResult(err, 'testrail.mapAutomatedResults');
            }
        }
    );

    server.registerTool(
        'testrail.searchCases',
        {
            description: 'Search cases by title, section, priority, or custom fields (simple filter).',
            inputSchema: {
                type: 'object',
                properties: {
                    suite_id: { type: 'number' },
                    text: { type: 'string' },
                    section_id: { type: 'number' },
                    priority_id: { type: 'number' }
                },
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const list = await server.tools['testrail.listTestCases'].handler(args);
                if (list.isError) return list;
                const parsed = JSON.parse(list.content[0].text);
                let cases = parsed.cases || [];
                if (args.text) cases = cases.filter((c) => (c.title || '').toLowerCase().includes(args.text.toLowerCase()));
                if (args.section_id) cases = cases.filter((c) => c.section_id === args.section_id);
                if (args.priority_id) cases = cases.filter((c) => c.priority_id === args.priority_id);
                return { content: [{ type: 'text', text: JSON.stringify({ cases }) }] };
            } catch (err) {
                return errorResult(err, 'testrail.searchCases');
            }
        }
    );

    server.registerTool(
        'testrail.searchRuns',
        {
            description: 'Search runs by name/status creator/date (simple filter).',
            inputSchema: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    is_completed: { type: 'boolean' }
                },
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const data = await trlFetch(`index.php?/api/v2/get_runs/${sessionConfig.projectId}`);
                let runs = data || [];
                if (args.name) runs = runs.filter((r) => (r.name || '').toLowerCase().includes(args.name.toLowerCase()));
                if (args.is_completed !== undefined) runs = runs.filter((r) => !!r.is_completed === !!args.is_completed);
                return { content: [{ type: 'text', text: JSON.stringify({ runs }) }] };
            } catch (err) {
                return errorResult(err, 'testrail.searchRuns');
            }
        }
    );

    // Optional MVP placeholders for plans (phase 2)
    server.registerTool(
        'testrail.listTestPlans',
        {
            description: 'List test plans (optional MVP).',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false }
        },
        async () => {
            try {
                requireConfigured();
                const data = await trlFetch(`index.php?/api/v2/get_plans/${sessionConfig.projectId}`);
                return { content: [{ type: 'text', text: JSON.stringify({ plans: data || [] }) }] };
            } catch (err) {
                return errorResult(err, 'testrail.listTestPlans');
            }
        }
    );

    server.server.oninitialized = () => {
        console.log('TestRail MCP server initialized.');
    };

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.log('TestRail MCP server running on stdio.');
}

main().catch((err) => {
    console.error('TestRail MCP server failed to start:', err);
    process.exit(1);
});
