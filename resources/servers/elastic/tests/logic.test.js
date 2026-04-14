// server requirement moved down to after mock

// Mock @elastic/elasticsearch
const mockSearch = jest.fn();
const mockGet = jest.fn();
const mockCatIndices = jest.fn();
const mockClusterHealth = jest.fn();
const mockPing = jest.fn();

jest.mock('@elastic/elasticsearch', () => {
    return {
        Client: jest.fn().mockImplementation(() => ({
            search: mockSearch,
            get: mockGet,
            cat: { indices: mockCatIndices },
            cluster: { health: mockClusterHealth },
            ping: mockPing
        }))
    };
});

describe('Elastic Observability MCP Logic', () => {
    let server;
    const { createElasticServer } = require('../server');

    beforeEach(() => {
        jest.clearAllMocks();
        server = createElasticServer();
        process.env.ELASTIC_URL = 'http://localhost:9200';
    });

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        const result = await tool.handler(args);
        if (result.isError) {
            console.error(`Tool ${name} failed:`, result.content[0].text);
        }
        return result;
    };

    describe('elastic_search_logs', () => {
        it('should format search request and parse results', async () => {
            // The search response might be nested depending on client version
            mockSearch.mockResolvedValue({
                hits: {
                    total: { value: 100 },
                    hits: [
                        { _index: 'logs-1', _id: '1', _source: { '@timestamp': '2024-01-01T00:00:00Z', message: 'error here' } }
                    ]
                }
            });

            const result = await callTool('elastic_search_logs', { query_string: 'error', size: 10 });
            const data = JSON.parse(result.content[0].text);

            expect(data.hits).toHaveLength(1);
            expect(data.total).toBe(100);
            expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({
                body: expect.objectContaining({
                    query: { bool: { must: [{ query_string: { query: 'error' } }], filter: [] } },
                    size: 10
                })
            }));
        });
    });

    describe('elastic_find_recent_errors', () => {
        it('should filter by ERROR level and service', async () => {
            mockSearch.mockResolvedValue({
                hits: {
                    total: { value: 5 },
                    hits: [
                        { _source: { '@timestamp': '2024-01-01T00:00:00Z', service: { name: 'auth' }, log: { level: 'ERROR', message: 'failed' } } }
                    ]
                }
            });

            const result = await callTool('elastic_find_recent_errors', { service: 'auth', lookback: '15m' });
            const data = JSON.parse(result.content[0].text);

            expect(data.errors).toHaveLength(1);
            expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({
                body: expect.objectContaining({
                    query: expect.objectContaining({
                        bool: expect.objectContaining({
                            filter: expect.arrayContaining([
                                { range: { '@timestamp': { gte: 'now-15m' } } }
                            ])
                        })
                    })
                })
            }));
        });
    });

    describe('elastic_get_log_context', () => {
        it('should fetch target, before, and after logs', async () => {
            mockGet.mockResolvedValue({ _source: { '@timestamp': '2024-01-01T10:00:00Z', message: 'target' } });
            mockSearch.mockResolvedValueOnce({ hits: { hits: [{ _source: { message: 'before' } }] } }); // before
            mockSearch.mockResolvedValueOnce({ hits: { hits: [{ _source: { message: 'after' } }] } }); // after

            const result = await callTool('elastic_get_log_context', { index: 'logs', id: '123', before: 5, after: 5 });
            const data = JSON.parse(result.content[0].text);

            expect(data.target.message).toBe('target');
            expect(data.before).toHaveLength(1);
            expect(data.after).toHaveLength(1);
            expect(mockGet).toHaveBeenCalledWith({ index: 'logs', id: '123' });
        });
    });
});
