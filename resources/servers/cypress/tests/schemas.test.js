const { createCypressServer } = require('../server');

describe('Cypress MCP Schema Tests', () => {
    let server;

    beforeEach(() => {
        server = createCypressServer();
    });

    const getValidator = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    describe('cypress_configure', () => {
        it('should allow optional configuration fields', () => {
            const schema = getValidator('cypress_configure');
            expect(schema.safeParse({ project_root: '/opt/app' }).success).toBe(true);
            expect(schema.safeParse({ browser: 'firefox', env: { DEBUG: '1' } }).success).toBe(true);
        });
    });

    describe('cypress_run_spec', () => {
        it('should require spec and validate booleans', () => {
            const schema = getValidator('cypress_run_spec');
            
            expect(schema.safeParse({ spec: 'auth.cy.js' }).success).toBe(true);
            expect(schema.safeParse({ spec: 'auth.cy.js', headed: true }).success).toBe(true);
            
            // Invalid
            expect(schema.safeParse({}).success).toBe(false);
            expect(schema.safeParse({ spec: 123 }).success).toBe(false);
            expect(schema.safeParse({ spec: 'a.js', headed: 'yes' }).success).toBe(false);
        });
    });

    describe('cypress_get_failed_tests', () => {
        it('should require stdout string', () => {
            const schema = getValidator('cypress_get_failed_tests');
            expect(schema.safeParse({ stdout: 'log content' }).success).toBe(true);
            expect(schema.safeParse({}).success).toBe(false);
        });
    });
});
