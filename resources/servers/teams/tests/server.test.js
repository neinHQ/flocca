
const cp = require('child_process');
const path = require('path');

const serverPath = path.join(__dirname, '../server.js');

describe('Teams MCP Server Smoke Test', () => {
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
                        expect(names).toContain('teams.configure');
                        expect(names).toContain('teams.listTeams');
                        expect(names).toContain('teams.sendChannelMessage');
                        done();
                    }
                } catch (e) {
                    // ignore partial json
                }
            }
        });

        // We need to initialize first per MCP spec? 
        // The SDK might require initialize.
        // Let's send initialize then tools/list.

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

        // We wait for init result? Or just blast tools/list?
        // Async handling suggests we should wait, but for a test we can just write both sequential line-delimited.

        const listReq = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list'
        });

        server.stdin.write(listReq + '\n');
    }, 10000); // 10s timeout
});
