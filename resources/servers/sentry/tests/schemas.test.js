const { createSentryServer } = require('../server');

describe('Sentry MCP Schema Validation', () => {
    let server;

    beforeEach(() => {
        server = createSentryServer();
    });

    const getValidator = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    describe('sentry_configure', () => {
        it('should require token and org_slug', () => {
            const schema = getValidator('sentry_configure');
            expect(schema.safeParse({ token: 't1', org_slug: 'o1' }).success).toBe(true);
            expect(schema.safeParse({ token: 't1' }).success).toBe(false);
        });
    });

    describe('sentry_list_issues', () => {
        it('should require project_slug', () => {
            const schema = getValidator('sentry_list_issues');
            expect(schema.safeParse({ project_slug: 'p1' }).success).toBe(true);
            expect(schema.safeParse({}).success).toBe(false);
        });
    });

    describe('sentry_get_issue', () => {
        it('should require issue_id', () => {
            const schema = getValidator('sentry_get_issue');
            expect(schema.safeParse({ issue_id: 'i1' }).success).toBe(true);
            expect(schema.safeParse({}).success).toBe(false);
        });
    });
});
