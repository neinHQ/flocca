const path = require('path');
const z = require('zod');

const { McpServer } = require(path.join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js'));
const { StdioServerTransport } = require(path.join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/stdio.js'));

const SERVER_INFO = { name: 'zephyr-enterprise-mcp', version: '0.1.0' };
const API_FAMILY = {
    PUBLIC: 'public',
    FLEX: 'flex'
};

const sessionConfig = {
    base_url: process.env.ZEPHYR_ENT_BASE_URL || undefined,
    auth: process.env.ZEPHYR_ENT_TOKEN
        ? { type: 'api_token', username: process.env.ZEPHYR_ENT_USERNAME, token: process.env.ZEPHYR_ENT_TOKEN }
        : (process.env.ZEPHYR_ENT_PASSWORD ? { type: 'basic', username: process.env.ZEPHYR_ENT_USERNAME, password: process.env.ZEPHYR_ENT_PASSWORD } : undefined),
    project: process.env.ZEPHYR_ENT_PROJECT_ID
        ? { id: parseInt(process.env.ZEPHYR_ENT_PROJECT_ID) }
        : (process.env.ZEPHYR_ENT_PROJECT_KEY ? { key: process.env.ZEPHYR_ENT_PROJECT_KEY } : undefined),
    read_only: false,
    api_family: undefined,
    release_id: process.env.ZEPHYR_ENT_RELEASE_ID ? parseInt(process.env.ZEPHYR_ENT_RELEASE_ID) : undefined,
    identity: undefined,
    version: undefined
};

const GUARDRAILS = {
    max_batch_results: 2000,
    max_attachment_size_bytes: 5 * 1024 * 1024 // 5MB
};

function normalizeBaseUrl(baseUrl) {
    const raw = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (!raw) return raw;

    // Users sometimes paste API URLs instead of host root. Normalize to host root/context root.
    return raw
        .replace(/\/public\/rest\/api\/1\.0$/i, '')
        .replace(/\/public\/rest\/api$/i, '')
        .replace(/\/rest\/api\/1\.0$/i, '')
        .replace(/\/rest\/api$/i, '')
        .replace(/\/+$/, '');
}

function activeApiFamily() {
    return sessionConfig.api_family === API_FAMILY.FLEX ? API_FAMILY.FLEX : API_FAMILY.PUBLIC;
}

function projectPathsFor(apiFamily = activeApiFamily()) {
    if (apiFamily === API_FAMILY.FLEX) {
        return ['flex/services/rest/latest/project/details', 'flex/services/rest/latest/project'];
    }
    return ['public/rest/api/1.0/projects'];
}

function testCaseSearchSpec(args) {
    const query = (typeof args?.query === 'string' && args.query.trim()) ? args.query.trim() : '*';
    const limit = args?.limit || 50;
    if (activeApiFamily() === API_FAMILY.FLEX) {
        const queryParams = {
            word: query,
            entitytype: 'testcase',
            firstresult: '0',
            maxresults: String(limit)
        };
        if (sessionConfig.release_id) {
            queryParams.releaseid = String(sessionConfig.release_id);
        }
        return {
            paths: ['flex/services/rest/latest/advancesearch'],
            options: { method: 'GET', query: queryParams, operation: 'search_test_cases' }
        };
    }
    return {
        paths: ['public/rest/api/1.0/testcases/search', 'public/rest/api/1.0/testcase/search'],
        options: {
            method: 'POST',
            body: {
                projectId: sessionConfig.project.id,
                search: query,
                folderId: args?.folder_id,
                maxRecords: limit
            },
            operation: 'search_test_cases'
        }
    };
}

function testCaseGetPaths(id) {
    if (activeApiFamily() === API_FAMILY.FLEX) {
        return [`flex/services/rest/latest/testcase/${id}`];
    }
    return [`public/rest/api/1.0/testcases/${id}`, `public/rest/api/1.0/testcase/${id}`];
}

function buildCreateTestCasePayload(args) {
    const mappedSteps = args.steps?.map((s, i) => ({ index: i + 1, step: s.step, expectedResult: s.expected }));
    if (activeApiFamily() === API_FAMILY.FLEX) {
        return {
            tcrCatalogTreeId: args.folder_id || 0,
            testcase: {
                name: args.name,
                description: args.description,
                priority: args.priority,
                customFields: args.custom_fields,
                steps: mappedSteps
            }
        };
    }
    return {
        projectId: sessionConfig.project.id,
        name: args.name,
        description: args.description,
        folderId: args.folder_id,
        priority: args.priority,
        customFields: args.custom_fields,
        steps: mappedSteps
    };
}

function buildUpdateTestCasePayload(args) {
    if (activeApiFamily() === API_FAMILY.FLEX) {
        const testcase = { testcaseId: args.id };
        if (args.name) testcase.name = args.name;
        if (args.description) testcase.description = args.description;
        if (args.priority) testcase.priority = args.priority;
        if (args.custom_fields) testcase.customFields = args.custom_fields;
        if (args.steps) testcase.steps = args.steps.map((s, i) => ({ index: i + 1, step: s.step, expectedResult: s.expected }));
        const payload = { testcase };
        if (args.folder_id) payload.tcrCatalogTreeId = args.folder_id;
        if (sessionConfig.release_id) payload.releaseId = sessionConfig.release_id;
        return payload;
    }

    const payload = {};
    if (args.name) payload.name = args.name;
    if (args.description) payload.description = args.description;
    if (args.folder_id) payload.folderId = args.folder_id;
    if (args.priority) payload.priority = args.priority;
    if (args.custom_fields) payload.customFields = args.custom_fields;
    if (args.steps) payload.steps = args.steps.map((s, i) => ({ index: i + 1, step: s.step, expectedResult: s.expected }));
    return payload;
}

function testCaseCreatePaths() {
    if (activeApiFamily() === API_FAMILY.FLEX) {
        return ['flex/services/rest/latest/testcase'];
    }
    return ['public/rest/api/1.0/testcases', 'public/rest/api/1.0/testcase'];
}

function testCaseUpdateSpec(id) {
    if (activeApiFamily() === API_FAMILY.FLEX) {
        return {
            paths: ['flex/services/rest/latest/testcase'],
            options: { method: 'PUT', query: { forceCreateNewVersion: 'false' }, operation: 'update_test_case' }
        };
    }
    return {
        paths: [`public/rest/api/1.0/testcases/${id}`, `public/rest/api/1.0/testcase/${id}`],
        options: { method: 'PUT', operation: 'update_test_case' }
    };
}

function extractProjects(projectsResp) {
    const rawList = Array.isArray(projectsResp)
        ? projectsResp
        : (projectsResp?.values || projectsResp?.projects || projectsResp?.projectDto || projectsResp?.projectDtos || projectsResp?.data || []);

    return (Array.isArray(rawList) ? rawList : [])
        .map((p) => ({
            id: p?.id ?? p?.projectId ?? p?.projectID ?? p?.projectDto?.id,
            key: p?.key ?? p?.projectKey ?? p?.name ?? p?.projectName ?? p?.projectDto?.key ?? p?.projectDto?.name
        }))
        .filter((p) => p.id !== undefined || p.key);
}

function normalizeError(message, code = 'ZEPHYR_ENTERPRISE_ERROR', details, http_status) {
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { message, code, details, http_status } }) }] };
}

