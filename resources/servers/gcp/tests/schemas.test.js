const { createGcpServer } = require('../server');

describe('GCP MCP Schema Validation', () => {
    let server;

    beforeEach(() => {
        server = createGcpServer();
    });

    const getValidator = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    describe('gcp_configure', () => {
        it('should require project_id and token', () => {
            const schema = getValidator('gcp_configure');
            expect(schema.safeParse({ project_id: 'my-id', token: 'ya29' }).success).toBe(true);
            expect(schema.safeParse({ project_id: 'my-id' }).success).toBe(false);
        });
    });

    describe('gcp_compute_stop_instance', () => {
        it('should require zone, name and confirm', () => {
            const schema = getValidator('gcp_compute_stop_instance');
            expect(schema.safeParse({ zone: 'us-ce1-a', name: 'vm1', confirm: true }).success).toBe(true);
            expect(schema.safeParse({ zone: 'us-ce1-a', name: 'vm1' }).success).toBe(false);
        });
    });

    describe('gcp_storage_put_object', () => {
        it('should validate required fields', () => {
            const schema = getValidator('gcp_storage_put_object');
            expect(schema.safeParse({ bucket: 'b1', object: 'o1', content: 'hi', confirm: true }).success).toBe(true);
            expect(schema.safeParse({ bucket: 'b1', object: 'o1', content: 'hi' }).success).toBe(false);
        });
    });

    describe('gcp_pubsub_publish_message', () => {
        it('should allow structured attributes via catchall', () => {
            const schema = getValidator('gcp_pubsub_publish_message');
            const result = schema.safeParse({
                topic: 't1',
                data: 'msg',
                confirm: true,
                attributes: { key: 'val', priority: 1 }
            });
            expect(result.success).toBe(true);
        });
    });
});
