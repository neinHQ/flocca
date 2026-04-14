const { createPrometheusServer } = require('../server');

describe('Prometheus MCP Schema Validation', () => {
    let server;

    beforeEach(() => {
        server = createPrometheusServer();
    });

    const getValidator = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    describe('prometheus_query', () => {
        it('should require query', () => {
            const schema = getValidator('prometheus_query');
            expect(schema.safeParse({ query: 'up' }).success).toBe(true);
            expect(schema.safeParse({}).success).toBe(false);
        });
    });

    describe('prometheus_query_range', () => {
        it('should require query, start, end, and step', () => {
            const schema = getValidator('prometheus_query_range');
            const valid = { query: 'up', start: '2023-01-01T00:00:00Z', end: '2023-01-01T01:00:00Z', step: '15s' };
            expect(schema.safeParse(valid).success).toBe(true);
            expect(schema.safeParse({ query: 'up' }).success).toBe(false);
        });
    });
});
