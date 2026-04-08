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
                // ignore
            }
        }
    });

    const request = (method, params) => {
        const id = nextId++;
        const payload = { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) };
        const promise = new Promise((resolve) => {
            const timeout = setTimeout(() => {
                pending.delete(id);
                resolve({ error: { message: `Timed out waiting for response to ${method}` } });
            }, 5000);

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

describe('Zephyr Enterprise Release Tools Schema & Validation', () => {
    let harness;

    beforeAll(async () => {
        harness = createRpcHarness();
        await harness.request('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0' }
        });
    });

    afterAll(() => {
        harness.close();
    });

    describe('zephyr_enterprise_create_release', () => {
        test('is registered with correct description and mandatory fields', async () => {
            const list = await harness.request('tools/list');
            const tool = (list.result?.tools || []).find(t => t.name === 'zephyr_enterprise_create_release');
            expect(tool).toBeDefined();
            expect(tool.inputSchema.required).toContain('name');
            expect(tool.inputSchema.properties.name.type).toBe('string');
        });

        test('accepts valid arguments and attempts execution', async () => {
            const res = await harness.request('tools/call', {
                name: 'zephyr_enterprise_create_release',
                arguments: {
                    name: 'v1.0.0',
                    description: 'Public Beta',
                    start_date: '2026-04-01T00:00:00Z'
                }
            });
            expect(res.error).toBeUndefined();
            // Should fail network call (no live backend) but not schema validation
            const text = JSON.stringify(res.result?.content || []);
            expect(text).not.toContain('Input validation error');
        });

        test('rejects missing name', async () => {
            const res = await harness.request('tools/call', {
                name: 'zephyr_enterprise_create_release',
                arguments: {
                    description: 'Forgot the name'
                }
            });
            expect(JSON.stringify(res.result?.content || [])).toContain('Input validation error');
        });
    });

    describe('zephyr_enterprise_update_release', () => {
        test('is registered and requires id', async () => {
            const list = await harness.request('tools/list');
            const tool = (list.result?.tools || []).find(t => t.name === 'zephyr_enterprise_update_release');
            expect(tool).toBeDefined();
            expect(tool.inputSchema.required).toContain('id');
        });

        test('accepts valid update arguments', async () => {
            const res = await harness.request('tools/call', {
                name: 'zephyr_enterprise_update_release',
                arguments: {
                    id: 101,
                    status: 'Released',
                    end_date: '2026-05-01T00:00:00Z'
                }
            });
            expect(res.error).toBeUndefined();
            const text = JSON.stringify(res.result?.content || []);
            expect(text).not.toContain('Input validation error');
        });

        test('rejects if no updateable fields are provided', async () => {
            const res = await harness.request('tools/call', {
                name: 'zephyr_enterprise_update_release',
                arguments: { id: 101 }
            });
            // This is caught by requireAtLeastOneField tool-side, so it returns a "normal" tool error (isError: true)
            expect(res.result?.isError).toBe(true);
            expect(JSON.stringify(res.result.content)).toContain('At least one updatable field is required');
        });

        test('rejects additional properties', async () => {
            const res = await harness.request('tools/call', {
                name: 'zephyr_enterprise_update_release',
                arguments: {
                    id: 101,
                    bogus: 'fail'
                }
            });
            expect(JSON.stringify(res.result?.content || [])).toContain('Input validation error');
        });
    });
});
