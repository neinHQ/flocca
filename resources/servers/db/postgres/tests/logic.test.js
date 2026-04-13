const { createPostgresServer } = require('../server');

jest.mock('pg', () => {
    const mClient = {
        connect: jest.fn().mockResolvedValue(undefined),
        end: jest.fn().mockResolvedValue(undefined),
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0, command: 'SELECT' }),
    };
    return { Client: jest.fn(() => mClient) };
});

describe('Postgres MCP Logic Tests', () => {
    let server, mockClient;
    const { Client } = require('pg');

    beforeEach(() => {
        jest.clearAllMocks();
        server = createPostgresServer();
        mockClient = new Client();
    });

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.handler(args);
    };

    it('db_connect initialises pg client and returns success', async () => {
        const res = await callTool('db_connect', { host: 'localhost', user: 'postgres', password: 'password', database: 'mydb' });
        expect(res.content[0].text).toContain('Successfully connected');
        expect(Client).toHaveBeenCalled();
        expect(mockClient.connect).toHaveBeenCalled();
    });

    it('postgres_health returns ok after connect', async () => {
        await callTool('db_connect', { host: 'localhost', user: 'postgres', password: 'password', database: 'mydb' });
        const res = await callTool('postgres_health');
        expect(JSON.parse(res.content[0].text).ok).toBe(true);
    });

    it('db_query appends LIMIT 100 to SELECT without one', async () => {
        await callTool('db_connect', { host: 'localhost', user: 'postgres', password: 'password', database: 'mydb' });
        await callTool('db_query', { text: 'SELECT * FROM users' });
        expect(mockClient.query).toHaveBeenCalledWith('SELECT * FROM users LIMIT 100', []);
    });

    it('db_query blocks destructive queries without confirm', async () => {
        await callTool('db_connect', { host: 'localhost', user: 'postgres', password: 'password', database: 'mydb' });
        const res = await callTool('db_query', { text: 'DELETE FROM users' });
        expect(res.isError).toBe(true);
        expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
    });

    it('db_query allows destructive queries with confirm: true', async () => {
        await callTool('db_connect', { host: 'localhost', user: 'postgres', password: 'password', database: 'mydb' });
        await callTool('db_query', { text: 'DELETE FROM users', confirm: true });
        expect(mockClient.query).toHaveBeenCalledWith('DELETE FROM users', []);
    });

    it('db_get_schema groups columns by table_name', async () => {
        await callTool('db_connect', { host: 'localhost', user: 'postgres', password: 'password', database: 'mydb' });
        mockClient.query.mockResolvedValueOnce({
            rows: [
                { table_name: 'users', column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
                { table_name: 'users', column_name: 'email', data_type: 'text', is_nullable: 'YES' },
            ]
        });
        const res = await callTool('db_get_schema', { schema_name: 'public' });
        const data = JSON.parse(res.content[0].text);
        expect(data.users).toHaveLength(2);
        expect(data.users[0].column).toBe('id');
        expect(data.users[1].nullable).toBe(true);
    });

    it('returns isError when not connected', async () => {
        const res = await callTool('postgres_health');
        expect(res.isError).toBe(true);
    });
});
