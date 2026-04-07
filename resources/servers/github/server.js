const { Octokit } = require("@octokit/rest");
const z = require('zod');
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

    server.registerTool('github_health',
        {
            description: 'Health check for GitHub authentication',
            inputSchema: z.object({})
        },
        async () => {
            try {
                await getKit().rest.rateLimit.get();
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.registerTool('search_repositories',
        {
            description: 'Search GitHub Repositories',
            inputSchema: z.object({
                query: z.string(),
                page: z.number().optional(),
                per_page: z.number().optional()
            })
        },
        async (args) => {
            try {
                const res = await getKit().rest.search.repos({
                    q: args.query,
                    page: args.page || 1,
                    per_page: args.per_page || 10
                });
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
            inputSchema: z.object({
                owner: z.string(),
                repo: z.string(),
                path: z.string(),
                ref: z.string().optional()
            })
        },
        async (args) => {
            try {
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

                const content = Buffer.from(res.data.content, res.data.encoding).toString('utf-8');
                return { content: [{ type: 'text', text: content }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.registerTool('create_issue',
        {
            description: 'Create an Issue',
            inputSchema: z.object({
                owner: z.string(),
                repo: z.string(),
                title: z.string(),
                body: z.string().optional()
            })
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

    const { exec } = require('child_process');
    const util = require('util');
    const execAsync = util.promisify(exec);

    server.registerTool('git_add',
        {
            description: 'Stage files for commit (git add)',
            inputSchema: z.object({
                files: z.array(z.string()).describe('List of files to add, or ["."] for all')
            })
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
            inputSchema: z.object({
                message: z.string()
            })
        },
        async (args) => {
            try {
                const msg = args.message.replace(/"/g, '\\"');
                await execAsync(`git commit -m "${msg}"`);
                return { content: [{ type: 'text', text: `Committed with message: ${args.message}` }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.registerTool('git_push',
        {
            description: 'Push changes to remote (git push)',
            inputSchema: z.object({
                remote: z.string().optional().default('origin'),
                branch: z.string().optional()
            })
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

    server.registerTool('create_pull_request',
        {
            description: 'Create a Pull Request',
            inputSchema: z.object({
                owner: z.string(),
                repo: z.string(),
                title: z.string(),
                head: z.string().describe('The name of the branch where your changes are implemented.'),
                base: z.string().describe('The name of the branch you want the changes pulled into.'),
                body: z.string().optional()
            })
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
            inputSchema: z.object({
                owner: z.string(),
                repo: z.string(),
                pull_number: z.number(),
                merge_method: z.enum(['merge', 'squash', 'rebase']).optional().default('merge')
            })
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
