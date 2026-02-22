const path = require('path');
const z = require('zod');

const { McpServer } = require(path.join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js'));
const { StdioServerTransport } = require(path.join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/stdio.js'));

const SERVER_INFO = { name: 'zephyr-mcp', version: '0.1.0' };

const sessionConfig = {
    site_url: process.env.ZEPHYR_SITE_URL || undefined,
    token: process.env.ZEPHYR_TOKEN || undefined,
    jira_project_key: process.env.ZEPHYR_JIRA_PROJECT_KEY || undefined,
    zephyr_project_key: undefined,
    default_folder_id: undefined,
    read_only: false,
    identity: undefined
};

const GUARDRAILS = {
    max_batch_results: 500,
    max_attachment_size_bytes: 5 * 1024 * 1024 // 5MB
};

function normalizeError(message, code = 'ZEPHYR_ERROR', details, http_status) {
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { message, code, details, http_status } }) }] };
}

function requireConfigured() {
    if (!sessionConfig.site_url || !sessionConfig.token || !sessionConfig.jira_project_key) {
        throw { message: 'Zephyr not configured. Call zephyr_configure first.', code: 'AUTH_FAILED' };
    }
}

function baseUrl(pathPart) {
    return `${sessionConfig.site_url.replace(/\/+$/, '')}${pathPart.startsWith('/') ? '' : '/'}${pathPart}`;
}

