const { createZephyrServer } = require('../server');

describe('Zephyr Scale Schema Validation', () => {
    let server;

    beforeEach(() => {
        server = createZephyrServer();
    });

    const getValidator = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    describe('zephyr_create_test_case', () => {
        it('should require title and confirm', () => {
            const schema = getValidator('zephyr_create_test_case');
            const valid = { title: 'Test Case 1', confirm: true };
            expect(schema.safeParse(valid).success).toBe(true);
            expect(schema.safeParse({ ...valid, confirm: undefined }).success).toBe(false);
        });
    });

    describe('zephyr_update_execution_status', () => {
        it('should require execution_id, status, and confirm', () => {
            const schema = getValidator('zephyr_update_execution_status');
            const valid = { execution_id: 'EX-1', status: 'PASS', confirm: true };
            expect(schema.safeParse(valid).success).toBe(true);
            expect(schema.safeParse({ ...valid, status: 'INVALID' }).success).toBe(false);
        });
    });
});
