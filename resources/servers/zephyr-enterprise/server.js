const path = require('path');

const { McpServer } = require(path.join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js'));
const { StdioServerTransport } = require(path.join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/stdio.js'));

const SERVER_INFO = { name: 'zephyr-enterprise-mcp', version: '0.1.0' };

const sessionConfig = {
    base_url: process.env.ZEPHYR_ENT_BASE_URL || undefined,
    auth: process.env.ZEPHYR_ENT_TOKEN
        ? { type: 'api_token', username: process.env.ZEPHYR_ENT_USERNAME, token: process.env.ZEPHYR_ENT_TOKEN }
        : (process.env.ZEPHYR_ENT_PASSWORD ? { type: 'basic', username: process.env.ZEPHYR_ENT_USERNAME, password: process.env.ZEPHYR_ENT_PASSWORD } : undefined),
    project: process.env.ZEPHYR_ENT_PROJECT_ID
        ? { id: parseInt(process.env.ZEPHYR_ENT_PROJECT_ID) }
        : (process.env.ZEPHYR_ENT_PROJECT_KEY ? { key: process.env.ZEPHYR_ENT_PROJECT_KEY } : undefined),
    read_only: false,
    identity: undefined,
    version: undefined
};

const GUARDRAILS = {
    max_batch_results: 2000,
    max_attachment_size_bytes: 5 * 1024 * 1024 // 5MB
};

function normalizeError(message, code = 'ZEPHYR_ENTERPRISE_ERROR', details, http_status) {
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { message, code, details, http_status } }) }] };
}

function requireConfigured() {
    if (!sessionConfig.base_url || !sessionConfig.auth) {
        throw { message: 'Zephyr Enterprise not configured. Call zephyr_enterprise.configure first.', code: 'AUTH_FAILED' };
    }
}

function ensureWritable() {
    if (sessionConfig.read_only) {
        throw { message: 'Read-only mode enabled', code: 'READ_ONLY_MODE' };
    }
}

function authHeaders() {
    if (!sessionConfig.auth) return {};
    if (sessionConfig.auth.type === 'api_token') {
        const { username, token } = sessionConfig.auth;
        const encoded = Buffer.from(`${username}:${token}`).toString('base64');
        return { Authorization: `Basic ${encoded}` };
    }
    if (sessionConfig.auth.type === 'basic') {
        const { username, password } = sessionConfig.auth;
        const encoded = Buffer.from(`${username}:${password}`).toString('base64');
        return { Authorization: `Basic ${encoded}` };
    }
    return {};
}

