const z = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const SERVER_INFO = { name: 'azuredevops-mcp', version: '2.0.0' };
const API_VERSION = '7.1-preview.1';

function createAzureDevOpsServer() {
    const sessionConfig = {
        serviceUrl: process.env.AZURE_DEVOPS_ORG_URL,
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

    function normalizeServiceUrl(serviceUrl, project) {
        const raw = String(serviceUrl || '').trim().replace(/\/+$/, '');
        if (!raw) return raw;
        let normalized = raw
            .replace(/\/_apis(?:\/.*)?$/i, '')
            .replace(/\/_git(?:\/.*)?$/i, '');
        if (project) {
            const escapedProject = String(project).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            normalized = normalized.replace(new RegExp(`/${escapedProject}$`, 'i'), '');
        }
        return normalized.replace(/\/+$/, '');
    }

    function requireConfigured() {
        if (!sessionConfig.serviceUrl || !sessionConfig.project || !sessionConfig.token) {
            throw new AzureError('Azure DevOps is not configured. Call azuredevops_configure first.', { status: 400 });
        }
    }

    function authHeaders() {
        const token = sessionConfig.token || '';
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
            headers: { Accept: 'application/json', ...(options.headers || {}) }
        });

        if (resp.status === 429 && attempt <= 3) {
            const retryAfter = Number(resp.headers.get('retry-after')) || 1;
            await new Promise((r) => setTimeout(r, retryAfter * 1000 * Math.pow(2, attempt - 1)));
            return adoFetch(url, options, attempt + 1);
        }

        if (!resp.ok) {
            let details;
            try { details = await resp.text(); } catch (_) { details = ''; }
            throw new AzureError(`Azure DevOps request failed (${resp.status})`, {
                status: resp.status,
                details: { response: details, requested_url: url, method: options.method || 'GET' }
            });
        }
        const contentType = resp.headers.get('content-type') || '';
        if (contentType.includes('application/json')) return resp.json();
        return resp.text();
    }

    function buildUrl(pathPart, query = {}) {
        const url = new URL(`${sessionConfig.serviceUrl}/${sessionConfig.project}/${pathPart}`);
        url.search = new URLSearchParams({ 'api-version': API_VERSION, ...query }).toString();
        return url.toString();
    }

    function buildReleaseUrl(pathPart, query = {}) {
        const base = sessionConfig.serviceUrl.replace('dev.azure.com', 'vsrm.dev.azure.com');
        const url = new URL(`${base}/${sessionConfig.project}/${pathPart}`);
        url.search = new URLSearchParams({ 'api-version': API_VERSION, ...query }).toString();
        return url.toString();
    }

    function buildOrgUrl(pathPart, query = {}) {
        const url = new URL(`${sessionConfig.serviceUrl}/${pathPart}`);
        url.search = new URLSearchParams({ 'api-version': API_VERSION, ...query }).toString();
        return url.toString();
    }

    async function validateConfig({ service_url, project, token }) {
        if (!service_url || !project || !token) {
            throw new AzureError('Missing required configuration values', { status: 400 });
        }
        const normalizedUrl = normalizeServiceUrl(service_url, project);
        const testUrl = `${normalizedUrl}/${project}/_apis/projects?api-version=${API_VERSION}`;
        const resp = await fetch(testUrl, { headers: authHeaders() });
        if (!resp.ok) {
            throw new AzureError('Azure DevOps token validation failed', { status: resp.status, details: await resp.text() });
        }
    }

    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    // --- CORE ---
    server.tool('azuredevops_health', {}, async () => {
        try {
            requireConfigured();
            await validateConfig({ service_url: sessionConfig.serviceUrl, project: sessionConfig.project, token: sessionConfig.token });
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
        } catch (err) { return unifyError(err); }
    });

    server.tool('azuredevops_configure', {
        service_url: z.string(),
        project: z.string(),
        token: z.string()
    }, async (args) => {
        try {
            await validateConfig(args);
            sessionConfig.serviceUrl = normalizeServiceUrl(args.service_url, args.project);
            sessionConfig.project = args.project;
            sessionConfig.token = args.token;
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
        } catch (err) { return unifyError(err); }
    });

    // --- REPOS ---
    server.tool('azuredevops_list_repositories', {}, async () => {
        try {
            requireConfigured();
            const data = await adoFetch(buildUrl('_apis/git/repositories'), { headers: authHeaders() });
            const repos = (data.value || []).map(r => ({ id: r.id, name: r.name, webUrl: r.webUrl, remoteUrl: r.remoteUrl }));
            return { content: [{ type: 'text', text: JSON.stringify({ repositories: repos }) }] };
        } catch (err) { return unifyError(err); }
    });

    server.tool('azuredevops_get_repository_items', {
        repository_id: z.string(),
        path: z.string().optional(),
        recursionLevel: z.enum(['none', 'oneLevel', 'full']).optional(),
        version: z.string().optional()
    }, async (args) => {
        try {
            requireConfigured();
            const query = { path: args.path || '/', recursionLevel: (args.recursionLevel || 'oneLevel').toLowerCase(), includeContent: false };
            if (args.version) query.versionDescriptor_version = args.version;
            const data = await adoFetch(buildUrl(`_apis/git/repositories/${args.repository_id}/items`, query), { headers: authHeaders() });
            return { content: [{ type: 'text', text: JSON.stringify({ items: data.value || [] }) }] };
        } catch (err) { return unifyError(err); }
    });

    server.tool('azuredevops_get_file_content', {
        repository_id: z.string(),
        path: z.string(),
        version: z.string().optional()
    }, async (args) => {
        try {
            requireConfigured();
            const query = { path: args.path, includeContent: true };
            if (args.version) query.versionDescriptor_version = args.version;
            const data = await adoFetch(buildUrl(`_apis/git/repositories/${args.repository_id}/items`, query), { headers: authHeaders() });
            return { content: [{ type: 'text', text: JSON.stringify({ content: data.content || '' }) }] };
        } catch (err) { return unifyError(err); }
    });

    // --- MUTATIONS (with safety gates) ---
    server.tool('azuredevops_create_branch', {
        repository_id: z.string(),
        source_branch: z.string(),
        new_branch: z.string(),
        confirm: z.boolean().describe('Safety gate')
    }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: 'CONFIRMATION_REQUIRED' }] };
        try {
            requireConfigured();
            const refsUrl = buildUrl(`_apis/git/repositories/${args.repository_id}/refs`, { filter: `heads/${args.source_branch}` });
            const refs = await adoFetch(refsUrl, { headers: authHeaders() });
            const baseRef = (refs.value || [])[0];
            if (!baseRef) throw new AzureError('Source branch not found', { status: 404 });
            const createUrl = buildUrl(`_apis/git/repositories/${args.repository_id}/refs`);
            await adoFetch(createUrl, {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify([{ name: `refs/heads/${args.new_branch}`, oldObjectId: '0000000000000000000000000000000000000000', newObjectId: baseRef.objectId }])
            });
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
        } catch (err) { return unifyError(err); }
    });

    server.tool('azuredevops_create_pull_request', {
        repository_id: z.string(),
        source_branch: z.string(),
        target_branch: z.string(),
        title: z.string(),
        description: z.string().optional(),
        confirm: z.boolean().describe('Safety gate')
    }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: 'CONFIRMATION_REQUIRED' }] };
        try {
            requireConfigured();
            const url = buildUrl(`_apis/git/repositories/${args.repository_id}/pullrequests`);
            const pr = await adoFetch(url, {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourceRefName: `refs/heads/${args.source_branch}`,
                    targetRefName: `refs/heads/${args.target_branch}`,
                    title: args.title,
                    description: args.description || ''
                })
            });
            return { content: [{ type: 'text', text: JSON.stringify({ id: pr.pullRequestId, webUrl: pr._links?.web?.href, title: pr.title }) }] };
        } catch (err) { return unifyError(err); }
    });

    // --- WORK ITEMS ---
    server.tool('azuredevops_list_work_items', { wiql: z.string() }, async (args) => {
        try {
            requireConfigured();
            const data = await adoFetch(buildOrgUrl('_apis/wit/wiql'), {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: args.wiql })
            });
            return { content: [{ type: 'text', text: JSON.stringify({ ids: (data.workItems || []).map(w => w.id) }) }] };
        } catch (err) { return unifyError(err); }
    });

    server.tool('azuredevops_get_work_item', { id: z.number() }, async (args) => {
        try {
            requireConfigured();
            const item = await adoFetch(buildOrgUrl(`_apis/wit/workitems/${args.id}`), { headers: authHeaders() });
            return { content: [{ type: 'text', text: JSON.stringify(item) }] };
        } catch (err) { return unifyError(err); }
    });

    server.tool('azuredevops_update_work_item', {
        id: z.number(),
        fields: z.record(z.string(), z.any()),
        confirm: z.boolean().describe('Safety gate')
    }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: 'CONFIRMATION_REQUIRED' }] };
        try {
            requireConfigured();
            const operations = Object.entries(args.fields || {}).map(([k, v]) => ({ op: 'add', path: `/fields/${k}`, value: v }));
            const updated = await adoFetch(buildOrgUrl(`_apis/wit/workitems/${args.id}`), {
                method: 'PATCH',
                headers: { ...authHeaders(), 'Content-Type': 'application/json-patch+json' },
                body: JSON.stringify(operations)
            });
            return { content: [{ type: 'text', text: JSON.stringify(updated) }] };
        } catch (err) { return unifyError(err); }
    });

    server.tool('azuredevops_create_work_item', {
        type: z.string().describe('e.g. Task, Bug, User Story'),
        title: z.string(),
        description: z.string().optional(),
        assigned_to: z.string().optional(),
        confirm: z.boolean().describe('Safety gate')
    }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: 'CONFIRMATION_REQUIRED' }] };
        try {
            requireConfigured();
            const operations = [
                { op: 'add', path: '/fields/System.Title', value: args.title },
                { op: 'add', path: '/fields/System.Description', value: args.description || '' }
            ];
            if (args.assigned_to) operations.push({ op: 'add', path: '/fields/System.AssignedTo', value: args.assigned_to });
            const data = await adoFetch(buildUrl(`_apis/wit/workitems/$${args.type}`), {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json-patch+json' },
                body: JSON.stringify(operations)
            });
            return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        } catch (err) { return unifyError(err); }
    });

    server.tool('azuredevops_add_work_item_comment', {
        id: z.number(),
        text: z.string(),
        confirm: z.boolean().describe('Safety gate')
    }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: 'CONFIRMATION_REQUIRED' }] };
        try {
            requireConfigured();
            const data = await adoFetch(buildOrgUrl(`_apis/wit/workitems/${args.id}/comments`), {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: args.text })
            });
            return { content: [{ type: 'text', text: JSON.stringify({ id: data.id, text: data.text }) }] };
        } catch (err) { return unifyError(err); }
    });

    // --- PIPELINES ---
    server.tool('azuredevops_run_pipeline', {
        pipeline_id: z.number(),
        branch: z.string(),
        confirm: z.boolean().describe('Safety gate')
    }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: 'CONFIRMATION_REQUIRED' }] };
        try {
            requireConfigured();
            const data = await adoFetch(buildUrl(`_apis/pipelines/${args.pipeline_id}/runs`), {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ resources: { repositories: { self: { refName: `refs/heads/${args.branch}` } } } })
            });
            return { content: [{ type: 'text', text: JSON.stringify({ runId: data.id, state: data.state }) }] };
        } catch (err) { return unifyError(err); }
    });

    server.tool('azuredevops_get_pipeline_runs', {
        pipeline_id: z.number(),
        top: z.number().optional()
    }, async (args) => {
        try {
            requireConfigured();
            const data = await adoFetch(buildUrl(`_apis/pipelines/${args.pipeline_id}/runs`, { '$top': args.top }), { headers: authHeaders() });
            return { content: [{ type: 'text', text: JSON.stringify({ runs: data.value || [] }) }] };
        } catch (err) { return unifyError(err); }
    });

    server.tool('azuredevops_get_pipeline_run_status', {
        pipeline_id: z.number(),
        run_id: z.number()
    }, async (args) => {
        try {
            requireConfigured();
            const data = await adoFetch(buildUrl(`_apis/pipelines/${args.pipeline_id}/runs/${args.run_id}`), { headers: authHeaders() });
            return { content: [{ type: 'text', text: JSON.stringify({ state: data.state, result: data.result }) }] };
        } catch (err) { return unifyError(err); }
    });

    // --- DISCOVERY ---
    server.tool('azuredevops_list_projects', { top: z.number().optional() }, async (args) => {
        try {
            requireConfigured();
            const data = await adoFetch(buildOrgUrl('_apis/projects', { '$top': args.top }), { headers: authHeaders() });
            return { content: [{ type: 'text', text: JSON.stringify({ projects: data.value || [] }) }] };
        } catch (err) { return unifyError(err); }
    });

    server.tool('azuredevops_list_pipelines', { top: z.number().optional() }, async (args) => {
        try {
            requireConfigured();
            const data = await adoFetch(buildUrl('_apis/pipelines', { '$top': args.top }), { headers: authHeaders() });
            return { content: [{ type: 'text', text: JSON.stringify({ pipelines: data.value || [] }) }] };
        } catch (err) { return unifyError(err); }
    });

    // --- RELEASES ---
    server.tool('azuredevops_list_releases', { top: z.number().optional() }, async (args) => {
        try {
            requireConfigured();
            const data = await adoFetch(buildReleaseUrl('_apis/release/releases', { '$top': args.top }), { headers: authHeaders() });
            return { content: [{ type: 'text', text: JSON.stringify({ releases: data.value || [] }) }] };
        } catch (err) { return unifyError(err); }
    });

    // --- TESTING ---
    server.tool('azuredevops_list_test_plans', { top: z.number().optional() }, async (args) => {
        try {
            requireConfigured();
            const data = await adoFetch(buildUrl('_apis/test/plans', { '$top': args.top }), { headers: authHeaders() });
            return { content: [{ type: 'text', text: JSON.stringify({ plans: data.value || [] }) }] };
        } catch (err) { return unifyError(err); }
    });

    server.tool('azuredevops_list_test_suites', {
        plan_id: z.number(),
        top: z.number().optional()
    }, async (args) => {
        try {
            requireConfigured();
            const data = await adoFetch(buildUrl(`_apis/test/plans/${args.plan_id}/suites`, { '$top': args.top }), { headers: authHeaders() });
            return { content: [{ type: 'text', text: JSON.stringify({ suites: data.value || [] }) }] };
        } catch (err) { return unifyError(err); }
    });

    server.tool('azuredevops_list_test_runs', { top: z.number().optional() }, async (args) => {
        try {
            requireConfigured();
            const data = await adoFetch(buildUrl('_apis/test/runs', { '$top': args.top }), { headers: authHeaders() });
            return { content: [{ type: 'text', text: JSON.stringify({ runs: data.value || [] }) }] };
        } catch (err) { return unifyError(err); }
    });

    server.tool('azuredevops_get_test_run_results', { run_id: z.number() }, async (args) => {
        try {
            requireConfigured();
            const data = await adoFetch(buildUrl(`_apis/test/runs/${args.run_id}/results`), { headers: authHeaders() });
            return { content: [{ type: 'text', text: JSON.stringify({ results: data.value || [] }) }] };
        } catch (err) { return unifyError(err); }
    });

    // --- OBSERVABILITY ---
    server.tool('azuredevops_get_build_logs', { build_id: z.number() }, async (args) => {
        try {
            requireConfigured();
            const metaUrl = buildUrl(`_apis/build/builds/${args.build_id}/logs`);
            const meta = await adoFetch(metaUrl, { headers: authHeaders() });
            const results = [];
            for (const log of (meta.value || []).slice(-3)) {
                const content = await adoFetch(log.url, { headers: authHeaders() });
                results.push({ id: log.id, lineCount: log.lineCount, content: typeof content === 'string' ? content.substring(0, 5000) : content });
            }
            return { content: [{ type: 'text', text: JSON.stringify({ logs: results }) }] };
        } catch (err) { return unifyError(err); }
    });

    // --- QUERY HELPER ---
    server.tool('azuredevops_query_work_items', {
        state: z.string().optional(),
        assigned_to: z.string().optional(),
        type: z.string().optional(),
        top: z.number().optional()
    }, async (args) => {
        try {
            requireConfigured();
            let wiql = `SELECT [System.Id], [System.Title], [System.State] FROM WorkItems WHERE [System.TeamProject] = '${sessionConfig.project}'`;
            if (args.state) wiql += ` AND [System.State] = '${args.state}'`;
            if (args.assigned_to) wiql += ` AND [System.AssignedTo] = '${args.assigned_to}'`;
            if (args.type) wiql += ` AND [System.WorkItemType] = '${args.type}'`;
            wiql += ' ORDER BY [System.CreatedDate] DESC';
            const data = await adoFetch(buildOrgUrl('_apis/wit/wiql', { '$top': args.top }), {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: wiql })
            });
            const ids = (data.workItems || []).map(w => w.id);
            return { content: [{ type: 'text', text: JSON.stringify({ ids, count: ids.length }) }] };
        } catch (err) { return unifyError(err); }
    });

    return {
        server,
        __test: {
            normalizeServiceUrl,
            unifyError,
            setConfig: (next) => { Object.assign(sessionConfig, next); },
            getConfig: () => ({ ...sessionConfig })
        }
    };
}

const { server, __test } = createAzureDevOpsServer();

if (require.main === module) {
    const transport = new StdioServerTransport();
    server.connect(transport).catch(console.error);
}

module.exports = { createAzureDevOpsServer, __test };
