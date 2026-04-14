// server requirement moved down to after mock
const { createNotionServer } = require('../server'); 

// Mocking Notion Client
const mockUsersMe = jest.fn();
const mockSearch = jest.fn();
const mockPagesCreate = jest.fn();

jest.mock('@notionhq/client', () => {
    return {
        Client: jest.fn().mockImplementation(() => ({
            users: { me: mockUsersMe },
            search: mockSearch,
            pages: { create: mockPagesCreate },
            databases: { query: jest.fn() }
        }))
    };
});

describe('Notion MCP Logic', () => {
    let server;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        process.env.NOTION_TOKEN = 'test-token';
        const { createNotionServer } = require('../server');
        server = createNotionServer();
    });

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        const result = await tool.handler(args);
        if (result.isError) {
            console.error(`Tool ${name} failed:`, result.content[0].text);
        }
        return result;
    };

    describe('Safety Gates', () => {
        it('notion_create_page requires confirm: true', async () => {
            const res = await callTool('notion_create_page', { parent_id: 'p1', title: 't1', confirm: false });
            expect(res.isError).toBe(true);
            expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
            expect(mockPagesCreate).not.toHaveBeenCalled();
        });

        it('notion_create_page proceeds with confirm: true', async () => {
            mockPagesCreate.mockResolvedValue({ id: 'new-page-id' });
            const res = await callTool('notion_create_page', { parent_id: 'p1', title: 't1', confirm: true });
            expect(res.isError).toBeUndefined();
            expect(mockPagesCreate).toHaveBeenCalled();
        });
    });

    describe('notion_health', () => {
        it('should verify connection', async () => {
            mockUsersMe.mockResolvedValue({ id: 'user-id' });
            const result = await callTool('notion_health');
            const data = JSON.parse(result.content[0].text);
            expect(data.ok).toBe(true);
            expect(mockUsersMe).toHaveBeenCalled();
        });
    });

    describe('notion_search', () => {
        it('should return mocked search results', async () => {
            mockSearch.mockResolvedValue({
                results: [{ id: 'res1', object: 'page' }]
            });

            const result = await callTool('notion_search', { query: 'test' });
            const data = JSON.parse(result.content[0].text);

            expect(data).toHaveLength(1);
            expect(data[0].id).toBe('res1');
        });
    });
});
