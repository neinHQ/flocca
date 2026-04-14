const { createJiraServer } = require('../server');
const axios = require('axios');

jest.mock('axios');

describe('Jira MCP Logic', () => {
    let server;
    let mockAxios;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.JIRA_API_TOKEN = 'test-token';
        process.env.JIRA_SITE_URL = 'http://jira.local';
        process.env.JIRA_EMAIL = 'test@example.com';
        
        mockAxios = {
            get: jest.fn().mockResolvedValue({ data: {} }),
            post: jest.fn().mockResolvedValue({ data: {} }),
            put: jest.fn().mockResolvedValue({ data: {} }),
            request: jest.fn().mockResolvedValue({ data: {} })
        };
        axios.create.mockReturnValue(mockAxios);
        server = createJiraServer();
    });

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return await tool.handler(args);
    };

    describe('jira_health', () => {
        it('should verify connection', async () => {
            mockAxios.get.mockResolvedValue({ data: { name: 'User' } });
            const res = await callTool('jira_health');
            const data = JSON.parse(res.content[0].text);
            expect(data.ok).toBe(true);
            expect(mockAxios.get).toHaveBeenCalledWith(expect.stringContaining('myself'));
        });
    });

    describe('jira_create_issue', () => {
        it('should block if not confirmed', async () => {
            const res = await callTool('jira_create_issue', { projectKey: 'PROJ', issueType: 'Bug', summary: 'Fail', confirm: false });
            expect(res.isError).toBe(true);
            expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
        });

        it('should create issue if confirmed', async () => {
            mockAxios.request.mockResolvedValue({ data: { key: 'PROJ-123', id: '1000' } });
            const res = await callTool('jira_create_issue', { projectKey: 'PROJ', issueType: 'Bug', summary: 'Success', confirm: true });
            const data = JSON.parse(res.content[0].text);
            expect(data.key).toBe('PROJ-123');
            expect(mockAxios.request).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', url: expect.stringContaining('issue') }));
        });
    });

    describe('jira_list_projects', () => {
        it('should return projects', async () => {
            mockAxios.request.mockResolvedValue({ data: [{ key: 'PROJ', name: 'Project' }] });
            const res = await callTool('jira_list_projects');
            if (res.isError) {
                throw new Error(`Tool returned error: ${res.content[0].text}`);
            }
            const data = JSON.parse(res.content[0].text);
            expect(data).toHaveLength(1);
            expect(data[0].key).toBe('PROJ');
        });
    });
});
