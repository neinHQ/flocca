const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const SERVER_INFO = { name: 'figma-mcp', version: '2.0.0' };

let sessionConfig = {
    token: process.env.FIGMA_TOKEN || process.env.FIGMA_ACCESS_TOKEN,
    default_file_key: process.env.FIGMA_DEFAULT_FILE_KEY,
    proxy_url: process.env.FLOCCA_PROXY_URL,
    user_id: process.env.FLOCCA_USER_ID
};

function normalizeError(err) {
    const msg = err.message || JSON.stringify(err);
    const code = err.code || 'FIGMA_ERROR';
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { message: msg, code, status: err.http_status } }) }] };
}

async function figmaFetch(url, { query, method = 'GET', body } = {}) {
    let targetUrl = url;
    let reqHeaders = {};

    if (sessionConfig.proxy_url && sessionConfig.user_id) {
        const path = url.replace('https://api.figma.com', '');
        targetUrl = `${sessionConfig.proxy_url}${path}`;
        reqHeaders = {
            'Content-Type': 'application/json',
            'X-Flocca-User-ID': sessionConfig.user_id
        };
    } else {
        if (!sessionConfig.token) throw { message: 'Figma token not configured', code: 'AUTH_FAILED' };
        reqHeaders = { 'X-Figma-Token': sessionConfig.token };
    }

    const u = new URL(targetUrl);
    if (query) Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null) u.searchParams.append(k, v); });

    const resp = await fetch(u.toString(), {
        method,
        headers: reqHeaders,
        body: body ? JSON.stringify(body) : undefined
    });

    let data = {};
    try { data = await resp.json(); } catch (_) { data = {}; }

    if (!resp.ok || data.err) {
        let code = 'FIGMA_ERROR';
        if (resp.status === 401 || resp.status === 403) code = 'AUTH_FAILED';
        if (resp.status === 429) code = 'RATE_LIMITED';
        throw { message: data.err || resp.statusText || 'Figma request failed', code, http_status: resp.status };
    }
    return data;
}

// --- Extraction Logic ---

function flattenNodes(node, acc = []) {
    if (!node) return acc;
    acc.push(node);
    if (node.children) node.children.forEach((c) => flattenNodes(c, acc));
    return acc;
}

function isFrame(node) {
    return node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE';
}

function extractFrameSpec(frame) {
    const spec = { id: frame.id, name: frame.name, type: frame.type, inputs: [], buttons: [], toggles: [], texts: [], variants: frame.componentPropertyReferences || {}, components: [] };
    const nodes = flattenNodes(frame, []);
    nodes.forEach((n) => {
        if (n.type === 'TEXT' && n.characters) {
            spec.texts.push({ id: n.id, text: n.characters, name: n.name });
            if (/required|error|invalid|warning/i.test(n.characters)) {
                spec.components.push({ id: n.id, hint: 'validation_text', text: n.characters });
            }
        }
        if (n.type === 'FRAME' || n.type === 'GROUP' || n.type === 'INSTANCE' || n.type === 'COMPONENT') {
            if (/button|cta|submit/i.test(n.name)) spec.buttons.push({ id: n.id, name: n.name });
            if (/toggle|switch|checkbox/i.test(n.name)) spec.toggles.push({ id: n.id, name: n.name });
            if (/input|field|textbox|email|password/i.test(n.name)) spec.inputs.push({ id: n.id, name: n.name, placeholder: n.characters });
        }
    });
    return spec;
}

function suggestScenarios(frameSpec) {
    const scenarios = [];
    if (frameSpec.inputs.some((i) => /email/i.test(i.name || ''))) {
        scenarios.push('Email is required', 'Invalid email shows error');
    }
    if (frameSpec.buttons.length) {
        scenarios.push('Submit disabled until valid', 'Loading prevents double submit');
    }
    scenarios.push('Keyboard navigation works');
    return scenarios;
}

function generateSelectors(frameSpec) {
    const selectors = [];
    frameSpec.buttons.forEach((b) => selectors.push({ node_id: b.id, strategy: 'id', value: b.id }));
    frameSpec.inputs.forEach((i) => {
        selectors.push({ node_id: i.id, strategy: 'id', value: i.id });
        selectors.push({ node_id: i.id, strategy: 'name', value: i.name });
    });
    return selectors;
}

// --- Server Definition ---

