const axios = require('axios');
const { McpServer } = require(require('path').join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js'));
const { StdioServerTransport } = require(require('path').join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/stdio.js'));

const SERVER_INFO = { name: 'confluence-mcp', version: '1.0.0' };

let config = {
    username: process.env.CONFLUENCE_USERNAME,
    token: process.env.CONFLUENCE_TOKEN,
    baseUrl: process.env.FLOCCA_PROXY_URL || process.env.CONFLUENCE_BASE_URL,
    deploymentMode: (process.env.CONFLUENCE_DEPLOYMENT_MODE || 'cloud').toLowerCase()
};

function normalizeBaseUrl(url) {
    const trimmed = (url || '').replace(/\/+$/, '');
    return trimmed.replace(/\/wiki$/i, '');
}
config.baseUrl = normalizeBaseUrl(config.baseUrl);

function apiPathCandidates(pathPart) {
    const suffix = pathPart.replace(/^\/+/, '');
    const cloudPath = `/wiki/rest/api/${suffix}`;
    const serverPath = `/rest/api/${suffix}`;
    if (config.deploymentMode === 'server' || config.deploymentMode === 'self_hosted') return [serverPath, cloudPath];
    return [cloudPath, serverPath];
}

async function confluenceRequest(method, pathPart, body, options = {}) {
    let lastError;
    for (const apiPath of apiPathCandidates(pathPart)) {
        try {
            return await axios({
                method,
                url: `${config.baseUrl}${apiPath}`,
                data: body,
                ...options
            });
        } catch (err) {
            lastError = err;
            const status = err?.response?.status;
            if (status === 404 || status === 405) continue;
            throw err;
        }
    }
    throw lastError || new Error('Confluence request failed');
}

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

    registerToolWithAliases(server, 'confluence.configure',
        { description: 'Configure Confluence', inputSchema: { type: 'object', properties: { username: { type: 'string' }, token: { type: 'string' }, base_url: { type: 'string' }, deployment_mode: { type: 'string' } }, required: ['token', 'base_url'] } },
        async (args) => {
            config.token = args.token;
            config.baseUrl = normalizeBaseUrl(args.base_url);
            if (args.deployment_mode) config.deploymentMode = args.deployment_mode.toLowerCase();
            if (args.username) config.username = args.username;

            try {
                // Verify
                await confluenceRequest('get', 'user/current', undefined, { headers: getHeaders() });
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, status: 'authenticated' }) }] };
            } catch (e) {
                config.token = undefined;
                return normalizeError(e);
            }
        }
    );

    registerToolWithAliases(server, 'confluence.listSpaces',
        { description: 'List Spaces', inputSchema: { type: 'object', properties: {} } },
        async () => {
            try {
                const res = await confluenceRequest('get', 'space', undefined, { headers: getHeaders(), params: { limit: 25 } });
                return { content: [{ type: 'text', text: JSON.stringify(res.data.results) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'confluence.searchPages',
        { description: 'Search Pages (CQL)', inputSchema: { type: 'object', properties: { cql: { type: 'string' } }, required: ['cql'] } },
        async (args) => {
            try {
                const res = await confluenceRequest('get', 'content/search', undefined, {
                    headers: getHeaders(),
                    params: { cql: args.cql, limit: 10 }
                });
                return { content: [{ type: 'text', text: JSON.stringify(res.data.results) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'confluence.getPage',
        { description: 'Get Page', inputSchema: { type: 'object', properties: { page_id: { type: 'string' } }, required: ['page_id'] } },
        async (args) => {
            try {
                const res = await confluenceRequest('get', `content/${args.page_id}`, undefined, { headers: getHeaders(), params: { expand: 'body.storage' } });
                return { content: [{ type: 'text', text: JSON.stringify(res.data) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'confluence.createPage',
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
                const res = await confluenceRequest('post', 'content', payload, { headers: getHeaders() });
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

module.exports = {
    main,
    __test: {
        normalizeBaseUrl,
        apiPathCandidates,
        confluenceRequest,
        setConfig: (next) => { config = { ...config, ...next }; },
        getConfig: () => ({ ...config })
    }
};
