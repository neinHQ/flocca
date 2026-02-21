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

describe('Jira MCP Schema Compatibility', () => {
    test('jira_get_issue accepts issue_key and issueKey and returns explicit error when missing', async () => {
        const harness = createRpcHarness({
            JIRA_SITE_URL: 'https://jira.example.com',
            JIRA_EMAIL: 'user@example.com',
            JIRA_API_TOKEN: 'token'
        });

        try {
            const init = await harness.request('initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test', version: '1.0' }
            });
            expect(init.error).toBeUndefined();

            const withSnake = await harness.request('tools/call', {
                name: 'jira_get_issue',
                arguments: { issue_key: 'JIRA-1' }
            });
            expect(withSnake.error).toBeUndefined();
            expect(withSnake.result).toBeDefined();

            const withCamel = await harness.request('tools/call', {
                name: 'jira_get_issue',
                arguments: { issueKey: 'JIRA-2' }
            });
            expect(withCamel.error).toBeUndefined();
            expect(withCamel.result).toBeDefined();

            const missing = await harness.request('tools/call', {
                name: 'jira_get_issue',
                arguments: {}
            });
            expect(missing.error).toBeUndefined();
            expect(missing.result?.isError).toBe(true);
            const text = JSON.stringify(missing.result?.content || []);
            expect(text).toContain('issue_key (or issueKey) is required');
        } finally {
            harness.close();
        }
    }, 30000);
});

