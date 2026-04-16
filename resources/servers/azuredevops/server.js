const z = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const SERVER_INFO = { name: 'azuredevops-mcp', version: '2.0.0' };
const API_VERSION = '7.1-preview.1';

function createAzureDevOpsServer() {
    let sessionConfig = {
        serviceUrl: process.env.AZURE_DEVOPS_ORG_URL,
        project: process.env.AZURE_DEVOPS_PROJECT,
        token: process.env.AZURE_DEVOPS_TOKEN,
        proxyUrl: process.env.FLOCCA_PROXY_URL,
        userId: process.env.FLOCCA_USER_ID
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
        if (!raw) return 'https://dev.azure.com';
        let normalized = raw
            .replace(/\/_apis(?:\/.*)?$/i, '')
            .replace(/\/_git(?:\/.*)?$/i, '');
        if (project) {
            const escapedProject = String(project).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            normalized = normalized.replace(new RegExp(`/${escapedProject}$`, 'i'), '');
        }
        return normalized.replace(/\/+$/, '');
    }

    function getHeaderCandidates() {
        const candidates = [];
        const { token, userId, proxyUrl } = sessionConfig;

        if (proxyUrl && userId) {
            candidates.push({ 'X-Flocca-User-ID': userId });
        }

        if (token) {
            const auth = Buffer.from(`:${token}`).toString('base64');
            candidates.push({ 'Authorization': `Basic ${auth}` });
        }

        return candidates;
    }

    async function ensureConfigured() {
        if (!sessionConfig.serviceUrl || !sessionConfig.project || getHeaderCandidates().length === 0) {
            // Re-read env for late configuration
            if (!sessionConfig.serviceUrl) sessionConfig.serviceUrl = process.env.AZURE_DEVOPS_ORG_URL;
            if (!sessionConfig.project) sessionConfig.project = process.env.AZURE_DEVOPS_PROJECT;
            if (!sessionConfig.token) sessionConfig.token = process.env.AZURE_DEVOPS_TOKEN;
            if (!sessionConfig.proxyUrl) sessionConfig.proxyUrl = process.env.FLOCCA_PROXY_URL;
            if (!sessionConfig.userId) sessionConfig.userId = process.env.FLOCCA_USER_ID;

            if (!sessionConfig.serviceUrl || !sessionConfig.project || getHeaderCandidates().length === 0) {
                throw new AzureError('Azure DevOps is not configured. Provide AZURE_DEVOPS_ORG_URL, AZURE_DEVOPS_PROJECT, and AZURE_DEVOPS_TOKEN (or Proxy).', { status: 400 });
            }
        }
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
        await ensureConfigured();
        const headersList = getHeaderCandidates();
        let lastError;

        for (const headers of headersList) {
            try {
                let finalUrl = url;
                if (sessionConfig.proxyUrl && sessionConfig.userId) {
                    const urlObj = new URL(url);
                    finalUrl = `${sessionConfig.proxyUrl.replace(/\/+$/, '')}${urlObj.pathname}${urlObj.search}`;
                }

                const resp = await fetch(finalUrl, {
                    ...options,
                    headers: { 
                        Accept: 'application/json', 
                        'Content-Type': 'application/json',
                        ...(options.headers || {}), 
                        ...headers 
                    }
                });

                if (resp.status === 429 && attempt <= 3) {
                    const retryAfter = Number(resp.headers.get('retry-after')) || 1;
                    await new Promise((r) => setTimeout(r, retryAfter * 1000 * Math.pow(2, attempt - 1)));
                    return adoFetch(url, options, attempt + 1);
                }

                if (!resp.ok) {
                    if (resp.status === 401 || resp.status === 404) continue;
                    let details;
                    try { details = await resp.text(); } catch (_) { details = ''; }
                    throw new AzureError(`Azure DevOps request failed (${resp.status})`, {
                        status: resp.status,
                        details: { response: details, requested_url: finalUrl, method: options.method || 'GET' }
                    });
                }

                const contentType = resp.headers.get('content-type') || '';
                if (contentType.includes('application/json')) return resp.json();
                return resp.text();
            } catch (e) {
                lastError = e;
                if (e instanceof AzureError) throw e;
                continue;
            }
        }
        throw lastError || new AzureError('All authentication candidates failed');
    }

    function buildUrl(pathPart, query = {}) {
        const base = normalizeServiceUrl(sessionConfig.serviceUrl, sessionConfig.project);
        const url = new URL(`${base}/${sessionConfig.project}/_apis/${pathPart}`);
        url.search = new URLSearchParams({ 'api-version': API_VERSION, ...query }).toString();
        return url.toString();
    }

    function buildReleaseUrl(pathPart, query = {}) {
        let base = normalizeServiceUrl(sessionConfig.serviceUrl, sessionConfig.project);
        base = base.replace('dev.azure.com', 'vsrm.dev.azure.com');
        const url = new URL(`${base}/${sessionConfig.project}/_apis/${pathPart}`);
        url.search = new URLSearchParams({ 'api-version': API_VERSION, ...query }).toString();
        return url.toString();
    }

    function buildOrgUrl(pathPart, query = {}) {
        const base = normalizeServiceUrl(sessionConfig.serviceUrl, sessionConfig.project);
        const url = new URL(`${base}/_apis/${pathPart}`);
        url.search = new URLSearchParams({ 'api-version': API_VERSION, ...query }).toString();
        return url.toString();
    }

    function buildGitUrl(pathPart, query = {}) {
        const base = normalizeServiceUrl(sessionConfig.serviceUrl, sessionConfig.project);
        const url = new URL(`${base}/${sessionConfig.project}/_apis/git/${pathPart}`);
        url.search = new URLSearchParams({ 'api-version': API_VERSION, ...query }).toString();
        return url.toString();
    }

    async function validateConfig() {
        await adoFetch(buildOrgUrl('projects', { '$top': 1 }));
    }

    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    // --- CORE ---
    server.tool('azuredevops_health', {}, async () => {
        try {
            await validateConfig();
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, mode: sessionConfig.proxyUrl ? 'proxy' : 'direct' }) }] };
        } catch (err) { return unifyError(err); }
    });

    server.tool('azuredevops_configure', {
        service_url: z.string().optional(),
        project: z.string().optional(),
        token: z.string().optional()
    }, async (args) => {
        if (args.service_url) sessionConfig.serviceUrl = args.service_url;
        if (args.project) sessionConfig.project = args.project;
        if (args.token) sessionConfig.token = args.token;
        try {
            await validateConfig();
            return { content: [{ type: 'text', text: "Azure DevOps configuration updated." }] };
        } catch (e) { return unifyError(e); }
    });

    // --- REPOS ---
    server.tool('azuredevops_list_repositories', {}, async () => {
        try {
            const data = await adoFetch(buildUrl('_apis/git/repositories'));
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
            const query = { path: args.path || '/', recursionLevel: (args.recursionLevel || 'oneLevel').toLowerCase(), includeContent: false };
            if (args.version) query.versionDescriptor_version = args.version;
            const data = await adoFetch(buildUrl(`_apis/git/repositories/${args.repository_id}/items`, query));
            return { content: [{ type: 'text', text: JSON.stringify({ items: data.value || [] }) }] };
        } catch (err) { return unifyError(err); }
    });

    server.tool('azuredevops_get_file_content', {
        repository_id: z.string(),
        path: z.string(),
        version: z.string().optional()
    }, async (args) => {
        try {
            const query = { path: args.path, includeContent: true };
            if (args.version) query.versionDescriptor_version = args.version;
            const data = await adoFetch(buildUrl(`_apis/git/repositories/${args.repository_id}/items`, query));
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
            const refsUrl = buildUrl(`_apis/git/repositories/${args.repository_id}/refs`, { filter: `heads/${args.source_branch}` });
            const refs = await adoFetch(refsUrl);
            const baseRef = (refs.value || [])[0];
            if (!baseRef) throw new AzureError('Source branch not found', { status: 404 });
            const createUrl = buildUrl(`_apis/git/repositories/${args.repository_id}/refs`);
            await adoFetch(createUrl, {
                method: 'POST',
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
            const url = buildUrl(`_apis/git/repositories/${args.repository_id}/pullrequests`);
            const pr = await adoFetch(url, {
                method: 'POST',
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
            const data = await adoFetch(buildOrgUrl('_apis/wit/wiql'), {
                method: 'POST',
                body: JSON.stringify({ query: args.wiql })
            });
            return { content: [{ type: 'text', text: JSON.stringify({ ids: (data.workItems || []).map(w => w.id) }) }] };
        } catch (err) { return unifyError(err); }
    });

    server.tool('azuredevops_get_work_item', { id: z.number() }, async (args) => {
        try {
            const item = await adoFetch(buildOrgUrl(`_apis/wit/workitems/${args.id}`));
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
            const operations = Object.entries(args.fields || {}).map(([k, v]) => ({ op: 'add', path: `/fields/${k}`, value: v }));
            const updated = await adoFetch(buildOrgUrl(`_apis/wit/workitems/${args.id}`), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json-patch+json' },
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
            const operations = [
                { op: 'add', path: '/fields/System.Title', value: args.title },
                { op: 'add', path: '/fields/System.Description', value: args.description || '' }
            ];
            if (args.assigned_to) operations.push({ op: 'add', path: '/fields/System.AssignedTo', value: args.assigned_to });
            const data = await adoFetch(buildUrl(`_apis/wit/workitems/$${args.type}`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json-patch+json' },
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
            const data = await adoFetch(buildOrgUrl(`_apis/wit/workitems/${args.id}/comments`), {
                method: 'POST',
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
            const data = await adoFetch(buildUrl(`_apis/pipelines/${args.pipeline_id}/runs`), {
                method: 'POST',
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
            const data = await adoFetch(buildUrl(`_apis/pipelines/${args.pipeline_id}/runs`, { '$top': args.top }));
            return { content: [{ type: 'text', text: JSON.stringify({ runs: data.value || [] }) }] };
        } catch (err) { return unifyError(err); }
    });

    server.tool('azuredevops_get_pipeline_run_status', {
        pipeline_id: z.number(),
        run_id: z.number()
    }, async (args) => {
        try {
            const data = await adoFetch(buildUrl(`_apis/pipelines/${args.pipeline_id}/runs/${args.run_id}`));
            return { content: [{ type: 'text', text: JSON.stringify({ state: data.state, result: data.result }) }] };
        } catch (err) { return unifyError(err); }
    });

    // --- DISCOVERY ---
    server.tool('azuredevops_list_projects', { top: z.number().optional() }, async (args) => {
        try {
            const data = await adoFetch(buildOrgUrl('_apis/projects', { '$top': args.top }));
            return { content: [{ type: 'text', text: JSON.stringify({ projects: data.value || [] }) }] };
        } catch (err) { return unifyError(err); }
    });

    server.tool('azuredevops_list_pipelines', { top: z.number().optional() }, async (args) => {
        try {
            const data = await adoFetch(buildUrl('_apis/pipelines', { '$top': args.top }));
            return { content: [{ type: 'text', text: JSON.stringify({ pipelines: data.value || [] }) }] };
        } catch (err) { return unifyError(err); }
    });

    // --- RELEASES ---
    server.tool('azuredevops_list_releases', { top: z.number().optional() }, async (args) => {
        try {
            const data = await adoFetch(buildReleaseUrl('_apis/release/releases', { '$top': args.top }));
            return { content: [{ type: 'text', text: JSON.stringify({ releases: data.value || [] }) }] };
        } catch (err) { return unifyError(err); }
    });

    // --- TESTING ---
    server.tool('azuredevops_list_test_plans', { top: z.number().optional() }, async (args) => {
        try {
            const data = await adoFetch(buildUrl('_apis/test/plans', { '$top': args.top }));
            return { content: [{ type: 'text', text: JSON.stringify({ plans: data.value || [] }) }] };
        } catch (err) { return unifyError(err); }
    });

    server.tool('azuredevops_list_test_suites', {
        plan_id: z.number(),
        top: z.number().optional()
    }, async (args) => {
        try {
            const data = await adoFetch(buildUrl(`_apis/test/plans/${args.plan_id}/suites`, { '$top': args.top }));
            return { content: [{ type: 'text', text: JSON.stringify({ suites: data.value || [] }) }] };
        } catch (err) { return unifyError(err); }
    });

    server.tool('azuredevops_list_test_runs', { top: z.number().optional() }, async (args) => {
        try {
            const data = await adoFetch(buildUrl('_apis/test/runs', { '$top': args.top }));
            return { content: [{ type: 'text', text: JSON.stringify({ runs: data.value || [] }) }] };
        } catch (err) { return unifyError(err); }
    });

    server.tool('azuredevops_get_test_run_results', { run_id: z.number() }, async (args) => {
        try {
            const data = await adoFetch(buildUrl(`_apis/test/runs/${args.run_id}/results`));
            return { content: [{ type: 'text', text: JSON.stringify({ results: data.value || [] }) }] };
        } catch (err) { return unifyError(err); }
    });

    // --- OBSERVABILITY ---
    server.tool('azuredevops_get_build_logs', { build_id: z.number() }, async (args) => {
        try {
            const metaUrl = buildUrl(`_apis/build/builds/${args.build_id}/logs`);
            const meta = await adoFetch(metaUrl);
            const results = [];
            for (const log of (meta.value || []).slice(-3)) {
                const content = await adoFetch(log.url);
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
            let wiql = `SELECT [System.Id], [System.Title], [System.State] FROM WorkItems WHERE [System.TeamProject] = '${sessionConfig.project}'`;
            if (args.state) wiql += ` AND [System.State] = '${args.state}'`;
            if (args.assigned_to) wiql += ` AND [System.AssignedTo] = '${args.assigned_to}'`;
            if (args.type) wiql += ` AND [System.WorkItemType] = '${args.type}'`;
            wiql += ' ORDER BY [System.CreatedDate] DESC';
            const data = await adoFetch(buildOrgUrl('_apis/wit/wiql', { '$top': args.top }), {
                method: 'POST',
                body: JSON.stringify({ query: wiql })
            });
            const ids = (data.workItems || []).map(w => w.id);
            return { content: [{ type: 'text', text: JSON.stringify({ ids, count: ids.length }) }] };
        } catch (err) { return unifyError(err); }
    });

    server.__test = {
        sessionConfig,
        ensureConfigured,
        adoFetch,
        getHeaderCandidates,
        setConfig: (next) => { Object.assign(sessionConfig, next); },
        getConfig: () => ({ ...sessionConfig })
    };

    return server;
}

if (require.main === module) {
    const serverInstance = createAzureDevOpsServer();
    const transport = new StdioServerTransport();
    serverInstance.connect(transport).catch((error) => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createAzureDevOpsServer };