function requireConfigured() {
    if (!sessionConfig.base_url || !sessionConfig.auth) {
        throw { message: 'Zephyr Enterprise not configured. Call zephyr_enterprise_configure first.', code: 'AUTH_FAILED' };
    }
}

async function ensureApiFamilyDetected() {
    if (sessionConfig.api_family) {
        return;
    }
    try {
        await zFetchWithFallback(projectPathsFor(API_FAMILY.PUBLIC), { operation: 'detect_api_family', api_family: API_FAMILY.PUBLIC });
        sessionConfig.api_family = API_FAMILY.PUBLIC;
        return;
    } catch (publicErr) {
        if (publicErr?.http_status !== 404 && publicErr?.code !== 'NOT_FOUND') {
            throw publicErr;
        }
    }
    await zFetchWithFallback(projectPathsFor(API_FAMILY.FLEX), { operation: 'detect_api_family', api_family: API_FAMILY.FLEX });
    sessionConfig.api_family = API_FAMILY.FLEX;
}

async function ensureConfigured() {
    requireConfigured();
    await ensureApiFamilyDetected();
}

function ensureWritable() {
    if (sessionConfig.read_only) {
        throw { message: 'Read-only mode enabled', code: 'READ_ONLY_MODE' };
    }
}

function requireNonEmptyString(value, fieldName) {
    if (typeof value !== 'string' || !value.trim()) {
        throw { message: `Missing required argument: ${fieldName}`, code: 'INVALID_REQUEST', details: { required: [fieldName] }, http_status: 400 };
    }
}

