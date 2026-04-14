const { createGitLabServer } = require('../server');

describe('GitLab MCP Schema Validation', () => {
    let server;

    beforeEach(() => {
        server = createGitLabServer();
    });

    const getValidator = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    describe('gitlab_configure', () => {
        it('should require token', () => {
            const schema = getValidator('gitlab_configure');
            expect(schema.safeParse({ token: 't1' }).success).toBe(true);
            expect(schema.safeParse({}).success).toBe(false);
        });
    });

    describe('gitlab_create_branch', () => {
        it('should require project_id, branch_name, ref, and confirm', () => {
            const schema = getValidator('gitlab_create_branch');
            expect(schema.safeParse({ project_id: 123, branch_name: 'b1', ref: 'main', confirm: true }).success).toBe(true);
            expect(schema.safeParse({ project_id: 123, branch_name: 'b1', ref: 'main' }).success).toBe(false);
        });
    });

    describe('gitlab_trigger_pipeline', () => {
        it('should require project_id, ref, and confirm', () => {
            const schema = getValidator('gitlab_trigger_pipeline');
            expect(schema.safeParse({ project_id: 'p1', ref: 'main', confirm: true }).success).toBe(true);
            expect(schema.safeParse({ project_id: 'p1', ref: 'main' }).success).toBe(false);
        });
    });
});
