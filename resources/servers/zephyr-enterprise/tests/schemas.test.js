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

    describe('zephyr_enterprise_update_test_case', () => {
        it('should validate id, name, steps, and confirm', () => {
            const schema = getValidator('zephyr_enterprise_update_test_case');
            expect(schema.safeParse({ id: 1, name: 'T2', confirm: true }).success).toBe(true);
            expect(schema.safeParse({ id: 1, steps: [{ step: 'one' }], confirm: true }).success).toBe(true);
            expect(schema.safeParse({ name: 'T2', confirm: true }).success).toBe(false); // id missing
        });
    });
    describe('zephyr_enterprise_create_tcr_folder', () => {
        it('should require name and confirm', () => {
            const schema = getValidator('zephyr_enterprise_create_tcr_folder');
            const valid = { name: 'Folder1', confirm: true };
            expect(schema.safeParse(valid).success).toBe(true);
            expect(schema.safeParse({ name: 'F', parent_id: 123, release_id: 456, confirm: true }).success).toBe(true);
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
