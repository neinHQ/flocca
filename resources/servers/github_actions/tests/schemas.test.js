const { createGitHubActionsServer } = require('../server');

describe('GitHub Actions Schema Validation', () => {
    let server;

    beforeEach(() => {
        server = createGitHubActionsServer();
    });

    const getValidator = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    describe('github_actions_configure', () => {
        it('should require token, owner, and repo', () => {
            const schema = getValidator('github_actions_configure');
            expect(schema.safeParse({ token: 't1', owner: 'o1', repo: 'r1' }).success).toBe(true);
            expect(schema.safeParse({ token: 't1' }).success).toBe(false);
        });
    });

    describe('github_actions_dispatch_workflow', () => {
        it('should require workflow_id, ref, and confirm', () => {
            const schema = getValidator('github_actions_dispatch_workflow');
            expect(schema.safeParse({ workflow_id: 'w1', ref: 'main', confirm: true }).success).toBe(true);
            expect(schema.safeParse({ workflow_id: 'w1', ref: 'main' }).success).toBe(false);
        });

        it('should allow structured inputs', () => {
            const schema = getValidator('github_actions_dispatch_workflow');
            const result = schema.safeParse({
                workflow_id: 'w1',
                ref: 'main',
                confirm: true,
                inputs: { env: 'prod', debug: true }
            });
            expect(result.success).toBe(true);
        });
    });
});
