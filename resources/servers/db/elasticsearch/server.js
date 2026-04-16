const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { Client } = require('@elastic/elasticsearch');

const SERVER_INFO = { name: 'elasticsearch-mcp', version: '1.0.0' };

function createElasticsearchServer() {
    let sessionConfig = {
        node: process.env.ELASTIC_NODE,
        apiKey: process.env.ELASTIC_API_KEY,
        username: process.env.ELASTIC_USERNAME,
        password: process.env.ELASTIC_PASSWORD,
        tlsSkipVerify: process.env.ELASTIC_TLS_SKIP_VERIFY === 'true'
    };

    function normalizeError(err) {
        const msg = err.message || err.meta?.body?.error?.reason || JSON.stringify(err);
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: msg, code: err.meta?.statusCode || 'ELASTIC_ERROR' }) }] };
    }

    let esClient = null;

    async function ensureConnected() {
        if (!esClient) {
            // Re-read env
            sessionConfig.node = process.env.ELASTIC_NODE || sessionConfig.node;
            sessionConfig.apiKey = process.env.ELASTIC_API_KEY || sessionConfig.apiKey;
            sessionConfig.username = process.env.ELASTIC_USERNAME || sessionConfig.username;
            sessionConfig.password = process.env.ELASTIC_PASSWORD || sessionConfig.password;

            if (sessionConfig.node) {
                const config = { node: sessionConfig.node };
                if (sessionConfig.apiKey) {
                    config.auth = { apiKey: sessionConfig.apiKey };
                } else if (sessionConfig.username) {
                    config.auth = { username: sessionConfig.username, password: sessionConfig.password };
                }
                if (sessionConfig.tlsSkipVerify) {
                    config.tls = { rejectUnauthorized: false };
                }
                esClient = new Client(config);
            } else {
                throw new Error('Elasticsearch not connected. Provide environment variables or call elastic_connect first.');
            }
        }
        return esClient;
    }

    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    // --- Core ---

    server.tool('elastic_connect',
        {
            node: z.string().describe('Elasticsearch node URL (e.g. https://localhost:9200)'),
            api_key: z.string().optional().describe('API key for authentication'),
            username: z.string().optional().describe('Basic auth username'),
            password: z.string().optional().describe('Basic auth password'),
            tls_skip_verify: z.boolean().default(false).describe('Skip TLS certificate verification (dev only)')
        },
        async (args) => {
            try {
                sessionConfig = {
                    node: args.node,
                    apiKey: args.api_key,
                    username: args.username,
                    password: args.password,
                    tlsSkipVerify: args.tls_skip_verify
                };
                const config = { node: args.node };
                if (args.api_key) {
                    config.auth = { apiKey: args.api_key };
                } else if (args.username && args.password) {
                    config.auth = { username: args.username, password: args.password };
                }
                if (args.tls_skip_verify) {
                    config.tls = { rejectUnauthorized: false };
                }
                esClient = new Client(config);
                await esClient.ping();
                return { content: [{ type: 'text', text: `Successfully connected to Elasticsearch at ${args.node}.` }] };
            } catch (e) {
                esClient = null;
                return normalizeError(e);
            }
        }
    );

    server.tool('elastic_health', {}, async () => {
        try {
            const c = await ensureConnected();
            const res = await c.cluster.health();
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, status: res.status, clusterName: res.cluster_name }) }] };
        } catch (e) { return normalizeError(e); }
    });

    // --- Index Introspection ---

    server.tool('elastic_list_indices',
        { pattern: z.string().default('*').describe('Index pattern to list (e.g. "logs-*")') },
        async (args) => {
            try {
                const c = await ensureConnected();
                const res = await c.cat.indices({ index: args.pattern, format: 'json' });
                const indices = res.map(i => ({ index: i.index, health: i.health, docsCount: i['docs.count'], storeSize: i['store.size'] }));
                return { content: [{ type: 'text', text: JSON.stringify(indices, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('elastic_get_mapping',
        { index: z.string().describe('Index name to get mapping for') },
        async (args) => {
            try {
                const c = await ensureConnected();
                const res = await c.indices.getMapping({ index: args.index });
                return { content: [{ type: 'text', text: JSON.stringify(res[args.index]?.mappings || res, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- Search ---

    server.tool('elastic_search',
        {
            index: z.string().describe('Index name (or comma-separated list)'),
            query: z.object({}).catchall(z.any()).describe('Elasticsearch query DSL body (e.g. { match: { field: "value" } })'),
            size: z.number().int().min(1).max(200).default(10).describe('Max results to return'),
            from: z.number().int().min(0).default(0).describe('Offset for pagination'),
            sort: z.array(z.object({}).catchall(z.any())).optional().describe('Sort order array')
        },
        async (args) => {
            try {
                const c = await ensureConnected();
                const res = await c.search({
                    index: args.index,
                    body: { query: args.query, size: args.size, from: args.from, sort: args.sort }
                });
                const hits = res.hits;
                return { content: [{ type: 'text', text: JSON.stringify({ total: hits.total?.value ?? hits.total, hits: hits.hits.map(h => ({ _id: h._id, _score: h._score, ...h._source })) }, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- Write ---

    server.tool('elastic_index_document',
        {
            index: z.string(),
            document: z.object({}).catchall(z.any()).describe('Document body to index'),
            id: z.string().optional().describe('Optional document ID (auto-generated if omitted)'),
            confirm: z.boolean().describe('Must be true to write')
        },
        async (args) => {
            try {
                if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set 'confirm: true' to index a document." }] };
                const c = await ensureConnected();
                const res = await c.index({ index: args.index, id: args.id, document: args.document });
                return { content: [{ type: 'text', text: JSON.stringify({ _id: res._id, result: res.result }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('elastic_delete_document',
        {
            index: z.string(),
            id: z.string().describe('Document ID to delete'),
            confirm: z.boolean().describe('Must be true to delete')
        },
        async (args) => {
            try {
                if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set 'confirm: true' to delete a document." }] };
                const c = await ensureConnected();
                const res = await c.delete({ index: args.index, id: args.id });
                return { content: [{ type: 'text', text: JSON.stringify({ _id: res._id, result: res.result }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.__test = {
        sessionConfig,
        normalizeError,
        ensureConnected,
        setConfig: (next) => { Object.assign(sessionConfig, next); esClient = null; },
        getConfig: () => ({ ...sessionConfig })
    };

    return server;
}

if (require.main === module) {
    const serverInstance = createElasticsearchServer();
    const transport = new StdioServerTransport();
    serverInstance.connect(transport).then(() => {
        console.error('Elasticsearch MCP server running on stdio');
    }).catch((error) => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createElasticsearchServer, Client };
