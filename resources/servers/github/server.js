
const { Octokit } = require("@octokit/rest");
const { McpServer } = require(require('path').join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js'));
const { StdioServerTransport } = require(require('path').join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/stdio.js'));

const SERVER_INFO = { name: 'github-mcp', version: '1.0.0' };

let config = {
    token: process.env.GITHUB_PERSONAL_ACCESS_TOKEN || process.env.GITHUB_TOKEN,
    proxyUrl: process.env.FLOCCA_PROXY_URL,
    userId: process.env.FLOCCA_USER_ID
};

function getKit() {
    if (config.proxyUrl && config.userId) {
        return new Octokit({
            baseUrl: config.proxyUrl, // e.g. http://localhost:3000/proxy/github
            userAgent: 'flocca-vscode',
            request: {
                fetch: (url, opts) => {
                    // Inject Header manually if needed, though Octokit might not support custom headers in constructor easily for all requests without plugin.
                    // Actually Octokit supports `userAgent`. Custom headers?
                    // We can pass `defaults`.
                    opts.headers = opts.headers || {};
                    opts.headers['X-Flocca-User-ID'] = config.userId;
                    return fetch(url, opts);
                }
            }
        });
    }

    if (!config.token) throw new Error("GitHub Not Configured. token missing.");
    return new Octokit({ auth: config.token });
}

function normalizeError(err) {
    const msg = err.message || JSON.stringify(err);
    return { isError: true, content: [{ type: 'text', text: `GitHub Error: ${msg}` }] };
}

async function main() {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    server.registerTool('search_repositories',
        {
            description: 'Search GitHub Repositories',
            inputSchema: {
                type: 'object',
                properties: {
                    query: { type: 'string' },
                    page: { type: 'number' },
                    per_page: { type: 'number' }
                },
                required: ['query']
            }
        },
        async (args) => {
            try {
                const res = await getKit().rest.search.repos({
                    q: args.query,
                    page: args.page || 1,
                    per_page: args.per_page || 10
                });
                // Map to simpler format
                const repos = res.data.items.map(r => ({
                    name: r.name,
                    full_name: r.full_name,
                    html_url: r.html_url,
                    description: r.description,
                    stars: r.stargazers_count,
                    language: r.language
                }));
                return { content: [{ type: 'text', text: JSON.stringify(repos, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.registerTool('read_file',
        {
            description: 'Read file content',
            inputSchema: {
                type: 'object',
                properties: {
                    owner: { type: 'string' },
                    repo: { type: 'string' },
                    path: { type: 'string' },
                    ref: { type: 'string' }
                },
                required: ['owner', 'repo', 'path']
            }
        },
        async (args) => {
            try {
                // Get content
                const res = await getKit().rest.repos.getContent({
                    owner: args.owner,
                    repo: args.repo,
                    path: args.path,
                    ref: args.ref
                });

                if (Array.isArray(res.data)) {
                    return { isError: true, content: [{ type: 'text', text: "Path is a directory, not a file." }] };
                }

                if (res.data.type !== 'file') {
                    return { isError: true, content: [{ type: 'text', text: "Target is not a file." }] };
                }

                // Decode content (base64)
                const content = Buffer.from(res.data.content, res.data.encoding).toString('utf-8');
                return { content: [{ type: 'text', text: content }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.registerTool('create_issue',
        {
            description: 'Create an Issue',
            inputSchema: {
                type: 'object',
                properties: {
                    owner: { type: 'string' },
                    repo: { type: 'string' },
                    title: { type: 'string' },
                    body: { type: 'string' }
                },
                required: ['owner', 'repo', 'title']
            }
        },
        async (args) => {
            try {
                const res = await getKit().rest.issues.create({
                    owner: args.owner,
                    repo: args.repo,
                    title: args.title,
                    body: args.body
                });
                return { content: [{ type: 'text', text: JSON.stringify({ number: res.data.number, html_url: res.data.html_url }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // Git Operations (Local)
    const { exec } = require('child_process');
    const util = require('util');
    const execAsync = util.promisify(exec);

    server.registerTool('git_add',
        {
            description: 'Stage files for commit (git add)',
            inputSchema: {
                type: 'object',
                properties: {
                    files: { type: 'array', items: { type: 'string' }, description: 'List of files to add, or ["."] for all' }
                },
                required: ['files']
            }
        },
        async (args) => {
            try {
                const files = args.files.join(' ');
                await execAsync(`git add ${files}`);
                return { content: [{ type: 'text', text: `Successfully staged: ${files}` }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.registerTool('git_commit',
        {
            description: 'Commit staged changes (git commit)',
            inputSchema: {
                type: 'object',
                properties: {
                    message: { type: 'string' }
                },
                required: ['message']
            }
        },
        async (args) => {
            try {
                // Escape quotes
                const msg = args.message.replace(/"/g, '\\"');
                await execAsync(`git commit -m "${msg}"`);
                return { content: [{ type: 'text', text: `Committed with message: ${args.message}` }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.registerTool('git_push',
        {
            description: 'Push changes to remote (git push)',
            inputSchema: {
                type: 'object',
                properties: {
                    remote: { type: 'string', default: 'origin' },
                    branch: { type: 'string' }
                }
            }
        },
        async (args) => {
            try {
                const remote = args.remote || 'origin';
                const branch = args.branch ? ` ${args.branch}` : '';
                await execAsync(`git push ${remote}${branch}`);
                return { content: [{ type: 'text', text: `Pushed to ${remote}${branch}` }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // Pull Request Operations (Remote)
    server.registerTool('create_pull_request',
        {
            description: 'Create a Pull Request',
            inputSchema: {
                type: 'object',
                properties: {
                    owner: { type: 'string' },
                    repo: { type: 'string' },
                    title: { type: 'string' },
                    head: { type: 'string', description: 'The name of the branch where your changes are implemented.' },
                    base: { type: 'string', description: 'The name of the branch you want the changes pulled into.' },
                    body: { type: 'string' }
                },
                required: ['owner', 'repo', 'title', 'head', 'base']
            }
        },
        async (args) => {
            try {
                const res = await getKit().rest.pulls.create({
                    owner: args.owner,
                    repo: args.repo,
                    title: args.title,
                    head: args.head,
                    base: args.base,
                    body: args.body
                });
                return { content: [{ type: 'text', text: JSON.stringify({ number: res.data.number, html_url: res.data.html_url }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.registerTool('merge_pull_request',
        {
            description: 'Merge a Pull Request',
            inputSchema: {
                type: 'object',
                properties: {
                    owner: { type: 'string' },
                    repo: { type: 'string' },
                    pull_number: { type: 'number' },
                    merge_method: { type: 'string', enum: ['merge', 'squash', 'rebase'], default: 'merge' }
                },
                required: ['owner', 'repo', 'pull_number']
            }
        },
        async (args) => {
            try {
                const res = await getKit().rest.pulls.merge({
                    owner: args.owner,
                    repo: args.repo,
                    pull_number: args.pull_number,
                    merge_method: args.merge_method || 'merge'
                });
                return { content: [{ type: 'text', text: JSON.stringify({ merged: res.data.merged, message: res.data.message }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    const transport = new StdioServerTransport();
    await server.connect(transport);
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { main };
