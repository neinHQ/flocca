
const cp = require('child_process');
const path = require('path');

const serverPath = path.join(__dirname, '../server.js');

describe('Zephyr Enterprise MCP Server Smoke Test', () => {
    let server;

    afterEach(() => {
        if (server) server.kill();
    });

    it('should list registered tools', (done) => {
        server = cp.spawn('node', [serverPath], {
            env: { ...process.env },
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let buffer = '';
        server.stdout.on('data', (data) => {
            buffer += data.toString();
            const lines = buffer.split('\n');
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const msg = JSON.parse(line);
                    if (msg.result && msg.id === 1) {
                        const tools = msg.result.tools;
                        const names = tools.map(t => t.name);
                        expect(names).toContain('zephyr_enterprise_configure');
                        expect(names).toContain('zephyr_enterprise_health');
                        expect(names).toContain('zephyr_enterprise_search_test_cases');
                        expect(names).toContain('zephyr_enterprise.searchTestCases');
                        expect(names).toContain('zephyr_enterprise_create_release');
                        expect(names).toContain('zephyr_enterprise_update_release');
                        for (const name of names) {
                            expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
                        }
                        done();
                    }
                } catch (e) {
                    // ignore
                }
            }
        });

        const initReq = JSON.stringify({
            jsonrpc: '2.0',
            id: 0,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test', version: '1.0' }
            }
        });

        server.stdin.write(initReq + '\n');

        const listReq = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list'
        });

        server.stdin.write(listReq + '\n');
    }, 10000);
});
