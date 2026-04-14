// server requirement moved down to after mock
const { createGcpServer } = require('../server'); 

// Mock global fetch
global.fetch = jest.fn();

describe('GCP MCP Logic', () => {
    let server;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        process.env.GCP_PROJECT_ID = 'test-proj';
        process.env.GCP_ACCESS_TOKEN = 'test-token';
        const { createGcpServer } = require('../server');
        server = createGcpServer();
    });

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        const result = await tool.handler(args);
        if (result.isError) {
            console.error(`Tool ${name} failed:`, result.content[0].text);
        }
        return result;
    };

    describe('Safety Gates', () => {
        it('gcp_compute_stop_instance requires confirm: true', async () => {
            const res = await callTool('gcp_compute_stop_instance', { zone: 'z1', name: 'vm1', confirm: false });
            expect(res.isError).toBe(true);
            expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
        });

        it('gcp_storage_put_object requires confirm: true', async () => {
            const res = await callTool('gcp_storage_put_object', { bucket: 'b1', object: 'o1', content: 'hi', confirm: false });
            expect(res.isError).toBe(true);
            expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
        });

        it('gcp_pubsub_publish_message requires confirm: true', async () => {
            const res = await callTool('gcp_pubsub_publish_message', { topic: 't1', data: 'hi', confirm: false });
            expect(res.isError).toBe(true);
            expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
        });
    });

    describe('gcp_health', () => {
        it('should fetch project info', async () => {
            fetch.mockResolvedValue({
                ok: true,
                json: async () => ({ projectNumber: '123' })
            });

            const result = await callTool('gcp_health');
            const data = JSON.parse(result.content[0].text);

            expect(data.ok).toBe(true);
            expect(data.project_number).toBe('123');
        });
    });

    describe('gcp_logging_query_logs', () => {
        it('should parse time range and format body', async () => {
            fetch.mockResolvedValue({
                ok: true,
                json: async () => ({ entries: [{ insertId: 'e1', textPayload: 'hello' }] })
            });

            await callTool('gcp_logging_query_logs', { filter: 'textPayload:hello', limit: 10 });
            
            expect(fetch).toHaveBeenCalledWith(
                expect.stringContaining('/v2/entries:list'),
                expect.objectContaining({
                    method: 'POST',
                    body: expect.stringContaining('"pageSize":10')
                })
            );
        });
    });
});
