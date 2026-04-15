const { createZephyrEnterpriseServer } = require('../server');

global.fetch = jest.fn();

describe('Zephyr Enterprise Logic', () => {
    let server;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.ZEPHYR_ENT_BASE_URL = 'http://zephyr-ent.local';
        process.env.ZEPHYR_ENT_USERNAME = 'admin';
        process.env.ZEPHYR_ENT_TOKEN = 'test-token';
        process.env.ZEPHYR_ENT_PROJECT_ID = '1';
        server = createZephyrEnterpriseServer();
    });

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return await tool.handler(args);
    };

    describe('zephyr_enterprise_health', () => {
        it('should detect API family and report health', async () => {
            // API detection call
            fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
            
            const res = await callTool('zephyr_enterprise_health');
            const data = JSON.parse(res.content[0].text);
            expect(data.ok).toBe(true);
            expect(data.api_family).toBe('public');
        });
    });

    describe('zephyr_enterprise_create_test_case', () => {
        it('should block if not confirmed', async () => {
            const res = await callTool('zephyr_enterprise_create_test_case', { name: 'T1', confirm: false });
            expect(res.isError).toBe(true);
            expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
        });

        it('should create test case if confirmed (Public API)', async () => {
            // API detection
            fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
            // Create call
            fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 555 }) });
            
            const res = await callTool('zephyr_enterprise_create_test_case', { name: 'T1', confirm: true });
            const data = JSON.parse(res.content[0].text);
            expect(data.id).toBe(555);
            expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/public/rest/api/1.0/testcase'), expect.objectContaining({ method: 'POST' }));
        });
    });

    describe('zephyr_enterprise_update_test_case', () => {
        it('should block if not confirmed', async () => {
            const res = await callTool('zephyr_enterprise_update_test_case', { id: 1, confirm: false });
            expect(res.isError).toBe(true);
            expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
        });

        it('should update name only', async () => {
            fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // detection
            fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 1, name: 'Renamed' }) });
            
            const res = await callTool('zephyr_enterprise_update_test_case', { id: 1, name: 'Renamed', confirm: true });
            const data = JSON.parse(res.content[0].text);
            expect(data.name).toBe('Renamed');
            expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/public/rest/api/1.0/testcases/1'), expect.objectContaining({ method: 'PUT' }));
        });

        it('should append steps only', async () => {
            fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // detection
            fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 99 }) }); // step mock response
            
            const res = await callTool('zephyr_enterprise_update_test_case', { id: 1, steps: [{ step: 's1' }], confirm: true });
            const data = JSON.parse(res.content[0].text);
            expect(data.added_steps[0].id).toBe(99);
            expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/public/rest/api/1.0/teststep/1'), expect.objectContaining({ method: 'POST' }));
        });
    });

    describe('zephyr_enterprise_create_tcr_folder', () => {
        it('should block if not confirmed', async () => {
            const res = await callTool('zephyr_enterprise_create_tcr_folder', { name: 'Folder1', confirm: false });
            expect(res.isError).toBe(true);
            expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
        });

        it('should create folder if confirmed (Public API)', async () => {
            fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // detection
            fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 777 }) });
            
            const res = await callTool('zephyr_enterprise_create_tcr_folder', { name: 'Folder1', confirm: true });
            const data = JSON.parse(res.content[0].text);
            expect(data.id).toBe(777);
            expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/public/rest/api/1.0/folders'), expect.objectContaining({ method: 'POST' }));
        });
    });
});
