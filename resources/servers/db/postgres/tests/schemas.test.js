const { createPostgresServer } = require('../server');

describe('Postgres MCP Schema Tests', () => {
    let server;

    beforeEach(() => { server = createPostgresServer(); });

    const getSchema = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    it('db_connect requires host, user, password, database', () => {
        const schema = getSchema('db_connect');
        expect(schema.safeParse({ host: 'localhost', user: 'postgres', password: 'password', database: 'mydb' }).success).toBe(true);
        expect(schema.safeParse({}).success).toBe(false);
    });

    it('db_connect defaults port to 5432', () => {
        const schema = getSchema('db_connect');
        const result = schema.parse({ host: 'localhost', user: 'postgres', password: 'password', database: 'mydb' });
        expect(result.port).toBe(5432);
    });

    it('db_query requires text, params optional array, confirm optional bool', () => {
        const schema = getSchema('db_query');
        expect(schema.safeParse({ text: 'SELECT 1' }).success).toBe(true);
        expect(schema.safeParse({ text: 'SELECT 1', params: [1], confirm: true }).success).toBe(true);
        expect(schema.safeParse({ text: 'SELECT 1', params: 'bad' }).success).toBe(false);
        expect(schema.safeParse({}).success).toBe(false);
    });

    it('db_get_schema defaults schema_name to public', () => {
        const schema = getSchema('db_get_schema');
        expect(schema.parse({}).schema_name).toBe('public');
    });

    it('db_describe_table requires table_name', () => {
        const schema = getSchema('db_describe_table');
        expect(schema.safeParse({ table_name: 'users' }).success).toBe(true);
        expect(schema.safeParse({ schema_name: 'public' }).success).toBe(false);
    });

    it('postgres_health has no required params', () => {
        const schema = getSchema('postgres_health');
        expect(schema.safeParse({}).success).toBe(true);
    });

    it('db_list_tables has no required params', () => {
        const schema = getSchema('db_list_tables');
        expect(schema.safeParse({}).success).toBe(true);
    });
});
