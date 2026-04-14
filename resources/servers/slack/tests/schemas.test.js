const { createSlackServer } = require('../server');

describe('Slack MCP Schema Validation', () => {
    let server;

    beforeEach(() => {
        server = createSlackServer();
    });

    const getValidator = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    describe('slack_send_message', () => {
        it('should require channel, text, and confirm', () => {
            const schema = getValidator('slack_send_message');
            const valid = { channel: 'C123', text: 'hello', confirm: true };
            expect(schema.safeParse(valid).success).toBe(true);
            expect(schema.safeParse({ ...valid, confirm: undefined }).success).toBe(false);
        });
    });

    describe('slack_send_thread_reply', () => {
        it('should require channel, thread_ts, text, and confirm', () => {
            const schema = getValidator('slack_send_thread_reply');
            const valid = { channel: 'C123', thread_ts: '123.456', text: 'reply', confirm: true };
            expect(schema.safeParse(valid).success).toBe(true);
            expect(schema.safeParse({ ...valid, confirm: false }).success).toBe(true);
            expect(schema.safeParse({ ...valid, thread_ts: undefined }).success).toBe(false);
        });
    });

    describe('slack_upload_file', () => {
        it('should require channels, file_path, and confirm', () => {
            const schema = getValidator('slack_upload_file');
            const valid = { channels: ['C123'], file_path: '/tmp/test.txt', confirm: true };
            expect(schema.safeParse(valid).success).toBe(true);
            expect(schema.safeParse({ ...valid, confirm: undefined }).success).toBe(false);
        });
    });
});
