const axios = require('axios');
const { McpServer } = require(require('path').join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js'));
const { StdioServerTransport } = require(require('path').join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/stdio.js'));

const SERVER_INFO = { name: 'confluence-mcp', version: '1.0.0' };

let config = {
    username: process.env.CONFLUENCE_USERNAME,
    token: process.env.CONFLUENCE_TOKEN,
    baseUrl: process.env.FLOCCA_PROXY_URL || process.env.CONFLUENCE_BASE_URL
};

function getHeaders() {
    if (process.env.FLOCCA_PROXY_URL && process.env.FLOCCA_USER_ID) {
        return {
            'X-Flocca-User-ID': process.env.FLOCCA_USER_ID,
            'Content-Type': 'application/json'
        };
    }

    if (!config.token || !config.baseUrl) throw new Error("Confluence not configured.");
    // Support Bearer or Basic. Usually SaaS is Basic with email:token base64, or just Bearer.
    // If username provided, use Basic
    if (config.username) {
        const auth = Buffer.from(`${config.username}:${config.token}`).toString('base64');
        return { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' };
    }
    // Else assume Bearer
    return { 'Authorization': `Bearer ${config.token}`, 'Content-Type': 'application/json' };
}

function normalizeError(err) {
    const msg = err.response?.data?.message || err.message || JSON.stringify(err);
    return { isError: true, content: [{ type: 'text', text: `Confluence Error: ${msg}` }] };
}

async function main() {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    server.registerTool('confluence.configure',
        { description: 'Configure Confluence', inputSchema: { type: 'object', properties: { username: { type: 'string' }, token: { type: 'string' }, base_url: { type: 'string' } }, required: ['token', 'base_url'] } },
        async (args) => {
            config.token = args.token;
            config.baseUrl = args.base_url.replace(/\/$/, ''); // Remove trailing slash
            if (args.username) config.username = args.username;

            try {
                // Verify
                await axios.get(`${config.baseUrl}/wiki/rest/api/user/current`, { headers: getHeaders() });
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, status: 'authenticated' }) }] };
            } catch (e) {
                config.token = undefined;
                return normalizeError(e);
            }
        }
    );

    server.registerTool('confluence.listSpaces',
        { description: 'List Spaces', inputSchema: { type: 'object', properties: {} } },
        async () => {
            try {
                const res = await axios.get(`${config.baseUrl}/wiki/rest/api/space?limit=25`, { headers: getHeaders() });
                return { content: [{ type: 'text', text: JSON.stringify(res.data.results) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.registerTool('confluence.searchPages',
        { description: 'Search Pages (CQL)', inputSchema: { type: 'object', properties: { cql: { type: 'string' } }, required: ['cql'] } },
        async (args) => {
            try {
                const res = await axios.get(`${config.baseUrl}/wiki/rest/api/content/search`, {
                    headers: getHeaders(),
                    params: { cql: args.cql, limit: 10 }
                });
                return { content: [{ type: 'text', text: JSON.stringify(res.data.results) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.registerTool('confluence.getPage',
        { description: 'Get Page', inputSchema: { type: 'object', properties: { page_id: { type: 'string' } }, required: ['page_id'] } },
        async (args) => {
            try {
                const res = await axios.get(`${config.baseUrl}/wiki/rest/api/content/${args.page_id}?expand=body.storage`, { headers: getHeaders() });
                return { content: [{ type: 'text', text: JSON.stringify(res.data) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.registerTool('confluence.createPage',
        {
            description: 'Create Page',
            inputSchema: {
                type: 'object',
                properties: {
                    space_key: { type: 'string' },
                    title: { type: 'string' },
                    body: { type: 'string' },
                    parent_id: { type: 'string' }
                },
                required: ['space_key', 'title']
            }
        },
        async (args) => {
            try {
                const payload = {
                    title: args.title,
                    type: 'page',
                    space: { key: args.space_key },
                    body: { storage: { value: args.body || '<p></p>', representation: 'storage' } }
                };
                if (args.parent_id) {
                    payload.ancestors = [{ id: args.parent_id }];
                }
                const res = await axios.post(`${config.baseUrl}/wiki/rest/api/content`, payload, { headers: getHeaders() });
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
