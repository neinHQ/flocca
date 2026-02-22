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
        if (!server.killed) server.kill();
    };

    return { request, close };
}

describe('Zephyr MCP schema compatibility', () => {
    test('tool names are VS Code compatible and calls do not fail schema parsing', async () => {
        const harness = createRpcHarness();

        try {
            const init = await harness.request('initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test', version: '1.0' }
            });
            expect(init.error).toBeUndefined();

            const list = await harness.request('tools/list');
            expect(list.error).toBeUndefined();
            const names = (list.result?.tools || []).map((t) => t.name);
            expect(names.length).toBeGreaterThan(0);
            for (const name of names) {
                expect(name).toMatch(/^[a-z0-9_-]+$/);
            }

            const search = await harness.request('tools/call', {
                name: 'zephyr_search_test_cases',
                arguments: { query: 'smoke' }
            });
            expect(search.error).toBeUndefined();
            expect(search.result).toBeDefined();

            const getOne = await harness.request('tools/call', {
                name: 'zephyr_get_test_case',
                arguments: { key: 'TC-1' }
            });
            expect(getOne.error).toBeUndefined();
            expect(getOne.result).toBeDefined();
        } finally {
            harness.close();
        }
    }, 30000);
});
