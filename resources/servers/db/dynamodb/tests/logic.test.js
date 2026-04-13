const { createDynamoServer } = require('../server');

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
    ListTablesCommand: jest.fn().mockImplementation((input) => ({ input, name: 'ListTablesCommand' })),
    DescribeTableCommand: jest.fn().mockImplementation((input) => ({ input, name: 'DescribeTableCommand' })),
    GetItemCommand: jest.fn().mockImplementation((input) => ({ input, name: 'GetItemCommand' })),
    PutItemCommand: jest.fn().mockImplementation((input) => ({ input, name: 'PutItemCommand' })),
    DeleteItemCommand: jest.fn().mockImplementation((input) => ({ input, name: 'DeleteItemCommand' })),
    QueryCommand: jest.fn().mockImplementation((input) => ({ input, name: 'QueryCommand' })),
    ScanCommand: jest.fn().mockImplementation((input) => ({ input, name: 'ScanCommand' })),
}));

jest.mock('@aws-sdk/util-dynamodb', () => ({
    marshall: jest.fn((obj) => obj),
    unmarshall: jest.fn((obj) => obj),
}));

describe('DynamoDB MCP Logic Tests', () => {
    let server;

    beforeEach(() => {
        jest.clearAllMocks();
        server = createDynamoServer();
    });

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.handler(args);
    };

    it('dynamo_connect creates a client and returns success', async () => {
        mockSend.mockResolvedValueOnce({ TableNames: [] });
        const res = await callTool('dynamo_connect', { region: 'us-west-2' });
        expect(res.content[0].text).toContain('Successfully connected');
    });

    it('dynamo_health returns ok after connect', async () => {
        mockSend.mockResolvedValueOnce({ TableNames: [] }); // connect
        await callTool('dynamo_connect', { region: 'us-east-1' });
        mockSend.mockResolvedValueOnce({ TableNames: ['Users'] }); // health
        const res = await callTool('dynamo_health');
        expect(JSON.parse(res.content[0].text).ok).toBe(true);
    });

    it('dynamo_list_tables returns table names', async () => {
        mockSend.mockResolvedValueOnce({ TableNames: [] }); // connect
        await callTool('dynamo_connect', { region: 'us-east-1' });
        mockSend.mockResolvedValueOnce({ TableNames: ['Users', 'Orders'], LastEvaluatedTableName: null });
        const res = await callTool('dynamo_list_tables', {});
        const data = JSON.parse(res.content[0].text);
        expect(data.tables).toContain('Users');
    });

    it('dynamo_get_item returns unmarshalled item', async () => {
        mockSend.mockResolvedValueOnce({ TableNames: [] }); // connect
        await callTool('dynamo_connect', { region: 'us-east-1' });
        mockSend.mockResolvedValueOnce({ Item: { userId: '123', name: 'Alice' } });
        const res = await callTool('dynamo_get_item', { table_name: 'Users', key: { userId: '123' } });
        const data = JSON.parse(res.content[0].text);
        expect(data.found).toBe(true);
        expect(data.item.name).toBe('Alice');
    });

    it('dynamo_get_item returns found: false when item is missing', async () => {
        mockSend.mockResolvedValueOnce({ TableNames: [] }); // connect
        await callTool('dynamo_connect', { region: 'us-east-1' });
        mockSend.mockResolvedValueOnce({ Item: undefined });
        const res = await callTool('dynamo_get_item', { table_name: 'Users', key: { userId: 'unknown' } });
        expect(JSON.parse(res.content[0].text).found).toBe(false);
    });

    it('dynamo_put_item requires confirm: true', async () => {
        mockSend.mockResolvedValueOnce({ TableNames: [] }); // connect
        await callTool('dynamo_connect', { region: 'us-east-1' });
        const blocked = await callTool('dynamo_put_item', { table_name: 'Users', item: { userId: '1' }, confirm: false });
        expect(blocked.isError).toBe(true);
        expect(blocked.content[0].text).toContain('CONFIRMATION_REQUIRED');
    });

    it('dynamo_put_item writes with confirm: true', async () => {
        mockSend.mockResolvedValueOnce({ TableNames: [] }); // connect
        await callTool('dynamo_connect', { region: 'us-east-1' });
        mockSend.mockResolvedValueOnce({});
        const res = await callTool('dynamo_put_item', { table_name: 'Users', item: { userId: '1' }, confirm: true });
        expect(JSON.parse(res.content[0].text).ok).toBe(true);
    });

    it('dynamo_delete_item requires confirm: true', async () => {
        mockSend.mockResolvedValueOnce({ TableNames: [] }); // connect
        await callTool('dynamo_connect', { region: 'us-east-1' });
        const blocked = await callTool('dynamo_delete_item', { table_name: 'Users', key: { userId: '1' }, confirm: false });
        expect(blocked.isError).toBe(true);
    });

    it('dynamo_scan returns items', async () => {
        mockSend.mockResolvedValueOnce({ TableNames: [] }); // connect
        await callTool('dynamo_connect', { region: 'us-east-1' });
        mockSend.mockResolvedValueOnce({ Items: [{ userId: '1' }, { userId: '2' }], ScannedCount: 2 });
        const res = await callTool('dynamo_scan', { table_name: 'Users' });
        const data = JSON.parse(res.content[0].text);
        expect(data.count).toBe(2);
    });

    it('returns isError when not connected', async () => {
        const res = await callTool('dynamo_health');
        expect(res.isError).toBe(true);
    });
});
