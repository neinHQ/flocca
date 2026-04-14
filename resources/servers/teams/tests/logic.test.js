const { createTeamsServer } = require('../server');
const { Client } = require('@microsoft/microsoft-graph-client');

jest.mock('@microsoft/microsoft-graph-client');

describe('Teams MCP Logic', () => {
    let server;
    let mockClient;
    let mockApi;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.TEAMS_TOKEN = 'test-token';
        
        mockApi = {
            get: jest.fn(),
            post: jest.fn(),
            filter: jest.fn().mockReturnThis()
        };
        
        mockClient = {
            api: jest.fn().mockReturnValue(mockApi)
        };
        
        Client.init.mockReturnValue(mockClient);
        server = createTeamsServer();
    });

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return await tool.handler(args);
    };

    describe('teams_health', () => {
        it('should verify connection', async () => {
            mockApi.get.mockResolvedValue({ displayName: 'Test User' });
            const res = await callTool('teams_health');
            const data = JSON.parse(res.content[0].text);
            expect(data.ok).toBe(true);
            expect(data.user).toBe('Test User');
            expect(mockClient.api).toHaveBeenCalledWith('/me');
        });
    });

    describe('teams_send_channel_message', () => {
        it('should block if not confirmed', async () => {
            const res = await callTool('teams_send_channel_message', { 
                team_id: 't1', channel_id: 'c1', message: 'hi', confirm: false 
            });
            expect(res.isError).toBe(true);
            expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
        });

        it('should send if confirmed', async () => {
            mockApi.post.mockResolvedValue({ id: 'msg123', createdDateTime: '2024-01-01' });
            const res = await callTool('teams_send_channel_message', { 
                team_id: 't1', channel_id: 'c1', message: 'hi', confirm: true 
            });
            const data = JSON.parse(res.content[0].text);
            expect(data.id).toBe('msg123');
            expect(mockClient.api).toHaveBeenCalledWith('/teams/t1/channels/c1/messages');
        });
    });

    describe('teams_list_teams', () => {
        it('should return joined teams', async () => {
            mockApi.get.mockResolvedValue({ value: [{ id: 't1', displayName: 'Team 1' }] });
            const res = await callTool('teams_list_teams');
            const data = JSON.parse(res.content[0].text);
            expect(data.teams).toHaveLength(1);
            expect(data.teams[0].displayName).toBe('Team 1');
        });
    });
});
