const { createZephyrEnterpriseServer } = require('../server');

describe('Zephyr Enterprise Schema Validation', () => {
    let server;

    beforeEach(() => {
        server = createZephyrEnterpriseServer();
    });

    const getValidator = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    describe('zephyr_enterprise_create_test_case', () => {
        it('should require name and confirm', () => {
            const schema = getValidator('zephyr_enterprise_create_test_case');
            const valid = { name: 'T1', confirm: true };
            expect(schema.safeParse(valid).success).toBe(true);
            expect(schema.safeParse({ ...valid, confirm: undefined }).success).toBe(false);
        });
    });

    describe('zephyr_enterprise_create_release', () => {
        it('should validate name and confirm', () => {
            const schema = getValidator('zephyr_enterprise_create_release');
            const valid = { name: 'R1', confirm: true };
            expect(schema.safeParse(valid).success).toBe(true);
            expect(schema.safeParse({ name: 123 }).success).toBe(false);
        });
    });
});
