const axios = require('axios');
const { McpServer } = require(require('path').join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js'));
const { StdioServerTransport } = require(require('path').join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/stdio.js'));

const SERVER_INFO = { name: 'sentry-mcp', version: '1.0.0' };

let config = {
    token: process.env.SENTRY_TOKEN,
    baseUrl: process.env.FLOCCA_PROXY_URL || process.env.SENTRY_BASE_URL || 'https://sentry.io/api/0',
    orgSlug: process.env.SENTRY_ORG_SLUG
};

function getHeaders() {
    if (process.env.FLOCCA_PROXY_URL && process.env.FLOCCA_USER_ID) {
        return {
            'X-Flocca-User-ID': process.env.FLOCCA_USER_ID,
            'Content-Type': 'application/json'
        };
    }
    if (!config.token) throw new Error("Sentry Setup Required");
    return { 'Authorization': `Bearer ${config.token}`, 'Content-Type': 'application/json' };
}

function normalizeError(err) {
    const msg = err.response?.data?.detail || err.message || JSON.stringify(err);
    return { isError: true, content: [{ type: 'text', text: `Sentry Error: ${msg}` }] };
}

function createToolAliases(name) {
    const alias = name
        .replace(/\./g, '_')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase();
    return alias !== name ? [alias] : [];
}

function registerToolWithAliases(server, name, config, handler) {
    const aliases = createToolAliases(name);
    if (aliases.length === 0) {
        server.registerTool(name, config, handler);
        return;
    }
    for (const alias of aliases) {
        server.registerTool(alias, config, handler);
    }
}

async function main() {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    registerToolWithAliases(server, 'sentry.configure',
        { description: 'Configure Sentry', inputSchema: { type: 'object', properties: { token: { type: 'string' }, org_slug: { type: 'string' }, base_url: { type: 'string' } }, required: ['token', 'org_slug'] } },
        async (args) => {
            config.token = args.token;
            config.orgSlug = args.org_slug;
            if (args.base_url) config.baseUrl = args.base_url;

            try {
                // Verify by getting org
                await axios.get(`${config.baseUrl}/organizations/${config.orgSlug}/`, { headers: getHeaders() });
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'sentry.listProjects',
        { description: 'List Projects', inputSchema: { type: 'object', properties: {} } },
        async () => {
            try {
                const res = await axios.get(`${config.baseUrl}/organizations/${config.orgSlug}/projects/`, { headers: getHeaders() });
                return { content: [{ type: 'text', text: JSON.stringify(res.data.map(p => ({ slug: p.slug, name: p.name, platform: p.platform }))) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'sentry.listIssues',
        { description: 'List Issues', inputSchema: { type: 'object', properties: { project_slug: { type: 'string' }, query: { type: 'string' } }, required: ['project_slug'] } },
        async (args) => {
            try {
                const res = await axios.get(`${config.baseUrl}/projects/${config.orgSlug}/${args.project_slug}/issues/`, {
                    headers: getHeaders(),
                    params: { query: args.query || 'is:unresolved', limit: 20 }
                });
                return { content: [{ type: 'text', text: JSON.stringify(res.data.map(i => ({ id: i.id, title: i.title, count: i.count, userCount: i.userCount }))) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'sentry.getIssue',
        { description: 'Get Issue Details', inputSchema: { type: 'object', properties: { issue_id: { type: 'string' } }, required: ['issue_id'] } },
        async (args) => {
            try {
                const res = await axios.get(`${config.baseUrl}/issues/${args.issue_id}/`, { headers: getHeaders() });
                return { content: [{ type: 'text', text: JSON.stringify(res.data) }] };
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
