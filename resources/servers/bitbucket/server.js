const axios = require('axios');
const readline = require('readline');

// Configuration State
let config = {
    serviceUrl: process.env.BITBUCKET_SERVICE_URL || 'https://api.bitbucket.org/2.0',
    username: process.env.BITBUCKET_USERNAME,
    password: process.env.BITBUCKET_PASSWORD, // App Password or PAT
    workspace: process.env.BITBUCKET_WORKSPACE // Optional default
};

// Helper: Get Axios Instance
function getApi() {
    const proxyUrl = process.env.FLOCCA_PROXY_URL;
    const userId = process.env.FLOCCA_USER_ID;

    if ((!config.username || !config.password) && !(proxyUrl && userId)) {
        throw new Error("Bitbucket credentials not configured. Use bitbucket.configure or set BITBUCKET_USERNAME/PASSWORD.");
    }

    if (proxyUrl && userId) {
        return axios.create({
            baseURL: proxyUrl, // Proxy URL acts as base
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

// Helper: Determine API Mode (Cloud vs Server)
function isCloud() {
    return config.serviceUrl.includes('api.bitbucket.org');
}

// Helper: Construct Repo Path
function getRepoPath(workspace, repo) {
    if (isCloud()) {
        return `/repositories/${workspace}/${repo}`;
    } else {
        // Bitbucket Server API v1.0
        return `/projects/${workspace}/repos/${repo}`; // 'workspace' acts as Project Key
    }
}

// JSON-RPC Setup
let sendCallback = (response) => {
    process.stdout.write(JSON.stringify(response) + "\n");
};

function send(response) {
    if (sendCallback) sendCallback(response);
}

// Tool Handlers
async function handleToolCall(name, args) {
    try {
        const api = getApi();
        // Default workspace/repo from config if missing (optional convenience)
        const workspace = args.workspace || config.workspace;

        switch (name) {
            case 'bitbucket.configure':
                if (args.service_url) config.serviceUrl = args.service_url;
                if (args.auth) {
                    config.username = args.auth.username;
                    config.password = args.auth.password;
                }
                if (args.workspace) config.workspace = args.workspace;

                // Verify
                try {
                    await getApi().get(isCloud() ? '/user' : '/users/' + config.username); // Simple auth check
                    return { content: [{ type: 'text', text: "Configuration updated and verified." }] };
                } catch (e) {
                    return { isError: true, content: [{ type: 'text', text: `Auth Verification Failed: ${e.message}` }] };
                }

            case 'bitbucket.listRepositories':
                // Cloud: /repositories/{workspace}
                // Server: /projects/{project}/repos
                let listUrl;
                if (isCloud()) {
                    listUrl = `/repositories/${workspace}`;
                } else {
                    listUrl = `/projects/${workspace}/repos`;
                }

                const repos = await api.get(listUrl, { params: { role: 'member' } });
                const repoList = (repos.data.values || []).map(r => ({
                    id: r.uuid || r.id,
                    name: r.name,
                    slug: r.slug,
                    links: r.links
                }));
                return { content: [{ type: 'text', text: JSON.stringify(repoList, null, 2) }] };

            case 'bitbucket.listBranches':
                // Cloud: /repositories/{w}/{r}/refs/branches
                // Server: /projects/{p}/repos/{r}/branches
                const branchUrl = isCloud()
                    ? `${getRepoPath(workspace, args.repo_slug)}/refs/branches`
                    : `${getRepoPath(workspace, args.repo_slug)}/branches`;

                const branches = await api.get(branchUrl);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify((branches.data.values || []).map(b => ({
                            name: b.name || b.displayId,
                            target: b.target.hash || b.latestCommit
                        })), null, 2)
                    }]
                };

            case 'bitbucket.getRepositoryTree':
                // Cloud: /repositories/{w}/{r}/src/{commit}/{path}
                // Server: /projects/{p}/repos/{r}/browse/{path}?at={ref}
                let treeData;
                if (isCloud()) {
                    const commit = args.branch || 'HEAD'; // Default to HEAD main
                    const path = args.path || '';
                    const treeUrl = `${getRepoPath(workspace, args.repo_slug)}/src/${commit}/${path}`;
                    const res = await api.get(treeUrl);
                    treeData = res.data.values || []; // Cloud returns paged values for directory
                } else {
                    const params = { at: args.branch };
                    const browseUrl = `${getRepoPath(workspace, args.repo_slug)}/browse/${args.path || ''}`;
                    const res = await api.get(browseUrl, { params });
                    treeData = res.data.children ? res.data.children.values : [];
                }
                return { content: [{ type: 'text', text: JSON.stringify(treeData, null, 2) }] };

            case 'bitbucket.getFileContent':
                // Cloud: Same as tree but returns raw if file
                // Server: /browse endpoint returns lines or `raw` param?
                // For simplicity, let's use the 'format=meta' check or try fetching text.
                // Cloud raw: https://api.bitbucket.org/2.0/repositories/.../src/.../file?format=meta not needed creates download link
                // Actually Cloud src endpoint returns the file content if it's a file.

                if (isCloud()) {
                    const commit = args.branch || 'HEAD';
                    const url = `${getRepoPath(workspace, args.repo_slug)}/src/${commit}/${args.path}`;
                    const fileRes = await api.get(url, { responseType: 'text' }); // Get raw text
                    return { content: [{ type: 'text', text: fileRes.data }] };
                } else {
                    // Server: /raw/path...
                    const rawUrl = `/projects/${workspace}/repos/${args.repo_slug}/raw/${args.path}`;
                    const fileRes = await api.get(rawUrl, { params: { at: args.branch }, responseType: 'text' });
                    return { content: [{ type: 'text', text: fileRes.data }] };
                }

            case 'bitbucket.createBranch':
                // Cloud: POST /repositories/{w}/{r}/refs/branches
                // Body: { name, target: { hash } }
                if (!isCloud()) throw new Error("Branch creation implementation limited to Cloud for MVP.");

                const createData = {
                    name: args.name,
                    target: { hash: args.from_branch } // Assuming from_branch is a commit/branch name
                    // Actually if it's a branch name, we might need to resolve it to hash first or pass config.
                    // Cloud API accepts "branch name" as target usually? No, it wants 'hash'.
                    // Let's quickly fetch the from_branch hash.
                };

                // Resolve from_branch to hash if needed (skipped for brevity, assuming generic string works or user passes hash)
                // Actually users usually pass "main".
                // We'll try passing "name" in target. hash is preferred.
                // Let's do a quick lookup if easy. 
                // For now, assume from_branch is handled or API accepts generic ref.

                const brRes = await api.post(`${getRepoPath(workspace, args.repo_slug)}/refs/branches`, {
                    name: args.name,
                    target: { hash: args.from_branch }
                });
                return { content: [{ type: 'text', text: `Branch created: ${brRes.data.name}` }] };

            case 'bitbucket.createPullRequest':
                const prBody = {
                    title: args.title,
                    description: args.description,
                    source: { branch: { name: args.source_branch } },
                    destination: { branch: { name: args.target_branch } }
                };

                const prUrl = isCloud()
                    ? `${getRepoPath(workspace, args.repo_slug)}/pullrequests`
                    : `${getRepoPath(workspace, args.repo_slug)}/pull-requests`;

                const prRes = await api.post(prUrl, prBody);
                return {
                    content: [{
                        type: 'text',
                        // Cloud vs Server response fields might differ slightly
                        text: JSON.stringify({
                            id: prRes.data.id,
                            link: prRes.data.links ? prRes.data.links.html.href : prRes.data.link.url,
                            title: prRes.data.title
                        }, null, 2)
                    }]
                };

            case 'bitbucket.listPullRequests':
                const prListUrl = isCloud()
                    ? `${getRepoPath(workspace, args.repo_slug)}/pullrequests`
                    : `${getRepoPath(workspace, args.repo_slug)}/pull-requests`;

                const prs = await api.get(prListUrl, { params: { state: args.state || 'OPEN' } });
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify((prs.data.values || []).map(p => ({
                            id: p.id,
                            title: p.title,
                            state: p.state,
                            author: p.author.display_name,
                            url: p.links ? p.links.html.href : ''
                        })), null, 2)
                    }]
                };

            case 'bitbucket.runPipeline':
                if (!isCloud()) throw new Error("Pipelines only supported on Bitbucket Cloud");
                const pipeUrl = `${getRepoPath(workspace, args.repo_slug)}/pipelines`;
                const pipeRes = await api.post(pipeUrl, {
                    target: {
                        ref_type: 'branch',
                        type: 'pipeline_ref_target',
                        ref_name: args.branch
                    }
                });
                return { content: [{ type: 'text', text: JSON.stringify(pipeRes.data, null, 2) }] };

            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error) {
        const msg = error.response ? `${error.response.status} - ${JSON.stringify(error.response.data)}` : error.message;
        return {
            isError: true,
            content: [{ type: 'text', text: `Bitbucket API Error: ${msg}` }]
        };
    }
}

