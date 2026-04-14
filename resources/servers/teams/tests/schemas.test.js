const { createTeamsServer } = require('../server');

describe('Teams MCP Schema Validation', () => {
    let server;

    beforeEach(() => {
        server = createTeamsServer();
    });

    const getValidator = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    describe('teams_send_channel_message', () => {
        it('should require team_id, channel_id, message, and confirm', () => {
            const schema = getValidator('teams_send_channel_message');
            const valid = { team_id: 't1', channel_id: 'c1', message: 'hi', confirm: true };
            expect(schema.safeParse(valid).success).toBe(true);
            expect(schema.safeParse({ ...valid, confirm: undefined }).success).toBe(false);
        });
    });

    describe('teams_send_direct_message', () => {
        it('should require user_id, message, and confirm', () => {
            const schema = getValidator('teams_send_direct_message');
            const valid = { user_id: 'u1', message: 'priv', confirm: true };
            expect(schema.safeParse(valid).success).toBe(true);
            expect(schema.safeParse({ ...valid, confirm: false }).success).toBe(true);
            expect(schema.safeParse({ ...valid, user_id: undefined }).success).toBe(false);
        });
    });

    describe('teams_notify_on_workflow_complete', () => {
        it('should validate status enum and confirm', () => {
            const schema = getValidator('teams_notify_on_workflow_complete');
            const valid = { team_id: 't1', channel_id: 'c1', workflow_name: 'test', status: 'success', confirm: true };
            expect(schema.safeParse(valid).success).toBe(true);
            expect(schema.safeParse({ ...valid, status: 'invalid' }).success).toBe(false);
        });
    });
});
