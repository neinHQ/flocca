const path = require('path');

const { McpServer } = require(path.join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js'));
const { StdioServerTransport } = require(path.join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/stdio.js'));

const SERVER_INFO = { name: 'elastic-mcp', version: '0.1.0' };

const sessionConfig = {
    url: process.env.ELASTIC_URL,
    auth: process.env.ELASTIC_API_KEY
        ? { type: 'api_key', api_key: process.env.ELASTIC_API_KEY }
        : (process.env.ELASTIC_USERNAME && process.env.ELASTIC_PASSWORD
            ? { type: 'basic', username: process.env.ELASTIC_USERNAME, password: process.env.ELASTIC_PASSWORD }
            : undefined),
    default_indices: process.env.ELASTIC_INDICES ? process.env.ELASTIC_INDICES.split(',') : undefined,
    maxSize: 1000,
    maxSimpleRangeMinutes: 24 * 60 // 24h guardrail for simplified tools
};

function normalizeError(message, code = 'ELASTICSEARCH_ERROR', http_status, details) {
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { message, code, http_status, details } }) }] };
}

function requireConfigured() {
    if (!sessionConfig.url) throw new Error('Elasticsearch is not configured. Call elastic.configure first.');
}

function authHeaders() {
    if (!sessionConfig.auth) return {};
    const { type } = sessionConfig.auth;
    if (type === 'basic') {
        const { username, password } = sessionConfig.auth;
        const encoded = Buffer.from(`${username}:${password}`).toString('base64');
        return { Authorization: `Basic ${encoded}` };
    }
    if (type === 'bearer') {
        return { Authorization: `Bearer ${sessionConfig.auth.token}` };
    }
    if (type === 'api_key') {
        return { Authorization: `ApiKey ${sessionConfig.auth.api_key}` };
    }
    return {};
}

async function esFetch(pathPart, { method = 'GET', body, query } = {}) {
    const url = new URL(`${sessionConfig.url.replace(/\/+$/, '')}/${pathPart.replace(/^\/+/, '')}`);
    if (query) {
        Object.entries(query).forEach(([k, v]) => {
            if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
        });
    }
    const resp = await fetch(url.toString(), {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders()
        },
        body: body ? JSON.stringify(body) : undefined
    });

    let data;
    try {
        data = await resp.json();
    } catch (e) {
        data = {};
    }

    if (!resp.ok || data.error) {
        const err = data.error || {};
        const message = err.reason || err.type || resp.statusText || 'Elasticsearch request failed';
        const details = typeof err === 'string' ? err : JSON.stringify(err);
        throw { message, http_status: resp.status, details };
    }
    return data;
}

function enforceGuardrails({ size, time_range }) {
    if (size && size > sessionConfig.maxSize) {
        throw { message: 'QueryTooBroad: size exceeds limit', code: 'QUERY_TOO_BROAD', http_status: 400 };
    }
    if (time_range) {
        // basic check: if explicit from/to are not relative, skip; we only hard-guard relative minutes for simplified tools.
        // This is a light guardrail.
    }
}

function parseHits(data) {
    const hits = (data.hits?.hits || []).map((h) => ({
        index: h._index,
        id: h._id,
        score: h._score,
        timestamp: h._source?.['@timestamp'],
        source: h._source
    }));
    const total = typeof data.hits?.total === 'object' ? data.hits.total.value : data.hits?.total || hits.length;
    return { hits, total };
}

