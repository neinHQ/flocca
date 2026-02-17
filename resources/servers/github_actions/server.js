const { Octokit } = require("@octokit/rest");
const { McpServer } = require(require('path').join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js'));
const { StdioServerTransport } = require(require('path').join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/stdio.js'));

const SERVER_INFO = { name: 'github-actions-mcp', version: '1.0.0' };

let config = {
    token: process.env.GITHUB_TOKEN,
    owner: process.env.GITHUB_OWNER,
    repo: process.env.GITHUB_REPO,
    apiUrl: process.env.GITHUB_API_URL
};

function normalizeGitHubApiUrl(url) {
    if (!url) return undefined;
    const trimmed = url.replace(/\/+$/, '');
    if (/\/api\/v3$/i.test(trimmed)) return trimmed;
    return `${trimmed}/api/v3`;
}

function getKit() {
    if (!config.token) throw new Error("GitHub Actions not configured.");
    return new Octokit({
        auth: config.token,
        baseUrl: normalizeGitHubApiUrl(config.apiUrl)
    });
}

function normalizeError(err) {
    const msg = err.message || JSON.stringify(err);
    return { isError: true, content: [{ type: 'text', text: `GitHub Error: ${msg}` }] };
}

async function main() {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    server.registerTool('github_actions.configure',
        { description: 'Configure GHA', inputSchema: { type: 'object', properties: { token: { type: 'string' }, owner: { type: 'string' }, repo: { type: 'string' }, api_url: { type: 'string' } }, required: ['token', 'owner', 'repo'] } },
        async (args) => {
            config.token = args.token;
            config.owner = args.owner;
            config.repo = args.repo;
            config.apiUrl = args.api_url;
            try {
                await getKit().repos.get({ owner: config.owner, repo: config.repo });
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, status: 'authenticated' }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.registerTool('github_actions.listWorkflows',
        { description: 'List Workflows', inputSchema: { type: 'object', properties: {} } },
        async () => {
            try {
                const res = await getKit().actions.listRepoWorkflows({ owner: config.owner, repo: config.repo });
                return { content: [{ type: 'text', text: JSON.stringify(res.data.workflows) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.registerTool('github_actions.listRuns',
        { description: 'List Runs', inputSchema: { type: 'object', properties: { workflow_id: { type: 'string' } } } },
        async (args) => {
            try {
                let res;
                if (args.workflow_id) {
                    res = await getKit().actions.listWorkflowRuns({ owner: config.owner, repo: config.repo, workflow_id: args.workflow_id });
                } else {
                    res = await getKit().actions.listWorkflowRunsForRepo({ owner: config.owner, repo: config.repo });
                }
                return { content: [{ type: 'text', text: JSON.stringify(res.data.workflow_runs) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.registerTool('github_actions.dispatchWorkflow',
        { description: 'Dispatch Workflow', inputSchema: { type: 'object', properties: { workflow_id: { type: 'string' }, ref: { type: 'string' }, inputs: { type: 'object' } }, required: ['workflow_id', 'ref'] } },
        async (args) => {
            try {
                await getKit().actions.createWorkflowDispatch({
                    owner: config.owner,
                    repo: config.repo,
                    workflow_id: args.workflow_id,
                    ref: args.ref,
                    inputs: args.inputs || {}
                });
                return { content: [{ type: 'text', text: JSON.stringify({ status: 'dispatched' }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.registerTool('github_actions.getRunLogs',
        { description: 'Get Logs URL', inputSchema: { type: 'object', properties: { run_id: { type: 'string' } }, required: ['run_id'] } },
        async (args) => {
            try {
                const res = await getKit().actions.downloadWorkflowRunLogs({
                    owner: config.owner,
                    repo: config.repo,
                    run_id: Number(args.run_id)
                });
                // This redirects to a URL usually, or returns zip buffer?
                // Octokit download usually returns redirected url if valid? 
                // Actually downloadWorkflowRunLogs returns info or 302 location.
                return { content: [{ type: 'text', text: JSON.stringify({ url: res.url || 'Log download initiated' }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    const transport = new StdioServerTransport();
    await server.connect(transport);
}


if (require.main === module) {
    main().catch(console.error);
}

module.exports = {
    main,
    __test: {
        normalizeGitHubApiUrl
    }
};
