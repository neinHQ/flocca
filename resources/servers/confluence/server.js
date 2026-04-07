const axios = require('axios');
const z = require('zod');
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
    const headerCandidates = getHeaderCandidates();

    for (const apiPath of apiPathCandidates(pathPart)) {
        for (const headers of headerCandidates) {
            try {
                return await axios({
                    method,
                    url: `${config.baseUrl}${apiPath}`,
                    data: body,
                    ...options,
                    headers: { ...(options.headers || {}), ...headers }
                });
            } catch (err) {
                lastError = err;
                const status = err?.response?.status;
                const url = `${config.baseUrl}${apiPath}`;
                
                // Logging the full error to stderr for easier debugging in VS Code logs
                console.error(`[Confluence] ${method.toUpperCase()} ${url} failed with status ${status || 'unknown'}:`, {
                    error: err.message,
                    responseData: err?.response?.data,
                    headers: err?.response?.headers
                });

                // If it's a 401 and we have more header candidates, keep trying
                if (status === 401 && headerCandidates.length > 1) continue;
                // If it's a 404 or 405 on an API path, try the other candidate (server vs cloud paths)
                if (status === 404 || status === 405) continue;
                throw err;
            }
        }
    }
    throw lastError || new Error('Confluence request failed');
}

function getHeaderCandidates() {
    if (process.env.FLOCCA_PROXY_URL && process.env.FLOCCA_USER_ID) {
        return [{
            'X-Flocca-User-ID': process.env.FLOCCA_USER_ID,
            'Content-Type': 'application/json'
        }];
    }

    if (!config.token || !config.baseUrl) throw new Error("Confluence not configured.");

    const baseHeaders = { 'Content-Type': 'application/json' };
    const candidates = [];

    // Bearer token (preferred for PAT on Server/DC)
    const bearerCandidate = { ...baseHeaders, 'Authorization': `Bearer ${config.token}` };
    // Basic auth (preferred for Cloud with email)
    const basicCandidate = config.username
        ? { ...baseHeaders, 'Authorization': `Basic ${Buffer.from(`${config.username}:${config.token}`).toString('base64')}` }
        : undefined;

    if (config.deploymentMode === 'server' || config.deploymentMode === 'self_hosted') {
        candidates.push(bearerCandidate);
        if (basicCandidate) candidates.push(basicCandidate);
    } else {
        if (basicCandidate) candidates.push(basicCandidate);
        candidates.push(bearerCandidate);
    }

    return candidates;
}

function getHeaders() {
    return getHeaderCandidates()[0];
}

function normalizeError(err) {
    const data = err.response?.data;
    let detail = '';
    if (data) {
        if (typeof data === 'string') {
            detail = data;
        } else if (data.message) {
            detail = data.message;
        } else if (Array.isArray(data.errors) && data.errors.length > 0) {
            detail = data.errors.map(e => e.message || JSON.stringify(e)).join(', ');
        } else {
            detail = JSON.stringify(data);
        }
    }
    const msg = detail || err.message || JSON.stringify(err);
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

    registerToolWithAliases(server, 'confluence.health',
        { description: 'Health check for Confluence', inputSchema: z.object({}) },
        async () => {
            try {
                await confluenceRequest('get', 'user/current', undefined, { headers: getHeaders() });
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'confluence.configure',
        { description: 'Configure Confluence', inputSchema: z.object({ username: z.string().optional(), token: z.string(), base_url: z.string(), deployment_mode: z.string().optional() }) },
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
        { description: 'List Spaces', inputSchema: z.object({}) },
        async () => {
            try {
                const res = await confluenceRequest('get', 'space', undefined, { headers: getHeaders(), params: { limit: 25 } });
                return { content: [{ type: 'text', text: JSON.stringify(res.data.results) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'confluence.getSpace',
        {
            description: 'Get Space metadata, including the homepage ID (useful for find ancestor_id for new pages).',
            inputSchema: z.object({
                space_key: z.string().describe('The key of the space (e.g., "TEAM")')
            })
        },
        async (args) => {
            try {
                const res = await confluenceRequest('get', `space/${args.space_key}`, undefined, {
                    headers: getHeaders(),
                    params: { expand: 'homepage' }
                });
                return { content: [{ type: 'text', text: JSON.stringify(res.data) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'confluence.searchPages',
        { description: 'Search Pages (CQL)', inputSchema: z.object({ cql: z.string() }) },
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
        { description: 'Get Page', inputSchema: z.object({ page_id: z.string() }) },
        async (args) => {
            try {
                const res = await confluenceRequest('get', `content/${args.page_id}`, undefined, { headers: getHeaders(), params: { expand: 'body.storage' } });
                return { content: [{ type: 'text', text: JSON.stringify(res.data) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'confluence.createPage',
        {
            description: 'Create a new page in a Confluence space.',
            inputSchema: z.object({
                space_key: z.string().describe('The key of the space to create the page in (e.g., "TEAM")'),
                title: z.string().describe('The title of the new page'),
                body: z.string().optional().describe('The storage format (XHTML) content of the page'),
                ancestor_id: z.string().optional().describe('The ID of the parent page (can be found via getSpace or searchPages)'),
                parent_id: z.string().optional().describe('Alias for ancestor_id')
            })
        },
        async (args) => {
            try {
                const parentId = args.ancestor_id || args.parent_id;
                const payload = {
                    title: args.title,
                    type: 'page',
                    space: { key: args.space_key },
                    body: { storage: { value: args.body || '<p></p>', representation: 'storage' } }
                };
                if (parentId) {
                    payload.ancestors = [{ id: parentId }];
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
        normalizeError,
        setConfig: (next) => { config = { ...config, ...next }; },
        getConfig: () => ({ ...config })
    }
};