async function zFetch(pathPart, { method = 'GET', query, body, headers } = {}) {
    const url = new URL(`${sessionConfig.base_url.replace(/\/+$/, '')}/${pathPart.replace(/^\/+/, '')}`);
    if (query) Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null) url.searchParams.set(k, v); });
    const resp = await fetch(url.toString(), {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders(),
            ...(headers || {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    let data = {};
    try { data = await resp.json(); } catch (_) { data = {}; }
    if (!resp.ok || data.error) {
        const detail = data.error || data;
        const message = detail.message || resp.statusText || 'Zephyr Enterprise request failed';
        let code = 'ZEPHYR_ENTERPRISE_ERROR';
        if (resp.status === 401 || resp.status === 403) code = 'PERMISSION_DENIED';
        if (resp.status === 404) code = 'NOT_FOUND';
        if (resp.status === 429) code = 'RATE_LIMITED';
        throw { message, code, details: detail, http_status: resp.status };
    }
    return data;
}

async function validateConfig(args) {
    if (!base) throw { message: 'Missing base_url', code: 'INVALID_REQUEST' };
    if (!args.auth) throw { message: 'Missing auth', code: 'INVALID_REQUEST' };
    // Project is now optional

    sessionConfig.base_url = base;
    sessionConfig.auth = args.auth;
    sessionConfig.project = args.project;
    sessionConfig.read_only = !!args.read_only;

    // Validate API availability and auth via /projects
    const projects = await zFetch('public/rest/api/1.0/projects');
    sessionConfig.version = projects.releaseVersion || projects.version;
    const match = (projects || []).find
        ? projects.find((p) => (args.project.id && p.id === args.project.id) || (args.project.key && p.key === args.project.key))
        : undefined;
    if (!match) throw { message: 'Project not accessible', code: 'INVALID_REQUEST', details: projects };
    sessionConfig.identity = sessionConfig.auth.username || 'api_token_user';
}

async function main() {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    server.registerTool(
        'zephyr_enterprise.health',
        { description: 'Health check for Zephyr Enterprise MCP server.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                requireConfigured();
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, product: 'zephyr_enterprise', version: sessionConfig.version, project: sessionConfig.project }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise.configure',
        {
            description: 'Configure Zephyr Enterprise session.',
            inputSchema: {
                type: 'object',
                properties: {
                    deployment: { type: 'string', enum: ['enterprise'] },
                    base_url: { type: 'string' },
                    auth: {
                        type: 'object',
                        properties: {
                            type: { type: 'string', enum: ['api_token', 'basic'] },
                            username: { type: 'string' },
                            token: { type: 'string' },
                            password: { type: 'string' }
                        },
                        required: ['type', 'username']
                    },
                    project: { type: 'object', properties: { key: { type: 'string' }, id: { type: 'number' } }, required: [] },
                    read_only: { type: 'boolean' }
                },
                required: ['deployment', 'base_url', 'auth', 'project'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                await validateConfig(args);
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, product: 'zephyr_enterprise', project: sessionConfig.project, version: sessionConfig.version }) }] };
            } catch (err) {
                sessionConfig.base_url = undefined;
                sessionConfig.auth = undefined;
                sessionConfig.project = undefined;
                sessionConfig.identity = undefined;
                sessionConfig.version = undefined;
                return normalizeError(err.message, err.code || 'AUTH_FAILED', err.details, err.http_status);
            }
        }
    );

    // Discovery
    server.registerTool(
        'zephyr_enterprise.getContext',
        { description: 'Return Zephyr Enterprise context.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                requireConfigured();
                const projects = await zFetch('public/rest/api/1.0/projects');
                return { content: [{ type: 'text', text: JSON.stringify({ product: 'zephyr_enterprise', version: sessionConfig.version, projects }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise.listProjects',
        { description: 'List Zephyr Enterprise projects.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                requireConfigured();
                const projects = await zFetch('public/rest/api/1.0/projects');
                return { content: [{ type: 'text', text: JSON.stringify({ projects }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise.listFolders',
        { description: 'List folders for a project.', inputSchema: { type: 'object', properties: { project_id: { type: 'number' } }, additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const projectId = args.project_id || sessionConfig.project.id;
                const folders = await zFetch(`public/rest/api/1.0/folders?projectId=${projectId}`);
                return { content: [{ type: 'text', text: JSON.stringify({ folders }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    // Test cases
    server.registerTool(
        'zephyr_enterprise.searchTestCases',
        {
            description: 'Search test cases.',
            inputSchema: {
                type: 'object',
                properties: { query: { type: 'string' }, folder_id: { type: 'number' }, limit: { type: 'number' } },
                required: ['query'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const body = {
                    projectId: sessionConfig.project.id,
                    search: args.query,
                    folderId: args.folder_id,
                    maxRecords: args.limit || 50
                };
                const data = await zFetch('public/rest/api/1.0/testcases/search', { method: 'POST', body });
                return { content: [{ type: 'text', text: JSON.stringify({ results: data.testCases || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise.getTestCase',
        { description: 'Get test case details.', inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const data = await zFetch(`public/rest/api/1.0/testcases/${args.id}`);
                return { content: [{ type: 'text', text: JSON.stringify(data) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise.createTestCase',
        {
            description: 'Create a test case.',
            inputSchema: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    description: { type: 'string' },
                    steps: { type: 'array', items: { type: 'object', properties: { step: { type: 'string' }, expected: { type: 'string' } } } },
                    folder_id: { type: 'number' },
                    priority: { type: 'string' },
                    custom_fields: { type: 'object' }
                },
                required: ['name'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                ensureWritable();
                requireConfigured();
                const payload = {
                    projectId: sessionConfig.project.id,
                    name: args.name,
                    description: args.description,
                    folderId: args.folder_id,
                    priority: args.priority,
                    customFields: args.custom_fields,
                    steps: args.steps?.map((s, i) => ({ index: i + 1, step: s.step, expectedResult: s.expected }))
                };
                const data = await zFetch('public/rest/api/1.0/testcases', { method: 'POST', body: payload });
                return { content: [{ type: 'text', text: JSON.stringify({ id: data.id, key: data.key }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise.updateTestCase',
        {
            description: 'Update a test case (partial).',
            inputSchema: {
                type: 'object',
                properties: {
                    id: { type: 'number' },
                    name: { type: 'string' },
                    description: { type: 'string' },
                    steps: { type: 'array', items: { type: 'object' } },
                    folder_id: { type: 'number' },
                    priority: { type: 'string' },
                    custom_fields: { type: 'object' }
                },
                required: ['id'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                ensureWritable();
                requireConfigured();
                const payload = {};
                if (args.name) payload.name = args.name;
                if (args.description) payload.description = args.description;
                if (args.folder_id) payload.folderId = args.folder_id;
                if (args.priority) payload.priority = args.priority;
                if (args.custom_fields) payload.customFields = args.custom_fields;
                if (args.steps) payload.steps = args.steps.map((s, i) => ({ index: i + 1, step: s.step, expectedResult: s.expected }));
                const data = await zFetch(`public/rest/api/1.0/testcases/${args.id}`, { method: 'PUT', body: payload });
                return { content: [{ type: 'text', text: JSON.stringify({ id: data.id, key: data.key }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    // Cycles and executions
    server.registerTool(
        'zephyr_enterprise.createCycle',
        {
            description: 'Create a test cycle.',
            inputSchema: {
                type: 'object',
                properties: { name: { type: 'string' }, project_id: { type: 'number' }, description: { type: 'string' } },
                required: ['name'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                ensureWritable();
                requireConfigured();
                const payload = { name: args.name, projectId: args.project_id || sessionConfig.project.id, description: args.description };
                const data = await zFetch('public/rest/api/1.0/cycles', { method: 'POST', body: payload });
                return { content: [{ type: 'text', text: JSON.stringify({ id: data.id, name: data.name }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise.addTestCasesToCycle',
        {
            description: 'Add test cases to cycle.',
            inputSchema: {
                type: 'object',
                properties: { cycle_id: { type: 'number' }, test_case_ids: { type: 'array', items: { type: 'number' } }, environment: { type: 'string' }, version: { type: 'string' } },
                required: ['cycle_id', 'test_case_ids'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                ensureWritable();
                requireConfigured();
                const payload = { cycleId: args.cycle_id, projectId: sessionConfig.project.id, testCaseIds: args.test_case_ids, environment: args.environment, version: args.version };
                const data = await zFetch('public/rest/api/1.0/executions', { method: 'POST', body: payload });
                return { content: [{ type: 'text', text: JSON.stringify({ created: data.executions?.length || 0, executions: data.executions }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise.listExecutions',
        { description: 'List executions for a cycle.', inputSchema: { type: 'object', properties: { cycle_id: { type: 'number' } }, required: ['cycle_id'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const data = await zFetch(`public/rest/api/1.0/executions/search?projectId=${sessionConfig.project.id}&cycleId=${args.cycle_id}`);
                return { content: [{ type: 'text', text: JSON.stringify({ executions: data.executions || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise.updateExecution',
        {
            description: 'Update execution status/comment/time.',
            inputSchema: {
                type: 'object',
                properties: {
                    execution_id: { type: 'number' },
                    status: { type: 'string', enum: ['PASS', 'FAIL', 'BLOCKED', 'WIP', 'NOT_EXECUTED'] },
                    comment: { type: 'string' },
                    execution_time_ms: { type: 'number' }
                },
                required: ['execution_id', 'status'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                ensureWritable();
                requireConfigured();
                const payload = { status: args.status, comment: args.comment, executionTime: args.execution_time_ms };
                const data = await zFetch(`public/rest/api/1.0/executions/${args.execution_id}`, { method: 'PUT', body: payload });
                return { content: [{ type: 'text', text: JSON.stringify({ execution: data }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    // Evidence
    server.registerTool(
        'zephyr_enterprise.attachEvidence',
        {
            description: 'Attach evidence to execution.',
            inputSchema: {
                type: 'object',
                properties: { execution_id: { type: 'number' }, name: { type: 'string' }, content_type: { type: 'string' }, data_base64: { type: 'string' } },
                required: ['execution_id', 'name', 'content_type', 'data_base64'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                ensureWritable();
                requireConfigured();
                const size = Buffer.byteLength(args.data_base64 || '', 'base64');
                if (size > GUARDRAILS.max_attachment_size_bytes) {
                    return normalizeError('Attachment too large', 'ATTACHMENT_TOO_LARGE', { max: GUARDRAILS.max_attachment_size_bytes });
                }
                const resp = await fetch(`${sessionConfig.base_url.replace(/\/+$/, '')}/public/rest/api/1.0/executions/${args.execution_id}/attachments`, {
                    method: 'POST',
                    headers: { ...authHeaders(), 'Content-Type': args.content_type, 'X-Zephyr-Filename': args.name },
                    body: Buffer.from(args.data_base64, 'base64')
                });
                if (!resp.ok) {
                    const text = await resp.text().catch(() => '');
                    throw { message: 'Attach failed', code: resp.status === 429 ? 'RATE_LIMITED' : 'ZEPHYR_ENTERPRISE_ERROR', details: text, http_status: resp.status };
                }
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    // Automation ingestion
    server.registerTool(
        'zephyr_enterprise.publishAutomationResults',
        {
            description: 'Publish automation results in bulk.',
            inputSchema: {
                type: 'object',
                properties: {
                    cycle: { type: 'object', properties: { name: { type: 'string' }, create_if_missing: { type: 'boolean' } } },
                    results: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                external_id: { type: 'string' },
                                name: { type: 'string' },
                                status: { type: 'string' },
                                duration_ms: { type: 'number' },
                                comment: { type: 'string' }
                            },
                            required: ['status']
                        }
                    },
                    mapping: { type: 'object', properties: { strategy: { type: 'string', enum: ['external_id', 'name_exact', 'custom_field'] }, field: { type: 'string' } } }
                },
                required: ['results'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                ensureWritable();
                requireConfigured();
                if (args.results.length > GUARDRAILS.max_batch_results) {
                    return normalizeError('Batch too large', 'INVALID_REQUEST', { max: GUARDRAILS.max_batch_results });
                }

                let cycleId;
                if (args.cycle?.name && args.cycle.create_if_missing) {
                    const created = await zFetch('public/rest/api/1.0/cycles', { method: 'POST', body: { name: args.cycle.name, projectId: sessionConfig.project.id } });
                    cycleId = created.id;
                }

                const payload = {
                    projectId: sessionConfig.project.id,
                    cycleId,
                    testCases: args.results.map((r) => ({
                        externalId: r.external_id,
                        name: r.name,
                        status: r.status,
                        executionTime: r.duration_ms,
                        comment: r.comment
                    }))
                };
                const data = await zFetch('public/rest/api/1.0/automation/executions', { method: 'POST', body: payload });
                return { content: [{ type: 'text', text: JSON.stringify({ summary: data }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.server.oninitialized = () => {
        console.log('Zephyr Enterprise MCP server initialized.');
    };

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.log('Zephyr Enterprise MCP server running on stdio.');
}

if (require.main === module) {
    main().catch((err) => {
        console.error('Zephyr Enterprise MCP server failed to start:', err);
        process.exit(1);
    });
}

module.exports = { main };
