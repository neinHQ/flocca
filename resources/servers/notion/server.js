const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { Client } = require("@notionhq/client");

const SERVER_INFO = { name: 'notion-mcp', version: '2.0.0' };

function createNotionServer() {
    let sessionConfig = {
        token: process.env.NOTION_TOKEN,
        proxyUrl: process.env.FLOCCA_PROXY_URL,
        userId: process.env.FLOCCA_USER_ID
    };

    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });
    let notionClient = null;

    async function ensureConnected() {
        if (!sessionConfig.token && !(sessionConfig.proxyUrl && sessionConfig.userId)) {
            // Re-check env vars
            sessionConfig.token = process.env.NOTION_TOKEN || sessionConfig.token;
            sessionConfig.proxyUrl = process.env.FLOCCA_PROXY_URL || sessionConfig.proxyUrl;
            sessionConfig.userId = process.env.FLOCCA_USER_ID || sessionConfig.userId;

            if (!sessionConfig.token && !(sessionConfig.proxyUrl && sessionConfig.userId)) {
                throw new Error("Notion Not Configured. Provide NOTION_TOKEN or FLOCCA_PROXY_URL.");
            }
        }

        if (!notionClient) {
            if (sessionConfig.proxyUrl && sessionConfig.userId) {
                notionClient = new Client({
                    baseUrl: sessionConfig.proxyUrl,
                    auth: 'dummy',
                    fetch: async (url, init) => {
                        init.headers = { ...(init.headers || {}), 'X-Flocca-User-ID': sessionConfig.userId };
                        delete init.headers['Authorization'];
                        return fetch(url, init);
                    }
                });
            } else {
                notionClient = new Client({ auth: sessionConfig.token });
            }
        }
        return notionClient;
    }

    server.tool('notion_health', {}, async () => {
        try {
            const client = await ensureConnected();
            await client.users.me();
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, mode: sessionConfig.proxyUrl ? 'proxy' : 'direct' }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('notion_configure',
        { token: z.string().describe('Notion Integration Token') },
        async (args) => {
            try {
                sessionConfig.token = args.token;
                notionClient = null; // force re-init
                const client = await ensureConnected();
                await client.users.me();
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, status: 'authenticated' }) }] };
            } catch (e) {
                sessionConfig.token = undefined;
                notionClient = null;
                return normalizeError(e);
            }
        }
    );

    server.tool('notion_search',
        { query: z.string().describe('Search term for pages or databases') },
        async (args) => {
            try {
                const client = await ensureConnected();
                const res = await client.search({ query: args.query, page_size: 20 });
                return { content: [{ type: 'text', text: JSON.stringify(res.results, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('notion_list_databases', {}, async () => {
        try {
            const client = await ensureConnected();
            const res = await client.search({ filter: { value: 'database', property: 'object' } });
            return { content: [{ type: 'text', text: JSON.stringify(res.results, null, 2) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('notion_query_database',
        { database_id: z.string().describe('The ID of the database to query') },
        async (args) => {
            try {
                const client = await ensureConnected();
                const res = await client.databases.query({ database_id: args.database_id, page_size: 50 });
                return { content: [{ type: 'text', text: JSON.stringify(res.results, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('notion_get_page',
        { page_id: z.string().describe('The ID of the page to retrieve') },
        async (args) => {
            try {
                const client = await ensureConnected();
                const page = await client.pages.retrieve({ page_id: args.page_id });
                return { content: [{ type: 'text', text: JSON.stringify(page, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('notion_create_page',
        {
            parent_id: z.string().describe('The ID of the parent page'),
            title: z.string().describe('The title of the new page'),
            body: z.string().optional().describe('Plain text content for the page body'),
            confirm: z.boolean().describe('Safety gate')
        },
        async (args) => {
            try {
                if (!args.confirm) return { isError: true, content: [{ type: 'text', text: `CONFIRMATION_REQUIRED: Create page "${args.title}" under parent ${args.parent_id}? Set confirm: true to proceed.` }] };
                const client = await ensureConnected();
                const res = await client.pages.create({
                    parent: { page_id: args.parent_id },
                    properties: {
                        title: [{ text: { content: args.title } }]
                    },
                    children: args.body ? [
                        { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: args.body } }] } }
                    ] : []
                });
                return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.__test = {
        sessionConfig,
        ensureConnected,
        setConfig: (next) => { Object.assign(sessionConfig, next); notionClient = null; },
        getConfig: () => ({ ...sessionConfig })
    };

    return server;
}

if (require.main === module) {
    const server = createNotionServer();
    const transport = new StdioServerTransport();
    server.connect(transport).then(() => {
        console.error('Notion MCP server running on stdio');
    }).catch((error) => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createNotionServer };
