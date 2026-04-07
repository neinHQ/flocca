const cp = require('child_process');
const path = require('path');

const serverPath = path.join(__dirname, '../server.js');

function createRpcHarness(env = {}) {
    const server = cp.spawn('node', [serverPath], {
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe']
    });

    let nextId = 1;
    let buffer = '';
    const pending = new Map();

    server.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const msg = JSON.parse(line);
                if (msg.id && pending.has(msg.id)) {
                    const resolver = pending.get(msg.id);
                    pending.delete(msg.id);
                    resolver(msg);
                }
            } catch {
                // ignore non-JSON lines
            }
        }
    });

    const request = (method, params) => {
        const id = nextId++;
        const payload = { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) };
        const promise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`Timed out waiting for response to ${method}`));
            }, 10000);

            pending.set(id, (msg) => {
                clearTimeout(timeout);
                resolve(msg);
            });
        });
        server.stdin.write(JSON.stringify(payload) + '\n');
        return promise;
    };

    const close = () => {
        if (!server.killed) {
            server.kill();
        }
    };

    return { request, close };
}

describe('Confluence MCP Schema Compatibility', () => {
    test('Server tools use Zod and avoid safeParseAsync crashes', async () => {
        const harness = createRpcHarness({
            CONFLUENCE_USERNAME: 'user',
            CONFLUENCE_TOKEN: 'token',
            CONFLUENCE_BASE_URL: 'https://confluence.example.com'
        });

        try {
            const init = await harness.request('initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test', version: '1.0' }
            });
            expect(init.error).toBeUndefined();

            const toolsList = await harness.request('tools/list', {});
            expect(toolsList.error).toBeUndefined();
            expect(toolsList.result.tools).toBeDefined();

            // Find the health tool to test
            const healthTool = toolsList.result.tools.find(t => t.name === 'confluence_health' || t.name === 'confluence.health');
            expect(healthTool).toBeDefined();

            // Calling the tool with no arguments to ensure MCP SDK successfully calls safeParseAsync (because it's now a Zod schema).
            const callRes = await harness.request('tools/call', {
                name: healthTool.name,
                arguments: {}
            });
            
            // The JSON-RPC itself shouldn't have thrown an error from MCP's router (which happens if schemas are invalid).
            expect(callRes.error).toBeUndefined();
            // Since it's a fake URL, we expect an explicit tool error response from axios, but NOT an MCP validation crash.
            expect(callRes.result?.isError).toBe(true);

        } finally {
            harness.close();
        }
    }, 30000);
});
