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
        const paths = ['flex/services/rest/latest/project/details', 'flex/services/rest/latest/project'];
        if (sessionConfig.project && sessionConfig.project.id) {
            paths.push(`flex/services/rest/latest/project/${sessionConfig.project.id}`);
        }
        return paths;
    }
    const publicPaths = ['public/rest/api/1.0/projects'];
    if (sessionConfig.project && sessionConfig.project.id) {
        publicPaths.push(`public/rest/api/1.0/projects/${sessionConfig.project.id}`);
    }
    return publicPaths;
}

function testCaseSearchSpec(args) {
    const query = (typeof args?.query === 'string' && args.query.trim()) ? args.query.trim() : '*';
    const limit = args?.limit || 50;
    const releaseId = getNumberArg(args, ['release_id', 'releaseId']) ?? sessionConfig.release_id;
    if (activeApiFamily() === API_FAMILY.FLEX) {
        const queryParams = {
            word: query,
            entitytype: 'testcase',
            firstresult: '0',
            maxresults: String(limit)
        };
        if (releaseId) {
            queryParams.releaseid = String(releaseId);
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
    const normalizedArgs = normalizeTestCaseArgs(args);
    const mappedSteps = normalizedArgs.steps?.map((s, i) => ({ index: i + 1, step: s.step, expectedResult: s.expected }));
    if (activeApiFamily() === API_FAMILY.FLEX) {
        return {
            tcrCatalogTreeId: normalizedArgs.folder_id || 0,
            testcase: {
                name: normalizedArgs.name,
                description: normalizedArgs.description,
                priority: normalizedArgs.priority,
                customFields: normalizedArgs.custom_fields,
                steps: mappedSteps
            }
        };
    }
    return {
        projectId: sessionConfig.project.id,
        name: normalizedArgs.name,
        description: normalizedArgs.description,
        folderId: normalizedArgs.folder_id,
        priority: normalizedArgs.priority,
        customFields: normalizedArgs.custom_fields,
        steps: mappedSteps
    };
}

function buildUpdateTestCasePayload(args) {
    const normalizedArgs = normalizeTestCaseArgs(args);
    if (activeApiFamily() === API_FAMILY.FLEX) {
        const testcase = { testcaseId: normalizedArgs.id };
        if (normalizedArgs.name) testcase.name = normalizedArgs.name;
        if (normalizedArgs.description) testcase.description = normalizedArgs.description;
        if (normalizedArgs.priority) testcase.priority = normalizedArgs.priority;
        if (normalizedArgs.custom_fields) testcase.customFields = normalizedArgs.custom_fields;
        if (normalizedArgs.steps) testcase.steps = normalizedArgs.steps.map((s, i) => ({ index: i + 1, step: s.step, expectedResult: s.expected }));
        const payload = { testcase };
        if (normalizedArgs.folder_id) payload.tcrCatalogTreeId = normalizedArgs.folder_id;
        if (normalizedArgs.release_id) payload.releaseId = normalizedArgs.release_id;
        return payload;
    }

    const payload = {};
    if (normalizedArgs.name) payload.name = normalizedArgs.name;
    if (normalizedArgs.description) payload.description = normalizedArgs.description;
    if (normalizedArgs.folder_id) payload.folderId = normalizedArgs.folder_id;
    if (normalizedArgs.priority) payload.priority = normalizedArgs.priority;
    if (normalizedArgs.custom_fields) payload.customFields = normalizedArgs.custom_fields;
    if (normalizedArgs.steps) payload.steps = normalizedArgs.steps.map((s, i) => ({ index: i + 1, step: s.step, expectedResult: s.expected }));
    return payload;
}

function buildCreateReleasePayload(args) {
    const normalized = normalizeReleaseArgs(args);
    const payload = {
        name: normalized.name,
        description: normalized.description,
        releaseStartDate: normalized.start_date,
        releaseEndDate: normalized.end_date,
        status: normalized.status
    };
    if (activeApiFamily() === API_FAMILY.FLEX) {
        return {
            projectId: normalized.project_id || sessionConfig.project?.id,
            release: payload
        };
    }
    return {
        ...payload,
        projectId: normalized.project_id || sessionConfig.project?.id
    };
}

function buildUpdateReleasePayload(args) {
    const normalized = normalizeReleaseArgs(args);
    const payload = {};
    if (normalized.name !== undefined) payload.name = normalized.name;
    if (normalized.description !== undefined) payload.description = normalized.description;
    if (normalized.status !== undefined) payload.status = normalized.status;
    if (normalized.start_date !== undefined) payload.releaseStartDate = normalized.start_date;
    if (normalized.end_date !== undefined) payload.releaseEndDate = normalized.end_date;

    if (activeApiFamily() === API_FAMILY.FLEX) {
        return { release: payload };
    }
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

function releaseCreatePaths() {
    if (activeApiFamily() === API_FAMILY.FLEX) {
        return ['flex/services/rest/v3/release'];
    }
    return ['public/rest/api/1.0/releases'];
}

function releaseUpdatePaths(id) {
    if (activeApiFamily() === API_FAMILY.FLEX) {
        return [`flex/services/rest/v3/release/${id}`];
    }
    return [`public/rest/api/1.0/releases/${id}`];
}

function releaseDeletePaths(id) {
    if (activeApiFamily() === API_FAMILY.FLEX) {
        return [`flex/services/rest/v3/release/${id}`];
    }
    return [`public/rest/api/1.0/releases/${id}`];
}

function extractProjects(projectsResp) {
    if (projectsResp && !Array.isArray(projectsResp) && (projectsResp.id !== undefined || projectsResp.projectId !== undefined) && !projectsResp.values && !projectsResp.projects && !projectsResp.data) {
        return [{
            id: projectsResp.id ?? projectsResp.projectId ?? projectsResp.projectID,
            key: projectsResp.key ?? projectsResp.projectKey ?? projectsResp.name ?? projectsResp.projectName
        }].filter(p => p.id !== undefined || p.key);
    }

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

function getArg(args, keys) {
    for (const key of keys) {
        const value = args?.[key];
        if (value !== undefined && value !== null && value !== '') {
            return value;
        }
    }
    return undefined;
}

function getNumberArg(args, keys) {
    const value = getArg(args, keys);
    if (value === undefined) return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
}

function getStringArg(args, keys) {
    const value = getArg(args, keys);
    if (value === undefined) return undefined;
    return typeof value === 'string' ? value : String(value);
}

function normalizePriority(value) {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }
    return String(value);
}

function normalizeReleaseArgs(args = {}) {
    return {
        id: getNumberArg(args, ['id', 'release_id', 'releaseId']),
        name: getStringArg(args, ['name']),
        description: getStringArg(args, ['description']),
        status: getStringArg(args, ['status']),
        start_date: getStringArg(args, ['start_date', 'startDate', 'releaseStartDate']),
        end_date: getStringArg(args, ['end_date', 'endDate', 'releaseEndDate']),
        project_id: getNumberArg(args, ['project_id', 'projectId'])
    };
}

function normalizeTestCaseArgs(args = {}) {
    return {
        id: getNumberArg(args, ['id', 'test_case_id', 'testCaseId']),
        name: getStringArg(args, ['name']),
        description: getStringArg(args, ['description']),
        steps: Array.isArray(args?.steps) ? args.steps : undefined,
        folder_id: getNumberArg(args, ['folder_id', 'folderId']),
        priority: normalizePriority(getArg(args, ['priority'])),
        custom_fields: getArg(args, ['custom_fields', 'customFields']),
        release_id: getNumberArg(args, ['release_id', 'releaseId']) ?? sessionConfig.release_id
    };
}

function folderRequestSpecsFor(args = {}) {
    const projectId = getNumberArg(args, ['project_id', 'projectId']) ?? sessionConfig.project?.id;
    const releaseId = getNumberArg(args, ['release_id', 'releaseId']) ?? sessionConfig.release_id;
    const publicRequest = projectId
        ? [{ path: 'public/rest/api/1.0/folders', query: { projectId: String(projectId) } }]
        : [];
    const flexRequests = releaseId
        ? [
            { path: 'flex/services/rest/v3/testcasetree', query: { releaseid: String(releaseId) } },
            { path: 'flex/services/rest/v3/testcasetree', query: { releaseId: String(releaseId) } },
            { path: 'flex/services/rest/latest/testcasetree', query: { releaseid: String(releaseId) } },
            { path: 'flex/services/rest/latest/testcasetree', query: { releaseId: String(releaseId) } }
        ]
        : [];

    return activeApiFamily() === API_FAMILY.FLEX
        ? [...flexRequests, ...publicRequest]
        : [...publicRequest, ...flexRequests];
}

function tcrFolderRequestSpecsFor(args = {}) {
    const releaseId = getNumberArg(args, ['release_id', 'releaseId']) ?? sessionConfig.release_id;
    const parentId = getNumberArg(args, ['parent_id', 'parentId']);
    const flexRequests = [];

    // If parent_id is given, fetch children of that specific folder
    if (parentId !== undefined) {
        flexRequests.push(
            { path: `flex/services/rest/v3/testcasetree/${parentId}` },
            { path: `flex/services/rest/latest/testcasetree/${parentId}` }
        );
        return flexRequests;
    }

    if (releaseId !== undefined) {
        flexRequests.push(
            { path: 'flex/services/rest/v3/testcasetree', query: { releaseid: String(releaseId) } },
            { path: 'flex/services/rest/v3/testcasetree', query: { releaseId: String(releaseId) } },
            { path: 'flex/services/rest/latest/testcasetree', query: { releaseid: String(releaseId) } },
            { path: 'flex/services/rest/latest/testcasetree', query: { releaseId: String(releaseId) } }
        );
    }
    const projectId = getNumberArg(args, ['project_id', 'projectId']) ?? sessionConfig.project?.id;
    if (projectId !== undefined) {
        flexRequests.push(
            { path: 'flex/services/rest/v3/testcasetree', query: { projectid: String(projectId) } },
            { path: 'flex/services/rest/v3/testcasetree', query: { projectId: String(projectId) } }
        );
    }
    flexRequests.push(
        { path: 'flex/services/rest/v3/testcasetree' },
        { path: 'flex/services/rest/latest/testcasetree' }
    );
    return flexRequests;
}

function extractFolders(foldersResp) {
    if (Array.isArray(foldersResp)) {
        return foldersResp;
    }
    return foldersResp?.folders
        || foldersResp?.values
        || foldersResp?.results
        || foldersResp?.data
        || foldersResp?.testcaseTreeGridResponseList
        || foldersResp?.items
        || [];
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
    return zFetchWithRequestFallback(pathParts.map((path) => ({ path })), options);
}

async function zFetchWithRequestFallback(requests, options = {}) {
    let lastErr;
    const attemptedPaths = [];
    for (const request of requests) {
        const { path, ...requestOptions } = request;
        try {
            const queryString = requestOptions.query ? `?${new URLSearchParams(requestOptions.query).toString()}` : '';
            attemptedPaths.push(`${path}${queryString}`);
            return await zFetch(path, { ...options, ...requestOptions });
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
    
    function schemaToZod(schema) {
        if (!schema) return z.object({}).passthrough();
        if (schema.type === 'object') {
            const shape = {};
            if (schema.properties) {
                for (const [key, val] of Object.entries(schema.properties)) {
                    let field = schemaToZod(val);
                    if (val.description) field = field.describe(val.description);
                    if (schema.required && !schema.required.includes(key)) field = field.optional();
                    shape[key] = field;
                }
            }
            let obj = z.object(shape);
            if (schema.additionalProperties === false) obj = obj.strict();
            else if (schema.additionalProperties) obj = obj.catchall(schemaToZod(schema.additionalProperties));
            return obj;
        }
        if (schema.type === 'string') return schema.enum ? z.enum(schema.enum) : z.string();
        if (schema.type === 'number') return z.number();
        if (schema.type === 'boolean') return z.boolean();
        if (schema.type === 'array') return z.array(schema.items ? schemaToZod(schema.items) : z.any());
        return z.any();
    }

    server.registerTool = (name, config, handler) => {
        const nextConfig = { ...(config || {}) };
        if (!nextConfig.inputSchema || typeof nextConfig.inputSchema.safeParseAsync !== 'function') {
            nextConfig.inputSchema = schemaToZod(nextConfig.inputSchema);
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
        { description: 'List folders for a project.', inputSchema: { type: 'object', properties: { project_id: { type: 'number' }, release_id: { type: 'number' } }, additionalProperties: false } },
        async (args) => {
            try {
                await ensureConfigured();
                const releaseId = getNumberArg(args, ['release_id', 'releaseId']);
                if (releaseId !== undefined) {
                    sessionConfig.release_id = releaseId;
                }
                const foldersResp = await zFetchWithRequestFallback(folderRequestSpecsFor(args), { operation: 'list_folders' });
                const folders = extractFolders(foldersResp);
                return { content: [{ type: 'text', text: JSON.stringify({ folders }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise_list_tcr_folders',
        {
            description: [
                'List Test Repository (TCR) folders to discover valid tcr_catalog_tree_id values. MANDATORY WORKFLOW — follow exactly:',
                '(1) Call with NO parent_id to get the top-level folder list.',
                '(2) If the target folder name does NOT appear in the result, it is a subfolder.',
                '    You MUST call this tool again with parent_id set to the id of the closest matching parent folder.',
                '(3) Repeat step 2, drilling deeper, until you find the folder by name.',
                '(4) Use the discovered id as tcr_catalog_tree_id in create/update calls.',
                'NEVER stop at the top-level if the target folder is not there. NEVER guess a folder id.',
                'TIP: Use recursive=true to fetch the entire tree in one call if the hierarchy is unknown.'
            ].join(' '),
            inputSchema: {
                type: 'object',
                properties: {
                    project_id: { type: 'number', description: 'Filter by project ID.' },
                    release_id: { type: 'number', description: 'Filter by release ID.' },
                    parent_id: { type: 'number', description: 'The id of a folder returned by a previous call to this tool. Set this to list the children (subfolders) of that folder. Omit to get top-level folders.' },
                    recursive: { type: 'boolean', description: 'If true, recursively returns ALL nested subfolders under parent_id (or root). Use this when the full hierarchy is unknown. Default: false.' },
                    max_depth: { type: 'number', description: 'Max recursion depth when recursive=true. Default: 5.' }
                },
                required: [],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                await ensureConfigured();
                const releaseId = getNumberArg(args, ['release_id', 'releaseId']);
                if (releaseId !== undefined) {
                    sessionConfig.release_id = releaseId;
                }

                const recursive = args.recursive === true;
                const maxDepth = getNumberArg(args, ['max_depth', 'maxDepth']) ?? 5;

                if (recursive) {
                    // Walk the full subfolder tree
                    const walkTree = async (parentArgs, depth) => {
                        if (depth > maxDepth) return [];
                        const resp = await zFetchWithRequestFallback(tcrFolderRequestSpecsFor(parentArgs), { operation: 'list_tcr_folders' });
                        const folders = extractFolders(resp);
                        const results = [];
                        for (const folder of folders) {
                            const folderId = folder.id ?? folder.tcrCatalogTreeId ?? folder.tcr_catalog_tree_id;
                            results.push(folder);
                            if (folderId !== undefined) {
                                const children = await walkTree({ ...parentArgs, parent_id: folderId }, depth + 1);
                                results.push(...children);
                            }
                        }
                        return results;
                    };
                    const allFolders = await walkTree(args, 0);
                    return { content: [{ type: 'text', text: JSON.stringify({ folders: allFolders, total: allFolders.length }) }] };
                }

                // Default: flat fetch (supports parent_id for one level of drilling)
                const foldersResp = await zFetchWithRequestFallback(tcrFolderRequestSpecsFor(args), { operation: 'list_tcr_folders' });
                const folders = extractFolders(foldersResp);
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
                const id = getNumberArg(args, ['id', 'test_case_id', 'testCaseId']);
                requireNumber(id, 'id');
                await ensureConfigured();
                const data = await zFetchWithFallback(testCaseGetPaths(id), { operation: 'get_test_case' });
                return { content: [{ type: 'text', text: JSON.stringify(data) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise_create_test_case',
        {
            description: [
                'Create a new test case.',
                'MANDATORY: You MUST discover the tcr_catalog_tree_id BEFORE calling this tool.',
                'Step 1: Call zephyr_enterprise_list_tcr_folders (no parent_id) to get top-level folders.',
                'Step 2: If the target folder is not in the list, call zephyr_enterprise_list_tcr_folders again with parent_id set to the closest parent folder\'s id.',
                'Step 3: Repeat until you find the exact folder. Use its id as tcr_catalog_tree_id here.',
                'NEVER guess or invent a tcr_catalog_tree_id. NEVER skip the discovery steps.'
            ].join(' '),
            inputSchema: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Test case name/title.' },
                    description: { type: 'string' },
                    steps: { type: 'array', items: { type: 'object', properties: { step: { type: 'string' }, expected: { type: 'string' } } } },
                    folder_id: { type: 'number', description: 'The tcrCatalogTreeId (folder) to place the test in. NEVER guess this. You MUST fetch it from zephyr_enterprise_list_tcr_folders first.' },
                    tcr_catalog_tree_id: { type: 'number', description: 'Exact same as folder_id. NEVER guess this. Call zephyr_enterprise_list_tcr_folders first.' },
                    priority: { type: 'string' },
                    custom_fields: { type: 'object' }
                },
                required: ['name'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                const normalizedArgs = normalizeTestCaseArgs(args);
                if (normalizedArgs.release_id !== undefined) {
                    sessionConfig.release_id = normalizedArgs.release_id;
                }
                requireNonEmptyString(normalizedArgs.name, 'name');
                ensureWritable();
                await ensureConfigured();
                const payload = buildCreateTestCasePayload(normalizedArgs);
                const data = await zFetchWithFallback(testCaseCreatePaths(), { method: 'POST', body: payload, operation: 'create_test_case' });
                return { content: [{ type: 'text', text: JSON.stringify({ id: data.id, key: data.key, testCaseId: data?.testcase?.testcaseId ?? data?.testcaseId, tcrCatalogTreeId: data?.tcrCatalogTreeId }) }] };
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
                    id: { type: 'number', description: 'Test case ID to update. NEVER GUESS. Fetch from zephyr_enterprise_search_test_cases.' },
                    name: { type: 'string' },
                    description: { type: 'string' },
                    steps: { type: 'array', items: { type: 'object' } },
                    folder_id: { type: 'number', description: 'The tcrCatalogTreeId (folder). NEVER GUESS. Call zephyr_enterprise_list_tcr_folders first.' },
                    priority: { type: 'string' },
                    custom_fields: { type: 'object' }
                },
                required: ['id'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                const normalizedArgs = normalizeTestCaseArgs(args);
                if (normalizedArgs.release_id !== undefined) {
                    sessionConfig.release_id = normalizedArgs.release_id;
                }
                requireNumber(normalizedArgs.id, 'id');
                requireAtLeastOneField(normalizedArgs, ['name', 'description', 'steps', 'folder_id', 'priority', 'custom_fields']);
                ensureWritable();
                await ensureConfigured();
                const payload = buildUpdateTestCasePayload(normalizedArgs);
                const updateSpec = testCaseUpdateSpec(normalizedArgs.id);
                const data = await zFetchWithFallback(updateSpec.paths, { ...updateSpec.options, body: payload });
                return { content: [{ type: 'text', text: JSON.stringify({ id: data.id, key: data.key, testCaseId: data?.testcase?.testcaseId ?? data?.testcaseId, tcrCatalogTreeId: data?.tcrCatalogTreeId }) }] };
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
        'zephyr_enterprise_list_cycles',
        {
            description: 'List existing test cycles for a release.',
            inputSchema: { type: 'object', properties: { project_id: { type: 'number' }, release_id: { type: 'number' } }, additionalProperties: false }
        },
        async (args) => {
            try {
                await ensureConfigured();
                const releaseId = getNumberArg(args, ['release_id', 'releaseId']) ?? sessionConfig.release_id;
                const projectId = getNumberArg(args, ['project_id', 'projectId']) ?? sessionConfig.project?.id;
                
                const pathParts = [];
                if (releaseId !== undefined) {
                    pathParts.push(`flex/services/rest/v3/cycle?releaseId=${releaseId}`);
                    pathParts.push(`public/rest/api/1.0/cycles/search?versionId=${releaseId}&projectId=${projectId}`);
                }
                pathParts.push(`public/rest/api/1.0/cycles/search?projectId=${projectId}`);
                
                const data = await zFetchWithFallback(pathParts, { operation: 'list_cycles' });
                return { content: [{ type: 'text', text: JSON.stringify({ cycles: data.values || data.searchObjectList || data }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise_add_phase_to_cycle',
        {
            description: 'Add a new phase to an existing cycle. STOP: NEVER GUESS cycle_id.',
            inputSchema: { type: 'object', properties: { cycle_id: { type: 'number', description: 'NEVER GUESS. Fetch from zephyr_enterprise_list_cycles.' }, name: { type: 'string' } }, required: ['cycle_id', 'name'], additionalProperties: false }
        },
        async (args) => {
            try {
                requireNumber(args.cycle_id, 'cycle_id');
                requireNonEmptyString(args.name, 'name');
                ensureWritable();
                await ensureConfigured();
                const payload = { cycleId: args.cycle_id, name: args.name };
                const pathParts = ['flex/services/rest/latest/cycle/cyclephase', `public/rest/api/1.0/cycle/${args.cycle_id}/phase`];
                const data = await zFetchWithFallback(pathParts, { method: 'POST', body: payload, operation: 'add_phase_to_cycle' });
                return { content: [{ type: 'text', text: JSON.stringify({ phase: data }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise_get_job_status',
        {
            description: 'Check the status of an asynchronous job progress ticket.',
            inputSchema: { type: 'object', properties: { ticket_id: { type: 'string' } }, required: ['ticket_id'], additionalProperties: false }
        },
        async (args) => {
            try {
                requireNonEmptyString(args.ticket_id, 'ticket_id');
                await ensureConfigured();
                const data = await zFetch(`public/rest/api/1.0/jobprogress/${args.ticket_id}`, { operation: 'get_job_status' });
                return { content: [{ type: 'text', text: JSON.stringify({ job: data }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise_add_test_cases_to_cycle',
        {
            description: 'Add test cases to cycle. STOP: NEVER GUESS IDs.',
            inputSchema: {
                type: 'object',
                properties: { cycle_id: { type: 'number', description: 'NEVER GUESS. Fetch from zephyr_enterprise_list_cycles.' }, test_case_ids: { type: 'array', items: { type: 'number' }, description: 'NEVER GUESS. Fetch from zephyr_enterprise_search_test_cases.' }, environment: { type: 'string' }, version: { type: 'string' } },
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
        { description: 'List executions for a cycle. STOP: NEVER GUESS cycle_id.', inputSchema: { type: 'object', properties: { cycle_id: { type: 'number', description: 'NEVER GUESS. Fetch from zephyr_enterprise_list_cycles.' } }, required: ['cycle_id'], additionalProperties: false } },
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
            description: 'Update execution status/comment/time. STOP: NEVER GUESS execution_id.',
            inputSchema: {
                type: 'object',
                properties: {
                    execution_id: { type: 'number', description: 'NEVER GUESS. Fetch from zephyr_enterprise_list_executions.' },
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
                    mapping: { type: 'object', properties: { strategy: { type: 'string', enum: ['external_id', 'name_exact', 'custom_field'] }, field: { type: 'string' } } },
                    wait_for_results: { type: 'boolean' }
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
                
                if (args.wait_for_results && data?.jobProgressToken) {
                    const ticketId = data.jobProgressToken;
                    let lastJobData;
                    for (const delay of [2000, 3000, 5000]) {
                        await new Promise(r => setTimeout(r, delay));
                        lastJobData = await zFetch(`public/rest/api/1.0/jobprogress/${ticketId}`);
                        if (lastJobData && lastJobData.progress >= 1 && lastJobData.entity) {
                             return { content: [{ type: 'text', text: JSON.stringify({ ok: true, summary: lastJobData.entity }) }] };
                        }
                    }
                    return { content: [{ type: 'text', text: JSON.stringify({ ticketId, message: "Job is taking longer than expected. Use zephyr_enterprise_get_job_status to continue monitoring." }) }] };
                }

                if (data?.jobProgressToken) {
                    return { content: [{ type: 'text', text: JSON.stringify({ ticketId: data.jobProgressToken, message: "Import started asynchronously. Please use zephyr_enterprise_get_job_status in a few moments to verify completion." }) }] };
                }

                return { content: [{ type: 'text', text: JSON.stringify({ summary: data }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    // Connectivity & Context extensions
    server.registerTool(
        'zephyr_enterprise_list_releases',
        { description: 'List releases for a project.', inputSchema: { type: 'object', properties: { project_id: { type: 'number' } }, additionalProperties: false } },
        async (args) => {
            try {
                await ensureConfigured();
                const projectId = args.project_id || sessionConfig.project?.id;
                const pathParts = [];
                if (projectId !== undefined) {
                    pathParts.push(`public/rest/api/1.0/releases?projectId=${projectId}`);
                }
                pathParts.push('flex/services/rest/v3/release'); // Fallback
                const data = await zFetchWithFallback(pathParts, { operation: 'list_releases' });
                const releases = Array.isArray(data) ? data : (data.values || data.releases || data);
                return { content: [{ type: 'text', text: JSON.stringify({ releases }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise_create_release',
        {
            description: 'Create a new release for a project.',
            inputSchema: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Name of the release.' },
                    status: { type: 'string', description: 'Status of the release (e.g., "Not Started", "In Progress").' },
                    description: { type: 'string' },
                    project_id: { type: 'number', description: 'Defaults to configured project.' },
                    start_date: { type: 'string', description: 'ISO date string.' },
                    end_date: { type: 'string', description: 'ISO date string.' }
                },
                required: ['name'], // status is now optional to prevent "additional property" errors on some Flex versions
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireNonEmptyString(args.name, 'name');
                ensureWritable();
                await ensureConfigured();
                const payload = buildCreateReleasePayload(args);
                const data = await zFetchWithFallback(releaseCreatePaths(), { method: 'POST', body: payload, operation: 'create_release' });
                return { content: [{ type: 'text', text: JSON.stringify(data) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise_update_release',
        {
            description: 'Update an existing release.',
            inputSchema: {
                type: 'object',
                properties: {
                    id: { type: 'number', description: 'ID of the release to update. NEVER GUESS. Fetch from zephyr_enterprise_list_releases.' },
                    name: { type: 'string' },
                    description: { type: 'string' },
                    status: { type: 'string', description: 'e.g., "In Progress", "Done"' },
                    start_date: { type: 'string' },
                    end_date: { type: 'string' }
                },
                required: ['id'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireNumber(args.id, 'id');
                requireAtLeastOneField(args, ['name', 'description', 'status', 'start_date', 'end_date']);
                ensureWritable();
                await ensureConfigured();
                const payload = buildUpdateReleasePayload(args);
                const data = await zFetchWithFallback(releaseUpdatePaths(args.id), { method: 'PUT', body: payload, operation: 'update_release' });
                return { content: [{ type: 'text', text: JSON.stringify(data) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise_delete_release',
        {
            description: 'Delete a release. WARNING: This is a destructive action.',
            inputSchema: {
                type: 'object',
                properties: {
                    id: { type: 'number', description: 'ID of the release to delete.' }
                },
                required: ['id'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireNumber(args.id, 'id');
                ensureWritable();
                await ensureConfigured();
                const data = await zFetchWithFallback(releaseDeletePaths(args.id), { method: 'DELETE', operation: 'delete_release' });
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, result: data }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise_list_users',
        { description: 'List users in Zephyr Enterprise.', inputSchema: { type: 'object', properties: { project_id: { type: 'number' } }, additionalProperties: false } },
        async (args) => {
            try {
                await ensureConfigured();
                const projectId = args.project_id || sessionConfig.project?.id;
                const pathParts = [];
                if (projectId !== undefined) pathParts.push(`public/rest/api/1.0/users?projectId=${projectId}`);
                pathParts.push('public/rest/api/1.0/users');
                pathParts.push('flex/services/rest/v3/user');
                const data = await zFetchWithFallback(pathParts, { operation: 'list_users' });
                const users = Array.isArray(data) ? data : (data.users || data.values || data.data || data);
                return { content: [{ type: 'text', text: JSON.stringify({ users }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise_get_me',
        { description: 'Return the currently authenticated user — useful for default assignee lookups.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                await ensureConfigured();
                const pathParts = [
                    'public/rest/api/1.0/users/me',
                    'flex/services/rest/v3/user/current',
                    'flex/services/rest/latest/user/current'
                ];
                const data = await zFetchWithFallback(pathParts, { operation: 'get_me' });
                return { content: [{ type: 'text', text: JSON.stringify({ user: data }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise_list_custom_fields',
        { description: 'List custom fields configured in Zephyr.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                await ensureConfigured();
                const pathParts = ['flex/services/rest/v3/customfield', 'public/rest/api/1.0/customfields'];
                const data = await zFetchWithFallback(pathParts, { operation: 'list_custom_fields' });
                return { content: [{ type: 'text', text: JSON.stringify({ custom_fields: data.customFields || data.values || data }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise_get_test_steps',
        { description: 'Get test steps for a specific test case.', inputSchema: { type: 'object', properties: { test_case_id: { type: 'number' } }, required: ['test_case_id'], additionalProperties: false } },
        async (args) => {
            try {
                requireNumber(args.test_case_id, 'test_case_id');
                await ensureConfigured();
                const pathParts = [`public/rest/api/1.0/teststep/${args.test_case_id}`, `flex/services/rest/latest/teststep/${args.test_case_id}`];
                const data = await zFetchWithFallback(pathParts, { operation: 'get_test_steps' });
                return { content: [{ type: 'text', text: JSON.stringify({ steps: data.steps || data.teststeps || data }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise_update_test_step',
        {
            description: 'Update a specific test step.',
            inputSchema: {
                type: 'object',
                properties: { test_step_id: { type: 'number' }, step: { type: 'string' }, data: { type: 'string' }, result: { type: 'string' } },
                required: ['test_step_id'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireNumber(args.test_step_id, 'test_step_id');
                requireAtLeastOneField(args, ['step', 'data', 'result']);
                ensureWritable();
                await ensureConfigured();
                const payload = {};
                if (args.step) payload.step = args.step;
                if (args.data) payload.data = args.data;
                if (args.result) payload.expectedResult = args.result;
                const pathParts = [`public/rest/api/1.0/teststep/${args.test_step_id}`, `flex/services/rest/latest/teststep/${args.test_step_id}`];
                const data = await zFetchWithFallback(pathParts, { method: 'PUT', body: payload, operation: 'update_test_step' });
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, step: data }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise_link_defect',
        {
            description: 'Link a Jira defect ID to an execution run.',
            inputSchema: { type: 'object', properties: { execution_id: { type: 'number' }, defect_id: { type: 'string' } }, required: ['execution_id', 'defect_id'], additionalProperties: false }
        },
        async (args) => {
            try {
                requireNumber(args.execution_id, 'execution_id');
                requireNonEmptyString(args.defect_id, 'defect_id');
                ensureWritable();
                await ensureConfigured();
                // To link defect, we execute the 'execute' endpoint with updateDefectList
                const payload = { updateDefectList: "true", defectList: [args.defect_id] };
                const pathParts = [`public/rest/api/1.0/executions/${args.execution_id}/execute`, `public/rest/api/1.0/executions/${args.execution_id}`];
                const data = await zFetchWithFallback(pathParts, { method: 'PUT', body: payload, operation: 'link_defect' });
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, execution: data }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'zephyr_enterprise_link_requirement',
        {
            description: 'Link a requirement / Jira Story to a testcase.',
            inputSchema: { type: 'object', properties: { test_case_id: { type: 'number' }, requirement_id: { type: 'string' } }, required: ['test_case_id', 'requirement_id'], additionalProperties: false }
        },
        async (args) => {
            try {
                requireNumber(args.test_case_id, 'test_case_id');
                requireNonEmptyString(args.requirement_id, 'requirement_id');
                ensureWritable();
                await ensureConfigured();
                // Using mapping endpoint for requirements
                const payload = { testcaseIds: [args.test_case_id], requirementIds: [args.requirement_id] };
                const pathParts = [`flex/services/rest/latest/requirement/map`, `public/rest/api/1.0/requirements/map`];
                const data = await zFetchWithFallback(pathParts, { method: 'POST', body: payload, operation: 'link_requirement' });
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, mapping: data }) }] };
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
        folderRequestSpecsFor,
        tcrFolderRequestSpecsFor,
        testCaseSearchSpec,
        testCaseGetPaths,
        testCaseCreatePaths,
        testCaseUpdateSpec,
        releaseCreatePaths,
        releaseUpdatePaths,
        buildCreateTestCasePayload,
        buildUpdateTestCasePayload,
        buildCreateReleasePayload,
        buildUpdateReleasePayload,
        extractProjects,
        extractFolders,
        normalizeTestCaseArgs,
        normalizeReleaseArgs,
        releaseDeletePaths
    }
};
