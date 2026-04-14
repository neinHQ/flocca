const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { Client } = require('@elastic/elasticsearch');

const SERVER_INFO = { name: 'elastic-mcp-observability', version: '2.0.0' };

function normalizeError(err) {
    const msg = err.message || err.meta?.body?.error?.reason || JSON.stringify(err);
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: msg, code: err.meta?.statusCode || 'ELASTIC_ERROR' }) }] };
}

function createElasticServer() {
    let client = null;

    async function ensureConnected() {
        if (!client) {
            const node = process.env.ELASTIC_URL || process.env.ELASTIC_NODE;
            if (node) {
                const config = { node };
                if (process.env.ELASTIC_API_KEY) {
                    config.auth = { apiKey: process.env.ELASTIC_API_KEY };
                } else if (process.env.ELASTIC_USERNAME && process.env.ELASTIC_PASSWORD) {
                    config.auth = { username: process.env.ELASTIC_USERNAME, password: process.env.ELASTIC_PASSWORD };
                }
                client = new Client(config);
            } else {
                throw new Error('Elasticsearch not connected. Provide environment variables or call elastic_configure first.');
            }
        }
        return client;
    }

    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    // --- Core ---

    server.tool('elastic_health', {}, async () => {
        try {
            const c = await ensureConnected();
            const res = await c.cluster.health();
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, status: res.status, clusterName: res.cluster_name }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('elastic_configure',
        {
            url: z.string().describe('Elasticsearch URL'),
            api_key: z.string().optional().describe('API Key'),
            username: z.string().optional().describe('Basic Auth Username'),
            password: z.string().optional().describe('Basic Auth Password'),
            default_indices: z.array(z.string()).optional().describe('Default indices for search')
        },
        async (args) => {
            try {
                const config = { node: args.url };
                if (args.api_key) config.auth = { apiKey: args.api_key };
                else if (args.username && args.password) config.auth = { username: args.username, password: args.password };
                
                const newClient = new Client(config);
                await newClient.ping();
                client = newClient;
                return { content: [{ type: 'text', text: `Successfully configured and connected to ${args.url}.` }] };
            } catch (e) {
                return normalizeError(e);
            }
        }
    );

    // --- Introspection ---

    server.tool('elastic_list_indices',
        { pattern: z.string().default('*').describe('Index pattern to list') },
        async (args) => {
            try {
                const c = await ensureConnected();
                const res = await c.cat.indices({ index: args.pattern, format: 'json' });
                const indices = res.map(i => ({
                    name: i.index,
                    health: i.health,
                    status: i.status,
                    docs_count: parseInt(i['docs.count'] || '0', 10),
                    store_size: i['store.size']
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ indices }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('elastic_get_mappings',
        { index: z.string().describe('Index name to get mapping for') },
        async (args) => {
            try {
                const c = await ensureConnected();
                const res = await c.indices.getMapping({ index: args.index });
                return { content: [{ type: 'text', text: JSON.stringify(res[args.index]?.mappings || res, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- Observability & Logs ---

    server.tool('elastic_search_logs',
        {
            indices: z.array(z.string()).default(['*']).describe('Indices to search'),
            query_string: z.string().describe('Query string (e.g. "level:ERROR AND service:auth")'),
            from: z.string().optional().describe('ISO timestamp or relative (e.g. "now-1h")'),
            to: z.string().optional().describe('ISO timestamp or relative (e.g. "now")'),
            size: z.number().int().min(1).max(500).default(50).describe('Max results to return')
        },
        async (args) => {
            try {
                const c = await ensureConnected();
                const must = [{ query_string: { query: args.query_string } }];
                const filter = [];
                if (args.from || args.to) {
                    filter.push({ range: { '@timestamp': { gte: args.from, lte: args.to } } });
                }

                const res = await c.search({
                    index: (args.indices || ['*']).join(','),
                    body: {
                        query: { bool: { must, filter } },
                        size: args.size,
                        sort: [{ '@timestamp': { order: 'desc' } }]
                    }
                });

                const hits = res.hits.hits.map(h => ({
                    _index: h._index,
                    _id: h._id,
                    timestamp: h._source?.['@timestamp'],
                    source: h._source
                }));

                return { content: [{ type: 'text', text: JSON.stringify({ total: res.hits.total?.value || res.hits.total, count: hits.length, hits }, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('elastic_get_log_context',
        {
            index: z.string().describe('Index name'),
            id: z.string().describe('Document ID'),
            before: z.number().int().default(10).describe('Number of logs before'),
            after: z.number().int().default(10).describe('Number of logs after')
        },
        async (args) => {
            try {
                const c = await ensureConnected();
                const target = await c.get({ index: args.index, id: args.id });
                const ts = target._source?.['@timestamp'];
                if (!ts) throw new Error('Document does not have a @timestamp field');

                const [beforeRes, afterRes] = await Promise.all([
                    c.search({
                        index: args.index,
                        body: {
                            query: { range: { '@timestamp': { lt: ts } } },
                            sort: [{ '@timestamp': { order: 'desc' } }],
                            size: args.before
                        }
                    }),
                    c.search({
                        index: args.index,
                        body: {
                            query: { range: { '@timestamp': { gt: ts } } },
                            sort: [{ '@timestamp': { order: 'asc' } }],
                            size: args.after
                        }
                    })
                ]);

                const before = beforeRes.hits.hits.map(h => h._source).reverse();
                const after = afterRes.hits.hits.map(h => h._source);

                return { content: [{ type: 'text', text: JSON.stringify({ before, target: target._source, after }, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('elastic_find_recent_errors',
        {
            service: z.string().optional().describe('Specific service name to filter by'),
            lookback: z.string().default('1h').describe('Lookback duration (e.g. 1h, 15m)'),
            size: z.number().int().default(10)
        },
        async (args) => {
            try {
                const c = await ensureConnected();
                const must = [];
                if (args.service) must.push({ term: { 'service.name': args.service } });
                
                const filter = [
                    { range: { '@timestamp': { gte: `now-${args.lookback}` } } },
                    { terms: { 'log.level': ['error', 'ERROR', 'critical', 'CRITICAL', 'fatal', 'FATAL'] } }
                ];

                const res = await c.search({
                    index: '*',
                    body: {
                        query: { bool: { must, filter } },
                        sort: [{ '@timestamp': { order: 'desc' } }],
                        size: args.size
                    }
                });

                const hits = res.hits.hits.map(h => ({
                    timestamp: h._source?.['@timestamp'],
                    service: h._source?.service?.name || h._source?.service,
                    message: h._source?.message || h._source?.log?.message,
                    level: h._source?.log?.level || h._source?.level
                }));

                return { content: [{ type: 'text', text: JSON.stringify({ count: hits.length, errors: hits }, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- Advanced ---

    server.tool('elastic_search_structured',
        {
            indices: z.array(z.string()).default(['*']),
            body: z.object({}).catchall(z.any()).describe('Full Elasticsearch Search DSL body')
        },
        async (args) => {
            try {
                const c = await ensureConnected();
                const res = await c.search({
                    index: (args.indices || ['*']).join(','),
                    body: args.body
                });
                return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('elastic_aggregate',
        {
            indices: z.array(z.string()).default(['*']),
            aggs: z.object({}).catchall(z.any()).describe('Elasticsearch Aggregations DSL'),
            query: z.object({}).catchall(z.any()).optional().describe('Elasticsearch Query DSL')
        },
        async (args) => {
            try {
                const c = await ensureConnected();
                const res = await c.search({
                    index: (args.indices || ['*']).join(','),
                    body: {
                        query: args.query || { match_all: {} },
                        aggs: args.aggs,
                        size: 0 // Aggregations only
                    }
                });
                return { content: [{ type: 'text', text: JSON.stringify(res.aggregations, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    return server;
}

if (require.main === module) {
    const server = createElasticServer();
    const transport = new StdioServerTransport();
    server.connect(transport).then(() => {
        console.error('Elastic Observability MCP server running on stdio');
    }).catch((error) => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createElasticServer };
