const axios = require('axios');
const z = require('zod');
const fs = require('fs');
const FormData = require('form-data');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const SERVER_INFO = { name: 'confluence-mcp', version: '2.0.0' };

function createConfluenceServer() {
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
        const bearerCandidate = { ...baseHeaders, 'Authorization': `Bearer ${config.token}` };
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

    async function confluenceRequest(method, pathPart, body, options = {}) {
        let lastError;
        const headerCandidates = getHeaderCandidates();
        const paths = apiPathCandidates(pathPart);

        for (const apiPath of paths) {
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
        token: z.string(),
        base_url: z.string(),
        deployment_mode: z.string().optional()
    }, async (args) => {
        config.token = args.token;
        config.baseUrl = normalizeBaseUrl(args.base_url);
        if (args.deployment_mode) config.deploymentMode = args.deployment_mode.toLowerCase();
        if (args.username) config.username = args.username;
        try {
            await confluenceRequest('get', 'user/current');
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, status: 'authenticated' }) }] };
        } catch (e) {
            config.token = undefined;
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

    return {
        server,
        __test: {
            normalizeBaseUrl,
            apiPathCandidates,
            confluenceRequest,
            normalizeError,
            setConfig: (next) => { config = { ...config, ...next }; },
            getConfig: () => ({ ...config })
        }
    };
}

const { server, __test } = createConfluenceServer();

if (require.main === module) {
    const transport = new StdioServerTransport();
    server.connect(transport).catch(console.error);
}

module.exports = {
    main: async () => server,
    createConfluenceServer,
    __test
};
