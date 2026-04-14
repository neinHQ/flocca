const { createPlaywrightServer } = require('../server');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

jest.mock('child_process');

describe('Playwright MCP Logic', () => {
    let server;
    let mockChild;

    beforeEach(() => {
        jest.clearAllMocks();
        server = createPlaywrightServer();

        mockChild = new EventEmitter();
        mockChild.stdout = new EventEmitter();
        mockChild.stderr = new EventEmitter();
        spawn.mockReturnValue(mockChild);
    });

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        const handlerPromise = tool.handler(args);
        
        // Wait bit for process to start
        setTimeout(() => {
            mockChild.stdout.emit('data', 'Test result output');
            mockChild.emit('close', 0);
        }, 10);

        return await handlerPromise;
    };

    describe('playwright_health', () => {
        it('should verify playwright version', async () => {
            const res = await callTool('playwright_health');
            const data = JSON.parse(res.content[0].text);
            expect(data.ok).toBe(true);
            expect(data.version).toContain('Test result output');
            expect(spawn).toHaveBeenCalledWith('npx', expect.arrayContaining(['playwright', '--version']), expect.anything());
        });
    });

    describe('playwright_run_all', () => {
        it('should execute npx playwright test', async () => {
            const res = await callTool('playwright_run_all', { project: 'chromium' });
            expect(res.content[0].text).toContain('Test result output');
            expect(spawn).toHaveBeenCalledWith('npx', expect.arrayContaining(['playwright', 'test', '--project', 'chromium']), expect.anything());
        });
    });

    describe('playwright_run_spec', () => {
        it('should run a specific spec file', async () => {
            const res = await callTool('playwright_run_spec', { spec_path: 'auth.spec.js' });
            expect(res.content[0].text).toContain('Test result output');
            expect(spawn).toHaveBeenCalledWith('npx', expect.arrayContaining(['playwright', 'test', 'auth.spec.js']), expect.anything());
        });
    });
});
