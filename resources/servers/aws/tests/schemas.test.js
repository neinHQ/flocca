const { createAwsServer } = require('../server');

describe('AWS MCP Schema Tests', () => {
    let server;

    beforeEach(() => {
        server = createAwsServer();
    });

    const getValidator = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    describe('aws_configure', () => {
        it('should require region and credentials', () => {
            const schema = getValidator('aws_configure');
            expect(schema.safeParse({ 
                region: 'us-east-1', 
                credentials: { access_key_id: 'A', secret_access_key: 'S' } 
            }).success).toBe(true);
            
            expect(schema.safeParse({ region: 'us-east-1' }).success).toBe(false);
        });
    });

    describe('aws_s3_get_object', () => {
        it('should require bucket and key', () => {
            const schema = getValidator('aws_s3_get_object');
            expect(schema.safeParse({ bucket: 'b', key: 'k' }).success).toBe(true);
            expect(schema.safeParse({ bucket: 'b' }).success).toBe(false);
        });
    });

    describe('aws_lambda_invoke', () => {
        it('should validate enum for invocation_type', () => {
            const schema = getValidator('aws_lambda_invoke');
            expect(schema.safeParse({ function_name: 'f', invocation_type: 'Event' }).success).toBe(true);
            expect(schema.safeParse({ function_name: 'f', invocation_type: 'Sync' }).success).toBe(false);
        });
    });

    describe('aws_logs_get_log_events', () => {
        it('should require log_group_name', () => {
            const schema = getValidator('aws_logs_get_log_events');
            expect(schema.safeParse({ log_group_name: 'lg' }).success).toBe(true);
            expect(schema.safeParse({ limit: 10 }).success).toBe(false);
        });
    });
});
