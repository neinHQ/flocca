const { createGitHubServer } = require('../server');

describe('GitHub MCP Schema Validation', () => {
    let server;

    beforeEach(() => {
        server = createGitHubServer();
    });

    const getValidator = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    describe('create_issue', () => {
        it('should require owner, repo, title, and confirm', () => {
            const schema = getValidator('create_issue');
            expect(schema.safeParse({ owner: 'o1', repo: 'r1', title: 't1', confirm: true }).success).toBe(true);
            expect(schema.safeParse({ owner: 'o1', repo: 'r1', title: 't1' }).success).toBe(false);
        });
    });

    describe('merge_pull_request', () => {
        it('should require owner, repo, pull_number, and confirm', () => {
            const schema = getValidator('merge_pull_request');
            expect(schema.safeParse({ owner: 'o1', repo: 'r1', pull_number: 1, confirm: true }).success).toBe(true);
            expect(schema.safeParse({ owner: 'o1', repo: 'r1', pull_number: 1 }).success).toBe(false);
        });

        it('should allow merge methods', () => {
            const schema = getValidator('merge_pull_request');
            expect(schema.safeParse({ owner: 'o1', repo: 'r1', pull_number: 1, confirm: true, merge_method: 'squash' }).success).toBe(true);
            expect(schema.safeParse({ owner: 'o1', repo: 'r1', pull_number: 1, confirm: true, merge_method: 'invalid' }).success).toBe(false);
        });
    });

    describe('git_commit', () => {
        it('should require message and confirm', () => {
            const schema = getValidator('git_commit');
            expect(schema.safeParse({ message: 'feat: add stuff', confirm: true }).success).toBe(true);
            expect(schema.safeParse({ message: 'feat: add stuff' }).success).toBe(false);
        });
    });
});
