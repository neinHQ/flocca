const { createPostgresServer, Client } = require('../server');

jest.mock('pg', () => {
    const mClient = {
        connect: jest.fn().mockResolvedValue(undefined),
        end: jest.fn().mockResolvedValue(undefined),
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0, command: 'SELECT' }),
    };
    return { Client: jest.fn(() => mClient) };
});

describe('Postgres MCP Logic Tests', () => {
    let server;
    let mockClient;

    beforeEach(() => {
        jest.clearAllMocks();
        server = createPostgresServer();
        mockClient = new Client();
    });

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return await tool.handler(args);
    };

    describe('db_connect', () => {
        it('should initialize the pg Client and connect', async () => {
            const res = await callTool('db_connect', { connectionString: 'postgres://user:pass@host/db' });
            expect(res.content[0].text).toContain('Successfully connected');
            expect(Client).toHaveBeenCalled();
            expect(mockClient.connect).toHaveBeenCalled();
        });
    });

    describe('db_query', () => {
        beforeEach(async () => {
            // First connect
            await callTool('db_connect', { connectionString: 'postgres://user:pass@host/db' });
        });

        it('should append LIMIT 100 to SELECT queries', async () => {
            await callTool('db_query', { text: 'SELECT * FROM users' });
            expect(mockClient.query).toHaveBeenCalledWith('SELECT * FROM users LIMIT 100', []);
        });

        it('should block destructive queries without confirmation', async () => {
            const res = await callTool('db_query', { text: 'DELETE FROM users' });
            expect(res.isError).toBe(true);
            expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
            expect(mockClient.query).not.toHaveBeenCalledWith('DELETE FROM users', []);
        });

        it('should allow destructive queries with confirmation', async () => {
            await callTool('db_query', { text: 'DELETE FROM users', confirm: true });
            expect(mockClient.query).toHaveBeenCalledWith('DELETE FROM users', []);
        });
    });

    describe('db_get_schema', () => {
        it('should format schema query results logically', async () => {
            await callTool('db_connect', { connectionString: 'postgres://user:pass@host/db' });
            
            mockClient.query.mockResolvedValueOnce({
                rows: [
                    { table_name: 'users', column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
                    { table_name: 'users', column_name: 'name', data_type: 'text', is_nullable: 'YES' }
                ]
            });

            const res = await callTool('db_get_schema', { schema_name: 'public' });
            const data = JSON.parse(res.content[0].text);
            
            expect(data.users).toHaveLength(2);
            expect(data.users[0].column).toBe('id');
            expect(data.users[1].nullable).toBe(true);
        });
    });
});
