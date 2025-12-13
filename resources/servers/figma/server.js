const path = require('path');

const { McpServer } = require(path.join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js'));
const { StdioServerTransport } = require(path.join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/stdio.js'));

const SERVER_INFO = { name: 'figma-mcp', version: '0.1.0' };

const sessionConfig = {
    token: undefined,
    default_file_key: undefined
};

const cache = {
    files: new Map(), // key -> { data, ts }
    nodes: new Map()  // `${fileKey}:${ids}` -> { data, ts }
};

const TTL_MS = 5 * 60 * 1000;
const PAYLOAD_LIMIT_NODES = 500;

function normalizeError(message, code = 'FIGMA_ERROR', details, http_status) {
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { message, code, details, http_status } }) }] };
}

function requireConfigured() {
    if (process.env.FLOCCA_PROXY_URL && process.env.FLOCCA_USER_ID) return; // Proxy Mode doesn't need local token
    if (!sessionConfig.token) {
        throw { message: 'Figma not configured. Call figma.configure first.', code: 'AUTH_FAILED' };
    }
}

function headers() {
    return {
        'X-Figma-Token': sessionConfig.token
    };
}

// Proxy Configuration
const PROXY_URL = process.env.FLOCCA_PROXY_URL;
const USER_ID = process.env.FLOCCA_USER_ID;

async function figmaFetch(url, { query, method = 'GET', body } = {}) {
    let targetUrl = url;
    let reqHeaders = headers();

    // PROXY MODE
    if (PROXY_URL && USER_ID) {
        // url is like https://api.figma.com/v1/files/...
        // we want PROXY_URL + /v1/files/...
        // assuming PROXY_URL = http://localhost:3000/proxy/figma
        const path = url.replace('https://api.figma.com', '');
        targetUrl = `${PROXY_URL}${path}`;
        reqHeaders = {
            'Content-Type': 'application/json',
            'X-Flocca-User-ID': USER_ID
        };
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
        throw { message: data.err || resp.statusText || 'Figma request failed', code, details: data, http_status: resp.status };
    }
    return data;
}

function getCached(map, key) {
    const hit = map.get(key);
    if (hit && Date.now() - hit.ts < TTL_MS) return hit.data;
    map.delete(key);
    return undefined;
}

class FigmaRestBackend {
    constructor(token) {
        this.token = token;
    }

    async validateAuth() {
        const data = await figmaFetch('https://api.figma.com/v1/me');
        return { user: data.user, scopes: data.scopes };
    }

    async getFile(fileKey) {
        const cacheKey = fileKey;
        const cached = getCached(cache.files, cacheKey);
        if (cached) return cached;
        const data = await figmaFetch(`https://api.figma.com/v1/files/${fileKey}`, { query: { geometry: 'paths' } });
        cache.files.set(cacheKey, { data, ts: Date.now() });
        return data;
    }

    async getNodes(fileKey, nodeIds) {
        const key = `${fileKey}:${nodeIds.sort().join(',')}`;
        const cached = getCached(cache.nodes, key);
        if (cached) return cached;
        const data = await figmaFetch(`https://api.figma.com/v1/files/${fileKey}/nodes`, { query: { ids: nodeIds.join(',') } });
        cache.nodes.set(key, { data, ts: Date.now() });
        return data;
    }

    async exportNodes(fileKey, nodeIds, opts) {
        const query = { ids: nodeIds.join(','), format: opts.format || 'png' };
        if (opts.scale) query.scale = opts.scale;
        if (opts.svg_include_id) query.svg_include_id = 'true';
        const data = await figmaFetch(`https://api.figma.com/v1/images/${fileKey}`, { query });
        return Object.entries(data.images || {}).map(([id, url]) => ({ id, url }));
    }

