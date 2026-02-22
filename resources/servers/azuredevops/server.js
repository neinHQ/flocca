const path = require('path');
const z = require('zod');
const { McpServer } = require(path.join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js'));
const { StdioServerTransport } = require(path.join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/stdio.js'));

const SERVER_INFO = { name: 'azuredevops-mcp', version: '0.1.0' };
const API_VERSION = '7.1-preview.1';

const sessionConfig = {
    serviceUrl: process.env.AZURE_DEVOPS_ORG_URL, // e.g. https://dev.azure.com/myorg
    project: process.env.AZURE_DEVOPS_PROJECT,
    token: process.env.AZURE_DEVOPS_TOKEN
};

class AzureError extends Error {
    constructor(message, { status, details, operation } = {}) {
        super(message);
        this.status = status;
        this.details = details;
        this.operation = operation;
    }
}

function requireConfigured() {
    if (!sessionConfig.serviceUrl || !sessionConfig.project || !sessionConfig.token) {
        throw new AzureError('Azure DevOps is not configured. Call azuredevops_configure first.', { status: 400 });
    }
}

function authHeaders() {
    const token = sessionConfig.token || '';
    // PAT: use Basic auth with empty user
    const auth = Buffer.from(`:${token}`).toString('base64');
    return { Authorization: `Basic ${auth}` };
}

function unifyError(err) {
    const payload = {
        error: {
            message: err.message || 'Unknown error',
            code: err.status || 500,
            details: err.details
        }
    };
    if (err.operation) payload.error.operation = err.operation;
    return { isError: true, content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

async function adoFetch(url, options = {}, attempt = 1) {
    const resp = await fetch(url, {
        ...options,
        headers: {
            Accept: 'application/json',
            ...(options.headers || {})
        }
    });

    if (resp.status === 429 && attempt <= 3) {
        const retryAfter = Number(resp.headers.get('retry-after')) || 1;
        await new Promise((r) => setTimeout(r, retryAfter * 1000 * Math.pow(2, attempt - 1)));
        return adoFetch(url, options, attempt + 1);
    }

    if (!resp.ok) {
        let details;
        try {
            details = await resp.text();
        } catch (_) {
            details = '';
        }
        throw new AzureError(`Azure DevOps request failed (${resp.status})`, { status: resp.status, details });
    }
    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        return resp.json();
    }
    return resp.text();
}

function buildUrl(pathPart, query = {}) {
    const url = new URL(`${sessionConfig.serviceUrl}/${sessionConfig.project}/${pathPart}`);
    const params = new URLSearchParams({ 'api-version': API_VERSION, ...query });
    url.search = params.toString();
    return url.toString();
}

function buildOrgUrl(pathPart, query = {}) {
    const url = new URL(`${sessionConfig.serviceUrl}/${pathPart}`);
    const params = new URLSearchParams({ 'api-version': API_VERSION, ...query });
    url.search = params.toString();
    return url.toString();
}

async function validateConfig({ service_url, project, token }) {
    if (!service_url || !project || !token) {
        throw new AzureError('Missing required configuration values', { status: 400 });
    }
    const testUrl = `${service_url}/${project}/_apis/projects?api-version=${API_VERSION}`;
    const resp = await fetch(testUrl, { headers: authHeaders() });
    if (!resp.ok) {
        throw new AzureError('Azure DevOps token validation failed', { status: resp.status, details: await resp.text() });
    }
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
        'azuredevops_health',
        {
            description: 'Health check for Azure DevOps MCP server.',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false }
        },
        async () => ({ content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] })
    );

    server.registerTool(
        'azuredevops_configure',
        {
            description: 'Configure Azure DevOps connection for this session.',
            inputSchema: {
                type: 'object',
                properties: {
                    service_url: { type: 'string' },
                    project: { type: 'string' },
                    token: { type: 'string' }
                },
                required: ['service_url', 'project', 'token'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                await validateConfig(args);
                sessionConfig.serviceUrl = args.service_url.replace(/\/+$/, '');
                sessionConfig.project = args.project;
                sessionConfig.token = args.token;
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
            } catch (err) {
                return unifyError(err);
            }
        }
    );

    server.registerTool(
        'azuredevops_list_repositories',
        {
            description: 'List repositories in the configured project.',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false }
        },
        async () => {
            try {
                requireConfigured();
                const repos = [];
                const url = buildUrl('_apis/git/repositories');
                const data = await adoFetch(url, { headers: authHeaders() });
                (data.value || []).forEach((r) => repos.push({ id: r.id, name: r.name, webUrl: r.webUrl, remoteUrl: r.remoteUrl }));
                return { content: [{ type: 'text', text: JSON.stringify({ repositories: repos }) }] };
            } catch (err) {
                return unifyError(err);
            }
        }
    );

    server.registerTool(
        'azuredevops_get_repository_items',
        {
            description: 'List files/folders within a repository path.',
            inputSchema: {
                type: 'object',
                properties: {
                    repository_id: { type: 'string' },
                    path: { type: 'string', default: '/' },
                    recursionLevel: { type: 'string', enum: ['none', 'oneLevel', 'full'], default: 'oneLevel' },
                    version: { type: 'string', description: 'Branch or commit (optional)' }
                },
                required: ['repository_id'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const query = {
                    path: args.path || '/',
                    recursionLevel: (args.recursionLevel || 'oneLevel').toLowerCase(),
                    includeContent: false
                };
                if (args.version) query.versionDescriptor_version = args.version;
                const url = buildUrl(`_apis/git/repositories/${args.repository_id}/items`, query);
                const data = await adoFetch(url, { headers: authHeaders() });
                return { content: [{ type: 'text', text: JSON.stringify({ items: data.value || [] }) }] };
            } catch (err) {
                return unifyError(err);
            }
        }
    );

    server.registerTool(
        'azuredevops_get_file_content',
        {
            description: 'Get file contents from a repository.',
            inputSchema: {
                type: 'object',
                properties: {
                    repository_id: { type: 'string' },
                    path: { type: 'string' },
                    version: { type: 'string', description: 'Branch or commit (optional)' }
                },
                required: ['repository_id', 'path'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const query = {
                    path: args.path,
                    includeContent: true
                };
                if (args.version) query.versionDescriptor_version = args.version;
                const url = buildUrl(`_apis/git/repositories/${args.repository_id}/items`, query);
                const data = await adoFetch(url, { headers: authHeaders() });
                const content = data.content || '';
                return { content: [{ type: 'text', text: JSON.stringify({ content }) }] };
            } catch (err) {
                return unifyError(err);
            }
        }
    );

    server.registerTool(
        'azuredevops_create_branch',
        {
            description: 'Create a new branch from a target branch.',
            inputSchema: {
                type: 'object',
                properties: {
                    repository_id: { type: 'string' },
                    source_branch: { type: 'string' },
                    new_branch: { type: 'string' }
                },
                required: ['repository_id', 'source_branch', 'new_branch'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const refsUrl = buildUrl(`_apis/git/repositories/${args.repository_id}/refs`, { filter: `heads/${args.source_branch}` });
                const refs = await adoFetch(refsUrl, { headers: authHeaders() });
                const baseRef = (refs.value || [])[0];
                if (!baseRef) {
                    throw new AzureError('Source branch not found', { status: 404 });
                }

                const createUrl = buildUrl(`_apis/git/repositories/${args.repository_id}/refs`);
                const payload = [
                    {
                        name: `refs/heads/${args.new_branch}`,
                        oldObjectId: '0000000000000000000000000000000000000000',
                        newObjectId: baseRef.objectId
                    }
                ];
                await adoFetch(createUrl, {
                    method: 'POST',
                    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
            } catch (err) {
                return unifyError(err);
            }
        }
    );

    server.registerTool(
        'azuredevops_create_pull_request',
        {
            description: 'Create a pull request.',
            inputSchema: {
                type: 'object',
                properties: {
                    repository_id: { type: 'string' },
                    source_branch: { type: 'string' },
                    target_branch: { type: 'string' },
                    title: { type: 'string' },
                    description: { type: 'string' }
                },
                required: ['repository_id', 'source_branch', 'target_branch', 'title'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const url = buildUrl(`_apis/git/repositories/${args.repository_id}/pullrequests`);
                const payload = {
                    sourceRefName: `refs/heads/${args.source_branch}`,
                    targetRefName: `refs/heads/${args.target_branch}`,
                    title: args.title,
                    description: args.description || ''
                };
                const pr = await adoFetch(url, {
                    method: 'POST',
                    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = {
                    id: pr.pullRequestId,
                    webUrl: pr._links && pr._links.web ? pr._links.web.href : undefined,
                    title: pr.title,
                    description: pr.description
                };
                return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            } catch (err) {
                return unifyError(err);
            }
        }
    );

    server.registerTool(
        'azuredevops_list_work_items',
        {
            description: 'List work items using WIQL or simple query.',
            inputSchema: {
                type: 'object',
                properties: {
                    wiql: { type: 'string', description: 'WIQL query string' }
                },
                required: ['wiql'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const url = buildOrgUrl('_apis/wit/wiql');
                const data = await adoFetch(url, {
                    method: 'POST',
                    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: args.wiql })
                });
                const ids = (data.workItems || []).map((w) => w.id);
                return { content: [{ type: 'text', text: JSON.stringify({ ids }) }] };
            } catch (err) {
                return unifyError(err);
            }
        }
    );

    server.registerTool(
        'azuredevops_get_work_item',
        {
            description: 'Get a work item by ID.',
            inputSchema: {
                type: 'object',
                properties: { id: { type: 'number' } },
                required: ['id'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const url = buildOrgUrl(`_apis/wit/workitems/${args.id}`);
                const item = await adoFetch(url, { headers: authHeaders() });
                return { content: [{ type: 'text', text: JSON.stringify(item) }] };
            } catch (err) {
                return unifyError(err);
            }
        }
    );

    server.registerTool(
        'azuredevops_update_work_item',
        {
            description: 'Update a work item fields (atomic).',
            inputSchema: {
                type: 'object',
                properties: {
                    id: { type: 'number' },
                    fields: { type: 'object', description: 'Key-value map of fields to update' }
                },
                required: ['id', 'fields'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const operations = Object.entries(args.fields || {}).map(([k, v]) => ({
                    op: 'add',
                    path: `/fields/${k}`,
                    value: v
                }));
                const url = buildOrgUrl(`_apis/wit/workitems/${args.id}`);
                const updated = await adoFetch(url, {
                    method: 'PATCH',
                    headers: { ...authHeaders(), 'Content-Type': 'application/json-patch+json' },
                    body: JSON.stringify(operations)
                });
                return { content: [{ type: 'text', text: JSON.stringify(updated) }] };
            } catch (err) {
                return unifyError(err);
            }
        }
    );

    server.registerTool(
        'azuredevops_run_pipeline',
        {
            description: 'Trigger a pipeline run for a given branch.',
            inputSchema: {
                type: 'object',
                properties: {
                    pipeline_id: { type: 'number' },
                    branch: { type: 'string' }
                },
                required: ['pipeline_id', 'branch'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const url = buildUrl(`_apis/pipelines/${args.pipeline_id}/runs`);
                const data = await adoFetch(url, {
                    method: 'POST',
                    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        resources: {
                            repositories: {
                                self: { refName: `refs/heads/${args.branch}` }
                            }
                        }
                    })
                });
                return { content: [{ type: 'text', text: JSON.stringify({ runId: data.id, state: data.state }) }] };
            } catch (err) {
                return unifyError(err);
            }
        }
    );

    server.registerTool(
        'azuredevops_get_pipeline_runs',
        {
            description: 'List pipeline runs.',
            inputSchema: {
                type: 'object',
                properties: { pipeline_id: { type: 'number' } },
                required: ['pipeline_id'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const url = buildUrl(`_apis/pipelines/${args.pipeline_id}/runs`);
                const data = await adoFetch(url, { headers: authHeaders() });
                return { content: [{ type: 'text', text: JSON.stringify({ runs: data.value || [] }) }] };
            } catch (err) {
                return unifyError(err);
            }
        }
    );

    server.registerTool(
        'azuredevops_get_pipeline_run_status',
        {
            description: 'Get status of a pipeline run.',
            inputSchema: {
                type: 'object',
                properties: { pipeline_id: { type: 'number' }, run_id: { type: 'number' } },
                required: ['pipeline_id', 'run_id'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const url = buildUrl(`_apis/pipelines/${args.pipeline_id}/runs/${args.run_id}`);
                const data = await adoFetch(url, { headers: authHeaders() });
                return { content: [{ type: 'text', text: JSON.stringify({ state: data.state, result: data.result }) }] };
            } catch (err) {
                return unifyError(err);
            }
        }
    );

    server.server.oninitialized = () => {
        console.log('Azure DevOps MCP server initialized.');
    };

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.log('Azure DevOps MCP server running on stdio.');
}

main().catch((err) => {
    console.error('Azure DevOps MCP server failed to start:', err);
    process.exit(1);
});
