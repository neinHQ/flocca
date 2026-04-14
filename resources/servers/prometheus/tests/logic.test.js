const { createPrometheusServer } = require('../server');

// Mock global fetch
global.fetch = jest.fn();

describe('Prometheus MCP Logic', () => {
    let server;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.PROMETHEUS_URL = 'http://localhost:9090';
        process.env.PROMETHEUS_TOKEN = 'test-token';
        server = createPrometheusServer();
    });

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        const result = await tool.handler(args);
        return result;
    };

    describe('prometheus_health', () => {
        it('should verify connection', async () => {
            fetch.mockResolvedValue({
                ok: true,
                json: async () => ({ status: 'success', data: { version: '1.0' } })
            });

            const res = await callTool('prometheus_health');
            const data = JSON.parse(res.content[0].text);
            expect(data.ok).toBe(true);
            expect(fetch).toHaveBeenCalledWith(expect.stringContaining('api/v1/status/buildinfo'), expect.anything());
        });
    });

    describe('prometheus_query', () => {
        it('should return query results', async () => {
            fetch.mockResolvedValue({
                ok: true,
                json: async () => ({
                    status: 'success',
                    data: { resultType: 'vector', result: [{ metric: {}, value: [123, "1.5"] }] }
                })
            });

            const res = await callTool('prometheus_query', { query: 'sum(up)' });
            const data = JSON.parse(res.content[0].text);
            expect(data.type).toBe('vector');
            expect(data.result).toHaveLength(1);
        });
    });

    describe('Guardrails', () => {
        it('should block queries > 3h', async () => {
            const start = '2023-01-01T00:00:00Z';
            const end = '2023-01-01T04:00:00Z'; // 4h
            const res = await callTool('prometheus_query_range', { query: 'up', start, end, step: '15s' });
            expect(res.isError).toBe(true);
            expect(res.content[0].text).toContain('QueryTooBroad');
        });
    });
});
