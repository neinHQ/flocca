const { createConfluenceServer } = require('../server');
const axios = require('axios');

jest.mock('axios');

describe('Confluence Hardening Validation', () => {
    let server;
    let confluence;
    let mockAxios;

    beforeEach(() => {
        jest.clearAllMocks();
        
        mockAxios = {
            get: jest.fn().mockResolvedValue({ data: {} }),
            post: jest.fn().mockResolvedValue({ data: {} }),
            put: jest.fn().mockResolvedValue({ data: {} }),
            request: jest.fn().mockResolvedValue({ data: {} })
        };
        server = createConfluenceServer();
        confluence = server.__test;
        confluence.setConfig({ baseUrl: 'http://conf.local', token: 'test-token' });
        
        // Mock axios as a function to match confluenceRequest implementation
        axios.mockImplementation((config) => {
            const method = config.method.toLowerCase();
            if (method === 'get') return mockAxios.get(config.url, config);
            if (method === 'post') return mockAxios.post(config.url, config.data, config);
            if (method === 'put') return mockAxios.put(config.url, config.data, config);
            return mockAxios.request(config);
        });
    });

    const callTool = async (name, args) => {
        const tool = server._registeredTools[name];
        return await tool.handler(args);
    };

    describe('Safety Gates', () => {
        const mutationTools = [
            'confluence_create_page',
            'confluence_update_page',
            'confluence_attach_file'
        ];

        mutationTools.forEach(name => {
            it(`should block ${name} if not confirmed`, async () => {
                const res = await callTool(name, { confirm: false });
                expect(res.isError).toBe(true);
                expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
            });
        });
    });
});
