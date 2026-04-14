const { createTestRailServer } = require('../server');
const axios = require('axios');

jest.mock('axios');

describe('TestRail MCP Logic', () => {
    let server;
    let mockAxios;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.TESTRAIL_BASE_URL = 'http://trl.local';
        process.env.TESTRAIL_USERNAME = 'user';
        process.env.TESTRAIL_API_KEY = 'key';
        process.env.TESTRAIL_PROJECT_ID = '1';
        
        mockAxios = {
            get: jest.fn(),
            post: jest.fn(),
            request: jest.fn()
        };
        axios.create.mockReturnValue(mockAxios);
        server = createTestRailServer();
    });

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return await tool.handler(args);
    };

    describe('testrail_health', () => {
        it('should verify connection', async () => {
            mockAxios.get.mockResolvedValue({ data: [] });
            const res = await callTool('testrail_health');
            const data = JSON.parse(res.content[0].text);
            expect(data.ok).toBe(true);
            expect(mockAxios.get).toHaveBeenCalledWith('get_projects');
        });
    });

    describe('testrail_list_test_cases', () => {
        it('should return cases', async () => {
            mockAxios.get.mockResolvedValue({ data: [{ id: 1, title: 'Case 1' }] });
            const res = await callTool('testrail_list_test_cases', { limit: 10 });
            const data = JSON.parse(res.content[0].text);
            expect(data.cases).toHaveLength(1);
            expect(data.cases[0].title).toBe('Case 1');
            expect(mockAxios.get).toHaveBeenCalledWith('get_cases/1', expect.any(Object));
        });
    });

    describe('testrail_create_test_case', () => {
        it('should block if not confirmed', async () => {
            const res = await callTool('testrail_create_test_case', { section_id: 1, title: 'new', confirm: false });
            expect(res.isError).toBe(true);
            expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
        });

        it('should create if confirmed', async () => {
            mockAxios.post.mockResolvedValue({ data: { id: 101, url: 'http://trl.local/101' } });
            const res = await callTool('testrail_create_test_case', { section_id: 1, title: 'new', confirm: true });
            const data = JSON.parse(res.content[0].text);
            expect(data.id).toBe(101);
            expect(mockAxios.post).toHaveBeenCalledWith('add_case/1', expect.any(Object));
        });
    });
});
