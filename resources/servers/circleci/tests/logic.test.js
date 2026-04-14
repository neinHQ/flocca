const { createCircleCiServer } = require('../server');
const axios = require('axios');

jest.mock('axios');

describe('CircleCI MCP Logic', () => {
    let server;
    let mockAxios;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.CIRCLECI_TOKEN = 'test-token';
        
        mockAxios = {
            get: jest.fn(),
            post: jest.fn()
        };
        axios.create.mockReturnValue(mockAxios);
        server = createCircleCiServer();
    });

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return await tool.handler(args);
    };

    describe('circleci_health', () => {
        it('should verify connection', async () => {
            mockAxios.get.mockResolvedValue({ data: { login: 'testuser' } });
            const res = await callTool('circleci_health');
            const data = JSON.parse(res.content[0].text);
            expect(data.ok).toBe(true);
            expect(data.user).toBe('testuser');
            expect(mockAxios.get).toHaveBeenCalledWith('/me');
        });
    });

    describe('circleci_trigger_pipeline', () => {
        it('should block if not confirmed', async () => {
            const res = await callTool('circleci_trigger_pipeline', { 
                project_slug: 'gh/o/r', confirm: false 
            });
            expect(res.isError).toBe(true);
            expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
        });

        it('should trigger if confirmed', async () => {
            mockAxios.post.mockResolvedValue({ data: { id: 'p123' } });
            const res = await callTool('circleci_trigger_pipeline', { 
                project_slug: 'gh/o/r', confirm: true 
            });
            const data = JSON.parse(res.content[0].text);
            expect(data.id).toBe('p123');
            expect(mockAxios.post).toHaveBeenCalledWith('/project/gh/o/r/pipeline', expect.any(Object));
        });
    });

    describe('circleci_list_pipelines', () => {
        it('should return project pipelines', async () => {
            mockAxios.get.mockResolvedValue({ data: { items: [{ id: 'pip1' }] } });
            const res = await callTool('circleci_list_pipelines', { project_slug: 'gh/o/r' });
            const data = JSON.parse(res.content[0].text);
            expect(data.items).toHaveLength(1);
            expect(data.items[0].id).toBe('pip1');
        });
    });

    describe('circleci_rerun_workflow', () => {
        it('should block if not confirmed', async () => {
            const res = await callTool('circleci_rerun_workflow', { 
                workflow_id: 'w1', confirm: false 
            });
            expect(res.isError).toBe(true);
            expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
        });

        it('should rerun if confirmed', async () => {
            mockAxios.post.mockResolvedValue({ data: { id: 'retry1' } });
            const res = await callTool('circleci_rerun_workflow', { 
                workflow_id: 'w1', from_failed: true, confirm: true 
            });
            const data = JSON.parse(res.content[0].text);
            expect(data.id).toBe('retry1');
            expect(mockAxios.post).toHaveBeenCalledWith('/workflow/w1/rerun', { from_failed: true });
        });
    });

    describe('circleci_get_job_details', () => {
        it('should return job details', async () => {
            mockAxios.get.mockResolvedValue({ data: { name: 'build_job' } });
            const res = await callTool('circleci_get_job_details', { 
                project_slug: 'gh/o/r', job_number: 1 
            });
            const data = JSON.parse(res.content[0].text);
            expect(data.name).toBe('build_job');
            expect(mockAxios.get).toHaveBeenCalledWith('/project/gh/o/r/job/1');
        });
    });
});
