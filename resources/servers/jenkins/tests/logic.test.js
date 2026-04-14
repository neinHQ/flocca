const { createJenkinsServer } = require('../server');
const axios = require('axios');

jest.mock('axios');

describe('Jenkins MCP Logic', () => {
    let server;
    let mockAxios;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.JENKINS_URL = 'http://jenkins.local';
        process.env.JENKINS_USER = 'admin';
        process.env.JENKINS_TOKEN = 'token';
        
        mockAxios = {
            get: jest.fn(),
            post: jest.fn()
        };
        axios.create.mockReturnValue(mockAxios);
        server = createJenkinsServer();
    });

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return await tool.handler(args);
    };

    describe('jenkins_health', () => {
        it('should verify connection and fetch crumb', async () => {
            mockAxios.get
                .mockResolvedValueOnce({ data: { nodeName: 'master' } }) // Health check
                .mockResolvedValueOnce({ data: { crumbRequestField: 'Jenkins-Crumb', crumb: 'abc' } }); // Crumb discovery
            
            const res = await callTool('jenkins_health');
            const data = JSON.parse(res.content[0].text);
            expect(data.ok).toBe(true);
            expect(mockAxios.get).toHaveBeenCalledWith('/api/json');
        });
    });

    describe('jenkins_build_job', () => {
        it('should block if not confirmed', async () => {
            const res = await callTool('jenkins_build_job', { 
                job_name: 'j1', confirm: false 
            });
            expect(res.isError).toBe(true);
            expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
        });

        it('should build if confirmed with crumb', async () => {
            // Setup crumb first
            mockAxios.get.mockResolvedValueOnce({ data: { crumbRequestField: 'C', crumb: 'v' } });
            // The first call that needs ensureConnected will fetch crumb
            mockAxios.post.mockResolvedValue({ status: 201 });
            
            const res = await callTool('jenkins_build_job', { 
                job_name: 'j1', confirm: true 
            });
            expect(res.content[0].text).toContain('triggered');
            expect(mockAxios.post).toHaveBeenCalledWith('/job/j1/build', null, expect.any(Object));
        });
    });

    describe('jenkins_get_console_output', () => {
        it('should return logs', async () => {
            mockAxios.get.mockResolvedValue({ data: 'hello world logs' });
            const res = await callTool('jenkins_get_console_output', { 
                job_name: 'j1', build_number: 1 
            });
            expect(res.content[0].text).toBe('hello world logs');
            expect(mockAxios.get).toHaveBeenCalledWith('/job/j1/1/consoleText');
        });
    });
});