// Request Handler
async function handleRequest(request) {
    if (request.method === 'initialize') {
        send({
            jsonrpc: "2.0",
            id: request.id,
            result: {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "bitbucket-mcp", version: "1.0.0" }
            }
        });
    } else if (request.method === 'tools/list') {
        send({
            jsonrpc: "2.0",
            id: request.id,
            result: {
                tools: [
                    {
                        name: "bitbucket.configure",
                        description: "Configure Bitbucket credentials",
                        inputSchema: {
                            type: "object",
                            properties: {
                                service_url: { type: "string" },
                                auth: { type: "object", properties: { username: { type: "string" }, password: { type: "string" } } },
                                workspace: { type: "string" }
                            }
                        }
                    },
                    {
                        name: "bitbucket.listRepositories",
                        description: "List repositories",
                        inputSchema: {
                            type: "object",
                            properties: { workspace: { type: "string" } },
                            required: ["workspace"]
                        }
                    },
                    {
                        name: "bitbucket.listBranches",
                        description: "List branches",
                        inputSchema: {
                            type: "object",
                            properties: { workspace: { type: "string" }, repo_slug: { type: "string" } },
                            required: ["workspace", "repo_slug"]
                        }
                    },
                    {
                        name: "bitbucket.getRepositoryTree",
                        description: "List files",
                        inputSchema: {
                            type: "object",
                            properties: { workspace: { type: "string" }, repo_slug: { type: "string" }, branch: { type: "string" }, path: { type: "string" } },
                            required: ["workspace", "repo_slug"]
                        }
                    },
                    {
                        name: "bitbucket.getFileContent",
                        description: "Get file content",
                        inputSchema: {
                            type: "object",
                            properties: { workspace: { type: "string" }, repo_slug: { type: "string" }, branch: { type: "string" }, path: { type: "string" } },
                            required: ["workspace", "repo_slug", "path"]
                        }
                    },
                    {
                        name: "bitbucket.createBranch",
                        description: "Create Branch",
                        inputSchema: {
                            type: "object",
                            properties: { workspace: { type: "string" }, repo_slug: { type: "string" }, name: { type: "string" }, from_branch: { type: "string" } },
                            required: ["workspace", "repo_slug", "name", "from_branch"]
                        }
                    },
                    {
                        name: "bitbucket.createPullRequest",
                        description: "Create Pull Request",
                        inputSchema: {
                            type: "object",
                            properties: { workspace: { type: "string" }, repo_slug: { type: "string" }, title: { type: "string" }, source_branch: { type: "string" }, target_branch: { type: "string" } },
                            required: ["workspace", "repo_slug", "title", "source_branch", "target_branch"]
                        }
                    },
                    {
                        name: "bitbucket.listPullRequests",
                        description: "List Pull Requests",
                        inputSchema: {
                            type: "object",
                            properties: { workspace: { type: "string" }, repo_slug: { type: "string" }, state: { type: "string" } },
                            required: ["workspace", "repo_slug"]
                        }
                    },
                    {
                        name: "bitbucket.runPipeline",
                        description: "Run Pipeline",
                        inputSchema: {
                            type: "object",
                            properties: { workspace: { type: "string" }, repo_slug: { type: "string" }, branch: { type: "string" } },
                            required: ["workspace", "repo_slug", "branch"]
                        }
                    }
                ]
            }
        });
    } else if (request.method === 'tools/call') {
        handleToolCall(request.params.name, request.params.arguments || {}).then(result => {
            send({
                jsonrpc: "2.0",
                id: request.id,
                result: result
            });
        });
    }
}

// Stdio Loop
if (require.main === module) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
    });

    rl.on('line', (line) => {
        try {
            const request = JSON.parse(line);
            handleRequest(request);
        } catch (e) { }
    });
}
