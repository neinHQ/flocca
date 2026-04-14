const { createAwsServer } = require('../server');

describe('AWS MCP Schema Validation', () => {
    let server;

    beforeEach(() => {
        server = createAwsServer();
    });

    const getValidator = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    describe('aws_s3_put_object', () => {
        it('should require bucket, key, content, and confirm', () => {
            const schema = getValidator('aws_s3_put_object');
            const valid = { bucket: 'b1', key: 'k1', content: 'hi', confirm: true };
            expect(schema.safeParse(valid).success).toBe(true);
            expect(schema.safeParse({ ...valid, confirm: undefined }).success).toBe(false);
        });
    });

    describe('aws_ec2_start_instance', () => {
        it('should require instance_id and confirm', () => {
            const schema = getValidator('aws_ec2_start_instance');
            const valid = { instance_id: 'i-123', confirm: true };
            expect(schema.safeParse(valid).success).toBe(true);
            expect(schema.safeParse({ ...valid, confirm: false }).success).toBe(true);
            expect(schema.safeParse({ ...valid, instance_id: undefined }).success).toBe(false);
        });
    });

    describe('aws_dynamodb_put_item', () => {
        it('should validate table_name, item, and confirm', () => {
            const schema = getValidator('aws_dynamodb_put_item');
            const valid = { table_name: 't1', item: { id: { S: '1' } }, confirm: true };
            expect(schema.safeParse(valid).success).toBe(true);
            expect(schema.safeParse({ ...valid, item: 'not-record' }).success).toBe(false);
        });
    });
});
