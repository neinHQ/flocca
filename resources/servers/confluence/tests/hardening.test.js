const { createConfluenceServer } = require('../server');

describe('Confluence Hardening Validation', () => {
    let server;
    let confluence;

    beforeEach(() => {
        const instance = createConfluenceServer();
        server = instance.server;
        confluence = instance.__test;
        confluence.setConfig({ baseUrl: 'http://conf.local', token: 'test-token' });
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
