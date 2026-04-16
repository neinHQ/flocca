const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { Octokit } = require("@octokit/rest");

const SERVER_INFO = { name: 'github-actions-mcp', version: '2.0.0' };

function createGitHubActionsServer() {
    let sessionConfig = {
        token: process.env.GITHUB_TOKEN,
        owner: process.env.GITHUB_OWNER,
        repo: process.env.GITHUB_REPO,
        apiUrl: process.env.GITHUB_API_URL
    };

    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });
    let kit = null;

    async function ensureConnected() {
        if (!sessionConfig.token) {
            // Re-check env vars
            sessionConfig.token = process.env.GITHUB_TOKEN || sessionConfig.token;
            sessionConfig.owner = process.env.GITHUB_OWNER || sessionConfig.owner;
            sessionConfig.repo = process.env.GITHUB_REPO || sessionConfig.repo;
            sessionConfig.apiUrl = process.env.GITHUB_API_URL || sessionConfig.apiUrl;
            
            if (!sessionConfig.token) {
                throw new Error("GitHub Actions not configured. Provide GITHUB_TOKEN or call github_actions_configure.");
            }
        }
        if (!kit) {
            kit = new Octokit({
                auth: sessionConfig.token,
                baseUrl: normalizeGitHubApiUrl(sessionConfig.apiUrl)
            });
        }
        return kit;
    }

    server.tool('github_actions_health', {}, async () => {
        try {
            const k = await ensureConnected();
            if (!sessionConfig.owner || !sessionConfig.repo) throw new Error("Owner and Repo must be configured for health check.");
            await k.repos.get({ owner: sessionConfig.owner, repo: sessionConfig.repo });
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, owner: sessionConfig.owner, repo: sessionConfig.repo }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('github_actions_configure',
        {
            token: z.string().describe('GitHub PAT'),
            owner: z.string().describe('Repository owner'),
            repo: z.string().describe('Repository name'),
            api_url: z.string().optional().describe('GitHub API URL (for GHES)')
        },
        async (args) => {
            try {
                sessionConfig.token = args.token;
                sessionConfig.owner = args.owner;
                sessionConfig.repo = args.repo;
                sessionConfig.apiUrl = args.api_url;
                kit = null; // force re-init
                const k = await ensureConnected();
                await k.repos.get({ owner: sessionConfig.owner, repo: sessionConfig.repo });
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, status: 'authenticated' }) }] };
            } catch (e) {
                sessionConfig.token = undefined;
                kit = null;
                return normalizeError(e);
            }
        }
    );

    server.tool('github_actions_list_workflows', {}, async () => {
        try {
            const k = await ensureConnected();
            const res = await k.actions.listRepoWorkflows({ owner: sessionConfig.owner, repo: sessionConfig.repo });
            return { content: [{ type: 'text', text: JSON.stringify(res.data.workflows, null, 2) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('github_actions_list_runs',
        { workflow_id: z.string().optional().describe('Filter by workflow ID (optional)') },
        async (args) => {
            try {
                const k = await ensureConnected();
                let res;
                if (args.workflow_id) {
                    res = await k.actions.listWorkflowRuns({ owner: sessionConfig.owner, repo: sessionConfig.repo, workflow_id: args.workflow_id });
                } else {
                    res = await k.actions.listWorkflowRunsForRepo({ owner: sessionConfig.owner, repo: sessionConfig.repo });
                }
                return { content: [{ type: 'text', text: JSON.stringify(res.data.workflow_runs, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('github_actions_dispatch_workflow',
        {
            workflow_id: z.string().describe('Workflow ID or filename'),
            ref: z.string().describe('Git ref (branch, tag, sha)'),
            inputs: z.object({}).catchall(z.any()).optional().describe('Workflow inputs'),
            confirm: z.boolean().describe('Safety gate')
        },
        async (args) => {
            try {
                if (!args.confirm) {
                    return { isError: true, content: [{ type: 'text', text: `CONFIRMATION_REQUIRED: Are you sure you want to dispatch workflow ${args.workflow_id} on ref ${args.ref}? Set confirm: true to proceed.` }] };
                }
                const k = await ensureConnected();
                await k.actions.createWorkflowDispatch({
                    owner: sessionConfig.owner,
                    repo: sessionConfig.repo,
                    workflow_id: args.workflow_id,
                    ref: args.ref,
                    inputs: args.inputs || {}
                });
                return { content: [{ type: 'text', text: JSON.stringify({ status: 'dispatched' }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('github_actions_get_run_logs',
        { run_id: z.string().describe('Run ID') },
        async (args) => {
            try {
                const k = await ensureConnected();
                const res = await k.actions.downloadWorkflowRunLogs({
                    owner: sessionConfig.owner,
                    repo: sessionConfig.repo,
                    run_id: Number(args.run_id)
                });
                return { content: [{ type: 'text', text: JSON.stringify({ url: res.url || 'Log download initiated' }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.__test = {
        sessionConfig,
        ensureConnected,
        setConfig: (next) => { Object.assign(sessionConfig, next); kit = null; },
        getConfig: () => ({ ...sessionConfig })
    };

    return server;
}

if (require.main === module) {
    const server = createGitHubActionsServer();
    const transport = new StdioServerTransport();
    server.connect(transport).then(() => {
        console.error('GitHub Actions MCP server running on stdio');
    }).catch((error) => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createGitHubActionsServer };
