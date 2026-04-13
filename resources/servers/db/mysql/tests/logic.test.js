const { createMysqlServer } = require('../server');

jest.mock('mysql2/promise', () => ({
    createConnection: jest.fn()
}));

describe('MySQL MCP Logic Tests', () => {
    let server;
    let mockConnection;
    const mysql = require('mysql2/promise');

    beforeEach(() => {
        jest.clearAllMocks();
        mockConnection = {
            query: jest.fn().mockResolvedValue([[], []]),
            end: jest.fn().mockResolvedValue(undefined),
        };
        mysql.createConnection.mockResolvedValue(mockConnection);
        server = createMysqlServer();
    });

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.handler(args);
    };

    it('mysql_connect creates a connection and returns success', async () => {
        const res = await callTool('mysql_connect', { host: 'localhost', user: 'root', password: 'pass', database: 'mydb' });
        expect(res.content[0].text).toContain('Successfully connected');
        expect(mysql.createConnection).toHaveBeenCalled();
    });

    it('mysql_health returns ok after connect', async () => {
        await callTool('mysql_connect', { host: 'localhost', user: 'root', password: 'pass', database: 'mydb' });
        mockConnection.query.mockResolvedValueOnce([[{ 1: 1 }], []]);
        const res = await callTool('mysql_health');
        expect(JSON.parse(res.content[0].text).ok).toBe(true);
    });

    it('mysql_query appends LIMIT 100 to SELECT without one', async () => {
        await callTool('mysql_connect', { host: 'localhost', user: 'root', password: 'pass', database: 'mydb' });
        mockConnection.query.mockResolvedValueOnce([[], []]);
        await callTool('mysql_query', { text: 'SELECT * FROM users' });
        expect(mockConnection.query).toHaveBeenCalledWith('SELECT * FROM users LIMIT 100', []);
    });

    it('mysql_query blocks destructive queries without confirm', async () => {
        await callTool('mysql_connect', { host: 'localhost', user: 'root', password: 'pass', database: 'mydb' });
        const res = await callTool('mysql_query', { text: 'DROP TABLE users' });
        expect(res.isError).toBe(true);
        expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
    });

    it('mysql_query allows destructive queries with confirm: true', async () => {
        await callTool('mysql_connect', { host: 'localhost', user: 'root', password: 'pass', database: 'mydb' });
        mockConnection.query.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);
        await callTool('mysql_query', { text: 'DROP TABLE users', confirm: true });
        expect(mockConnection.query).toHaveBeenCalledWith('DROP TABLE users', []);
    });

    it('mysql_get_schema groups columns by table name', async () => {
        await callTool('mysql_connect', { host: 'localhost', user: 'root', password: 'pass', database: 'mydb' });
        mockConnection.query.mockResolvedValueOnce([[
            { TABLE_NAME: 'products', COLUMN_NAME: 'id', DATA_TYPE: 'int', IS_NULLABLE: 'NO' },
            { TABLE_NAME: 'products', COLUMN_NAME: 'name', DATA_TYPE: 'varchar', IS_NULLABLE: 'YES' },
        ], []]);
        const res = await callTool('mysql_get_schema', {});
        const data = JSON.parse(res.content[0].text);
        expect(data.products).toHaveLength(2);
        expect(data.products[1].nullable).toBe(true);
    });

    it('returns isError when not connected', async () => {
        const res = await callTool('mysql_health');
        expect(res.isError).toBe(true);
    });
});
