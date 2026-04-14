const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { Octokit } = require("@octokit/rest");
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const SERVER_INFO = { name: 'github-mcp', version: '2.0.0' };

let config = {
    token: process.env.GITHUB_PERSONAL_ACCESS_TOKEN || process.env.GITHUB_TOKEN,
    proxyUrl: process.env.FLOCCA_PROXY_URL,
    userId: process.env.FLOCCA_USER_ID
};

function normalizeError(err) {
    const msg = err.message || JSON.stringify(err);
    return { isError: true, content: [{ type: 'text', text: `GitHub Error: ${msg}` }] };
}

function createGitHubServer() {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });
    let kit = null;

    async function ensureConnected() {
        if (!config.token && !(config.proxyUrl && config.userId)) {
            // Re-check env vars
            config.token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN || process.env.GITHUB_TOKEN;
            config.proxyUrl = process.env.FLOCCA_PROXY_URL;
            config.userId = process.env.FLOCCA_USER_ID;

            if (!config.token && !(config.proxyUrl && config.userId)) {
                throw new Error("GitHub Not Configured. Provide GITHUB_TOKEN or FLOCCA_PROXY_URL.");
            }
        }

        if (!kit) {
            if (config.proxyUrl && config.userId) {
                kit = new Octokit({
                    baseUrl: config.proxyUrl,
                    userAgent: 'flocca-vscode',
                    request: {
                        fetch: (url, opts) => {
                            opts.headers = opts.headers || {};
                            opts.headers['X-Flocca-User-ID'] = config.userId;
                            return fetch(url, opts);
                        }
                    }
                });
            } else {
                kit = new Octokit({ auth: config.token });
            }
        }
        return kit;
    }

    server.tool('github_health', {}, async () => {
        try {
            const k = await ensureConnected();
            await k.rest.rateLimit.get();
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, mode: config.proxyUrl ? 'proxy' : 'direct' }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('search_repositories',
        {
            query: z.string().describe('Search query (e.g. repo name or keywords)'),
            page: z.number().optional().default(1),
            per_page: z.number().optional().default(10)
        },
        async (args) => {
            try {
                const k = await ensureConnected();
                const res = await k.rest.search.repos({
                    q: args.query,
                    page: args.page,
                    per_page: args.per_page
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

    server.tool('read_file',
        {
            owner: z.string().describe('Repo owner'),
            repo: z.string().describe('Repo name'),
            path: z.string().describe('File path'),
            ref: z.string().optional().describe('Git ref (branch, tag, sha)')
        },
        async (args) => {
            try {
                const k = await ensureConnected();
                const res = await k.rest.repos.getContent({
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

    server.tool('create_issue',
        {
            owner: z.string(),
            repo: z.string(),
            title: z.string(),
            body: z.string().optional(),
            confirm: z.boolean().describe('Safety gate')
        },
        async (args) => {
            try {
                if (!args.confirm) return { isError: true, content: [{ type: 'text', text: `CONFIRMATION_REQUIRED: Are you sure you want to create issue "${args.title}" in ${args.owner}/${args.repo}? Set confirm: true to proceed.` }] };
                const k = await ensureConnected();
                const res = await k.rest.issues.create({
                    owner: args.owner,
                    repo: args.repo,
                    title: args.title,
                    body: args.body
                });
                return { content: [{ type: 'text', text: JSON.stringify({ number: res.data.number, html_url: res.data.html_url }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('git_add',
        { files: z.array(z.string()).describe('List of files to add, or ["."] for all') },
        async (args) => {
            try {
                const files = args.files.join(' ');
                await execAsync(`git add ${files}`);
                return { content: [{ type: 'text', text: `Successfully staged: ${files}` }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('git_commit',
        {
            message: z.string(),
            confirm: z.boolean().describe('Safety gate')
        },
        async (args) => {
            try {
                if (!args.confirm) return { isError: true, content: [{ type: 'text', text: `CONFIRMATION_REQUIRED: Commit message: "${args.message}". Set confirm: true to proceed.` }] };
                const msg = args.message.replace(/"/g, '\\"');
                await execAsync(`git commit -m "${msg}"`);
                return { content: [{ type: 'text', text: `Committed with message: ${args.message}` }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('git_push',
        {
            remote: z.string().optional().default('origin'),
            branch: z.string().optional(),
            confirm: z.boolean().describe('Safety gate')
        },
        async (args) => {
            try {
                if (!args.confirm) return { isError: true, content: [{ type: 'text', text: `CONFIRMATION_REQUIRED: Pushing to ${args.remote}. Set confirm: true to proceed.` }] };
                const remote = args.remote || 'origin';
                const branch = args.branch ? ` ${args.branch}` : '';
                await execAsync(`git push ${remote}${branch}`);
                return { content: [{ type: 'text', text: `Pushed to ${remote}${branch}` }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('create_pull_request',
        {
            owner: z.string(),
            repo: z.string(),
            title: z.string(),
            head: z.string().describe('Branch containing changes'),
            base: z.string().describe('Branch to merge into'),
            body: z.string().optional(),
            confirm: z.boolean().describe('Safety gate')
        },
        async (args) => {
            try {
                if (!args.confirm) return { isError: true, content: [{ type: 'text', text: `CONFIRMATION_REQUIRED: Create Pull Request "${args.title}"? Set confirm: true to proceed.` }] };
                const k = await ensureConnected();
                const res = await k.rest.pulls.create({
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

    server.tool('merge_pull_request',
        {
            owner: z.string(),
            repo: z.string(),
            pull_number: z.number(),
            merge_method: z.enum(['merge', 'squash', 'rebase']).optional().default('merge'),
            confirm: z.boolean().describe('Safety gate')
        },
        async (args) => {
            try {
                if (!args.confirm) return { isError: true, content: [{ type: 'text', text: `CONFIRMATION_REQUIRED: Merge PR #${args.pull_number}? Set confirm: true to proceed.` }] };
                const k = await ensureConnected();
                const res = await k.rest.pulls.merge({
                    owner: args.owner,
                    repo: args.repo,
                    pull_number: args.pull_number,
                    merge_method: args.merge_method
                });
                return { content: [{ type: 'text', text: JSON.stringify({ merged: res.data.merged, message: res.data.message }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    return server;
}

if (require.main === module) {
    const server = createGitHubServer();
    const transport = new StdioServerTransport();
    server.connect(transport).then(() => {
        console.error('GitHub MCP server running on stdio');
    }).catch((error) => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createGitHubServer };
