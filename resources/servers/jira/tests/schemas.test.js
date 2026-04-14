const { createJiraServer } = require('../server');

describe('Jira MCP Schema Validation', () => {
    let server;

    beforeEach(() => {
        server = createJiraServer();
    });

    const getValidator = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    describe('jira_create_issue', () => {
        it('should require projectKey, issueType, summary, and confirm', () => {
            const schema = getValidator('jira_create_issue');
            const valid = { projectKey: 'PROJ', issueType: 'Bug', summary: 'Test', confirm: true };
            expect(schema.safeParse(valid).success).toBe(true);
            expect(schema.safeParse({ ...valid, confirm: undefined }).success).toBe(false);
        });
    });

    describe('jira_update_issue', () => {
        it('should require issue_key and confirm', () => {
            const schema = getValidator('jira_update_issue');
            expect(schema.safeParse({ issue_key: 'PROJ-1', confirm: true }).success).toBe(true);
            expect(schema.safeParse({ issue_key: 'PROJ-1' }).success).toBe(false);
        });
    });

    describe('jira_configure', () => {
        it('should require token and url', () => {
            const schema = getValidator('jira_configure');
            expect(schema.safeParse({ token: 't1', url: 'https://site.atlassian.net' }).success).toBe(true);
            expect(schema.safeParse({ url: 'https://site.atlassian.net' }).success).toBe(false);
        });
    });
});
