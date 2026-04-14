const { createNotionServer } = require('../server');

describe('Notion MCP Schema Validation', () => {
    let server;

    beforeEach(() => {
        server = createNotionServer();
    });

    const getValidator = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    describe('notion_configure', () => {
        it('should require token', () => {
            const schema = getValidator('notion_configure');
            expect(schema.safeParse({ token: 't1' }).success).toBe(true);
            expect(schema.safeParse({}).success).toBe(false);
        });
    });

    describe('notion_search', () => {
        it('should require query', () => {
            const schema = getValidator('notion_search');
            expect(schema.safeParse({ query: 'search terms' }).success).toBe(true);
            expect(schema.safeParse({}).success).toBe(false);
        });
    });

    describe('notion_create_page', () => {
        it('should require parent_id, title, and confirm', () => {
            const schema = getValidator('notion_create_page');
            expect(schema.safeParse({ parent_id: 'p1', title: 't1', confirm: true }).success).toBe(true);
            expect(schema.safeParse({ parent_id: 'p1', title: 't1' }).success).toBe(false);
        });
    });
});