    async listVersions(fileKey) {
        const data = await figmaFetch(`https://api.figma.com/v1/files/${fileKey}/versions`);
        return data.versions || [];
    }
}

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
        if (n.type === 'RECTANGLE' || n.type === 'ELLIPSE') return;
        if (n.type === 'BOOLEAN_OPERATION') return;
        if (n.type === 'TEXT' && n.style?.textCase === 'UPPER') return;
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
        scenarios.push('Email is required');
        scenarios.push('Invalid email shows error');
    }
    if (frameSpec.buttons.length) {
        scenarios.push('Submit disabled until valid');
        scenarios.push('Loading prevents double submit');
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

async function main() {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    server.registerTool(
        'figma.configure',
        {
            description: 'Configure Figma MCP session.',
            inputSchema: {
                type: 'object',
                properties: {
                    auth: { type: 'object', properties: { type: { type: 'string', enum: ['pat'] }, token: { type: 'string' } }, required: ['type', 'token'] },
                    defaults: { type: 'object', properties: { file_key: { type: 'string' } } }
                },
                required: ['auth'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                sessionConfig.token = args.auth.token;
                sessionConfig.default_file_key = args.defaults?.file_key;
                const backend = new FigmaRestBackend(sessionConfig.token);
                const authCtx = await backend.validateAuth();
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, user: authCtx.user, scopes: authCtx.scopes }) }] };
            } catch (err) {
                sessionConfig.token = undefined;
                sessionConfig.default_file_key = undefined;
                return normalizeError(err.message, err.code || 'AUTH_FAILED', err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'figma.health',
        { description: 'Health check.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                requireConfigured();
                const backend = new FigmaRestBackend(sessionConfig.token);
                const authCtx = await backend.validateAuth();
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, user: authCtx.user }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'figma.getFileMetadata',
        { description: 'Get Figma file metadata.', inputSchema: { type: 'object', properties: { file_key: { type: 'string' } }, additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const fileKey = args.file_key || sessionConfig.default_file_key;
                if (!fileKey) throw { message: 'file_key required', code: 'INVALID_REQUEST' };
                const backend = new FigmaRestBackend(sessionConfig.token);
                const data = await backend.getFile(fileKey);
                const pages = (data.document?.children || []).map((p) => ({ id: p.id, name: p.name, type: p.type }));
                return { content: [{ type: 'text', text: JSON.stringify({ name: data.name, lastModified: data.lastModified, pages, version: data.version }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'figma.listPages',
        { description: 'List pages in a file.', inputSchema: { type: 'object', properties: { file_key: { type: 'string' } }, additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const fileKey = args.file_key || sessionConfig.default_file_key;
                if (!fileKey) throw { message: 'file_key required', code: 'INVALID_REQUEST' };
                const backend = new FigmaRestBackend(sessionConfig.token);
                const data = await backend.getFile(fileKey);
                const pages = (data.document?.children || []).map((p) => ({ id: p.id, name: p.name, type: p.type }));
                return { content: [{ type: 'text', text: JSON.stringify({ pages }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'figma.findFrames',
        { description: 'Find frames by name.', inputSchema: { type: 'object', properties: { file_key: { type: 'string' }, query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const fileKey = args.file_key || sessionConfig.default_file_key;
                if (!fileKey) throw { message: 'file_key required', code: 'INVALID_REQUEST' };
                const backend = new FigmaRestBackend(sessionConfig.token);
                const data = await backend.getFile(fileKey);
                const nodes = flattenNodes(data.document, []).filter(isFrame);
                const matches = nodes.filter((n) => n.name && n.name.toLowerCase().includes(args.query.toLowerCase())).slice(0, args.limit || 50);
                return { content: [{ type: 'text', text: JSON.stringify({ frames: matches.map((m) => ({ id: m.id, name: m.name, type: m.type })) }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'figma.getFrameSpec',
        { description: 'Return QA-friendly frame spec.', inputSchema: { type: 'object', properties: { file_key: { type: 'string' }, node_id: { type: 'string' } }, required: ['node_id'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const fileKey = args.file_key || sessionConfig.default_file_key;
                if (!fileKey) throw { message: 'file_key required', code: 'INVALID_REQUEST' };
                const backend = new FigmaRestBackend(sessionConfig.token);
                const data = await backend.getNodes(fileKey, [args.node_id]);
                const node = data.nodes?.[args.node_id]?.document;
                if (!node) throw { message: 'Node not found', code: 'NOT_FOUND' };
                if (!isFrame(node)) throw { message: 'Node is not a frame/component', code: 'INVALID_REQUEST' };
                const spec = extractFrameSpec(node);
                if (spec.inputs.length + spec.buttons.length + spec.toggles.length > PAYLOAD_LIMIT_NODES) {
                    return normalizeError('Payload too large', 'INVALID_REQUEST', { max: PAYLOAD_LIMIT_NODES });
                }
                return { content: [{ type: 'text', text: JSON.stringify({ frame: spec }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'figma.getComponentVariants',
        { description: 'List component variants.', inputSchema: { type: 'object', properties: { file_key: { type: 'string' }, node_id: { type: 'string' } }, required: ['node_id'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const fileKey = args.file_key || sessionConfig.default_file_key;
                if (!fileKey) throw { message: 'file_key required', code: 'INVALID_REQUEST' };
                const backend = new FigmaRestBackend(sessionConfig.token);
                const data = await backend.getNodes(fileKey, [args.node_id]);
                const node = data.nodes?.[args.node_id]?.document;
                if (!node || node.type !== 'COMPONENT_SET') throw { message: 'Not a component set', code: 'INVALID_REQUEST' };
                const variants = (node.children || []).map((c) => ({ id: c.id, name: c.name, properties: c.componentProperties }));
                return { content: [{ type: 'text', text: JSON.stringify({ variants }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'figma.extractDesignTokens',
        { description: 'Extract color/typography tokens.', inputSchema: { type: 'object', properties: { file_key: { type: 'string' } }, additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const fileKey = args.file_key || sessionConfig.default_file_key;
                if (!fileKey) throw { message: 'file_key required', code: 'INVALID_REQUEST' };
                const backend = new FigmaRestBackend(sessionConfig.token);
                const data = await backend.getFile(fileKey);
                const paints = data.styles ? Object.entries(data.styles).filter(([, v]) => v.styleType === 'FILL') : [];
                const texts = data.styles ? Object.entries(data.styles).filter(([, v]) => v.styleType === 'TEXT') : [];
                const colors = paints.map(([id, v]) => ({ id, name: v.name, type: v.styleType }));
                const typography = texts.map(([id, v]) => ({ id, name: v.name, type: v.styleType }));
                return { content: [{ type: 'text', text: JSON.stringify({ colors, typography }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'figma.suggestTestScenarios',
        { description: 'Suggest QA scenarios for a frame.', inputSchema: { type: 'object', properties: { file_key: { type: 'string' }, node_id: { type: 'string' } }, required: ['node_id'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const fileKey = args.file_key || sessionConfig.default_file_key;
                const backend = new FigmaRestBackend(sessionConfig.token);
                const data = await backend.getNodes(fileKey, [args.node_id]);
                const node = data.nodes?.[args.node_id]?.document;
                if (!node) throw { message: 'Node not found', code: 'NOT_FOUND' };
                const spec = extractFrameSpec(node);
                const scenarios = suggestScenarios(spec);
                return { content: [{ type: 'text', text: JSON.stringify({ scenarios }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'figma.generateStableSelectors',
        { description: 'Suggest selector strategies for Playwright.', inputSchema: { type: 'object', properties: { file_key: { type: 'string' }, node_id: { type: 'string' } }, required: ['node_id'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const fileKey = args.file_key || sessionConfig.default_file_key;
                const backend = new FigmaRestBackend(sessionConfig.token);
                const data = await backend.getNodes(fileKey, [args.node_id]);
                const node = data.nodes?.[args.node_id]?.document;
                if (!node) throw { message: 'Node not found', code: 'NOT_FOUND' };
                const spec = extractFrameSpec(node);
                const selectors = generateSelectors(spec);
                return { content: [{ type: 'text', text: JSON.stringify({ selectors }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'figma.exportFrameImage',
        { description: 'Export a frame as image.', inputSchema: { type: 'object', properties: { file_key: { type: 'string' }, node_id: { type: 'string' }, format: { type: 'string' }, scale: { type: 'number' } }, required: ['node_id'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const fileKey = args.file_key || sessionConfig.default_file_key;
                const backend = new FigmaRestBackend(sessionConfig.token);
                const imgs = await backend.exportNodes(fileKey, [args.node_id], { format: args.format, scale: args.scale });
                return { content: [{ type: 'text', text: JSON.stringify({ images: imgs }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'figma.exportNodeImagesBatch',
        { description: 'Batch export node images.', inputSchema: { type: 'object', properties: { file_key: { type: 'string' }, node_ids: { type: 'array', items: { type: 'string' } }, format: { type: 'string' }, scale: { type: 'number' } }, required: ['node_ids'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const fileKey = args.file_key || sessionConfig.default_file_key;
                if (args.node_ids.length > PAYLOAD_LIMIT_NODES) return normalizeError('Too many nodes requested', 'INVALID_REQUEST', { max: PAYLOAD_LIMIT_NODES });
                const backend = new FigmaRestBackend(sessionConfig.token);
                const imgs = await backend.exportNodes(fileKey, args.node_ids, { format: args.format, scale: args.scale });
                return { content: [{ type: 'text', text: JSON.stringify({ images: imgs }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'figma.diffVersions',
        { description: 'Diff two versions for changed nodes.', inputSchema: { type: 'object', properties: { file_key: { type: 'string' }, from_version: { type: 'string' }, to_version: { type: 'string' } }, required: ['from_version', 'to_version'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const fileKey = args.file_key || sessionConfig.default_file_key;
                const backend = new FigmaRestBackend(sessionConfig.token);
                const versions = await backend.listVersions(fileKey);
                const fromMeta = versions.find((v) => v.id === args.from_version);
                const toMeta = versions.find((v) => v.id === args.to_version);
                const summary = { from: fromMeta, to: toMeta, changes: ['Changed frames or components not computed (placeholder)'] };
                return { content: [{ type: 'text', text: JSON.stringify(summary) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.server.oninitialized = () => {
        console.log('Figma MCP server initialized.');
    };

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.log('Figma MCP server running on stdio.');
}

if (require.main === module) {
    main().catch((err) => {
        console.error('Figma MCP server failed to start:', err);
        process.exit(1);
    });
}

module.exports = { main };
