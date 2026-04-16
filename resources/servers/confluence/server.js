const axios = require('axios');
const z = require('zod');
const fs = require('fs');
const FormData = require('form-data');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const SERVER_INFO = { name: 'confluence-mcp', version: '2.0.0' };

function createConfluenceServer() {
    let sessionConfig = {
        username: process.env.CONFLUENCE_USERNAME,
        token: process.env.CONFLUENCE_TOKEN,
        baseUrl: process.env.CONFLUENCE_BASE_URL,
        deploymentMode: (process.env.CONFLUENCE_DEPLOYMENT_MODE || 'cloud').toLowerCase(),
        proxyUrl: process.env.FLOCCA_PROXY_URL,
        userId: process.env.FLOCCA_USER_ID
    };

    function normalizeBaseUrl(url) {
        let trimmed = (url || '').trim().replace(/\/+$/, '');
        if (!trimmed) return trimmed;
        if (!/^https?:\/\//i.test(trimmed)) trimmed = `https://${trimmed}`;
        return trimmed.replace(/\/wiki$/i, '');
    }
    sessionConfig.baseUrl = normalizeBaseUrl(sessionConfig.baseUrl);

    function apiPathCandidates(pathPart) {
        const suffix = pathPart.replace(/^\/+/, '');
        const cloudPath = `/wiki/rest/api/${suffix}`;
        const serverPath = `/rest/api/${suffix}`;
        if (sessionConfig.deploymentMode === 'server' || sessionConfig.deploymentMode === 'self_hosted') return [serverPath, cloudPath];
        return [cloudPath, serverPath];
    }

    function getHeaderCandidates() {
        if (sessionConfig.proxyUrl && sessionConfig.userId) {
            return [{ 'Content-Type': 'application/json', 'X-Flocca-User-ID': sessionConfig.userId }];
        }
        
        const baseHeaders = { 'Content-Type': 'application/json' };
        const candidates = [];
        const bearer = sessionConfig.token ? { ...baseHeaders, 'Authorization': `Bearer ${sessionConfig.token}` } : null;
        const basic = sessionConfig.username && sessionConfig.token ? { ...baseHeaders, 'Authorization': `Basic ${Buffer.from(`${sessionConfig.username}:${sessionConfig.token}`).toString('base64')}` } : null;

        if (sessionConfig.deploymentMode === 'server' || sessionConfig.deploymentMode === 'self_hosted') {
            if (bearer) candidates.push(bearer);
            if (basic) candidates.push(basic);
        } else {
            if (basic) candidates.push(basic);
            if (bearer) candidates.push(bearer);
        }
        return candidates;
    }

    async function ensureConfigured() {
        const headers = getHeaderCandidates();
        if (!sessionConfig.baseUrl || headers.length === 0) {
            // Re-read env for dynamic updates
            sessionConfig.username = process.env.CONFLUENCE_USERNAME;
            sessionConfig.token = process.env.CONFLUENCE_TOKEN;
            sessionConfig.baseUrl = normalizeBaseUrl(process.env.CONFLUENCE_BASE_URL);
            sessionConfig.proxyUrl = process.env.FLOCCA_PROXY_URL;
            sessionConfig.userId = process.env.FLOCCA_USER_ID;
            
            if (!sessionConfig.baseUrl || getHeaderCandidates().length === 0) {
                throw new Error("Confluence not configured. Provide Base URL and Token (or Proxy).");
            }
        }
    }

    async function confluenceRequest(method, pathPart, body, options = {}) {
        await ensureConfigured();
        let lastError;
        const headerCandidates = getHeaderCandidates();
        const paths = apiPathCandidates(pathPart);
        const baseURL = normalizeBaseUrl(sessionConfig.proxyUrl && sessionConfig.userId ? sessionConfig.proxyUrl : sessionConfig.baseUrl);

        for (const apiPath of paths) {
            for (const headers of headerCandidates) {
                try {
                    return await axios({
                        method,
                        url: `${baseURL}${apiPath}`,
                        data: body,
                        ...options,
                        headers: { ...(options.headers || {}), ...headers, 'X-Atlassian-Token': 'nocheck' }
                    });
                } catch (err) {
                    lastError = err;
                    const status = err?.response?.status;
                    if (status === 401 && headerCandidates.length > 1) continue;
                    if (status === 404 || status === 405) continue;
                    throw err;
                }
            }
        }
        throw lastError || new Error('Confluence request failed');
    }

    function normalizeError(err) {
        const data = err.response?.data;
        let detail = '';
        if (data) {
            if (typeof data === 'string') detail = data;
            else if (data.message) detail = data.message;
            else if (Array.isArray(data.errors) && data.errors.length > 0) {
                detail = data.errors.map(e => e.message || JSON.stringify(e)).join(', ');
            } else detail = JSON.stringify(data);
        }
        const msg = detail || err.message || JSON.stringify(err);
        return { isError: true, content: [{ type: 'text', text: `Confluence Error: ${msg}` }] };
    }

    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    const tool = (name, aliases, schema, handler) => {
        server.tool(name, schema, handler);
        aliases.forEach(a => server.tool(a, schema, handler));
    };

    // --- DISCOVERY ---
    tool('confluence_health', ['confluence.health'], {}, async () => {
        try {
            await confluenceRequest('get', 'user/current');
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
        } catch (e) { return normalizeError(e); }
    });

    tool('confluence_configure', ['confluence.configure'], {
        username: z.string().optional(),
        token: z.string().optional(),
        base_url: z.string().optional(),
        deployment_mode: z.enum(['cloud', 'server']).optional()
    }, async (args) => {
        if (args.token) sessionConfig.token = args.token;
        if (args.base_url) sessionConfig.baseUrl = normalizeBaseUrl(args.base_url);
        if (args.username) sessionConfig.username = args.username;
        if (args.deployment_mode) sessionConfig.deploymentMode = args.deployment_mode.toLowerCase();
        try {
            await confluenceRequest('get', 'user/current');
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, status: 'authenticated' }) }] };
        } catch (e) {
            return normalizeError(e);
        }
    });

    tool('confluence_list_spaces', ['confluence.listSpaces'], {}, async () => {
        try {
            const res = await confluenceRequest('get', 'space', undefined, { params: { limit: 25 } });
            return { content: [{ type: 'text', text: JSON.stringify(res.data.results) }] };
        } catch (e) { return normalizeError(e); }
    });

    tool('confluence_get_space_details', ['confluence.getSpace'], { space_key: z.string() }, async (args) => {
        try {
            const res = await confluenceRequest('get', `space/${args.space_key}`, undefined, { params: { expand: 'homepage' } });
            return { content: [{ type: 'text', text: JSON.stringify(res.data) }] };
        } catch (e) { return normalizeError(e); }
    });

    tool('confluence_get_page_by_title', ['confluence.getPageByTitle'], { space_key: z.string(), title: z.string() }, async (args) => {
        try {
            const cql = `space = "${args.space_key}" AND title = "${args.title}"`;
            const res = await confluenceRequest('get', 'content/search', undefined, { params: { cql, limit: 1 } });
            return { content: [{ type: 'text', text: JSON.stringify(res.data.results[0] || { error: 'Page not found' }) }] };
        } catch (e) { return normalizeError(e); }
    });

    tool('confluence_search', ['confluence.searchPages'], { cql: z.string() }, async (args) => {
        try {
            const res = await confluenceRequest('get', 'content/search', undefined, { params: { cql: args.cql, limit: 10 } });
            return { content: [{ type: 'text', text: JSON.stringify(res.data.results) }] };
        } catch (e) { return normalizeError(e); }
    });

    tool('confluence_get_page_content', ['confluence.getPage'], { page_id: z.string() }, async (args) => {
        try {
            const res = await confluenceRequest('get', `content/${args.page_id}`, undefined, { params: { expand: 'body.storage' } });
            return { content: [{ type: 'text', text: JSON.stringify(res.data) }] };
        } catch (e) { return normalizeError(e); }
    });

    // --- MUTATIONS ---
    tool('confluence_create_page', ['confluence.createPage'], {
        space_key: z.string(),
        title: z.string(),
        body: z.string().optional(),
        parent_id: z.string().optional(),
        ancestor_id: z.string().optional(),
        confirm: z.boolean().describe('Safety gate')
    }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
        try {
            const parentId = args.parent_id || args.ancestor_id;
            const payload = {
                title: args.title,
                type: 'page',
                space: { key: args.space_key },
                body: { storage: { value: args.body || '<p></p>', representation: 'storage' } }
            };
            if (parentId) payload.ancestors = [{ id: parentId }];
            const res = await confluenceRequest('post', 'content', payload);
            return { content: [{ type: 'text', text: JSON.stringify(res.data) }] };
        } catch (e) { return normalizeError(e); }
    });

    tool('confluence_update_page', ['confluence.updatePage'], {
        page_id: z.string(),
        title: z.string(),
        body: z.string(),
        version: z.number().optional(),
        confirm: z.boolean().describe('Safety gate')
    }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
        try {
            let nextVersion = args.version;
            if (!nextVersion) {
                const current = await confluenceRequest('get', `content/${args.page_id}`, undefined, { params: { expand: 'version' } });
                nextVersion = current.data.version.number + 1;
            }
            const payload = {
                id: args.page_id,
                type: 'page',
                title: args.title,
                version: { number: nextVersion },
                body: { storage: { value: args.body, representation: 'storage' } }
            };
            const res = await confluenceRequest('put', `content/${args.page_id}`, payload);
            return { content: [{ type: 'text', text: JSON.stringify(res.data) }] };
        } catch (e) { return normalizeError(e); }
    });

    tool('confluence_list_attachments', ['confluence.listAttachments'], { page_id: z.string() }, async (args) => {
        try {
            const res = await confluenceRequest('get', `content/${args.page_id}/child/attachment`);
            return { content: [{ type: 'text', text: JSON.stringify(res.data.results) }] };
        } catch (e) { return normalizeError(e); }
    });

    tool('confluence_attach_file', ['confluence.attachFile'], {
        page_id: z.string(),
        file_path: z.string(),
        comment: z.string().optional(),
        confirm: z.boolean().describe('Safety gate')
    }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
        try {
            if (!fs.existsSync(args.file_path)) throw new Error(`File not found: ${args.file_path}`);
            const form = new FormData();
            form.append('file', fs.createReadStream(args.file_path));
            if (args.comment) form.append('comment', args.comment);
            const res = await confluenceRequest('post', `content/${args.page_id}/child/attachment`, form, {
                headers: { ...form.getHeaders(), 'X-Atlassian-Token': 'nocheck' }
            });
            return { content: [{ type: 'text', text: JSON.stringify(res.data) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.__test = {
        sessionConfig,
        normalizeBaseUrl,
        apiPathCandidates,
        confluenceRequest,
        normalizeError,
        setConfig: (next) => { Object.assign(sessionConfig, next); },
        getConfig: () => ({ ...sessionConfig })
    };

    return server;
}

if (require.main === module) {
    const serverInstance = createConfluenceServer();
    const transport = new StdioServerTransport();
    serverInstance.connect(transport).catch((error) => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createConfluenceServer };
