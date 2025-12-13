const axios = require('axios');
const readline = require('readline');

// Config
const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
let GITLAB_BASE_URL = process.env.GITLAB_BASE_URL || 'https://gitlab.com/api/v4';

const PROXY_URL = process.env.FLOCCA_PROXY_URL;
const USER_ID = process.env.FLOCCA_USER_ID;

if (!GITLAB_TOKEN && (!PROXY_URL || !USER_ID)) {
    console.error("Error: GITLAB_TOKEN (or Proxy) is required.");
    process.exit(1);
}

const headers = {};
if (GITLAB_TOKEN) headers['Private-Token'] = GITLAB_TOKEN;

// PROXY MODE
if (PROXY_URL && USER_ID) {
    // PROXY_URL = http://localhost:3000/proxy/gitlab
    // We want all requests (which are relative like /projects) to go to Proxy
    // And Proxy needs to reconstruct full path.
    // If we set baseURL to PROXY_URL + '/api/v4', then axios.get('/projects') calls PROXY + '/api/v4/projects'.
    // Our Mock Backend takes path param.
    // If Backend mimics real GitLab, it should accept /api/v4/projects.
    // So yes:
    GITLAB_BASE_URL = `${PROXY_URL}/api/v4`;
    headers['X-Flocca-User-ID'] = USER_ID;
    delete headers['Private-Token'];
}

