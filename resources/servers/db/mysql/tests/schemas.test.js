const { createMysqlServer } = require('../server');

describe('MySQL MCP Schema Tests', () => {
    let server;

    beforeEach(() => { server = createMysqlServer(); });

    const getSchema = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    it('mysql_connect requires host, user, password, database', () => {
        const schema = getSchema('mysql_connect');
        expect(schema.safeParse({ host: 'localhost', user: 'root', password: 'pass', database: 'mydb' }).success).toBe(true);
        expect(schema.safeParse({ host: 'localhost', user: 'root' }).success).toBe(false);
    });

    it('mysql_connect defaults port to 3306', () => {
        const schema = getSchema('mysql_connect');
        const result = schema.parse({ host: 'localhost', user: 'root', password: 'pass', database: 'mydb' });
        expect(result.port).toBe(3306);
    });

    it('mysql_query requires text, params as optional array', () => {
        const schema = getSchema('mysql_query');
        expect(schema.safeParse({ text: 'SELECT 1' }).success).toBe(true);
        expect(schema.safeParse({ text: 'SELECT 1', params: [1], confirm: true }).success).toBe(true);
        expect(schema.safeParse({ text: 'SELECT 1', params: 'bad' }).success).toBe(false);
        expect(schema.safeParse({}).success).toBe(false);
    });

    it('mysql_describe_table requires table_name', () => {
        const schema = getSchema('mysql_describe_table');
        expect(schema.safeParse({ table_name: 'users' }).success).toBe(true);
        expect(schema.safeParse({}).success).toBe(false);
    });

    it('mysql_health has no required params', () => {
        const schema = getSchema('mysql_health');
        expect(schema.safeParse({}).success).toBe(true);
    });

    it('mysql_list_tables has no required params', () => {
        const schema = getSchema('mysql_list_tables');
        expect(schema.safeParse({}).success).toBe(true);
    });

    it('mysql_get_schema has optional database param', () => {
        const schema = getSchema('mysql_get_schema');
        expect(schema.safeParse({}).success).toBe(true);
        expect(schema.safeParse({ database: 'mydb' }).success).toBe(true);
    });
});
