const { createSlackServer } = require('../server');
const axios = require('axios');

jest.mock('axios');

describe('Slack MCP Logic', () => {
    let server;
    let mockAxios;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.SLACK_BOT_TOKEN = 'xoxb-test';
        
        mockAxios = {
            get: jest.fn(),
            post: jest.fn(),
            put: jest.fn(),
            request: jest.fn()
        };
        axios.create.mockReturnValue(mockAxios);
        server = createSlackServer();
    });

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return await tool.handler(args);
    };

    describe('slack_health', () => {
        it('should verify connection', async () => {
            mockAxios.request.mockResolvedValue({ data: { ok: true } });
            const res = await callTool('slack_health');
            const data = JSON.parse(res.content[0].text);
            expect(data.ok).toBe(true);
            expect(mockAxios.request).toHaveBeenCalledWith(expect.objectContaining({ url: 'auth.test' }));
        });
    });

    describe('slack_send_message', () => {
        it('should block if not confirmed', async () => {
            const res = await callTool('slack_send_message', { channel: 'C1', text: 'hi', confirm: false });
            expect(res.isError).toBe(true);
            expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
        });

        it('should send message if confirmed', async () => {
            mockAxios.request.mockResolvedValue({ data: { ok: true, ts: '123.456' } });
            const res = await callTool('slack_send_message', { channel: 'C1', text: 'hi', confirm: true });
            const data = JSON.parse(res.content[0].text);
            expect(data.ok).toBe(true);
            expect(data.ts).toBe('123.456');
        });
    });

    describe('slack_list_channels', () => {
        it('should return channels', async () => {
            mockAxios.request.mockResolvedValue({ 
                data: { 
                    ok: true, 
                    channels: [{ id: 'C1', name: 'general' }],
                    response_metadata: {}
                } 
            });
            const res = await callTool('slack_list_channels');
            const data = JSON.parse(res.content[0].text);
            expect(data.channels).toHaveLength(1);
            expect(data.channels[0].name).toBe('general');
        });
    });
});
