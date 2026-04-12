const axios = require('axios');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

// Configuration State
let config = {
    serviceUrl: process.env.BITBUCKET_SERVICE_URL || 'https://api.bitbucket.org/2.0',
    username: process.env.BITBUCKET_USERNAME,
    password: process.env.BITBUCKET_PASSWORD, // App Password or PAT
    workspace: process.env.BITBUCKET_WORKSPACE // Optional default
};

function normalizeServiceUrl(url) {
    if (!url) return 'https://api.bitbucket.org/2.0';
    const trimmed = url.replace(/\/+$/, '');
    if (trimmed.includes('api.bitbucket.org/2.0')) return trimmed;
    if (trimmed.includes('bitbucket.org')) return 'https://api.bitbucket.org/2.0';
    if (/\/rest\/api\/\d+\.\d+$/i.test(trimmed)) return trimmed;
    return `${trimmed}/rest/api/1.0`;
}

config.serviceUrl = normalizeServiceUrl(config.serviceUrl);

// Helper: Get Axios Instance
function getApi() {
    const proxyUrl = process.env.FLOCCA_PROXY_URL;
    const userId = process.env.FLOCCA_USER_ID;

    if ((!config.username || !config.password) && !(proxyUrl && userId)) {
        throw new Error("Bitbucket credentials not configured. Use bitbucket_configure or set BITBUCKET_USERNAME/PASSWORD.");
    }

    if (proxyUrl && userId) {
        return axios.create({
            baseURL: proxyUrl, 
            headers: {
                'X-Flocca-User-ID': userId,
                'Content-Type': 'application/json'
            }
        });
    }

    const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
    return axios.create({
        baseURL: config.serviceUrl,
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json'
        }
    });
}

function isCloud() {
    return config.serviceUrl.includes('api.bitbucket.org');
}

function getRepoPath(workspace, repo) {
    return isCloud() ? `/repositories/${workspace}/${repo}` : `/projects/${workspace}/repos/${repo}`;
}

function normalizeError(err) {
    const msg = err.message || JSON.stringify(err);
    const details = err.response ? { status: err.response.status, data: err.response.data } : undefined;
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: msg, details }) }] };
}

