const { Client } = require("@notionhq/client");
const { McpServer } = require(require('path').join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js'));
const { StdioServerTransport } = require(require('path').join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/stdio.js'));

const SERVER_INFO = { name: 'notion-mcp', version: '1.0.0' };

let config = { token: process.env.NOTION_TOKEN };

const PROXY = process.env.FLOCCA_PROXY_URL;
const USER = process.env.FLOCCA_USER_ID;

function getClient() {
    if (!config.token && !(PROXY && USER)) throw new Error("Notion Not Configured. Config is missing.");

    if (PROXY && USER) {
        // Proxy Mode
        return new Client({
            baseUrl: PROXY,
            auth: 'dummy', // SDK requires auth
            fetch: async (url, init) => {
                // Inject Header
                init.headers = { ...(init.headers || {}), 'X-Flocca-User-ID': USER };
                // remove auth header if present (Notion SDK adds it)
                delete init.headers['Authorization'];
                return fetch(url, init);
            }
        });
    }
    return new Client({ auth: config.token });
}

function normalizeError(err) {
    const msg = err.message || JSON.stringify(err);
    return { isError: true, content: [{ type: 'text', text: `Notion Error: ${msg}` }] };
}

function createToolAliases(name) {
    const alias = name
        .replace(/\./g, '_')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase();
    return alias !== name ? [alias] : [];
}

function registerToolWithAliases(server, name, config, handler) {
    server.registerTool(name, config, handler);
    for (const alias of createToolAliases(name)) {
        server.registerTool(alias, config, handler);
    }
}

async function main() {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    registerToolWithAliases(server, 'notion.configure',
        { description: 'Configure Notion', inputSchema: { type: 'object', properties: { token: { type: 'string' } }, required: ['token'] } },
        async (args) => {
            config.token = args.token;
            try {
                await getClient().users.me();
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, status: 'authenticated' }) }] };
            } catch (e) {
                config.token = undefined;
                return normalizeError(e);
            }
        }
    );

    registerToolWithAliases(server, 'notion.search',
        { description: 'Search pages/databases', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
        async (args) => {
            try {
                const res = await getClient().search({ query: args.query, page_size: 20 });
                return { content: [{ type: 'text', text: JSON.stringify(res.results) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'notion.listDatabases',
        { description: 'List databases', inputSchema: { type: 'object', properties: {} } },
        async () => {
            try {
                const res = await getClient().search({ filter: { value: 'database', property: 'object' } });
                return { content: [{ type: 'text', text: JSON.stringify(res.results) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'notion.queryDatabase',
        { description: 'Query Database', inputSchema: { type: 'object', properties: { database_id: { type: 'string' } }, required: ['database_id'] } },
        async (args) => {
            try {
                const res = await getClient().databases.query({ database_id: args.database_id, page_size: 50 });
                return { content: [{ type: 'text', text: JSON.stringify(res.results) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'notion.getPage',
        { description: 'Get Page', inputSchema: { type: 'object', properties: { page_id: { type: 'string' } }, required: ['page_id'] } },
        async (args) => {
            try {
                const page = await getClient().pages.retrieve({ page_id: args.page_id });
                return { content: [{ type: 'text', text: JSON.stringify(page) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'notion.createPage',
        {
            description: 'Create Page',
            inputSchema: {
                type: 'object',
                properties: {
                    parent_id: { type: 'string' },
                    title: { type: 'string' },
                    body: { type: 'string' } // Simplified markdown-ish body or plain text
                },
                required: ['parent_id', 'title']
            }
        },
        async (args) => {
            try {
                // Basic Create with just title and minimal blocks 
                const res = await getClient().pages.create({
                    parent: { page_id: args.parent_id }, // Assuming parent is page not DB for simplicity
                    properties: {
                        title: [{ text: { content: args.title } }]
                    },
                    children: args.body ? [
                        { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: args.body } }] } }
                    ] : []
                });
                return { content: [{ type: 'text', text: JSON.stringify(res) }] };
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
