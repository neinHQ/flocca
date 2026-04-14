const { createZephyrServer } = require('../server');

global.fetch = jest.fn();

describe('Zephyr Scale Logic', () => {
    let server;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.ZEPHYR_SITE_URL = 'http://zephyr.local';
        process.env.ZEPHYR_TOKEN = 'test-token';
        process.env.ZEPHYR_JIRA_PROJECT_KEY = 'PROJ';
        server = createZephyrServer();
    });

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return await tool.handler(args);
    };

    describe('zephyr_health', () => {
        it('should verify health and identity', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ accountId: 'id123' })
            });
            const res = await callTool('zephyr_health');
            const data = JSON.parse(res.content[0].text);
            expect(data.ok).toBe(true);
            expect(data.identity).toBe('id123');
        });
    });

    describe('zephyr_create_test_case', () => {
        it('should block if not confirmed', async () => {
            const res = await callTool('zephyr_create_test_case', { title: 'T1', confirm: false });
            expect(res.isError).toBe(true);
            expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
        });

        it('should create test case if confirmed', async () => {
            // Identity probe
            fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ accountId: 'u1' }) });
            // Create call
            fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ key: 'T-1' }) });
            
            const res = await callTool('zephyr_create_test_case', { title: 'T1', confirm: true });
            const data = JSON.parse(res.content[0].text);
            expect(data.key).toBe('T-1');
            expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/testcase'), expect.objectContaining({ method: 'POST' }));
        });
    });
});