function createFigmaServer() {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    async function ensureConnected() {
        if (!sessionConfig.token && !(sessionConfig.proxy_url && sessionConfig.user_id)) {
            // Re-check environment variables in case they were set after module load
            sessionConfig.token = process.env.FIGMA_TOKEN || process.env.FIGMA_ACCESS_TOKEN;
            sessionConfig.proxy_url = process.env.FLOCCA_PROXY_URL;
            sessionConfig.user_id = process.env.FLOCCA_USER_ID;
            
            if (!sessionConfig.token && !(sessionConfig.proxy_url && sessionConfig.user_id)) {
                throw { message: 'Figma not configured. Provide FIGMA_TOKEN or call figma_configure.', code: 'AUTH_FAILED' };
            }
        }
    }

    server.tool('figma_health', {}, async () => {
        try {
            await ensureConnected();
            const data = await figmaFetch('https://api.figma.com/v1/me');
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, user: data.user }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('figma_configure',
        {
            token: z.string().describe('Figma Personal Access Token'),
            default_file_key: z.string().optional().describe('Default file key to use')
        },
        async (args) => {
            try {
                sessionConfig.token = args.token;
                sessionConfig.default_file_key = args.default_file_key;
                const data = await figmaFetch('https://api.figma.com/v1/me');
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, user: data.user, message: "Successfully configured Figma." }) }] };
            } catch (e) {
                sessionConfig.token = undefined;
                return normalizeError(e);
            }
        }
    );

    server.tool('figma_get_file_metadata',
        { file_key: z.string().optional().describe('Figma file key') },
        async (args) => {
            try {
                await ensureConnected();
                const fileKey = args.file_key || sessionConfig.default_file_key;
                if (!fileKey) throw { message: 'file_key required', code: 'INVALID_REQUEST' };
                const data = await figmaFetch(`https://api.figma.com/v1/files/${fileKey}`);
                const pages = (data.document?.children || []).map((p) => ({ id: p.id, name: p.name, type: p.type }));
                return { content: [{ type: 'text', text: JSON.stringify({ name: data.name, lastModified: data.lastModified, pages, version: data.version }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('figma_find_frames',
        {
            file_key: z.string().optional(),
            query: z.string().describe('Frame name or partial name to find'),
            limit: z.number().default(50)
        },
        async (args) => {
            try {
                await ensureConnected();
                const fileKey = args.file_key || sessionConfig.default_file_key;
                if (!fileKey) throw { message: 'file_key required', code: 'INVALID_REQUEST' };
                const data = await figmaFetch(`https://api.figma.com/v1/files/${fileKey}`);
                const nodes = flattenNodes(data.document, []).filter(isFrame);
                const matches = nodes.filter((n) => n.name && n.name.toLowerCase().includes(args.query.toLowerCase())).slice(0, args.limit);
                return { content: [{ type: 'text', text: JSON.stringify({ frames: matches.map((m) => ({ id: m.id, name: m.name, type: m.type })) }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('figma_get_frame_spec',
        {
            file_key: z.string().optional(),
            node_id: z.string().describe('Node ID of the frame/component')
        },
        async (args) => {
            try {
                await ensureConnected();
                const fileKey = args.file_key || sessionConfig.default_file_key;
                if (!fileKey) throw { message: 'file_key required', code: 'INVALID_REQUEST' };
                const data = await figmaFetch(`https://api.figma.com/v1/files/${fileKey}/nodes`, { query: { ids: args.node_id } });
                const node = data.nodes?.[args.node_id]?.document;
                if (!node) throw { message: 'Node not found', code: 'NOT_FOUND' };
                if (!isFrame(node)) throw { message: 'Node is not a frame/component', code: 'INVALID_REQUEST' };
                const spec = extractFrameSpec(node);
                return { content: [{ type: 'text', text: JSON.stringify({ frame: spec }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('figma_suggest_test_scenarios',
        {
            file_key: z.string().optional(),
            node_id: z.string()
        },
        async (args) => {
            try {
                await ensureConnected();
                const fileKey = args.file_key || sessionConfig.default_file_key;
                if (!fileKey) throw { message: 'file_key required', code: 'INVALID_REQUEST' };
                const data = await figmaFetch(`https://api.figma.com/v1/files/${fileKey}/nodes`, { query: { ids: args.node_id } });
                const node = data.nodes?.[args.node_id]?.document;
                if (!node) throw { message: 'Node not found', code: 'NOT_FOUND' };
                const spec = extractFrameSpec(node);
                const scenarios = suggestScenarios(spec);
                return { content: [{ type: 'text', text: JSON.stringify({ scenarios }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('figma_export_frame_image',
        {
            file_key: z.string().optional(),
            node_id: z.string(),
            format: z.enum(['png', 'jpg', 'svg', 'pdf']).default('png'),
            scale: z.number().default(1)
        },
        async (args) => {
            try {
                await ensureConnected();
                const fileKey = args.file_key || sessionConfig.default_file_key;
                if (!fileKey) throw { message: 'file_key required', code: 'INVALID_REQUEST' };
                const data = await figmaFetch(`https://api.figma.com/v1/images/${fileKey}`, { 
                    query: { ids: args.node_id, format: args.format, scale: args.scale } 
                });
                return { content: [{ type: 'text', text: JSON.stringify({ images: data.images }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('figma_extract_design_tokens',
        { file_key: z.string().optional() },
        async (args) => {
            try {
                await ensureConnected();
                const fileKey = args.file_key || sessionConfig.default_file_key;
                if (!fileKey) throw { message: 'file_key required', code: 'INVALID_REQUEST' };
                const data = await figmaFetch(`https://api.figma.com/v1/files/${fileKey}`);
                const paints = data.styles ? Object.entries(data.styles).filter(([, v]) => v.styleType === 'FILL') : [];
                const texts = data.styles ? Object.entries(data.styles).filter(([, v]) => v.styleType === 'TEXT') : [];
                return { content: [{ type: 'text', text: JSON.stringify({ 
                    colors: paints.map(([id, v]) => ({ id, name: v.name, type: v.styleType })),
                    typography: texts.map(([id, v]) => ({ id, name: v.name, type: v.styleType }))
                }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    return server;
}

if (require.main === module) {
    const server = createFigmaServer();
    const transport = new StdioServerTransport();
    server.connect(transport).then(() => {
        console.error('Figma MCP server running on stdio');
    }).catch((error) => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createFigmaServer };
