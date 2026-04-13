const { createMongoServer } = require('../server');

describe('MongoDB MCP Schema Tests', () => {
    let server;

    beforeEach(() => { server = createMongoServer(); });

    const getSchema = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    it('mongo_connect requires uri and database', () => {
        const schema = getSchema('mongo_connect');
        expect(schema.safeParse({ uri: 'mongodb://localhost/test', database: 'test' }).success).toBe(true);
        expect(schema.safeParse({ uri: 'mongodb://localhost/test' }).success).toBe(false);
        expect(schema.safeParse({}).success).toBe(false);
    });

    it('mongo_find requires collection, limit defaults to 20', () => {
        const schema = getSchema('mongo_find');
        expect(schema.safeParse({ collection: 'users' }).success).toBe(true);
        expect(schema.safeParse({}).success).toBe(false);
        const result = schema.parse({ collection: 'users' });
        expect(result.limit).toBe(20);
    });

    it('mongo_find rejects limit > 500', () => {
        const schema = getSchema('mongo_find');
        expect(schema.safeParse({ collection: 'users', limit: 501 }).success).toBe(false);
    });

    it('mongo_count requires collection', () => {
        const schema = getSchema('mongo_count');
        expect(schema.safeParse({ collection: 'orders' }).success).toBe(true);
        expect(schema.safeParse({}).success).toBe(false);
    });

    it('mongo_aggregate requires collection and pipeline array', () => {
        const schema = getSchema('mongo_aggregate');
        expect(schema.safeParse({ collection: 'orders', pipeline: [{ $match: { status: 'active' } }] }).success).toBe(true);
        expect(schema.safeParse({ collection: 'orders', pipeline: 'bad' }).success).toBe(false);
    });

    it('mongo_insert_one requires collection, document, and confirm', () => {
        const schema = getSchema('mongo_insert_one');
        expect(schema.safeParse({ collection: 'users', document: { name: 'Alice' }, confirm: true }).success).toBe(true);
        expect(schema.safeParse({ collection: 'users', document: { name: 'Alice' } }).success).toBe(false);
    });

    it('mongo_update_one requires collection, filter, update, and confirm', () => {
        const schema = getSchema('mongo_update_one');
        expect(schema.safeParse({ collection: 'users', filter: { id: 1 }, update: { $set: { active: true } }, confirm: true }).success).toBe(true);
        expect(schema.safeParse({ collection: 'users', filter: { id: 1 }, update: { $set: {} } }).success).toBe(false);
    });

    it('mongo_delete_one requires collection, filter, and confirm', () => {
        const schema = getSchema('mongo_delete_one');
        expect(schema.safeParse({ collection: 'users', filter: { id: 1 }, confirm: true }).success).toBe(true);
        expect(schema.safeParse({ collection: 'users', filter: { id: 1 } }).success).toBe(false);
    });
});
