const { createMongoServer } = require('../server');

const mockDb = {
    command: jest.fn().mockResolvedValue({ ok: 1 }),
    listCollections: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([{ name: 'users' }, { name: 'orders' }]) }),
    collection: jest.fn().mockReturnValue({
        find: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }) }),
        countDocuments: jest.fn().mockResolvedValue(42),
        aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
        insertOne: jest.fn().mockResolvedValue({ insertedId: 'abc123' }),
        updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
        deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    }),
};

const mockMongoClient = {
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    db: jest.fn().mockReturnValue(mockDb),
};

jest.mock('mongodb', () => ({
    MongoClient: jest.fn().mockImplementation(() => mockMongoClient)
}));

describe('MongoDB MCP Logic Tests', () => {
    let server;
    const { MongoClient } = require('mongodb');

    beforeEach(() => {
        jest.clearAllMocks();
        server = createMongoServer();
    });

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.handler(args);
    };

    it('mongo_connect creates a MongoClient and returns success', async () => {
        const res = await callTool('mongo_connect', { uri: 'mongodb://localhost/test', database: 'test' });
        expect(res.content[0].text).toContain('Successfully connected');
        expect(MongoClient).toHaveBeenCalled();
        expect(mockMongoClient.connect).toHaveBeenCalled();
    });

    it('mongo_health pings the database', async () => {
        await callTool('mongo_connect', { uri: 'mongodb://localhost/test', database: 'test' });
        const res = await callTool('mongo_health');
        expect(JSON.parse(res.content[0].text).ok).toBe(true);
        expect(mockDb.command).toHaveBeenCalledWith({ ping: 1 });
    });

    it('mongo_list_collections returns collection names', async () => {
        await callTool('mongo_connect', { uri: 'mongodb://localhost/test', database: 'test' });
        const res = await callTool('mongo_list_collections');
        const data = JSON.parse(res.content[0].text);
        expect(data).toContain('users');
        expect(data).toContain('orders');
    });

    it('mongo_find calls find with filter and limit', async () => {
        await callTool('mongo_connect', { uri: 'mongodb://localhost/test', database: 'test' });
        await callTool('mongo_find', { collection: 'users', filter: { active: true }, limit: 5 });
        expect(mockDb.collection).toHaveBeenCalledWith('users');
    });

    it('mongo_count returns document count', async () => {
        await callTool('mongo_connect', { uri: 'mongodb://localhost/test', database: 'test' });
        const res = await callTool('mongo_count', { collection: 'users' });
        const data = JSON.parse(res.content[0].text);
        expect(data.count).toBe(42);
    });

    it('mongo_insert_one requires confirm: true', async () => {
        await callTool('mongo_connect', { uri: 'mongodb://localhost/test', database: 'test' });
        const blocked = await callTool('mongo_insert_one', { collection: 'users', document: { name: 'Alice' }, confirm: false });
        expect(blocked.isError).toBe(true);
        const allowed = await callTool('mongo_insert_one', { collection: 'users', document: { name: 'Alice' }, confirm: true });
        expect(JSON.parse(allowed.content[0].text).insertedId).toBe('abc123');
    });

    it('mongo_delete_one requires confirm: true', async () => {
        await callTool('mongo_connect', { uri: 'mongodb://localhost/test', database: 'test' });
        const blocked = await callTool('mongo_delete_one', { collection: 'users', filter: { id: 1 }, confirm: false });
        expect(blocked.isError).toBe(true);
    });

    it('returns isError when not connected', async () => {
        const res = await callTool('mongo_health');
        expect(res.isError).toBe(true);
    });
});
