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

describe('zephyr_enterprise_list_tcr_folders subfolder drilling', () => {
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

    test('tool is registered and inputSchema exposes parent_id, recursive, and max_depth', async () => {
        const list = await harness.request('tools/list');
        expect(list.error).toBeUndefined();

        const tool = (list.result?.tools || []).find(t => t.name === 'zephyr_enterprise_list_tcr_folders');
        expect(tool).toBeDefined();

        const props = tool.inputSchema?.properties || {};
        expect(props.parent_id).toBeDefined();
        expect(props.parent_id.type).toBe('number');
        expect(props.parent_id.description).toContain('tcrCatalogTreeId');

        expect(props.recursive).toBeDefined();
        expect(props.recursive.type).toBe('boolean');

        expect(props.max_depth).toBeDefined();
        expect(props.max_depth.type).toBe('number');
    }, 15000);

    test('description instructs the AI on the drilling workflow', async () => {
        const list = await harness.request('tools/list');
        const tool = (list.result?.tools || []).find(t => t.name === 'zephyr_enterprise_list_tcr_folders');
        expect(tool?.description).toContain('parent_id');
        expect(tool?.description).toContain('top-level');
    }, 15000);

    test('calling with no args returns a result (root-level fetch, no crash)', async () => {
        const res = await harness.request('tools/call', {
            name: 'zephyr_enterprise_list_tcr_folders',
            arguments: {}
        });
        // Without a live server it will fail HTTP, but it must NOT fail schema parsing
        expect(res.error).toBeUndefined();
        expect(res.result).toBeDefined();
    }, 15000);

    test('calling with parent_id passes schema validation (no INVALID_PARAMS error)', async () => {
        const res = await harness.request('tools/call', {
            name: 'zephyr_enterprise_list_tcr_folders',
            arguments: { parent_id: 935 }
        });
        // Schema validation must pass — MCP-level error would have code -32602
        expect(res.error).toBeUndefined();
        expect(res.result).toBeDefined();
        // The tool either returns a network error or data — but not a schema rejection
        const text = JSON.stringify(res.result?.content || []);
        expect(text).not.toContain('Input validation error');
    }, 15000);

    test('calling with recursive=true passes schema validation', async () => {
        const res = await harness.request('tools/call', {
            name: 'zephyr_enterprise_list_tcr_folders',
            arguments: { recursive: true, max_depth: 2 }
        });
        expect(res.error).toBeUndefined();
        expect(res.result).toBeDefined();
        const text = JSON.stringify(res.result?.content || []);
        expect(text).not.toContain('Input validation error');
    }, 15000);

    test('calling with unknown extra field is rejected by schema (additionalProperties: false)', async () => {
        const res = await harness.request('tools/call', {
            name: 'zephyr_enterprise_list_tcr_folders',
            arguments: { bogus_field: 'should-fail' }
        });
        expect(res.error).toBeUndefined();
        // The result should be an error response (isError: true) since additionalProperties is false
        expect(res.result?.isError).toBe(true);
        const text = JSON.stringify(res.result?.content || []);
        expect(text).toContain('Input validation error');
    }, 15000);
});