function requireNumber(value, fieldName) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        throw { message: `Missing required argument: ${fieldName}`, code: 'INVALID_REQUEST', details: { required: [fieldName] }, http_status: 400 };
    }
}

function requireNonEmptyArray(value, fieldName) {
    if (!Array.isArray(value) || value.length === 0) {
        throw { message: `Missing required argument: ${fieldName}`, code: 'INVALID_REQUEST', details: { required: [fieldName] }, http_status: 400 };
    }
}

function requireAtLeastOneField(args, fields) {
    const hasAny = fields.some((field) => args?.[field] !== undefined && args?.[field] !== null);
    if (!hasAny) {
        throw {
            message: `At least one updatable field is required: ${fields.join(', ')}`,
            code: 'INVALID_REQUEST',
            details: { any_of: fields },
            http_status: 400
        };
    }
}

function authHeaders() {
    if (!sessionConfig.auth) return {};
    if (sessionConfig.auth.type === 'api_token') {
        const { token } = sessionConfig.auth;
        return { Authorization: `Bearer ${token}` };
    }
    if (sessionConfig.auth.type === 'basic') {
        const { username, password } = sessionConfig.auth;
        const encoded = Buffer.from(`${username}:${password}`).toString('base64');
        return { Authorization: `Basic ${encoded}` };
    }
    return {};
}

async function zFetch(pathPart, { method = 'GET', query, body, headers, operation, api_family } = {}) {
    const url = new URL(`${sessionConfig.base_url.replace(/\/+$/, '')}/${pathPart.replace(/^\/+/, '')}`);
    if (query) Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null) url.searchParams.set(k, v); });
    let responseText = '';
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
    try {
        responseText = await resp.text();
        data = responseText ? JSON.parse(responseText) : {};
    } catch (_) {
        data = {};
    }
    if (!resp.ok || data.error) {
        const detail = data.error || data || {};
        detail.api_family = api_family || activeApiFamily();
        if (operation) {
            detail.operation = operation;
        }
        if (!detail.requested_path) {
            detail.requested_path = `${url.pathname}${url.search || ''}`;
        }
        if ((!detail || Object.keys(detail).length <= 1) && responseText) {
            detail.response_excerpt = responseText.slice(0, 500);
        }
        const message = detail.message || resp.statusText || `Zephyr Enterprise request failed (${method} ${url.pathname})`;
        let code = 'ZEPHYR_ENTERPRISE_ERROR';
        if (resp.status === 401 || resp.status === 403) code = 'PERMISSION_DENIED';
        if (resp.status === 404) code = 'NOT_FOUND';
        if (resp.status === 429) code = 'RATE_LIMITED';
        throw { message, code, details: detail, http_status: resp.status };
    }
    return data;
}

async function zFetchWithFallback(pathParts, options = {}) {
    let lastErr;
    const attemptedPaths = [];
    for (const pathPart of pathParts) {
        try {
            attemptedPaths.push(pathPart);
            return await zFetch(pathPart, options);
        } catch (err) {
            lastErr = err;
            if (!err.details) err.details = {};
            err.details.attempted_paths = attemptedPaths.slice();
            if (err?.http_status === 404 || err?.code === 'NOT_FOUND' || err?.http_status === 403 || err?.code === 'PERMISSION_DENIED') {
                continue;
            }
            throw err;
        }
    }
    throw lastErr;
}

