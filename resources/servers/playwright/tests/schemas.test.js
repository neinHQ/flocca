const { createPlaywrightServer } = require('../server');

describe('Playwright MCP Schema Validation', () => {
    let server;

    beforeEach(() => {
        server = createPlaywrightServer();
    });

    const getValidator = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    describe('playwright_run_all', () => {
        it('should allow optional project and grep', () => {
            const schema = getValidator('playwright_run_all');
            expect(schema.safeParse({}).success).toBe(true);
            expect(schema.safeParse({ project: 'chromium', grep: 'auth' }).success).toBe(true);
        });
    });

    describe('playwright_run_spec', () => {
        it('should require spec_path', () => {
            const schema = getValidator('playwright_run_spec');
            expect(schema.safeParse({ spec_path: 'tests/auth.spec.js' }).success).toBe(true);
            expect(schema.safeParse({}).success).toBe(false);
        });
    });
});
