const { createDockerServer } = require('../server');
const { z } = require('zod');

describe('Docker MCP Schema Validation', () => {
    let server;

    beforeEach(() => {
        server = createDockerServer();
    });

    const getValidator = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        // The inputSchema is a ZodObject
        return tool.inputSchema;
    };

    describe('docker_stop_container', () => {
        it('should require a string container_id and accept optional confirm', () => {
            const schema = getValidator('docker_stop_container');
            
            // Valid
            expect(schema.safeParse({ container_id: '123', confirm: true }).success).toBe(true);
            expect(schema.safeParse({ container_id: '123' }).success).toBe(true);
            
            // Invalid
            expect(schema.safeParse({}).success).toBe(false);
            expect(schema.safeParse({ container_id: 123 }).success).toBe(false);
        });
    });

    describe('docker_run_container', () => {
        it('should require image and handle optional fields', () => {
            const schema = getValidator('docker_run_container');
            
            // Minimal valid
            expect(schema.safeParse({ image: 'nginx' }).success).toBe(true);
            
            // Full valid (even with z.any fields)
            expect(schema.safeParse({
                image: 'nginx',
                name: 'web',
                env: { KEY: 'VAL' },
                detach: false,
                mounts: [{ type: 'bind', source: '/a', target: '/b' }]
            }).success).toBe(true);
            
            // Invalid (missing image)
            expect(schema.safeParse({ name: 'test' }).success).toBe(false);
        });

        it('should have default value for detach', () => {
            const schema = getValidator('docker_run_container');
            const result = schema.parse({ image: 'nginx' });
            expect(result.detach).toBe(true);
        });
    });

    describe('docker_get_logs', () => {
        it('should validate tail as a number', () => {
            const schema = getValidator('docker_get_logs');
            
            expect(schema.safeParse({ container_id: '123', tail: 50 }).success).toBe(true);
            expect(schema.safeParse({ container_id: '123', tail: '50' }).success).toBe(false);
        });
    });

    describe('docker_system_prune', () => {
        it('should have default values for booleans', () => {
            const schema = getValidator('docker_system_prune');
            const result = schema.parse({});
            expect(result.all).toBe(false);
            expect(result.volumes).toBe(false);
        });
    });

    describe('docker_configure', () => {
        it('should require a structured daemon object', () => {
            const schema = getValidator('docker_configure');
            
            expect(schema.safeParse({ daemon: { type: 'tcp', host: 'localhost' } }).success).toBe(true);
            expect(schema.safeParse({ daemon: { type: 'local_socket', socket_path: '/tmp/docker.sock' } }).success).toBe(true);
            
            // Invalid
            expect(schema.safeParse({ daemon: 'not-an-object' }).success).toBe(false);
            expect(schema.safeParse({ daemon: { type: 'invalid' } }).success).toBe(false);
        });
    });
});