async function validateConfig(args) {
    const base = normalizeBaseUrl(args.base_url || '');
    if (!base) throw { message: 'Missing base_url', code: 'INVALID_REQUEST' };
    if (!args.auth) throw { message: 'Missing auth', code: 'INVALID_REQUEST' };

    sessionConfig.base_url = base;
    sessionConfig.auth = args.auth;
    sessionConfig.project = args.project || undefined;
    sessionConfig.read_only = !!args.read_only;
    sessionConfig.release_id = args.release_id || sessionConfig.release_id;

    let projectsResp;
    let detectedFamily = API_FAMILY.PUBLIC;
    try {
        projectsResp = await zFetchWithFallback(projectPathsFor(API_FAMILY.PUBLIC), { operation: 'probe_projects', api_family: API_FAMILY.PUBLIC });
    } catch (publicErr) {
        if (publicErr?.http_status !== 404 && publicErr?.code !== 'NOT_FOUND' && publicErr?.http_status !== 403 && publicErr?.code !== 'PERMISSION_DENIED') {
            throw publicErr;
        }
        projectsResp = await zFetchWithFallback(projectPathsFor(API_FAMILY.FLEX), { operation: 'probe_projects', api_family: API_FAMILY.FLEX });
        detectedFamily = API_FAMILY.FLEX;
    }

    sessionConfig.api_family = detectedFamily;
    const projects = extractProjects(projectsResp);
    sessionConfig.version = projectsResp?.releaseVersion || projectsResp?.version || projectsResp?.serverVersion;

    if (sessionConfig.project) {
        const match = projects.find((p) =>
            (sessionConfig.project.id && p.id === sessionConfig.project.id) ||
            (sessionConfig.project.key && p.key === sessionConfig.project.key)
        );
        if (!match) throw { message: 'Project not accessible', code: 'INVALID_REQUEST', details: projectsResp };
        sessionConfig.project = { id: match.id, key: match.key };
    } else if (projects.length > 0) {
        sessionConfig.project = { id: projects[0].id, key: projects[0].key };
    } else {
        throw { message: 'No accessible Zephyr Enterprise projects found', code: 'INVALID_REQUEST', details: projectsResp };
    }

    sessionConfig.identity = sessionConfig.auth.username || 'api_token_user';
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
        'zephyr_enterprise_health',
        { description: 'Health check for Zephyr Enterprise MCP server.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                await ensureConfigured();
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, product: 'zephyr_enterprise', version: sessionConfig.version, project: sessionConfig.project, api_family: activeApiFamily() }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise_configure',
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
                    release_id: { type: 'number' },
                    read_only: { type: 'boolean' }
                },
                required: ['deployment', 'base_url', 'auth', 'project'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                await validateConfig(args);
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, product: 'zephyr_enterprise', project: sessionConfig.project, version: sessionConfig.version, api_family: activeApiFamily(), release_id: sessionConfig.release_id }) }] };
            } catch (err) {
                sessionConfig.base_url = undefined;
                sessionConfig.auth = undefined;
                sessionConfig.project = undefined;
                sessionConfig.api_family = undefined;
                sessionConfig.identity = undefined;
                sessionConfig.version = undefined;
                return normalizeError(err.message, err.code || 'AUTH_FAILED', err.details, err.http_status);
            }
        }
    );

    // Discovery
    server.registerTool(
        'zephyr_enterprise_get_context',
        { description: 'Return Zephyr Enterprise context.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                await ensureConfigured();
                const projects = await zFetchWithFallback(projectPathsFor(), { operation: 'get_context_projects' });
                return { content: [{ type: 'text', text: JSON.stringify({ product: 'zephyr_enterprise', version: sessionConfig.version, projects }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise_list_projects',
        { description: 'List Zephyr Enterprise projects.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                await ensureConfigured();
                const projects = await zFetchWithFallback(projectPathsFor(), { operation: 'list_projects' });
                return { content: [{ type: 'text', text: JSON.stringify({ projects }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise_list_folders',
        { description: 'List folders for a project.', inputSchema: { type: 'object', properties: { project_id: { type: 'number' } }, additionalProperties: false } },
        async (args) => {
            try {
                await ensureConfigured();
                const projectId = args.project_id || sessionConfig.project.id;
                const folders = await zFetch(`public/rest/api/1.0/folders?projectId=${projectId}`);
                return { content: [{ type: 'text', text: JSON.stringify({ folders }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    const searchTestCasesInputSchema = {
        type: 'object',
        properties: { query: { type: 'string' }, folder_id: { type: 'number' }, limit: { type: 'number' } },
        required: ['query'],
        additionalProperties: false
    };

    const handleSearchTestCases = async (args) => {
        try {
            await ensureConfigured();
            const searchSpec = testCaseSearchSpec(args);
            const data = await zFetchWithFallback(searchSpec.paths, searchSpec.options);
            const results = data?.testCases || data?.results || data?.searchObjectList || data?.searchResults || [];
            return { content: [{ type: 'text', text: JSON.stringify({ results }) }] };
        } catch (err) {
            return normalizeError(err.message, err.code, err.details, err.http_status);
        }
    };

    // Test cases
    server.registerTool(
        'zephyr_enterprise_search_test_cases',
        {
            description: 'Search test cases.',
            inputSchema: searchTestCasesInputSchema
        },
        handleSearchTestCases
    );

    // Backward-compatible alias used by some clients/orchestrators.
    server.registerTool(
        'zephyr_enterprise.searchTestCases',
        {
            description: 'Alias for zephyr_enterprise_search_test_cases.',
            inputSchema: searchTestCasesInputSchema
        },
        handleSearchTestCases
    );

    server.registerTool(
        'zephyr_enterprise_get_test_case',
        { description: 'Get test case details.', inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'], additionalProperties: false } },
        async (args) => {
            try {
                await ensureConfigured();
                const data = await zFetchWithFallback(testCaseGetPaths(args.id), { operation: 'get_test_case' });
                return { content: [{ type: 'text', text: JSON.stringify(data) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise_create_test_case',
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
                requireNonEmptyString(args?.name, 'name');
                ensureWritable();
                await ensureConfigured();
                const payload = buildCreateTestCasePayload(args);
                const data = await zFetchWithFallback(testCaseCreatePaths(), { method: 'POST', body: payload, operation: 'create_test_case' });
                return { content: [{ type: 'text', text: JSON.stringify({ id: data.id, key: data.key }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise_update_test_case',
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
                requireNumber(args?.id, 'id');
                requireAtLeastOneField(args, ['name', 'description', 'steps', 'folder_id', 'priority', 'custom_fields']);
                ensureWritable();
                await ensureConfigured();
                const payload = buildUpdateTestCasePayload(args);
                const updateSpec = testCaseUpdateSpec(args.id);
                const data = await zFetchWithFallback(updateSpec.paths, { ...updateSpec.options, body: payload });
                return { content: [{ type: 'text', text: JSON.stringify({ id: data.id, key: data.key }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    // Cycles and executions
    server.registerTool(
        'zephyr_enterprise_create_cycle',
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
                requireNonEmptyString(args?.name, 'name');
                ensureWritable();
                await ensureConfigured();
                const payload = { name: args.name, projectId: args.project_id || sessionConfig.project.id, description: args.description };
                const data = await zFetch('public/rest/api/1.0/cycles', { method: 'POST', body: payload });
                return { content: [{ type: 'text', text: JSON.stringify({ id: data.id, name: data.name }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise_add_test_cases_to_cycle',
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
                requireNumber(args?.cycle_id, 'cycle_id');
                requireNonEmptyArray(args?.test_case_ids, 'test_case_ids');
                ensureWritable();
                await ensureConfigured();
                const payload = { cycleId: args.cycle_id, projectId: sessionConfig.project.id, testCaseIds: args.test_case_ids, environment: args.environment, version: args.version };
                const data = await zFetch('public/rest/api/1.0/executions', { method: 'POST', body: payload });
                return { content: [{ type: 'text', text: JSON.stringify({ created: data.executions?.length || 0, executions: data.executions }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise_list_executions',
        { description: 'List executions for a cycle.', inputSchema: { type: 'object', properties: { cycle_id: { type: 'number' } }, required: ['cycle_id'], additionalProperties: false } },
        async (args) => {
            try {
                await ensureConfigured();
                const data = await zFetch(`public/rest/api/1.0/executions/search?projectId=${sessionConfig.project.id}&cycleId=${args.cycle_id}`);
                return { content: [{ type: 'text', text: JSON.stringify({ executions: data.executions || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise_update_execution',
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
                await ensureConfigured();
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
        'zephyr_enterprise_attach_evidence',
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
                await ensureConfigured();
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
        'zephyr_enterprise_publish_automation_results',
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
                await ensureConfigured();
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

module.exports = {
    main,
    __test: {
        API_FAMILY,
        sessionConfig,
        ensureApiFamilyDetected,
        projectPathsFor,
        testCaseSearchSpec,
        testCaseGetPaths,
        testCaseCreatePaths,
        testCaseUpdateSpec,
        buildCreateTestCasePayload,
        buildUpdateTestCasePayload,
        extractProjects
    }
};
