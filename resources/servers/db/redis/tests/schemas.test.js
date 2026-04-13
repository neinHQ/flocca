const { createRedisServer } = require('../server');

describe('Redis MCP Schema Tests', () => {
    let server;

    beforeEach(() => { server = createRedisServer(); });

    const getSchema = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    it('redis_connect has all optional params with defaults', () => {
        const schema = getSchema('redis_connect');
        const result = schema.parse({});
        expect(result.host).toBe('localhost');
        expect(result.port).toBe(6379);
        expect(result.db).toBe(0);
    });

    it('redis_connect rejects db > 15', () => {
        const schema = getSchema('redis_connect');
        expect(schema.safeParse({ db: 16 }).success).toBe(false);
    });

    it('redis_get requires key', () => {
        const schema = getSchema('redis_get');
        expect(schema.safeParse({ key: 'mykey' }).success).toBe(true);
        expect(schema.safeParse({}).success).toBe(false);
    });

    it('redis_set requires key, value, confirm', () => {
        const schema = getSchema('redis_set');
        expect(schema.safeParse({ key: 'k', value: 'v', confirm: true }).success).toBe(true);
        expect(schema.safeParse({ key: 'k', value: 'v' }).success).toBe(false);
    });

    it('redis_set accepts optional ttl', () => {
        const schema = getSchema('redis_set');
        expect(schema.safeParse({ key: 'k', value: 'v', confirm: true, ttl: 60 }).success).toBe(true);
    });

    it('redis_del requires at least one key and confirm', () => {
        const schema = getSchema('redis_del');
        expect(schema.safeParse({ keys: ['k1', 'k2'], confirm: true }).success).toBe(true);
        expect(schema.safeParse({ keys: [], confirm: true }).success).toBe(false);
        expect(schema.safeParse({ keys: ['k1'] }).success).toBe(false);
    });

    it('redis_keys defaults pattern to *', () => {
        const schema = getSchema('redis_keys');
        expect(schema.parse({}).pattern).toBe('*');
    });

    it('redis_lpush requires key, values array, and confirm', () => {
        const schema = getSchema('redis_lpush');
        expect(schema.safeParse({ key: 'list', values: ['a'], confirm: true }).success).toBe(true);
        expect(schema.safeParse({ key: 'list', values: [], confirm: true }).success).toBe(false);
    });

    it('redis_hset requires key, fields object, and confirm', () => {
        const schema = getSchema('redis_hset');
        expect(schema.safeParse({ key: 'myhash', fields: { name: 'Alice' }, confirm: true }).success).toBe(true);
        expect(schema.safeParse({ key: 'myhash', fields: { name: 'Alice' } }).success).toBe(false);
    });
});