async function zephyrFetch(pathPart, { method = 'GET', query, body, headers } = {}) {
    const url = new URL(baseUrl(pathPart));
    if (query) Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null) url.searchParams.set(k, v); });
    const resp = await fetch(url.toString(), {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionConfig.token}`,
            ...(headers || {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    let data = {};
    try { data = await resp.json(); } catch (_) { data = {}; }
    if (!resp.ok || data.error || data.errors) {
        const detail = data.error || data.errors || data;
        const message = detail.message || resp.statusText || 'Zephyr request failed';
        let code = 'ZEPHYR_ERROR';
        if (resp.status === 401 || resp.status === 403) code = 'PERMISSION_DENIED';
        if (resp.status === 404) code = 'NOT_FOUND';
        if (resp.status === 429) code = 'RATE_LIMITED';
        throw { message, code, details: detail, http_status: resp.status };
    }
    return data;
}

async function jiraFetch(pathPart) {
    const resp = await fetch(baseUrl(pathPart), {
        headers: { 'Authorization': `Bearer ${sessionConfig.token}` }
    });
    let data = {};
    try { data = await resp.json(); } catch (_) { data = {}; }
    if (!resp.ok) {
        throw { message: data.errorMessages?.[0] || resp.statusText, code: 'AUTH_FAILED', details: data, http_status: resp.status };
    }
    return data;
}

async function validateConfig(args) {
    const site = args.site_url.replace(/\/+$/, '');
    const token = args.auth?.access_token;
    const projectKey = args.jira?.project_key;
    if (!site || !token || !projectKey) throw { message: 'Missing required config fields', code: 'INVALID_REQUEST' };

    sessionConfig.site_url = site;
    sessionConfig.token = token;
    sessionConfig.jira_project_key = projectKey;
    sessionConfig.zephyr_project_key = args.zephyr?.default_test_project_key || projectKey;
    sessionConfig.default_folder_id = args.zephyr?.default_folder_id;
    sessionConfig.read_only = !!args.read_only;

    // Jira identity
    const me = await jiraFetch('/rest/api/3/myself');
    sessionConfig.identity = me.accountId ? `account:${me.accountId}` : (me.emailAddress || 'unknown');

    // Zephyr Scale capability check
    // Attempt to list test projects to confirm Scale availability
    try {
        await zephyrFetch('/rest/atm/1.0/testproject');
    } catch (err) {
        throw { message: 'Zephyr Scale not available or token lacks permission', code: 'UNSUPPORTED_PRODUCT', details: err.details, http_status: err.http_status };
    }
}

function ensureWritable() {
    if (sessionConfig.read_only) throw { message: 'Read-only mode enabled', code: 'READ_ONLY_MODE' };
}

async function main() {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });
    const originalRegisterTool = server.registerTool.bind(server);
    const permissiveInputSchema = z.object({}).passthrough();
    server.registerTool = (name, config, handler) => {
        const nextConfig = { ...(config || {}) };
        if (!nextConfig.inputSchema || typeof nextConfig.inputSchema.safeParseAsync !== 'function') {
            nextConfig.inputSchema = permissiveInputSchema;
        }
        return originalRegisterTool(name, nextConfig, handler);
    };

    server.registerTool(
        'zephyr_health',
        { description: 'Health check for Zephyr MCP server.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                requireConfigured();
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, product: 'zephyr_scale', cloud: true, project_key: sessionConfig.zephyr_project_key, identity: sessionConfig.identity }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_configure',
        {
            description: 'Configure Zephyr Scale cloud session.',
            inputSchema: {
                type: 'object',
                properties: {
                    deployment: { type: 'string', enum: ['cloud'] },
                    site_url: { type: 'string' },
                    auth: { type: 'object', properties: { type: { type: 'string', enum: ['atlassian_oauth'] }, access_token: { type: 'string' } }, required: ['type', 'access_token'] },
                    jira: { type: 'object', properties: { project_key: { type: 'string' } }, required: ['project_key'] },
                    zephyr: {
                        type: 'object',
                        properties: {
                            default_test_project_key: { type: 'string' },
                            default_folder_id: { type: 'string' }
                        }
                    },
                    read_only: { type: 'boolean' }
                },
                required: ['deployment', 'site_url', 'auth', 'jira'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                await validateConfig(args);
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, identity: sessionConfig.identity, product: 'zephyr_scale' }) }] };
            } catch (err) {
                // reset on failure
                sessionConfig.site_url = undefined;
                sessionConfig.token = undefined;
                sessionConfig.jira_project_key = undefined;
                sessionConfig.zephyr_project_key = undefined;
                sessionConfig.default_folder_id = undefined;
                sessionConfig.read_only = false;
                sessionConfig.identity = undefined;
                return normalizeError(err.message, err.code || 'AUTH_FAILED', err.details, err.http_status);
            }
        }
    );

    // Discovery
    server.registerTool(
        'zephyr_get_context',
        { description: 'Return Zephyr/Jira context.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                requireConfigured();
                const projects = await zephyrFetch('/rest/atm/1.0/testproject');
                const test_projects = (projects.values || projects) || [];
                return { content: [{ type: 'text', text: JSON.stringify({ jira_project_key: sessionConfig.jira_project_key, zephyr_product: 'zephyr_scale', test_projects }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_list_folders',
        { description: 'List Zephyr folders (test case folders).', inputSchema: { type: 'object', properties: { project_key: { type: 'string' } }, additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const proj = args.project_key || sessionConfig.zephyr_project_key;
                const data = await zephyrFetch('/rest/atm/1.0/folder/testcase', { query: { projectKey: proj, maxResults: 500 } });
                return { content: [{ type: 'text', text: JSON.stringify({ folders: data.values || data }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    // Test cases
    server.registerTool(
        'zephyr_search_test_cases',
        {
            description: 'Search Zephyr test cases.',
            inputSchema: {
                type: 'object',
                properties: {
                    query: { type: 'string' },
                    folder_id: { type: 'string' },
                    project_key: { type: 'string' },
                    limit: { type: 'number' }
                },
                required: ['query'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const proj = args.project_key || sessionConfig.zephyr_project_key;
                const data = await zephyrFetch('/rest/atm/1.0/testcase/search', {
                    method: 'POST',
                    body: {
                        projectKey: proj,
                        query: args.query,
                        folderId: args.folder_id,
                        maxResults: args.limit || 50
                    }
                });
                return { content: [{ type: 'text', text: JSON.stringify({ results: data.values || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_get_test_case',
        { description: 'Get a test case by key.', inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const data = await zephyrFetch(`/rest/atm/1.0/testcase/${args.key}`);
                return { content: [{ type: 'text', text: JSON.stringify(data) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_create_test_case',
        {
            description: 'Create a test case.',
            inputSchema: {
                type: 'object',
                properties: {
                    title: { type: 'string' },
                    objective: { type: 'string' },
                    precondition: { type: 'string' },
                    steps: {
                        type: 'array',
                        items: { type: 'object', properties: { action: { type: 'string' }, data: { type: 'string' }, expected: { type: 'string' } } }
                    },
                    labels: { type: 'array', items: { type: 'string' } },
                    folder_id: { type: 'string' },
                    links: { type: 'object', properties: { jira_issue_keys: { type: 'array', items: { type: 'string' } } } },
                    project_key: { type: 'string' }
                },
                required: ['title'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                ensureWritable();
                requireConfigured();
                const proj = args.project_key || sessionConfig.zephyr_project_key;
                const payload = {
                    projectKey: proj,
                    name: args.title,
                    objective: args.objective,
                    precondition: args.precondition,
                    labels: args.labels,
                    folderId: args.folder_id || sessionConfig.default_folder_id,
                    testScript: args.steps ? { type: 'STEP_BY_STEP', steps: args.steps.map((s, i) => ({ index: i + 1, action: s.action, data: s.data, expectedResult: s.expected })) } : undefined,
                    links: args.links?.jira_issue_keys ? { issues: args.links.jira_issue_keys } : undefined
                };
                const data = await zephyrFetch('/rest/atm/1.0/testcase', { method: 'POST', body: payload });
                return { content: [{ type: 'text', text: JSON.stringify({ key: data.key, self: data.self }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_update_test_case',
        {
            description: 'Update a test case (partial allowed).',
            inputSchema: {
                type: 'object',
                properties: {
                    key: { type: 'string' },
                    title: { type: 'string' },
                    objective: { type: 'string' },
                    precondition: { type: 'string' },
                    steps: { type: 'array', items: { type: 'object' } },
                    labels: { type: 'array', items: { type: 'string' } },
                    folder_id: { type: 'string' },
                    links: { type: 'object', properties: { jira_issue_keys: { type: 'array', items: { type: 'string' } } } }
                },
                required: ['key'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                ensureWritable();
                requireConfigured();
                const payload = {};
                if (args.title) payload.name = args.title;
                if (args.objective) payload.objective = args.objective;
                if (args.precondition) payload.precondition = args.precondition;
                if (args.labels) payload.labels = args.labels;
                if (args.folder_id) payload.folderId = args.folder_id;
                if (args.steps) payload.testScript = { type: 'STEP_BY_STEP', steps: args.steps.map((s, i) => ({ index: i + 1, action: s.action, data: s.data, expectedResult: s.expected })) };
                if (args.links?.jira_issue_keys) payload.links = { issues: args.links.jira_issue_keys };
                const data = await zephyrFetch(`/rest/atm/1.0/testcase/${args.key}`, { method: 'PUT', body: payload });
                return { content: [{ type: 'text', text: JSON.stringify({ key: data.key, self: data.self }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    // Cycles (Zephyr Scale uses test runs)
    server.registerTool(
        'zephyr_create_test_cycle',
        {
            description: 'Create a test cycle (test run).',
            inputSchema: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    project_key: { type: 'string' },
                    folder_id: { type: 'string' }
                },
                required: ['name'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                ensureWritable();
                requireConfigured();
                const proj = args.project_key || sessionConfig.zephyr_project_key;
                const payload = { name: args.name, projectKey: proj, folderId: args.folder_id };
                const data = await zephyrFetch('/rest/atm/1.0/testrun', { method: 'POST', body: payload });
                return { content: [{ type: 'text', text: JSON.stringify({ key: data.key, self: data.self }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_add_tests_to_cycle',
        {
            description: 'Add test cases to a cycle (test run).',
            inputSchema: {
                type: 'object',
                properties: { cycle_key: { type: 'string' }, test_case_keys: { type: 'array', items: { type: 'string' } } },
                required: ['cycle_key', 'test_case_keys'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                ensureWritable();
                requireConfigured();
                const body = { additions: args.test_case_keys.map((k) => ({ testCaseKey: k })) };
                const data = await zephyrFetch(`/rest/atm/1.0/testrun/${args.cycle_key}/testcase`, { method: 'POST', body });
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, added: args.test_case_keys.length, result: data }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_list_test_executions',
        { description: 'List test executions for a cycle.', inputSchema: { type: 'object', properties: { cycle_key: { type: 'string' } }, required: ['cycle_key'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const data = await zephyrFetch('/rest/atm/1.0/testrun/testexecution', { query: { testRunKey: args.cycle_key, maxResults: 200 } });
                return { content: [{ type: 'text', text: JSON.stringify({ executions: data.values || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_update_execution_status',
        {
            description: 'Update execution status with optional comment and attachments.',
            inputSchema: {
                type: 'object',
                properties: {
                    execution_id: { type: 'string' },
                    status: { type: 'string', enum: ['PASS', 'FAIL', 'BLOCKED', 'UNEXECUTED', 'IN_PROGRESS'] },
                    comment: { type: 'string' },
                    evidence: {
                        type: 'object',
                        properties: {
                            attachments: {
                                type: 'array',
                                items: { type: 'object', properties: { name: { type: 'string' }, content_type: { type: 'string' }, data_base64: { type: 'string' } }, required: ['name', 'content_type', 'data_base64'] }
                            }
                        }
                    }
                },
                required: ['execution_id', 'status'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                ensureWritable();
                requireConfigured();
                const payload = { status: args.status, comment: args.comment };
                const data = await zephyrFetch(`/rest/atm/1.0/testexecution/${args.execution_id}`, { method: 'PUT', body: payload });

                // attachments (limited)
                if (args.evidence?.attachments) {
                    for (const att of args.evidence.attachments) {
                        const size = Buffer.byteLength(att.data_base64 || '', 'base64');
                        if (size > GUARDRAILS.max_attachment_size_bytes) {
                            return normalizeError('Attachment too large', 'ATTACHMENT_TOO_LARGE', { name: att.name, max: GUARDRAILS.max_attachment_size_bytes });
                        }
                        await fetch(baseUrl(`/rest/atm/1.0/testexecution/${args.execution_id}/attachment`), {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${sessionConfig.token}`,
                                'Content-Type': att.content_type
                            },
                            body: Buffer.from(att.data_base64, 'base64')
                        });
                    }
                }
                return { content: [{ type: 'text', text: JSON.stringify({ execution: data }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_publish_automation_results',
        {
            description: 'Publish automation results (batch).',
            inputSchema: {
                type: 'object',
                properties: {
                    cycle: { type: 'object', properties: { name: { type: 'string' }, create_if_missing: { type: 'boolean' } } },
                    results: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                external_test_id: { type: 'string' },
                                status: { type: 'string' },
                                duration_ms: { type: 'number' },
                                artifacts: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, content_type: { type: 'string' }, data_base64: { type: 'string' } } } },
                                comment: { type: 'string' }
                            },
                            required: ['external_test_id', 'status']
                        }
                    },
                    mapping: { type: 'object', properties: { strategy: { type: 'string' }, field: { type: 'string' } } }
                },
                required: ['results'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                ensureWritable();
                requireConfigured();
                if ((args.results || []).length > GUARDRAILS.max_batch_results) {
                    return normalizeError('Batch too large', 'INVALID_REQUEST', { max: GUARDRAILS.max_batch_results });
                }

                // Ensure cycle
                let cycleKey;
                if (args.cycle?.name) {
                    if (args.cycle.create_if_missing) {
                        const created = await zephyrFetch('/rest/atm/1.0/testrun', { method: 'POST', body: { name: args.cycle.name, projectKey: sessionConfig.zephyr_project_key } });
                        cycleKey = created.key;
                    }
                }

                // Map and send results using testexecution import
                const executions = args.results.map((r) => ({
                    testCaseKey: r.external_test_id,
                    statusName: r.status,
                    comment: r.comment,
                    actualEndDate: new Date().toISOString(),
                    executionTime: r.duration_ms
                }));

                const payload = { testCycleKey: cycleKey, executions };
                const data = await zephyrFetch('/rest/atm/1.0/automation/execution', { method: 'POST', body: payload });

                return { content: [{ type: 'text', text: JSON.stringify({ summary: data }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.server.oninitialized = () => {
        console.log('Zephyr MCP server initialized.');
    };

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.log('Zephyr MCP server running on stdio.');
}

if (require.main === module) {
    main().catch((err) => {
        console.error('Zephyr MCP server failed to start:', err);
        process.exit(1);
    });
}

module.exports = { main };
