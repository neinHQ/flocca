const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const axios = require('axios');

const SERVER_INFO = { name: 'gitlab-mcp', version: '2.0.0' };

let config = {
    token: process.env.GITLAB_TOKEN,
    baseUrl: process.env.GITLAB_BASE_URL || 'https://gitlab.com/api/v4',
    proxyUrl: process.env.FLOCCA_PROXY_URL,
    userId: process.env.FLOCCA_USER_ID
};

function normalizeGitLabBaseUrl(url) {
    if (!url) return 'https://gitlab.com/api/v4';
    const trimmed = url.replace(/\/+$/, '');
    if (/\/api\/v4$/i.test(trimmed)) return trimmed;
    return `${trimmed}/api/v4`;
}

function normalizeError(err) {
    const msg = err.response ? `${err.response.status} - ${JSON.stringify(err.response.data)}` : (err.message || JSON.stringify(err));
    return { isError: true, content: [{ type: 'text', text: `GitLab Error: ${msg}` }] };
}

function createGitLabServer() {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });
    let api = null;

    async function ensureConnected() {
        if (!config.token && !(config.proxyUrl && config.userId)) {
            // Re-check env vars
            config.token = process.env.GITLAB_TOKEN;
            config.baseUrl = process.env.GITLAB_BASE_URL || config.baseUrl;
            config.proxyUrl = process.env.FLOCCA_PROXY_URL;
            config.userId = process.env.FLOCCA_USER_ID;

            if (!config.token && !(config.proxyUrl && config.userId)) {
                throw new Error("GitLab Not Configured. Provide GITLAB_TOKEN or FLOCCA_PROXY_URL.");
            }
        }

        if (!api) {
            let finalBaseUrl = normalizeGitLabBaseUrl(config.baseUrl);
            const headers = {};

            if (config.proxyUrl && config.userId) {
                finalBaseUrl = `${config.proxyUrl.replace(/\/+$/, '')}/api/v4`;
                headers['X-Flocca-User-ID'] = config.userId;
            } else {
                headers['Private-Token'] = config.token;
            }

            api = axios.create({
                baseURL: finalBaseUrl,
                headers: headers
            });
        }
        return api;
    }

    server.tool('gitlab_health', {}, async () => {
        try {
            const client = await ensureConnected();
            const res = await client.get('/user');
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, user: res.data.username, mode: config.proxyUrl ? 'proxy' : 'direct' }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('gitlab_configure',
        {
            token: z.string().describe('GitLab Personal Access Token'),
            base_url: z.string().optional().describe('GitLab Base URL (e.g. https://gitlab.com)'),
        },
        async (args) => {
            try {
                config.token = args.token;
                if (args.base_url) config.baseUrl = args.base_url;
                api = null; // force re-init
                const client = await ensureConnected();
                await client.get('/user');
                return { content: [{ type: 'text', text: "GitLab configuration updated and verified." }] };
            } catch (e) {
                config.token = undefined;
                api = null;
                return normalizeError(e);
            }
        }
    );

    server.tool('gitlab_list_projects',
        {
            search: z.string().optional().describe('Limit by search term'),
            membership_only: z.boolean().optional().default(true).describe('Limit by projects that the current user is a member of')
        },
        async (args) => {
            try {
                const client = await ensureConnected();
                const params = { simple: true, membership: args.membership_only };
                if (args.search) params.search = args.search;
                const res = await client.get('/projects', { params });
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(res.data.map(p => ({
                            id: p.id,
                            name: p.name,
                            path_with_namespace: p.path_with_namespace,
                            web_url: p.web_url
                        })), null, 2)
                    }]
                };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('gitlab_get_repository_tree',
        {
            project_id: z.union([z.string(), z.number()]).describe('Project ID or path'),
            ref: z.string().describe('Branch, tag, or commit SHA'),
            path: z.string().optional().default('').describe('Path in repository'),
            recursive: z.boolean().optional().default(false).describe('Get recursive tree')
        },
        async (args) => {
            try {
                const client = await ensureConnected();
                const treeParams = { ref: args.ref, path: args.path, recursive: args.recursive };
                const res = await client.get(`/projects/${encodeURIComponent(args.project_id)}/repository/tree`, { params: treeParams });
                return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('gitlab_get_file',
        {
            project_id: z.union([z.string(), z.number()]).describe('Project ID or path'),
            ref: z.string().describe('Branch, tag, or commit SHA'),
            file_path: z.string().describe('Full path to file')
        },
        async (args) => {
            try {
                const client = await ensureConnected();
                const encodedPath = encodeURIComponent(args.file_path);
                const res = await client.get(`/projects/${encodeURIComponent(args.project_id)}/repository/files/${encodedPath}`, {
                    params: { ref: args.ref }
                });
                const content = Buffer.from(res.data.content, 'base64').toString('utf-8');
                return { content: [{ type: 'text', text: content }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('gitlab_create_branch',
        {
            project_id: z.union([z.string(), z.number()]).describe('Project ID or path'),
            branch_name: z.string().describe('Name of new branch'),
            ref: z.string().describe('Source branch/sha'),
            confirm: z.boolean().describe('Safety gate')
        },
        async (args) => {
            try {
                if (!args.confirm) return { isError: true, content: [{ type: 'text', text: `CONFIRMATION_REQUIRED: Create branch "${args.branch_name}" from "${args.ref}"? Set confirm: true to proceed.` }] };
                const client = await ensureConnected();
                const res = await client.post(`/projects/${encodeURIComponent(args.project_id)}/repository/branches`, null, {
                    params: { branch: args.branch_name, ref: args.ref }
                });
                return { content: [{ type: 'text', text: `Branch created: ${res.data.name}` }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('gitlab_create_merge_request',
        {
            project_id: z.union([z.string(), z.number()]).describe('Project ID or path'),
            source_branch: z.string().describe('Source branch'),
            target_branch: z.string().describe('Target branch'),
            title: z.string().describe('MR title'),
            description: z.string().optional().describe('MR description'),
            confirm: z.boolean().describe('Safety gate')
        },
        async (args) => {
            try {
                if (!args.confirm) return { isError: true, content: [{ type: 'text', text: `CONFIRMATION_REQUIRED: Create Merge Request "${args.title}" from "${args.source_branch}" to "${args.target_branch}"? Set confirm: true to proceed.` }] };
                const client = await ensureConnected();
                const res = await client.post(`/projects/${encodeURIComponent(args.project_id)}/merge_requests`, {
                    source_branch: args.source_branch,
                    target_branch: args.target_branch,
                    title: args.title,
                    description: args.description
                });
                return { content: [{ type: 'text', text: JSON.stringify({ id: res.data.id, iid: res.data.iid, web_url: res.data.web_url }, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('gitlab_list_merge_requests',
        {
            project_id: z.union([z.string(), z.number()]).describe('Project ID or path'),
            state: z.enum(['opened', 'closed', 'merged', 'all']).optional().default('opened'),
            author_id: z.number().optional().describe('Filter by author ID')
        },
        async (args) => {
            try {
                const client = await ensureConnected();
                const params = { state: args.state, scope: 'all' };
                if (args.author_id) params.author_id = args.author_id;
                const res = await client.get(`/projects/${encodeURIComponent(args.project_id)}/merge_requests`, { params });
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(res.data.map(m => ({
                            iid: m.iid,
                            title: m.title,
                            web_url: m.web_url,
                            state: m.state,
                            author: m.author.username
                        })), null, 2)
                    }]
                };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('gitlab_trigger_pipeline',
        {
            project_id: z.union([z.string(), z.number()]).describe('Project ID or path'),
            ref: z.string().describe('Ref to trigger pipeline for'),
            confirm: z.boolean().describe('Safety gate')
        },
        async (args) => {
            try {
                if (!args.confirm) return { isError: true, content: [{ type: 'text', text: `CONFIRMATION_REQUIRED: Trigger pipeline on ref "${args.ref}" for project ${args.project_id}? Set confirm: true to proceed.` }] };
                const client = await ensureConnected();
                const res = await client.post(`/projects/${encodeURIComponent(args.project_id)}/pipeline`, null, {
                    params: { ref: args.ref }
                });
                return { content: [{ type: 'text', text: JSON.stringify({ id: res.data.id, status: res.data.status, web_url: res.data.web_url }, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('gitlab_get_pipeline_status',
        {
            project_id: z.union([z.string(), z.number()]).describe('Project ID or path'),
            pipeline_id: z.number().describe('Pipeline ID')
        },
        async (args) => {
            try {
                const client = await ensureConnected();
                const res = await client.get(`/projects/${encodeURIComponent(args.project_id)}/pipelines/${args.pipeline_id}`);
                return { content: [{ type: 'text', text: JSON.stringify({ id: res.data.id, status: res.data.status, web_url: res.data.web_url }, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    return server;
}

if (require.main === module) {
    const server = createGitLabServer();
    const transport = new StdioServerTransport();
    server.connect(transport).then(() => {
        console.error('GitLab MCP server running on stdio');
    }).catch((error) => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createGitLabServer };
