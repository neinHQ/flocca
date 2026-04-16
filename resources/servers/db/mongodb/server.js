const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { MongoClient } = require('mongodb');

const SERVER_INFO = { name: 'mongodb-mcp', version: '1.0.0' };

function createMongoServer() {
    let sessionConfig = {
        uri: process.env.MONGO_URI,
        database: process.env.MONGO_DATABASE
    };

    function normalizeError(err) {
        const msg = err.message || JSON.stringify(err);
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: msg, code: err.code || 'MONGO_ERROR' }) }] };
    }

    let mongoClient = null;
    let db = null;

    async function ensureConnected() {
        if (!db) {
            // Re-read env
            sessionConfig.uri = process.env.MONGO_URI || sessionConfig.uri;
            sessionConfig.database = process.env.MONGO_DATABASE || sessionConfig.database;

            if (sessionConfig.uri) {
                mongoClient = new MongoClient(sessionConfig.uri);
                await mongoClient.connect();
                db = mongoClient.db(sessionConfig.database);
            } else {
                throw new Error('Database not connected. Provide environment variables or call mongo_connect first.');
            }
        }
        return db;
    }

    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    // --- Core ---

    server.tool('mongo_connect',
        {
            uri: z.string().describe('MongoDB connection URI (mongodb://user:pass@host:27017/dbname)'),
            database: z.string().describe('Database name to use')
        },
        async (args) => {
            try {
                if (mongoClient) await mongoClient.close().catch(() => {});
                sessionConfig = { ...args };
                mongoClient = new MongoClient(args.uri);
                await mongoClient.connect();
                db = mongoClient.db(args.database);
                return { content: [{ type: 'text', text: `Successfully connected to MongoDB database '${args.database}'.` }] };
            } catch (e) {
                mongoClient = null; db = null;
                return normalizeError(e);
            }
        }
    );

    server.tool('mongo_health', {}, async () => {
        try {
            const d = await ensureConnected();
            await d.command({ ping: 1 });
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, connected: true }) }] };
        } catch (e) { return normalizeError(e); }
    });

    // --- Introspection ---

    server.tool('mongo_list_collections', {}, async () => {
        try {
            const d = await ensureConnected();
            const collections = await d.listCollections().toArray();
            return { content: [{ type: 'text', text: JSON.stringify(collections.map(c => c.name)) }] };
        } catch (e) { return normalizeError(e); }
    });

    // --- Read ---

    server.tool('mongo_find',
        {
            collection: z.string().describe('Collection name'),
            filter: z.object({}).catchall(z.any()).optional().describe('MongoDB filter object (default: {})'),
            projection: z.object({}).catchall(z.any()).optional().describe('Fields to include/exclude'),
            limit: z.number().int().min(1).max(500).default(20).describe('Max documents to return')
        },
        async (args) => {
            try {
                const d = await ensureConnected();
                const docs = await d.collection(args.collection)
                    .find(args.filter || {}, { projection: args.projection })
                    .limit(args.limit)
                    .toArray();
                return { content: [{ type: 'text', text: JSON.stringify({ count: docs.length, documents: docs }, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('mongo_count',
        {
            collection: z.string().describe('Collection name'),
            filter: z.object({}).catchall(z.any()).optional().describe('MongoDB filter object (default: {})')
        },
        async (args) => {
            try {
                const d = await ensureConnected();
                const count = await d.collection(args.collection).countDocuments(args.filter || {});
                return { content: [{ type: 'text', text: JSON.stringify({ collection: args.collection, count }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('mongo_aggregate',
        {
            collection: z.string().describe('Collection name'),
            pipeline: z.array(z.object({}).catchall(z.any())).describe('Aggregation pipeline stages'),
            limit: z.number().int().min(1).max(500).default(20)
        },
        async (args) => {
            try {
                const d = await ensureConnected();
                const stages = [...args.pipeline, { $limit: args.limit }];
                const results = await d.collection(args.collection).aggregate(stages).toArray();
                return { content: [{ type: 'text', text: JSON.stringify({ count: results.length, results }, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- Write (destructive — always require confirm) ---

    server.tool('mongo_insert_one',
        {
            collection: z.string(),
            document: z.object({}).catchall(z.any()).describe('Document to insert'),
            confirm: z.boolean().describe('Must be true to confirm write operation')
        },
        async (args) => {
            try {
                if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set 'confirm: true' to insert a document." }] };
                const d = await ensureConnected();
                const result = await d.collection(args.collection).insertOne(args.document);
                return { content: [{ type: 'text', text: JSON.stringify({ insertedId: result.insertedId }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('mongo_update_one',
        {
            collection: z.string(),
            filter: z.object({}).catchall(z.any()).describe('Filter to identify the document'),
            update: z.object({}).catchall(z.any()).describe('Update operators (e.g. { $set: { field: value } })'),
            confirm: z.boolean().describe('Must be true to confirm write operation')
        },
        async (args) => {
            try {
                if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set 'confirm: true' to update a document." }] };
                const d = await ensureConnected();
                const result = await d.collection(args.collection).updateOne(args.filter, args.update);
                return { content: [{ type: 'text', text: JSON.stringify({ matchedCount: result.matchedCount, modifiedCount: result.modifiedCount }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('mongo_delete_one',
        {
            collection: z.string(),
            filter: z.object({}).catchall(z.any()).describe('Filter to identify the document to delete'),
            confirm: z.boolean().describe('Must be true to confirm delete operation')
        },
        async (args) => {
            try {
                if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set 'confirm: true' to delete a document." }] };
                const d = await ensureConnected();
                const result = await d.collection(args.collection).deleteOne(args.filter);
                return { content: [{ type: 'text', text: JSON.stringify({ deletedCount: result.deletedCount }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.__test = {
        sessionConfig,
        normalizeError,
        ensureConnected,
        setConfig: (next) => { Object.assign(sessionConfig, next); db = null; },
        getConfig: () => ({ ...sessionConfig })
    };

    return server;
}

if (require.main === module) {
    const serverInstance = createMongoServer();
    const transport = new StdioServerTransport();
    serverInstance.connect(transport).then(() => {
        console.error('MongoDB MCP server running on stdio');
    }).catch((error) => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createMongoServer, MongoClient };