const api = axios.create({
    baseURL: GITLAB_BASE_URL,
    headers: headers
});

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
        switch (name) {
            case 'gitlab.health':
                const user = await api.get('/user');
                return {
                    content: [{ type: 'text', text: JSON.stringify({ ok: true, user: user.data.username }) }]
                };

            case 'gitlab.listProjects':
                const params = { simple: true, membership: args.membership_only };
                if (args.search) params.search = args.search;
                const projects = await api.get('/projects', { params });
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            projects: projects.data.map(p => ({
                                id: p.id,
                                name: p.name,
                                path_with_namespace: p.path_with_namespace,
                                web_url: p.web_url
                            }))
                        }, null, 2)
                    }]
                };

            case 'gitlab.getRepositoryTree':
                const treeParams = {
                    ref: args.ref,
                    path: args.path || '',
                    recursive: args.recursive || false
                };
                const tree = await api.get(`/projects/${args.project_id}/repository/tree`, { params: treeParams });
                return {
                    content: [{ type: 'text', text: JSON.stringify(tree.data, null, 2) }]
                };

            case 'gitlab.getFile':
                // file_path must be URL encoded
                const encodedPath = encodeURIComponent(args.file_path);
                const file = await api.get(`/projects/${args.project_id}/repository/files/${encodedPath}`, {
                    params: { ref: args.ref }
                });
                const content = Buffer.from(file.data.content, 'base64').toString('utf-8');
                return {
                    content: [{ type: 'text', text: content }]
                };

            case 'gitlab.createBranch':
                const branch = await api.post(`/projects/${args.project_id}/repository/branches`, null, {
                    params: { branch: args.branch_name, ref: args.ref }
                });
                return {
                    content: [{ type: 'text', text: `Branch created: ${branch.data.name}` }]
                };

            case 'gitlab.createMergeRequest':
                const mr = await api.post(`/projects/${args.project_id}/merge_requests`, {
                    source_branch: args.source_branch,
                    target_branch: args.target_branch,
                    title: args.title,
                    description: args.description
                });
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            id: mr.data.id,
                            iid: mr.data.iid,
                            web_url: mr.data.web_url
                        }, null, 2)
                    }]
                };

            case 'gitlab.listMergeRequests':
                const mrParams = { state: args.state || 'opened', scope: 'all' };
                if (args.author_id) mrParams.author_id = args.author_id;
                const mrs = await api.get(`/projects/${args.project_id}/merge_requests`, { params: mrParams });
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(mrs.data.map(m => ({
                            iid: m.iid,
                            title: m.title,
                            web_url: m.web_url,
                            state: m.state,
                            author: m.author.username
                        })), null, 2)
                    }]
                };

            case 'gitlab.triggerPipeline':
                const pipeline = await api.post(`/projects/${args.project_id}/pipeline`, null, {
                    params: { ref: args.ref }
                });
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            id: pipeline.data.id,
                            status: pipeline.data.status,
                            web_url: pipeline.data.web_url
                        }, null, 2)
                    }]
                };

            case 'gitlab.getPipelineStatus':
                const pStatus = await api.get(`/projects/${args.project_id}/pipelines/${args.pipeline_id}`);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            id: pStatus.data.id,
                            status: pStatus.data.status,
                            web_url: pStatus.data.web_url
                        }, null, 2)
                    }]
                };

            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error) {
        const msg = error.response ? `${error.response.status} - ${JSON.stringify(error.response.data)}` : error.message;
        return {
            isError: true,
            content: [{ type: 'text', text: `GitLab API Error: ${msg}` }]
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
                serverInfo: { name: "gitlab-mcp", version: "1.0.0" }
            }
        });
    } else if (request.method === 'tools/list') {
        send({
            jsonrpc: "2.0",
            id: request.id,
            result: {
                tools: [
                    {
                        name: "gitlab.health",
                        description: "Check connection health",
                        inputSchema: { type: "object", properties: {} }
                    },
                    {
                        name: "gitlab.listProjects",
                        description: "List accessible projects",
                        inputSchema: {
                            type: "object",
                            properties: {
                                search: { type: "string" },
                                membership_only: { type: "boolean" }
                            }
                        }
                    },
                    {
                        name: "gitlab.getRepositoryTree",
                        description: "List files/directories",
                        inputSchema: {
                            type: "object",
                            properties: {
                                project_id: { type: "integer" },
                                ref: { type: "string" },
                                path: { type: "string" }
                            },
                            required: ["project_id", "ref"]
                        }
                    },
                    {
                        name: "gitlab.getFile",
                        description: "Get raw file content",
                        inputSchema: {
                            type: "object",
                            properties: {
                                project_id: { type: "integer" },
                                ref: { type: "string" },
                                file_path: { type: "string" }
                            },
                            required: ["project_id", "ref", "file_path"]
                        }
                    },
                    {
                        name: "gitlab.createBranch",
                        description: "Create a new branch",
                        inputSchema: {
                            type: "object",
                            properties: {
                                project_id: { type: "integer" },
                                branch_name: { type: "string" },
                                ref: { type: "string" }
                            },
                            required: ["project_id", "branch_name", "ref"]
                        }
                    },
                    {
                        name: "gitlab.createMergeRequest",
                        description: "Create a Merge Request",
                        inputSchema: {
                            type: "object",
                            properties: {
                                project_id: { type: "integer" },
                                source_branch: { type: "string" },
                                target_branch: { type: "string" },
                                title: { type: "string" },
                                description: { type: "string" }
                            },
                            required: ["project_id", "source_branch", "target_branch", "title"]
                        }
                    },
                    {
                        name: "gitlab.listMergeRequests",
                        description: "List Merge Requests",
                        inputSchema: {
                            type: "object",
                            properties: {
                                project_id: { type: "integer" },
                                state: { type: "string", enum: ["opened", "closed", "merged", "all"] },
                                author_id: { type: "integer" }
                            },
                            required: ["project_id"]
                        }
                    },
                    {
                        name: "gitlab.triggerPipeline",
                        description: "Trigger a CI pipeline",
                        inputSchema: {
                            type: "object",
                            properties: {
                                project_id: { type: "integer" },
                                ref: { type: "string" }
                            },
                            required: ["project_id", "ref"]
                        }
                    },
                    {
                        name: "gitlab.getPipelineStatus",
                        description: "Get status of a pipeline",
                        inputSchema: {
                            type: "object",
                            properties: {
                                project_id: { type: "integer" },
                                pipeline_id: { type: "integer" }
                            },
                            required: ["project_id", "pipeline_id"]
                        }
                    }
                ]
            }
        });
    } else if (request.method === 'tools/call') {
        const result = await handleToolCall(request.params.name, request.params.arguments);
        send({
            jsonrpc: "2.0",
            id: request.id,
            result: result
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
