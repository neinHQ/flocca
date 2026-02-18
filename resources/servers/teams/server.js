require('isomorphic-fetch'); // Polyfill for Graph Client
const { Client } = require('@microsoft/microsoft-graph-client');
const { McpServer } = require(require('path').join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js'));
const { StdioServerTransport } = require(require('path').join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/stdio.js'));

const SERVER_INFO = { name: 'teams-mcp', version: '1.0.0' };

// Configuration State
let config = {
    tenantId: process.env.TEAMS_TENANT_ID,
    token: process.env.TEAMS_TOKEN,
    defaultTeam: process.env.TEAMS_DEFAULT_TEAM,
    defaultChannel: process.env.TEAMS_DEFAULT_CHANNEL
};

// Helper: Get Authenticated Client
const PROXY = process.env.FLOCCA_PROXY_URL;
const USER = process.env.FLOCCA_USER_ID;

function getClient() {
    if (!config.token && !(PROXY && USER)) throw new Error("Teams Not Configured. Call teams.configure or set TEAMS_TOKEN.");

    if (PROXY && USER) {
        // Proxy Mode: We need to override fetch to route via Proxy
        // Graph Client constructs URL like https://graph.microsoft.com/v1.0/me
        // We want: proxyUrl + /v1.0/me
        const customFetch = async (url, options) => {
            const dest = url.toString().replace('https://graph.microsoft.com', PROXY);
            const headers = { ...(options.headers || {}) };
            delete headers['Authorization']; // Proxy handles this
            headers['X-Flocca-User-ID'] = USER;

            return fetch(dest, { ...options, headers });
        };
        // initWithMiddleware expects options object with middleware, but simple fetch replace might work via polyfill override?
        // Actually custom fetch is supported in options since 3.0?
        // Let's try init with fetch.
        return Client.init({
            authProvider: (done) => done(null, 'dummy'), // Provider needed but token ignored
            fetchOptions: { fetch: customFetch } // Some versions support this
        });
        // Note: SDK structure varies. Safest is replacing global fetch if we can, but scoped is better.
        // If Client.init doesn't take fetch, we might need to rely on the fact that it uses 'isomorphic-fetch'.
    }

    return Client.init({
        authProvider: (done) => {
            done(null, config.token);
        }
    });
}

function normalizeError(err) {
    const msg = err.message || JSON.stringify(err);
    return { isError: true, content: [{ type: 'text', text: `Teams API Error: ${msg}` }] };
}

function createToolAliases(name) {
    const alias = name
        .replace(/\./g, '_')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase();
    return alias !== name ? [alias] : [];
}

function registerToolWithAliases(server, name, config, handler) {
    server.registerTool(name, config, handler);
    for (const alias of createToolAliases(name)) {
        server.registerTool(alias, config, handler);
    }
}

async function main() {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    registerToolWithAliases(server, 'teams.health',
        { description: 'Check connection health', inputSchema: { type: 'object', properties: {} } },
        async () => {
            try {
                if (config.token) {
                    await getClient().api('/me').get();
                    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, user: 'authenticated' }) }] };
                }
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, status: 'waiting_for_config' }) }] };
            } catch (e) {
                return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: e.message }) }] };
            }
        }
    );

    registerToolWithAliases(server, 'teams.configure',
        {
            description: 'Configure Teams Session',
            inputSchema: {
                type: 'object',
                properties: {
                    tenant_id: { type: 'string' },
                    token: { type: 'string' },
                    default_team: { type: 'string' },
                    default_channel: { type: 'string' }
                },
                required: ['token']
            }
        },
        async (args) => {
            config.token = args.token;
            if (args.tenant_id) config.tenantId = args.tenant_id;
            if (args.default_team) config.defaultTeam = args.default_team;
            if (args.default_channel) config.defaultChannel = args.default_channel;

            // Verify
            try {
                const me = await getClient().api('/me').get();
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, user: me.displayName }) }] };
            } catch (e) {
                config.token = undefined; // Unknown state, clear to be safe or keep? Clearing safer.
                return normalizeError(e);
            }
        }
    );

    registerToolWithAliases(server, 'teams.listTeams',
        { description: 'List joined teams', inputSchema: { type: 'object', properties: {} } },
        async () => {
            try {
                const res = await getClient().api('/me/joinedTeams').get();
                return { content: [{ type: 'text', text: JSON.stringify({ teams: res.value }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'teams.listChannels',
        {
            description: 'List channels in a team',
            inputSchema: { type: 'object', properties: { team_id: { type: 'string' } }, required: ['team_id'] }
        },
        async (args) => {
            try {
                const res = await getClient().api(`/teams/${args.team_id}/channels`).get();
                return { content: [{ type: 'text', text: JSON.stringify({ channels: res.value }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'teams.searchUsers',
        {
            description: 'Search users by name',
            inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
        },
        async (args) => {
            try {
                const res = await getClient().api('/users')
                    .filter(`startswith(displayName,'${args.query}') or startswith(mail,'${args.query}')`)
                    .get();
                return { content: [{ type: 'text', text: JSON.stringify({ users: res.value }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'teams.getUser',
        {
            description: 'Get user details',
            inputSchema: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'] }
        },
        async (args) => {
            try {
                const res = await getClient().api(`/users/${args.user_id}`).get();
                return { content: [{ type: 'text', text: JSON.stringify(res) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'teams.sendChannelMessage',
        {
            description: 'Send message to channel',
            inputSchema: {
                type: 'object',
                properties: {
                    team_id: { type: 'string' },
                    channel_id: { type: 'string' },
                    message: { type: 'string' }
                },
                required: ['team_id', 'channel_id', 'message']
            }
        },
        async (args) => {
            try {
                const msg = { body: { content: args.message } };
                const res = await getClient().api(`/teams/${args.team_id}/channels/${args.channel_id}/messages`).post(msg);
                return { content: [{ type: 'text', text: JSON.stringify({ id: res.id, createdDateTime: res.createdDateTime }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'teams.sendDirectMessage',
        {
            description: 'Send DM to user',
            inputSchema: {
                type: 'object',
                properties: {
                    user_id: { type: 'string' },
                    message: { type: 'string' }
                },
                required: ['user_id', 'message']
            }
        },
        async (args) => {
            try {
                const client = getClient();
                // 1. Create/Find Chat
                // We need the ID of the other user.
                // Chat creation payload:
                const chatPayload = {
                    chatType: 'oneOnOne',
                    members: [
                        { '@odata.type': '#microsoft.graph.aadUserConversationMember', roles: ['owner'], 'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${args.user_id}')` },
                        { '@odata.type': '#microsoft.graph.aadUserConversationMember', roles: ['owner'], 'user@odata.bind': `https://graph.microsoft.com/v1.0/me` }
                    ]
                };

                // This might fail if chat exists? API docs say it returns 201 or 200/409?
                // Actually Graph API for chats allows finding by members usually via list filtered?
                // Let's try create, if fails, we might need to search. 
                // BUT simple creation often retrieves existing.
                const chat = await client.api('/chats').post(chatPayload);

                // 2. Send Message
                const msg = { body: { content: args.message } };
                const res = await client.api(`/chats/${chat.id}/messages`).post(msg);

                return { content: [{ type: 'text', text: JSON.stringify({ id: res.id, chatId: chat.id }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'teams.replyToMessage',
        {
            description: 'Reply to channel message',
            inputSchema: {
                type: 'object',
                properties: {
                    team_id: { type: 'string' },
                    channel_id: { type: 'string' },
                    message_id: { type: 'string' },
                    reply: { type: 'string' }
                },
                required: ['team_id', 'channel_id', 'message_id', 'reply']
            }
        },
        async (args) => {
            try {
                const msg = { body: { content: args.reply } };
                const res = await getClient().api(`/teams/${args.team_id}/channels/${args.channel_id}/messages/${args.message_id}/replies`).post(msg);
                return { content: [{ type: 'text', text: JSON.stringify({ id: res.id }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'teams.sendReport',
        {
            description: 'Send formatted report',
            inputSchema: {
                type: 'object',
                properties: {
                    team_id: { type: 'string' },
                    channel_id: { type: 'string' },
                    title: { type: 'string' },
                    summary: { type: 'string' },
                    details: { type: 'string' } // Could be JSON or just text
                },
                required: ['team_id', 'channel_id', 'title']
            }
        },
        async (args) => {
            try {
                // Formatting simple HTML for Teams (Markdown support is limited in API body 'content', it expects HTML usually or plain text)
                // We'll use HTML table/list style
                let content = `<h1>${args.title}</h1><p><strong>${args.summary || ''}</strong></p>`;
                if (args.details) {
                    content += `<pre>${args.details}</pre>`; // Simple code block
                }

                const msg = { body: { contentType: 'html', content: content } };
                const res = await getClient().api(`/teams/${args.team_id}/channels/${args.channel_id}/messages`).post(msg);
                return { content: [{ type: 'text', text: JSON.stringify({ id: res.id }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'teams.notifyOnWorkflowComplete',
        {
            description: 'Notify workflow completion',
            inputSchema: {
                type: 'object',
                properties: {
                    team_id: { type: 'string' },
                    channel_id: { type: 'string' },
                    workflow_name: { type: 'string' },
                    status: { type: 'string' },
                    summary: { type: 'string' }
                },
                required: ['team_id', 'channel_id', 'workflow_name']
            }
        },
        async (args) => {
            try {
                const color = args.status === 'success' ? '#22bb33' : '#bb2124'; // Simple indicators
                const icon = args.status === 'success' ? '✅' : '❌';
                const content = `<h2>${icon} Workflow: ${args.workflow_name}</h2><p>Status: <span style="color:${color}">${args.status}</span></p><p>${args.summary || ''}</p>`;

                const msg = { body: { contentType: 'html', content: content } };
                const res = await getClient().api(`/teams/${args.team_id}/channels/${args.channel_id}/messages`).post(msg);
                return { content: [{ type: 'text', text: JSON.stringify({ id: res.id }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Teams MCP Server running on stdio');
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { main };
