// server requirement moved down to after mock
const { createSentryServer } = require('../server'); 
const axios = require('axios');

// Mocking Axios
jest.mock('axios', () => {
    const mAxios = {
        get: jest.fn(),
        post: jest.fn(),
        defaults: { headers: {} }
    };
    return {
        create: jest.fn(() => mAxios),
        get: mAxios.get,
        post: mAxios.post,
        mAxios // Export for testing
    };
});

describe('Sentry MCP Logic', () => {
    let server;
    let mockAxios;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        process.env.SENTRY_TOKEN = 'test-token';
        process.env.SENTRY_ORG_SLUG = 'test-org';
        
        mockAxios = require('axios').mAxios;
        const { createSentryServer } = require('../server');
        server = createSentryServer();
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

    describe('sentry_health', () => {
        it('should verify connection', async () => {
            mockAxios.get.mockResolvedValue({ data: { slug: 'test-org', name: 'Test Org' } });
            const result = await callTool('sentry_health');
            const data = JSON.parse(result.content[0].text);
            expect(data.ok).toBe(true);
            expect(mockAxios.get).toHaveBeenCalledWith('/organizations/test-org/');
        });
    });

    describe('sentry_list_projects', () => {
        it('should return projects', async () => {
            mockAxios.get.mockResolvedValue({
                data: [{ slug: 'p1', name: 'Project 1', platform: 'javascript' }]
            });

            const result = await callTool('sentry_list_projects');
            const data = JSON.parse(result.content[0].text);

            expect(data).toHaveLength(1);
            expect(data[0].slug).toBe('p1');
            expect(mockAxios.get).toHaveBeenCalledWith('/organizations/test-org/projects/');
        });
    });

    describe('sentry_list_issues', () => {
        it('should return issues with query', async () => {
            mockAxios.get.mockResolvedValue({
                data: [{ id: '123', title: 'Error message', count: 10, userCount: 5 }]
            });

            const result = await callTool('sentry_list_issues', { project_slug: 'p1', query: 'is:unresolved' });
            const data = JSON.parse(result.content[0].text);

            expect(data).toHaveLength(1);
            expect(data[0].id).toBe('123');
            expect(mockAxios.get).toHaveBeenCalledWith('/projects/test-org/p1/issues/', expect.objectContaining({
                params: expect.objectContaining({ query: 'is:unresolved' })
            }));
        });
    });
});
