const { createDynamoServer } = require('../server');

describe('DynamoDB MCP Schema Tests', () => {
    let server;

    beforeEach(() => { server = createDynamoServer(); });

    const getSchema = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    it('dynamo_connect defaults region to us-east-1', () => {
        const schema = getSchema('dynamo_connect');
        expect(schema.parse({}).region).toBe('us-east-1');
    });

    it('dynamo_describe_table requires table_name', () => {
        const schema = getSchema('dynamo_describe_table');
        expect(schema.safeParse({ table_name: 'Users' }).success).toBe(true);
        expect(schema.safeParse({}).success).toBe(false);
    });

    it('dynamo_get_item requires table_name and key', () => {
        const schema = getSchema('dynamo_get_item');
        expect(schema.safeParse({ table_name: 'Users', key: { userId: '123' } }).success).toBe(true);
        expect(schema.safeParse({ table_name: 'Users' }).success).toBe(false);
    });

    it('dynamo_query requires table_name, key_condition_expression, and expression_attribute_values', () => {
        const schema = getSchema('dynamo_query');
        expect(schema.safeParse({ table_name: 'Users', key_condition_expression: 'pk = :pk', expression_attribute_values: { ':pk': 'user1' } }).success).toBe(true);
        expect(schema.safeParse({ table_name: 'Users', key_condition_expression: 'pk = :pk' }).success).toBe(false);
    });

    it('dynamo_query defaults limit to 25', () => {
        const schema = getSchema('dynamo_query');
        const result = schema.parse({ table_name: 'T', key_condition_expression: 'pk = :pk', expression_attribute_values: { ':pk': '1' } });
        expect(result.limit).toBe(25);
    });

    it('dynamo_scan requires table_name and defaults limit to 25', () => {
        const schema = getSchema('dynamo_scan');
        expect(schema.safeParse({ table_name: 'Orders' }).success).toBe(true);
        expect(schema.parse({ table_name: 'Orders' }).limit).toBe(25);
    });

    it('dynamo_put_item requires table_name, item, and confirm', () => {
        const schema = getSchema('dynamo_put_item');
        expect(schema.safeParse({ table_name: 'Users', item: { userId: '1' }, confirm: true }).success).toBe(true);
        expect(schema.safeParse({ table_name: 'Users', item: { userId: '1' } }).success).toBe(false);
    });

    it('dynamo_delete_item requires table_name, key, and confirm', () => {
        const schema = getSchema('dynamo_delete_item');
        expect(schema.safeParse({ table_name: 'Users', key: { userId: '1' }, confirm: true }).success).toBe(true);
        expect(schema.safeParse({ table_name: 'Users', key: { userId: '1' } }).success).toBe(false);
    });

    it('dynamo_list_tables defaults limit to 20', () => {
        const schema = getSchema('dynamo_list_tables');
        expect(schema.parse({}).limit).toBe(20);
    });
});
