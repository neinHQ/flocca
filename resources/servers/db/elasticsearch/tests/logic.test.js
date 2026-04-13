const { createElasticsearchServer } = require('../server');

const mockEsClient = {
    ping: jest.fn().mockResolvedValue(true),
    cluster: { health: jest.fn().mockResolvedValue({ status: 'green', cluster_name: 'test-cluster' }) },
    cat: { indices: jest.fn().mockResolvedValue([{ index: 'logs-2026', health: 'green', 'docs.count': '1000', 'store.size': '5mb' }]) },
    indices: { getMapping: jest.fn().mockResolvedValue({ 'my-index': { mappings: { properties: { message: { type: 'text' } } } } }) },
    search: jest.fn().mockResolvedValue({ hits: { total: { value: 2 }, hits: [{ _id: '1', _score: 1.0, _source: { msg: 'hello' } }] } }),
    index: jest.fn().mockResolvedValue({ _id: 'new-id', result: 'created' }),
    delete: jest.fn().mockResolvedValue({ _id: 'del-id', result: 'deleted' }),
};

jest.mock('@elastic/elasticsearch', () => ({
    Client: jest.fn().mockImplementation(() => mockEsClient)
}));

describe('Elasticsearch MCP Logic Tests', () => {
    let server;
    const { Client } = require('@elastic/elasticsearch');

    beforeEach(() => {
        jest.clearAllMocks();
        server = createElasticsearchServer();
    });

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.handler(args);
    };

    it('elastic_connect pings and returns success', async () => {
        const res = await callTool('elastic_connect', { node: 'https://localhost:9200' });
        expect(res.content[0].text).toContain('Successfully connected');
        expect(Client).toHaveBeenCalled();
        expect(mockEsClient.ping).toHaveBeenCalled();
    });

    it('elastic_health returns cluster status', async () => {
        await callTool('elastic_connect', { node: 'https://localhost:9200' });
        const res = await callTool('elastic_health');
        const data = JSON.parse(res.content[0].text);
        expect(data.ok).toBe(true);
        expect(data.status).toBe('green');
    });

    it('elastic_list_indices returns formatted index list', async () => {
        await callTool('elastic_connect', { node: 'https://localhost:9200' });
        const res = await callTool('elastic_list_indices', { pattern: 'logs-*' });
        const data = JSON.parse(res.content[0].text);
        expect(data[0].index).toBe('logs-2026');
        expect(mockEsClient.cat.indices).toHaveBeenCalledWith({ index: 'logs-*', format: 'json' });
    });

    it('elastic_get_mapping returns index mapping', async () => {
        await callTool('elastic_connect', { node: 'https://localhost:9200' });
        const res = await callTool('elastic_get_mapping', { index: 'my-index' });
        const data = JSON.parse(res.content[0].text);
        expect(data.properties.message.type).toBe('text');
    });

    it('elastic_search returns hits with flattened source', async () => {
        await callTool('elastic_connect', { node: 'https://localhost:9200' });
        const res = await callTool('elastic_search', { index: 'logs', query: { match_all: {} } });
        const data = JSON.parse(res.content[0].text);
        expect(data.total).toBe(2);
        expect(data.hits[0].msg).toBe('hello');
    });

    it('elastic_index_document requires confirm: true', async () => {
        await callTool('elastic_connect', { node: 'https://localhost:9200' });
        const blocked = await callTool('elastic_index_document', { index: 'logs', document: { msg: 'hi' }, confirm: false });
        expect(blocked.isError).toBe(true);
        const allowed = await callTool('elastic_index_document', { index: 'logs', document: { msg: 'hi' }, confirm: true });
        expect(JSON.parse(allowed.content[0].text).result).toBe('created');
    });

    it('elastic_delete_document requires confirm: true', async () => {
        await callTool('elastic_connect', { node: 'https://localhost:9200' });
        const blocked = await callTool('elastic_delete_document', { index: 'logs', id: 'abc', confirm: false });
        expect(blocked.isError).toBe(true);
        const allowed = await callTool('elastic_delete_document', { index: 'logs', id: 'abc', confirm: true });
        expect(JSON.parse(allowed.content[0].text).result).toBe('deleted');
    });

    it('returns isError when not connected', async () => {
        const res = await callTool('elastic_health');
        expect(res.isError).toBe(true);
    });
});