function createBitbucketServer() {
    const server = new McpServer({
        name: "bitbucket-mcp",
        version: "1.1.0"
    });

    // --- Core Tools ---

    server.tool("bitbucket_health", {}, async () => {
        try {
            await getApi().get(isCloud() ? '/user' : '/users/' + config.username);
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
        } catch (e) {
            return normalizeError(e);
        }
    });

    server.tool("bitbucket_configure",
        {
            service_url: z.string().optional(),
            username: z.string().optional(),
            password: z.string().optional(),
            workspace: z.string().optional()
        },
        async (args) => {
            if (args.service_url) config.serviceUrl = normalizeServiceUrl(args.service_url);
            if (args.username) config.username = args.username;
            if (args.password) config.password = args.password;
            if (args.workspace) config.workspace = args.workspace;

            try {
                await getApi().get(isCloud() ? '/user' : '/users/' + config.username);
                return { content: [{ type: 'text', text: "Configuration updated and verified." }] };
            } catch (e) {
                return normalizeError(e);
            }
        }
    );

    // --- Git Tools ---

    server.tool("bitbucket_list_repositories",
        {
            workspace: z.string().optional(),
            pagelen: z.number().default(50),
            page: z.number().default(1)
        },
        async (args) => {
            try {
                const api = getApi();
                const ws = args.workspace || config.workspace;
                if (!ws) throw new Error("Workspace is required.");
                const listUrl = isCloud() ? `/repositories/${ws}` : `/projects/${ws}/repos`;
                const repos = await api.get(listUrl, { params: { role: 'member', pagelen: args.pagelen, page: args.page } });
                const repoList = (repos.data.values || []).map(r => ({
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
                const api = getApi();
                const ws = args.workspace || config.workspace;
                if (isCloud()) {
                    const commit = args.branch || 'HEAD';
                    const url = `${getRepoPath(ws, args.repo_slug)}/src/${commit}/${args.path}`;
                    const fileRes = await api.get(url, { responseType: 'text' });
                    return { content: [{ type: 'text', text: fileRes.data }] };
                } else {
                    const rawUrl = `/projects/${ws}/repos/${args.repo_slug}/raw/${args.path}`;
                    const fileRes = await api.get(rawUrl, { params: { at: args.branch }, responseType: 'text' });
                    return { content: [{ type: 'text', text: fileRes.data }] };
                }
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- Pull Requests (SDET/Dev) ---

    server.tool("bitbucket_get_pull_request_diff",
        {
            workspace: z.string().optional(),
            repo_slug: z.string(),
            pull_request_id: z.number()
        },
        async (args) => {
            try {
                const api = getApi();
                const ws = args.workspace || config.workspace;
                const url = isCloud() 
                    ? `${getRepoPath(ws, args.repo_slug)}/pullrequests/${args.pull_request_id}/diff`
                    : `${getRepoPath(ws, args.repo_slug)}/pull-requests/${args.pull_request_id}/diff`;
                const diffRes = await api.get(url, { responseType: 'text' });
                return { content: [{ type: 'text', text: diffRes.data }] };
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
                const api = getApi();
                const ws = args.workspace || config.workspace;
                const url = isCloud()
                    ? `${getRepoPath(ws, args.repo_slug)}/pullrequests/${args.pull_request_id}/comments`
                    : `${getRepoPath(ws, args.repo_slug)}/pull-requests/${args.pull_request_id}/comments`;
                const payload = isCloud() ? { content: { raw: args.text } } : { text: args.text };
                const res = await api.post(url, payload);
                return { content: [{ type: 'text', text: `Comment added. ID: ${res.data.id}` }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- Pipelines (DevOps) ---

    server.tool("bitbucket_get_pipeline_logs",
        {
            workspace: z.string().optional(),
            repo_slug: z.string(),
            pipeline_uuid: z.string(),
            step_uuid: z.string().optional()
        },
        async (args) => {
            try {
                const api = getApi();
                const ws = args.workspace || config.workspace;
                if (!isCloud()) throw new Error("Pipelines only supported on Cloud.");
                
                let url = `${getRepoPath(ws, args.repo_slug)}/pipelines/${args.pipeline_uuid}`;
                if (args.step_uuid) {
                    url += `/steps/${args.step_uuid}/log`;
                } else {
                    // If no step, list steps to help agent find the right one
                    const stepsRes = await api.get(`${url}/steps`);
                    return { content: [{ type: 'text', text: JSON.stringify({ steps: stepsRes.data.values || [] }) }] };
                }
                
                const logRes = await api.get(url, { responseType: 'text' });
                return { content: [{ type: 'text', text: logRes.data.substring(0, 5000) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- Discovery (DevOps/Admin) ---

    server.tool("bitbucket_list_workspaces",
        {
            pagelen: z.number().default(50),
            page: z.number().default(1)
        },
        async (args) => {
            try {
                const api = getApi();
                if (!isCloud()) throw new Error("Workspace listing only supported on Cloud.");
                const res = await api.get('/workspaces', { params: { pagelen: args.pagelen, page: args.page } });
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
                const api = getApi();
                const ws = args.workspace || config.workspace;
                if (!isCloud()) throw new Error("Deployments only supported on Cloud.");
                const url = `${getRepoPath(ws, args.repo_slug)}/deployments`;
                const res = await api.get(url, { params: { pagelen: args.pagelen } });
                return { content: [{ type: 'text', text: JSON.stringify(res.data.values || []) }] };
            } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
        }
    );

    return server;
}

if (require.main === module) {
    const server = createBitbucketServer();
    const transport = new StdioServerTransport();
    server.connect(transport).then(() => {
        console.error('Bitbucket MCP server running on stdio');
    }).catch((error) => {
        console.error("Server error:", error);
        process.exit(1);
    });
}

module.exports = { createBitbucketServer, config };
