const { createPostgresServer } = require('../server');

describe('Postgres MCP Schema Tests', () => {
    let server;

    beforeEach(() => {
        server = createPostgresServer();
    });

    const getValidator = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    describe('db_connect', () => {
        it('should require a connectionString', () => {
            const schema = getValidator('db_connect');
            expect(schema.safeParse({ connectionString: 'postgres://...' }).success).toBe(true);
            expect(schema.safeParse({}).success).toBe(false);
        });
    });

    describe('db_query', () => {
        it('should require a text query and optional params/confirm', () => {
            const schema = getValidator('db_query');
            
            // Valid cases
            expect(schema.safeParse({ text: 'SELECT 1' }).success).toBe(true);
            expect(schema.safeParse({ text: 'SELECT 1', params: [1], confirm: false }).success).toBe(true);
            
            // Invalid type for params
            expect(schema.safeParse({ text: 'SELECT 1', params: 'not-an-array' }).success).toBe(false);
        });
    });

    describe('db_get_schema', () => {
        it('should default schema_name to public', () => {
            const schema = getValidator('db_get_schema');
            const result = schema.parse({});
            expect(result.schema_name).toBe('public');
        });
    });

    describe('db_describe_table', () => {
        it('should require table_name', () => {
            const schema = getValidator('db_describe_table');
            expect(schema.safeParse({ table_name: 'users' }).success).toBe(true);
            expect(schema.safeParse({ schema_name: 'public' }).success).toBe(false);
        });
    });
});
