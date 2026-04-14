const { createElasticServer } = require('../server');

describe('Elastic Observability MCP Schema Validation', () => {
    let server;

    beforeEach(() => {
        server = createElasticServer();
    });

    const getValidator = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    describe('elastic_search_logs', () => {
        it('should require query_string', () => {
            const schema = getValidator('elastic_search_logs');
            expect(schema.safeParse({ query_string: 'error' }).success).toBe(true);
            expect(schema.safeParse({}).success).toBe(false);
        });

        it('should have defaults for indices and size', () => {
            const schema = getValidator('elastic_search_logs');
            const result = schema.parse({ query_string: 'test' });
            expect(result.indices).toEqual(['*']);
            expect(result.size).toBe(50);
        });
    });

    describe('elastic_find_recent_errors', () => {
        it('should use default lookback', () => {
            const schema = getValidator('elastic_find_recent_errors');
            const result = schema.parse({});
            expect(result.lookback).toBe('1h');
            expect(result.size).toBe(10);
        });
    });

    describe('elastic_search_structured', () => {
        it('should accept complex bodies', () => {
            const schema = getValidator('elastic_search_structured');
            const body = { query: { match_all: {} }, aggs: { by_service: { terms: { field: 'service.name' } } } };
            expect(schema.safeParse({ body }).success).toBe(true);
        });
    });
});
