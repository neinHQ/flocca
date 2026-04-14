const { createPytestServer } = require('../server');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

jest.mock('child_process');

describe('Pytest MCP Logic', () => {
    let server;
    let mockChild;

    beforeEach(() => {
        jest.clearAllMocks();
        server = createPytestServer();

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
            mockChild.stdout.emit('data', 'Pytest output');
            mockChild.emit('close', 0);
        }, 10);

        return await handlerPromise;
    };

    describe('pytest_health', () => {
        it('should verify pytest version', async () => {
            const res = await callTool('pytest_health');
            const data = JSON.parse(res.content[0].text);
            expect(data.ok).toBe(true);
            expect(data.version).toContain('Pytest output');
            expect(spawn).toHaveBeenCalledWith('pytest', expect.arrayContaining(['--version']), expect.anything());
        });
    });

    describe('pytest_run_all', () => {
        it('should execute pytest', async () => {
            const res = await callTool('pytest_run_all', { directory: 'tests/unit' });
            expect(res.content[0].text).toContain('Pytest output');
            expect(spawn).toHaveBeenCalledWith('pytest', expect.arrayContaining(['tests/unit']), expect.anything());
        });
    });

    describe('pytest_run_file', () => {
        it('should run a specific file', async () => {
            const res = await callTool('pytest_run_file', { path: 'tests/test_api.py' });
            expect(res.content[0].text).toContain('Pytest output');
            expect(spawn).toHaveBeenCalledWith('pytest', expect.arrayContaining(['tests/test_api.py']), expect.anything());
        });
    });
});
