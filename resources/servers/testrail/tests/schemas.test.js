const { createTestRailServer } = require('../server');

describe('TestRail MCP Schema Validation', () => {
    let server;

    beforeEach(() => {
        server = createTestRailServer();
    });

    const getValidator = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    describe('testrail_create_test_case', () => {
        it('should require section_id, title, and confirm', () => {
            const schema = getValidator('testrail_create_test_case');
            const valid = { section_id: 1, title: 'Test Case', confirm: true };
            expect(schema.safeParse(valid).success).toBe(true);
            expect(schema.safeParse({ ...valid, confirm: undefined }).success).toBe(false);
        });
    });

    describe('testrail_add_test_result', () => {
        it('should require test_id, status, and confirm', () => {
            const schema = getValidator('testrail_add_test_result');
            const valid = { test_id: 1, status: 'passed', confirm: true };
            expect(schema.safeParse(valid).success).toBe(true);
            expect(schema.safeParse({ ...valid, status: 'invalid' }).success).toBe(false);
        });
    });

    describe('testrail_map_automated_results', () => {
        it('should validate results array and confirm', () => {
            const schema = getValidator('testrail_map_automated_results');
            const valid = { 
                run_id: 1, 
                results: [{ case_id: 101, status: 'passed' }], 
                confirm: true 
            };
            expect(schema.safeParse(valid).success).toBe(true);
            expect(schema.safeParse({ ...valid, results: [] }).success).toBe(true);
        });
    });
});
