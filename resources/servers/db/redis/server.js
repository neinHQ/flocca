const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const Redis = require('ioredis');

const SERVER_INFO = { name: 'redis-mcp', version: '1.0.0' };

function normalizeError(err) {
    const msg = err.message || JSON.stringify(err);
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: msg, code: err.code || 'REDIS_ERROR' }) }] };
}

function createRedisServer() {
    let redis = null;

    async function ensureConnected() {
        if (!redis || redis.status === 'end') {
            const host = process.env.REDIS_HOST;
            if (host) {
                redis = new Redis({
                    host: host,
                    port: parseInt(process.env.REDIS_PORT || '6379', 10),
                    password: process.env.REDIS_PASSWORD || undefined,
                    db: parseInt(process.env.REDIS_DB || '0', 10),
                    lazyConnect: true
                });
                await redis.connect();
            } else {
                throw new Error('Redis not connected. Provide environment variables or call redis_connect first.');
            }
        }
        return redis;
    }

    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    // --- Core ---

    server.tool('redis_connect',
        {
            host: z.string().default('localhost').describe('Redis host'),
            port: z.number().int().default(6379).describe('Redis port'),
            password: z.string().optional().describe('Redis password (if AUTH required)'),
            db: z.number().int().min(0).max(15).default(0).describe('Redis database index (0-15)')
        },
        async (args) => {
            try {
                if (redis) redis.disconnect();
                redis = new Redis({ host: args.host, port: args.port, password: args.password, db: args.db, lazyConnect: true });
                await redis.connect();
                return { content: [{ type: 'text', text: `Successfully connected to Redis at ${args.host}:${args.port} db=${args.db}.` }] };
            } catch (e) {
                redis = null;
                return normalizeError(e);
            }
        }
    );

    server.tool('redis_health', {}, async () => {
        try {
            const r = await ensureConnected();
            const pong = await r.ping();
            return { content: [{ type: 'text', text: JSON.stringify({ ok: pong === 'PONG', response: pong }) }] };
        } catch (e) { return normalizeError(e); }
    });

    // --- Key-Value ---

    server.tool('redis_get',
        { key: z.string().describe('Key to retrieve') },
        async (args) => {
            try {
                const r = await ensureConnected();
                const value = await r.get(args.key);
                return { content: [{ type: 'text', text: JSON.stringify({ key: args.key, value }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('redis_set',
        {
            key: z.string(),
            value: z.string(),
            ttl: z.number().int().positive().optional().describe('Time-to-live in seconds'),
            confirm: z.boolean().describe('Must be true to write')
        },
        async (args) => {
            try {
                if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set 'confirm: true' to write a key." }] };
                const r = await ensureConnected();
                const result = args.ttl ? await r.set(args.key, args.value, 'EX', args.ttl) : await r.set(args.key, args.value);
                return { content: [{ type: 'text', text: JSON.stringify({ ok: result === 'OK', key: args.key }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('redis_del',
        {
            keys: z.array(z.string()).min(1).describe('Keys to delete'),
            confirm: z.boolean().describe('Must be true to delete')
        },
        async (args) => {
            try {
                if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set 'confirm: true' to delete keys." }] };
                const r = await ensureConnected();
                const count = await r.del(...args.keys);
                return { content: [{ type: 'text', text: JSON.stringify({ deletedCount: count }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('redis_keys',
        { pattern: z.string().default('*').describe('Key pattern (e.g. "user:*")') },
        async (args) => {
            try {
                const r = await ensureConnected();
                const keys = await r.keys(args.pattern);
                return { content: [{ type: 'text', text: JSON.stringify({ pattern: args.pattern, count: keys.length, keys }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('redis_ttl',
        { key: z.string() },
        async (args) => {
            try {
                const r = await ensureConnected();
                const ttl = await r.ttl(args.key);
                return { content: [{ type: 'text', text: JSON.stringify({ key: args.key, ttl, note: ttl === -1 ? 'no expiry' : ttl === -2 ? 'key does not exist' : `${ttl}s remaining` }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('redis_expire',
        {
            key: z.string(),
            ttl: z.number().int().positive().describe('Expiry in seconds'),
            confirm: z.boolean().describe('Must be true to set TTL')
        },
        async (args) => {
            try {
                if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set 'confirm: true' to update TTL." }] };
                const r = await ensureConnected();
                const result = await r.expire(args.key, args.ttl);
                return { content: [{ type: 'text', text: JSON.stringify({ key: args.key, applied: result === 1 }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('redis_incr',
        { key: z.string().describe('Key to increment'), by: z.number().int().default(1).describe('Amount to increment by') },
        async (args) => {
            try {
                const r = await ensureConnected();
                const newVal = args.by === 1 ? await r.incr(args.key) : await r.incrby(args.key, args.by);
                return { content: [{ type: 'text', text: JSON.stringify({ key: args.key, newValue: newVal }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- List ---

    server.tool('redis_lpush',
        {
            key: z.string(),
            values: z.array(z.string()).min(1),
            confirm: z.boolean().describe('Must be true to write')
        },
        async (args) => {
            try {
                if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set 'confirm: true' to push to a list." }] };
                const r = await ensureConnected();
                const len = await r.lpush(args.key, ...args.values);
                return { content: [{ type: 'text', text: JSON.stringify({ key: args.key, listLength: len }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('redis_lrange',
        {
            key: z.string(),
            start: z.number().int().default(0),
            stop: z.number().int().default(-1)
        },
        async (args) => {
            try {
                const r = await ensureConnected();
                const items = await r.lrange(args.key, args.start, args.stop);
                return { content: [{ type: 'text', text: JSON.stringify({ key: args.key, items }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- Hash ---

    server.tool('redis_hset',
        {
            key: z.string(),
            fields: z.object({}).catchall(z.string()).describe('Hash field/value pairs to set'),
            confirm: z.boolean().describe('Must be true to write')
        },
        async (args) => {
            try {
                if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set 'confirm: true' to set hash fields." }] };
                const r = await ensureConnected();
                const flatFields = Object.entries(args.fields).flat();
                const count = await r.hset(args.key, ...flatFields);
                return { content: [{ type: 'text', text: JSON.stringify({ key: args.key, fieldsSet: count }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('redis_hgetall',
        { key: z.string() },
        async (args) => {
            try {
                const r = await ensureConnected();
                const hash = await r.hgetall(args.key);
                return { content: [{ type: 'text', text: JSON.stringify({ key: args.key, fields: hash }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    return server;
}

if (require.main === module) {
    const server = createRedisServer();
    const transport = new StdioServerTransport();
    server.connect(transport).then(() => {
        console.error('Redis MCP server running on stdio');
    }).catch((error) => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createRedisServer, Redis };
