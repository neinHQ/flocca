const { createPytestServer } = require('../server');

describe('Pytest MCP Schema Validation', () => {
    let server;

    beforeEach(() => {
        server = createPytestServer();
    });

    const getValidator = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    describe('pytest_run_all', () => {
        it('should allow optional directory and args', () => {
            const schema = getValidator('pytest_run_all');
            expect(schema.safeParse({}).success).toBe(true);
            expect(schema.safeParse({ directory: 'tests/unit', args: '-v -s' }).success).toBe(true);
        });
    });

    describe('pytest_run_file', () => {
        it('should require path', () => {
            const schema = getValidator('pytest_run_file');
            expect(schema.safeParse({ path: 'tests/test_api.py' }).success).toBe(true);
            expect(schema.safeParse({}).success).toBe(false);
        });
    });
});
