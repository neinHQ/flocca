// server requirement moved down to after mock
const { createGitLabServer } = require('../server'); 
const axios = require('axios');

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

describe('GitLab MCP Logic', () => {
    let server;
    let mockAxios;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        process.env.GITLAB_TOKEN = 'test-token';
        
        mockAxios = require('axios');
        const { createGitLabServer } = require('../server');
        server = createGitLabServer();
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
        it('gitlab_create_branch requires confirm: true', async () => {
            const res = await callTool('gitlab_create_branch', { project_id: 123, branch_name: 'b1', ref: 'main', confirm: false });
            expect(res.isError).toBe(true);
            expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
            expect(mockAxios.post).not.toHaveBeenCalled();
        });

        it('gitlab_trigger_pipeline requires confirm: true', async () => {
            const res = await callTool('gitlab_trigger_pipeline', { project_id: 123, ref: 'main', confirm: false });
            expect(res.isError).toBe(true);
            expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
            expect(mockAxios.post).not.toHaveBeenCalled();
        });
    });

    describe('gitlab_health', () => {
        it('should verify connection', async () => {
            mockAxios.get.mockResolvedValue({ data: { username: 'test-user' } });
            const result = await callTool('gitlab_health');
            const data = JSON.parse(result.content[0].text);
            expect(data.ok).toBe(true);
            expect(mockAxios.get).toHaveBeenCalledWith('/user');
        });
    });

    describe('gitlab_list_projects', () => {
        it('should return projects', async () => {
            mockAxios.get.mockResolvedValue({
                data: [{ id: 1, name: 'P1', path_with_namespace: 'o/p1', web_url: 'http://gitlab.com/o/p1' }]
            });

            const result = await callTool('gitlab_list_projects', { search: 'test' });
            const data = JSON.parse(result.content[0].text);

            expect(data).toHaveLength(1);
            expect(data[0].name).toBe('P1');
            expect(mockAxios.get).toHaveBeenCalledWith('/projects', expect.objectContaining({
                params: expect.objectContaining({ search: 'test' })
            }));
        });
    });
});
