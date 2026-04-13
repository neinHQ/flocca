const { createElasticsearchServer } = require('../server');

describe('Elasticsearch MCP Schema Tests', () => {
    let server;

    beforeEach(() => { server = createElasticsearchServer(); });

    const getSchema = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    it('elastic_connect requires node', () => {
        const schema = getSchema('elastic_connect');
        expect(schema.safeParse({ node: 'https://localhost:9200' }).success).toBe(true);
        expect(schema.safeParse({}).success).toBe(false);
    });

    it('elastic_connect defaults tls_skip_verify to false', () => {
        const schema = getSchema('elastic_connect');
        expect(schema.parse({ node: 'https://localhost:9200' }).tls_skip_verify).toBe(false);
    });

    it('elastic_list_indices defaults pattern to *', () => {
        const schema = getSchema('elastic_list_indices');
        expect(schema.parse({}).pattern).toBe('*');
    });

    it('elastic_get_mapping requires index', () => {
        const schema = getSchema('elastic_get_mapping');
        expect(schema.safeParse({ index: 'my-index' }).success).toBe(true);
        expect(schema.safeParse({}).success).toBe(false);
    });

    it('elastic_search requires index and query DSL', () => {
        const schema = getSchema('elastic_search');
        expect(schema.safeParse({ index: 'logs', query: { match_all: {} } }).success).toBe(true);
        expect(schema.safeParse({ index: 'logs' }).success).toBe(false);
    });

    it('elastic_search defaults size to 10', () => {
        const schema = getSchema('elastic_search');
        expect(schema.parse({ index: 'logs', query: {} }).size).toBe(10);
    });

    it('elastic_search rejects size > 200', () => {
        const schema = getSchema('elastic_search');
        expect(schema.safeParse({ index: 'logs', query: {}, size: 201 }).success).toBe(false);
    });

    it('elastic_index_document requires index, document, and confirm', () => {
        const schema = getSchema('elastic_index_document');
        expect(schema.safeParse({ index: 'logs', document: { msg: 'hi' }, confirm: true }).success).toBe(true);
        expect(schema.safeParse({ index: 'logs', document: { msg: 'hi' } }).success).toBe(false);
    });

    it('elastic_delete_document requires index, id, and confirm', () => {
        const schema = getSchema('elastic_delete_document');
        expect(schema.safeParse({ index: 'logs', id: 'abc123', confirm: true }).success).toBe(true);
        expect(schema.safeParse({ index: 'logs', id: 'abc123' }).success).toBe(false);
    });
});
