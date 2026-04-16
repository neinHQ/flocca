const axios = require('axios');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const SERVER_INFO = { name: 'bitbucket-mcp', version: '2.0.0' };

function normalizeServiceUrl(url) {
    if (!url) return 'https://api.bitbucket.org/2.0';
    const trimmed = url.replace(/\/+$/, '');
    if (trimmed.includes('api.bitbucket.org/2.0')) return trimmed;
    if (trimmed.includes('bitbucket.org')) return 'https://api.bitbucket.org/2.0';
    if (/\/rest\/api\/\d+\.\d+$/i.test(trimmed)) return trimmed;
    // Default to Server/DC path if it looks like a custom domain but doesn't have the REST suffix
    return `${trimmed}/rest/api/1.0`;
}

function createBitbucketServer() {
    let sessionConfig = {
        serviceUrl: process.env.BITBUCKET_SERVICE_URL || 'https://api.bitbucket.org/2.0',
        username: process.env.BITBUCKET_USERNAME,
        password: process.env.BITBUCKET_PASSWORD, // App Password or PAT
        workspace: process.env.BITBUCKET_WORKSPACE,
        proxyUrl: process.env.FLOCCA_PROXY_URL,
        userId: process.env.FLOCCA_USER_ID
    };

    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });
    let api = null;

    function getHeaderCandidates() {
        const candidates = [];
        const { username, password, proxyUrl, userId } = sessionConfig;

        if (proxyUrl && userId) {
            candidates.push({ 'X-Flocca-User-ID': userId });
        }

        if (username && password) {
            const auth = Buffer.from(`${username}:${password}`).toString('base64');
            candidates.push({ 'Authorization': `Basic ${auth}` });
        }

        return candidates;
    }

    function getBaseUrlCandidates() {
        const candidates = [];
        const { proxyUrl, serviceUrl } = sessionConfig;

        if (proxyUrl) {
            candidates.push(proxyUrl.replace(/\/+$/, ''));
        }

        const normalized = normalizeServiceUrl(serviceUrl);
        candidates.push(normalized);
        
        // If it's potentially Bitbucket Server/DC, try another variation
        if (!normalized.includes('bitbucket.org')) {
            candidates.push(serviceUrl.replace(/\/+$/, '') + '/rest/api/1.0');
        }

        return [...new Set(candidates)];
    }

    async function ensureConnected() {
        const headers = getHeaderCandidates();
        if (headers.length === 0) {
            // Re-check env vars
            sessionConfig.username = process.env.BITBUCKET_USERNAME;
            sessionConfig.password = process.env.BITBUCKET_PASSWORD;
            sessionConfig.proxyUrl = process.env.FLOCCA_PROXY_URL;
            sessionConfig.userId = process.env.FLOCCA_USER_ID;
            if (getHeaderCandidates().length === 0) {
                throw new Error("Bitbucket credentials not configured. Provide BITBUCKET_USERNAME/PASSWORD or FLOCCA_PROXY_URL.");
            }
        }

        if (!api) {
            const urls = getBaseUrlCandidates();
            api = axios.create({
                baseURL: urls[0],
                headers: headers[0],
                timeout: 10000
            });
        }
        return api;
    }

    async function bitbucketRequest(config) {
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
                        headers: { ...config.headers, ...header },
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

    function isCloud() {
        return sessionConfig.serviceUrl.includes('api.bitbucket.org');
    }

    function getRepoPath(workspace, repo) {
        return isCloud() ? `/repositories/${workspace}/${repo}` : `/projects/${workspace}/repos/${repo}`;
    }

    function normalizeError(err) {
        const msg = err.message || JSON.stringify(err);
        const details = err.response ? { status: err.response.status, data: err.response.data } : undefined;
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: msg, details }) }] };
    }

    // --- TOOLS ---

    server.tool("bitbucket_health", {}, async () => {
        try {
            const url = isCloud() ? '/user' : '/users/' + sessionConfig.username;
            await bitbucketRequest({ method: 'GET', url });
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, mode: sessionConfig.proxyUrl ? 'proxy' : 'direct' }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool("bitbucket_configure",
        {
            service_url: z.string().optional(),
            username: z.string().optional(),
            password: z.string().optional(),
            workspace: z.string().optional()
        },
        async (args) => {
            if (args.service_url) sessionConfig.serviceUrl = normalizeServiceUrl(args.service_url);
            if (args.username) sessionConfig.username = args.username;
            if (args.password) sessionConfig.password = args.password;
            if (args.workspace) sessionConfig.workspace = args.workspace;
            api = null;

            try {
                const url = isCloud() ? '/user' : '/users/' + sessionConfig.username;
                await bitbucketRequest({ method: 'GET', url });
                return { content: [{ type: 'text', text: "Bitbucket configuration updated and verified." }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool("bitbucket_list_repositories",
        {
            workspace: z.string().optional(),
            pagelen: z.number().default(50),
            page: z.number().default(1)
        },
        async (args) => {
            try {
                const ws = args.workspace || sessionConfig.workspace;
                if (!ws) throw new Error("Workspace is required.");
                const listUrl = isCloud() ? `/repositories/${ws}` : `/projects/${ws}/repos`;
                const res = await bitbucketRequest({ method: 'GET', url: listUrl, params: { role: 'member', pagelen: args.pagelen, page: args.page } });
                const repoList = (res.data.values || []).map(r => ({
                    id: r.uuid || r.id,
                    name: r.name,
                    slug: r.slug,
                    links: r.links
                }));
                return { content: [{ type: 'text', text: JSON.stringify(repoList, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool("bitbucket_get_file_content",
        {
            workspace: z.string().optional(),
            repo_slug: z.string(),
            path: z.string(),
            branch: z.string().optional()
        },
        async (args) => {
            try {
                const ws = args.workspace || sessionConfig.workspace;
                if (isCloud()) {
                    const commit = args.branch || 'HEAD';
                    const url = `${getRepoPath(ws, args.repo_slug)}/src/${commit}/${args.path}`;
                    const res = await bitbucketRequest({ method: 'GET', url, responseType: 'text' });
                    return { content: [{ type: 'text', text: res.data }] };
                } else {
                    const rawUrl = `/projects/${ws}/repos/${args.repo_slug}/raw/${args.path}`;
                    const res = await bitbucketRequest({ method: 'GET', url: rawUrl, params: { at: args.branch }, responseType: 'text' });
                    return { content: [{ type: 'text', text: res.data }] };
                }
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool("bitbucket_get_pull_request_diff",
        {
            workspace: z.string().optional(),
            repo_slug: z.string(),
            pull_request_id: z.number()
        },
        async (args) => {
            try {
                const ws = args.workspace || sessionConfig.workspace;
                const url = isCloud() 
                    ? `${getRepoPath(ws, args.repo_slug)}/pullrequests/${args.pull_request_id}/diff`
                    : `${getRepoPath(ws, args.repo_slug)}/pull-requests/${args.pull_request_id}/diff`;
                const res = await bitbucketRequest({ method: 'GET', url, responseType: 'text' });
                return { content: [{ type: 'text', text: res.data }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool("bitbucket_add_pull_request_comment",
        {
            workspace: z.string().optional(),
            repo_slug: z.string(),
            pull_request_id: z.number(),
            text: z.string()
        },
        async (args) => {
            try {
                const ws = args.workspace || sessionConfig.workspace;
                const url = isCloud()
                    ? `${getRepoPath(ws, args.repo_slug)}/pullrequests/${args.pull_request_id}/comments`
                    : `${getRepoPath(ws, args.repo_slug)}/pull-requests/${args.pull_request_id}/comments`;
                const payload = isCloud() ? { content: { raw: args.text } } : { text: args.text };
                const res = await bitbucketRequest({ method: 'POST', url, data: payload });
                return { content: [{ type: 'text', text: `Comment added. ID: ${res.data.id}` }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool("bitbucket_get_pipeline_logs",
        {
            workspace: z.string().optional(),
            repo_slug: z.string(),
            pipeline_uuid: z.string(),
            step_uuid: z.string().optional()
        },
        async (args) => {
            try {
                const ws = args.workspace || sessionConfig.workspace;
                if (!isCloud()) throw new Error("Pipelines only supported on Cloud.");
                
                let url = `${getRepoPath(ws, args.repo_slug)}/pipelines/${args.pipeline_uuid}`;
                if (args.step_uuid) {
                    url += `/steps/${args.step_uuid}/log`;
                } else {
                    const stepsRes = await bitbucketRequest({ method: 'GET', url: `${url}/steps` });
                    return { content: [{ type: 'text', text: JSON.stringify({ steps: stepsRes.data.values || [] }) }] };
                }
                
                const logRes = await bitbucketRequest({ method: 'GET', url, responseType: 'text' });
                return { content: [{ type: 'text', text: logRes.data.substring(0, 5000) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool("bitbucket_list_workspaces",
        {
            pagelen: z.number().default(50),
            page: z.number().default(1)
        },
        async (args) => {
            try {
                if (!isCloud()) throw new Error("Workspace listing only supported on Cloud.");
                const res = await bitbucketRequest({ method: 'GET', url: '/workspaces', params: { pagelen: args.pagelen, page: args.page } });
                return { content: [{ type: 'text', text: JSON.stringify(res.data.values || []) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool("bitbucket_list_deployments",
        {
            workspace: z.string().optional(),
            repo_slug: z.string(),
            pagelen: z.number().default(50)
        },
        async (args) => {
            try {
                const ws = args.workspace || sessionConfig.workspace;
                if (!isCloud()) throw new Error("Deployments only supported on Cloud.");
                const url = `${getRepoPath(ws, args.repo_slug)}/deployments`;
                const res = await bitbucketRequest({ method: 'GET', url, params: { pagelen: args.pagelen } });
                return { content: [{ type: 'text', text: JSON.stringify(res.data.values || []) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.__test = {
        sessionConfig,
        ensureConnected,
        bitbucketRequest,
        getHeaderCandidates,
        getBaseUrlCandidates,
        setConfig: (next) => { sessionConfig = { ...sessionConfig, ...next }; api = null; },
        getConfig: () => ({ ...sessionConfig })
    };

    return server;
}

if (require.main === module) {
    const serverInstance = createBitbucketServer();
    const transport = new StdioServerTransport();
    serverInstance.connect(transport).then(() => {
        console.error('Bitbucket MCP server running on stdio');
    }).catch((error) => {
        console.error("Server error:", error);
        process.exit(1);
    });
}

module.exports = { createBitbucketServer };
