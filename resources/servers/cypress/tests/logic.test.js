const { createCypressServer, config } = require('../server');
const cp = require('child_process');
const fs = require('fs');
const glob = require('glob');
const EventEmitter = require('events');

jest.mock('child_process');
jest.mock('fs');
jest.mock('glob');

describe('Cypress MCP Logic Tests', () => {
    let server;
    let mockSpawn;

    beforeEach(() => {
        jest.clearAllMocks();
        server = createCypressServer();
        mockSpawn = cp.spawn;
        config.projectRoot = '/mock/project';
    });

    const setupMockProcess = ({ code = 0, stdout = '', stderr = '' } = {}) => {
        const stdoutEmitter = new EventEmitter();
        const stderrEmitter = new EventEmitter();
        const processEmitter = new EventEmitter();
        processEmitter.stdout = stdoutEmitter;
        processEmitter.stderr = stderrEmitter;
        processEmitter.stdin = { write: jest.fn(), end: jest.fn() };

        mockSpawn.mockReturnValue(processEmitter);

        setImmediate(() => {
            if (stdout) stdoutEmitter.emit('data', stdout);
            if (stderr) stderrEmitter.emit('data', stderr);
            processEmitter.emit('close', code);
        });
    };

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return await tool.handler(args);
    };

    describe('cypress_run_spec', () => {
        it('should correctly build CLI arguments and parse JSON results', async () => {
            const mockJson = JSON.stringify({ stats: { tests: 1, passes: 1, failures: 0 } });
            setupMockProcess({ stdout: `Cypress output... ${mockJson}` });

            const res = await callTool('cypress_run_spec', { spec: 'test.cy.js', headed: true });
            const data = JSON.parse(res.content[0].text);
            
            expect(data.status).toBe('passed');
            expect(data.results.stats.passes).toBe(1);
            
            const calledArgs = mockSpawn.mock.calls[0][1];
            expect(calledArgs).toContain('--spec');
            expect(calledArgs).toContain('test.cy.js');
            expect(calledArgs).toContain('--headed');
            expect(calledArgs).toContain('--reporter');
            expect(calledArgs).toContain('json');
        });
    });

    describe('cypress_list_specs', () => {
        it('should return found spec files', async () => {
            glob.sync.mockReturnValue(['login.cy.js', 'signup.cy.js']);
            
            const res = await callTool('cypress_list_specs');
            const data = JSON.parse(res.content[0].text);
            
            expect(data.specs).toContain('login.cy.js');
            expect(data.specs).toHaveLength(2);
        });
    });

    describe('cypress_get_failed_tests', () => {
        it('should extract failures from raw stdout', async () => {
            const mockStdout = JSON.stringify({
                stats: { failures: 1 },
                failures: [{ fullTitle: 'Login fails', err: { message: 'Wrong password', stack: '...' } }]
            });

            const res = await callTool('cypress_get_failed_tests', { stdout: mockStdout });
            const data = JSON.parse(res.content[0].text);
            
            expect(data.count).toBe(1);
            expect(data.failures[0].title).toBe('Login fails');
        });
    });
});
