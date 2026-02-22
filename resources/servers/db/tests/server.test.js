const cp = require('child_process');
const path = require('path');

const serverPath = path.join(__dirname, '../server.js');

describe('DB MCP Server', () => {
    let server;

    afterEach(() => {
        if (server) server.kill();
    });

    it('registers VS Code compatible tool names', (done) => {
        server = cp.spawn('node', [serverPath], {
            env: { ...process.env },
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let buffer = '';
        server.stdout.on('data', (data) => {
            buffer += data.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const msg = JSON.parse(line);
                    if (msg.result && msg.id === 1) {
                        const names = (msg.result.tools || []).map((t) => t.name);
                        expect(names.length).toBeGreaterThan(0);
                        expect(names).toContain('db_connect');
                        expect(names).toContain('db_get_schema');
                        expect(names).toContain('db_query');
                        for (const name of names) {
                            expect(name).toMatch(/^[a-z0-9_-]+$/);
                        }
                        done();
                    }
                } catch {
                    // ignore non-JSON lines
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
    }, 15000);
});