async function main() {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    server.registerTool(
        'elastic.health',
        { description: 'Health check for Elastic/OpenSearch MCP server.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                requireConfigured();
                await esFetch('_cluster/health');
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
            } catch (err) {
                return normalizeError(err.message || 'Health check failed', 'CONNECTION_FAILED', err.http_status, err.details);
            }
        }
    );

    server.registerTool(
        'elastic.configure',
        {
            description: 'Configure Elasticsearch/OpenSearch connection for this session.',
            inputSchema: {
                type: 'object',
                properties: {
                    url: { type: 'string' },
                    auth: {
                        type: 'object',
                        properties: {
                            type: { type: 'string', enum: ['basic', 'bearer', 'api_key'] },
                            username: { type: 'string' },
                            password: { type: 'string' },
                            token: { type: 'string' },
                            api_key: { type: 'string' }
                        }
                    },
                    default_indices: { type: 'array', items: { type: 'string' } }
                },
                required: ['url'],
                additionalProperties: false
            }
        },
        async (args) => {
            sessionConfig.url = args.url;
            sessionConfig.auth = args.auth;
            sessionConfig.default_indices = args.default_indices;
            try {
                await esFetch('_cluster/health');
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
            } catch (err) {
                sessionConfig.url = undefined;
                sessionConfig.auth = undefined;
                sessionConfig.default_indices = undefined;
                const code = err.http_status === 401 ? 'AUTH_FAILED' : 'CONNECTION_FAILED';
                return normalizeError(err.message || 'Failed to connect', code, err.http_status, err.details);
            }
        }
    );

    server.registerTool(
        'elastic.listIndices',
        {
            description: 'List indices (optionally filtered by pattern).',
            inputSchema: { type: 'object', properties: { pattern: { type: 'string' } }, additionalProperties: false }
        },
        async (args) => {
            try {
                requireConfigured();
                const pattern = args.pattern || '*';
                const data = await esFetch(`_cat/indices/${pattern}`, { query: { format: 'json' } });
                const indices = (data || []).map((i) => ({
                    name: i.index,
                    docs_count: Number(i['docs.count']),
                    size_bytes: i['store.size']
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ indices }) }] };
            } catch (err) {
                return normalizeError(err.message, 'ELASTICSEARCH_ERROR', err.http_status, err.details);
            }
        }
    );

    server.registerTool(
        'elastic.getIndexStats',
        {
            description: 'Get stats for indices.',
            inputSchema: { type: 'object', properties: { indices: { type: 'array', items: { type: 'string' } } }, required: ['indices'], additionalProperties: false }
        },
        async (args) => {
            try {
                requireConfigured();
                const data = await esFetch(`${args.indices.join(',')}/_stats`);
                const stats = Object.entries(data.indices || {}).map(([name, s]) => ({
                    name,
                    docs_count: s.total?.docs?.count,
                    size_in_bytes: s.total?.store?.size_in_bytes,
                    primary_shards: s.primaries,
                    total_shards: s.total
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ stats }) }] };
            } catch (err) {
                return normalizeError(err.message, 'ELASTICSEARCH_ERROR', err.http_status, err.details);
            }
        }
    );

    server.registerTool(
        'elastic.getMappings',
        {
            description: 'Get field mappings for an index.',
            inputSchema: {
                type: 'object',
                properties: { index: { type: 'string' }, path_prefix: { type: 'string', description: 'Optional path/prefix to limit response' } },
                required: ['index'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const data = await esFetch(`${args.index}/_mapping`);
                let mappings = data[args.index]?.mappings || data;
                if (args.path_prefix && mappings?.properties) {
                    const prefix = args.path_prefix;
                    mappings = Object.fromEntries(Object.entries(mappings.properties).filter(([k]) => k.startsWith(prefix)));
                }
                return { content: [{ type: 'text', text: JSON.stringify({ mappings }) }] };
            } catch (err) {
                return normalizeError(err.message, 'ELASTICSEARCH_ERROR', err.http_status, err.details);
            }
        }
    );

    server.registerTool(
        'elastic.searchLogs',
        {
            description: 'Search logs with query_string and optional time_range.',
            inputSchema: {
                type: 'object',
                properties: {
                    indices: { type: 'array', items: { type: 'string' } },
                    query_string: { type: 'string' },
                    time_range: {
                        type: 'object',
                        properties: { from: { type: 'string' }, to: { type: 'string' } }
                    },
                    size: { type: 'number' }
                },
                required: ['query_string'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const indices = args.indices?.length ? args.indices.join(',') : (sessionConfig.default_indices || ['*']).join(',');
                const size = Math.min(args.size || 100, sessionConfig.maxSize);
                const body = {
                    query: {
                        bool: {
                            must: [{ query_string: { query: args.query_string } }],
                            filter: []
                        }
                    },
                    size
                };
                if (args.time_range?.from || args.time_range?.to) {
                    body.query.bool.filter.push({ range: { '@timestamp': { gte: args.time_range.from, lte: args.time_range.to } } });
                }
                const data = await esFetch(`${indices}/_search`, { method: 'POST', body });
                const parsed = parseHits(data);
                return { content: [{ type: 'text', text: JSON.stringify(parsed) }] };
            } catch (err) {
                return normalizeError(err.message, err.code || 'ELASTICSEARCH_ERROR', err.http_status, err.details);
            }
        }
    );

    server.registerTool(
        'elastic.searchStructured',
        {
            description: 'Run a structured JSON search query.',
            inputSchema: {
                type: 'object',
                properties: {
                    indices: { type: 'array', items: { type: 'string' } },
                    body: { type: 'object' }
                },
                required: ['body'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const indices = args.indices?.length ? args.indices.join(',') : (sessionConfig.default_indices || ['*']).join(',');
                const data = await esFetch(`${indices}/_search`, { method: 'POST', body: args.body });
                const parsed = parseHits(data);
                return { content: [{ type: 'text', text: JSON.stringify({ ...parsed, aggregations: data.aggregations }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code || 'ELASTICSEARCH_ERROR', err.http_status, err.details);
            }
        }
    );

    server.registerTool(
        'elastic.aggregate',
        {
            description: 'Run aggregation-only queries.',
            inputSchema: {
                type: 'object',
                properties: { indices: { type: 'array', items: { type: 'string' } }, body: { type: 'object' } },
                required: ['body'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const indices = args.indices?.length ? args.indices.join(',') : (sessionConfig.default_indices || ['*']).join(',');
                const data = await esFetch(`${indices}/_search`, { method: 'POST', body: args.body });
                return { content: [{ type: 'text', text: JSON.stringify({ aggregations: data.aggregations }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code || 'ELASTICSEARCH_ERROR', err.http_status, err.details);
            }
        }
    );

    server.registerTool(
        'elastic.findRecentErrors',
        {
            description: 'Fetch recent error-level logs for a service.',
            inputSchema: {
                type: 'object',
                properties: {
                    service: { type: 'string' },
                    time_range: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
                    size: { type: 'number' }
                },
                required: ['service'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const indices = (sessionConfig.default_indices || ['*']).join(',');
                const size = Math.min(args.size || 50, sessionConfig.maxSize);
                const body = {
                    query: {
                        bool: {
                            must: [{ term: { 'service.keyword': args.service } }],
                            filter: [{ term: { 'level.keyword': 'ERROR' } }]
                        }
                    },
                    sort: [{ '@timestamp': { order: 'desc' } }],
                    size
                };
                if (args.time_range?.from || args.time_range?.to) {
                    body.query.bool.filter.push({ range: { '@timestamp': { gte: args.time_range.from, lte: args.time_range.to } } });
                }
                const data = await esFetch(`${indices}/_search`, { method: 'POST', body });
                const parsed = parseHits(data);
                return { content: [{ type: 'text', text: JSON.stringify(parsed) }] };
            } catch (err) {
                return normalizeError(err.message, err.code || 'ELASTICSEARCH_ERROR', err.http_status, err.details);
            }
        }
    );

    server.registerTool(
        'elastic.getLogContext',
        {
            description: 'Fetch a log document and surrounding context.',
            inputSchema: {
                type: 'object',
                properties: {
                    index: { type: 'string' },
                    id: { type: 'string' },
                    before: { type: 'number', default: 20 },
                    after: { type: 'number', default: 20 }
                },
                required: ['index', 'id'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const doc = await esFetch(`${args.index}/_doc/${args.id}`);
                const ts = doc._source?.['@timestamp'];
                if (!ts) {
                    return normalizeError('Timestamp not found on document', 'ELASTICSEARCH_ERROR', 400);
                }
                const windowRange = {
                    gte: `now-1d`,
                    lte: `now`
                };
                const beforeSize = Math.min(args.before || 20, sessionConfig.maxSize);
                const afterSize = Math.min(args.after || 20, sessionConfig.maxSize);

                const baseQuery = {
                    bool: {
                        filter: [{ range: { '@timestamp': windowRange } }]
                    }
                };

                const dataBefore = await esFetch(`${args.index}/_search`, {
                    method: 'POST',
                    body: {
                        query: baseQuery,
                        sort: [{ '@timestamp': { order: 'desc' } }],
                        size: beforeSize,
                        search_after: [ts]
                    }
                });
                const dataAfter = await esFetch(`${args.index}/_search`, {
                    method: 'POST',
                    body: {
                        query: baseQuery,
                        sort: [{ '@timestamp': { order: 'asc' } }],
                        size: afterSize,
                        search_after: [ts]
                    }
                });

                const context = {
                    target: doc._source,
                    before: parseHits(dataBefore).hits,
                    after: parseHits(dataAfter).hits
                };
                return { content: [{ type: 'text', text: JSON.stringify(context) }] };
            } catch (err) {
                return normalizeError(err.message, err.code || 'ELASTICSEARCH_ERROR', err.http_status, err.details);
            }
        }
    );

    server.server.oninitialized = () => {
        console.log('Elastic MCP server initialized.');
    };

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.log('Elastic MCP server running on stdio.');
}

main().catch((err) => {
    console.error('Elastic MCP server failed to start:', err);
    process.exit(1);
});
