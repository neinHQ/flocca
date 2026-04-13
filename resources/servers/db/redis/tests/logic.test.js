const { createRedisServer } = require('../server');

const mockRedis = {
    status: 'ready',
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    ping: jest.fn().mockResolvedValue('PONG'),
    get: jest.fn().mockResolvedValue('myvalue'),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(2),
    keys: jest.fn().mockResolvedValue(['user:1', 'user:2']),
    ttl: jest.fn().mockResolvedValue(120),
    expire: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    incrby: jest.fn().mockResolvedValue(5),
    lpush: jest.fn().mockResolvedValue(3),
    lrange: jest.fn().mockResolvedValue(['a', 'b', 'c']),
    hset: jest.fn().mockResolvedValue(2),
    hgetall: jest.fn().mockResolvedValue({ name: 'Alice', age: '30' }),
};

jest.mock('ioredis', () => jest.fn().mockImplementation(() => mockRedis));

describe('Redis MCP Logic Tests', () => {
    let server;

    beforeEach(() => {
        jest.clearAllMocks();
        server = createRedisServer();
    });

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.handler(args);
    };

    it('redis_connect creates a Redis instance and returns success', async () => {
        const res = await callTool('redis_connect', {});
        expect(res.content[0].text).toContain('Successfully connected');
        expect(mockRedis.connect).toHaveBeenCalled();
    });

    it('redis_health returns PONG response', async () => {
        await callTool('redis_connect', {});
        const res = await callTool('redis_health');
        const data = JSON.parse(res.content[0].text);
        expect(data.ok).toBe(true);
        expect(data.response).toBe('PONG');
    });

    it('redis_get retrieves value by key', async () => {
        await callTool('redis_connect', {});
        const res = await callTool('redis_get', { key: 'session:abc' });
        const data = JSON.parse(res.content[0].text);
        expect(data.value).toBe('myvalue');
        expect(mockRedis.get).toHaveBeenCalledWith('session:abc');
    });

    it('redis_set blocks without confirm', async () => {
        await callTool('redis_connect', {});
        const res = await callTool('redis_set', { key: 'k', value: 'v', confirm: false });
        expect(res.isError).toBe(true);
        expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
    });

    it('redis_set writes key with confirm: true', async () => {
        await callTool('redis_connect', {});
        const res = await callTool('redis_set', { key: 'mykey', value: 'hello', confirm: true });
        const data = JSON.parse(res.content[0].text);
        expect(data.ok).toBe(true);
        expect(mockRedis.set).toHaveBeenCalledWith('mykey', 'hello');
    });

    it('redis_set uses EX when ttl is provided', async () => {
        await callTool('redis_connect', {});
        await callTool('redis_set', { key: 'mykey', value: 'hello', ttl: 300, confirm: true });
        expect(mockRedis.set).toHaveBeenCalledWith('mykey', 'hello', 'EX', 300);
    });

    it('redis_del blocks without confirm', async () => {
        await callTool('redis_connect', {});
        const res = await callTool('redis_del', { keys: ['k1'], confirm: false });
        expect(res.isError).toBe(true);
    });

    it('redis_del deletes keys and returns count', async () => {
        await callTool('redis_connect', {});
        const res = await callTool('redis_del', { keys: ['k1', 'k2'], confirm: true });
        expect(JSON.parse(res.content[0].text).deletedCount).toBe(2);
    });

    it('redis_keys returns keys matching pattern', async () => {
        await callTool('redis_connect', {});
        const res = await callTool('redis_keys', { pattern: 'user:*' });
        const data = JSON.parse(res.content[0].text);
        expect(data.count).toBe(2);
        expect(data.keys).toContain('user:1');
    });

    it('redis_ttl returns remaining TTL', async () => {
        await callTool('redis_connect', {});
        const res = await callTool('redis_ttl', { key: 'session:1' });
        expect(JSON.parse(res.content[0].text).ttl).toBe(120);
    });

    it('redis_hgetall returns hash fields', async () => {
        await callTool('redis_connect', {});
        const res = await callTool('redis_hgetall', { key: 'user:1' });
        const data = JSON.parse(res.content[0].text);
        expect(data.fields.name).toBe('Alice');
    });

    it('returns isError when not connected', async () => {
        const res = await callTool('redis_health');
        expect(res.isError).toBe(true);
    });
});
