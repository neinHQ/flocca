require('isomorphic-fetch');
const { Client } = require('@microsoft/microsoft-graph-client');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const SERVER_INFO = { name: 'teams-mcp', version: '2.0.0' };

function createTeamsServer() {
    let sessionConfig = {
        token: process.env.TEAMS_TOKEN,
        proxyUrl: process.env.FLOCCA_PROXY_URL,
        userId: process.env.FLOCCA_USER_ID
    };

    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });
    let api = null;

    async function ensureConnected() {
        if (!sessionConfig.token && !(sessionConfig.proxyUrl && sessionConfig.userId)) {
            // Re-read env for dynamic updates
            sessionConfig.token = process.env.TEAMS_TOKEN || sessionConfig.token;
            sessionConfig.proxyUrl = process.env.FLOCCA_PROXY_URL || sessionConfig.proxyUrl;
            sessionConfig.userId = process.env.FLOCCA_USER_ID || sessionConfig.userId;

            if (!sessionConfig.token && !(sessionConfig.proxyUrl && sessionConfig.userId)) {
                throw new Error("Teams Not Configured. Provide TEAMS_TOKEN or use Proxy.");
            }
        }

        if (!api) {
            if (sessionConfig.proxyUrl && sessionConfig.userId) {
                const customFetch = async (url, options) => {
                    const dest = url.toString().replace('https://graph.microsoft.com', sessionConfig.proxyUrl.replace(/\/$/, ''));
                    const headers = { ...(options.headers || {}) };
                    delete headers['Authorization'];
                    headers['X-Flocca-User-ID'] = sessionConfig.userId;
                    return fetch(dest, { ...options, headers });
                };
                api = Client.init({
                    authProvider: (done) => done(null, 'proxy'),
                    fetchOptions: { fetch: customFetch }
                });
            } else {
                api = Client.init({
                    authProvider: (done) => done(null, sessionConfig.token)
                });
            }
        }
        return api;
    }

    server.tool('teams_health', {}, async () => {
        try {
            const client = await ensureConnected();
            const me = await client.api('/me').get();
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, user: me.displayName, mode: sessionConfig.proxyUrl ? 'proxy' : 'direct' }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('teams_configure',
        {
            token: z.string().describe('Microsoft Graph API Token'),
            default_team: z.string().optional(),
            default_channel: z.string().optional()
        },
        async (args) => {
            try {
                sessionConfig.token = args.token;
                api = null; // Reset client
                const client = await ensureConnected();
                const me = await client.api('/me').get();
                return { content: [{ type: 'text', text: `Teams configured for ${me.displayName}` }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('teams_list_teams', {}, async () => {
        try {
            const client = await ensureConnected();
            const res = await client.api('/me/joinedTeams').get();
            return { content: [{ type: 'text', text: JSON.stringify({ teams: res.value }, null, 2) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('teams_list_channels',
        { team_id: z.string().describe('The ID of the team') },
        async (args) => {
            try {
                const client = await ensureConnected();
                const res = await client.api(`/teams/${args.team_id}/channels`).get();
                return { content: [{ type: 'text', text: JSON.stringify({ channels: res.value }, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('teams_search_users',
        { query: z.string().describe('Search by name or email') },
        async (args) => {
            try {
                const client = await ensureConnected();
                const res = await client.api('/users')
                    .filter(`startswith(displayName,'${args.query}') or startswith(mail,'${args.query}')`)
                    .get();
                return { content: [{ type: 'text', text: JSON.stringify({ users: res.value }, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('teams_send_channel_message',
        {
            team_id: z.string(),
            channel_id: z.string(),
            message: z.string(),
            confirm: z.boolean().describe('Confirm mutation (safety gate)')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set confirm:true to send this message." }] };
            try {
                const client = await ensureConnected();
                const msg = { body: { content: args.message } };
                const res = await client.api(`/teams/${args.team_id}/channels/${args.channel_id}/messages`).post(msg);
                return { content: [{ type: 'text', text: JSON.stringify({ id: res.id, created: res.createdDateTime }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('teams_send_direct_message',
        {
            user_id: z.string().describe('Target User ID'),
            message: z.string(),
            confirm: z.boolean().describe('Confirm mutation (safety gate)')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set confirm:true to send DM." }] };
            try {
                const client = await ensureConnected();
                const chatPayload = {
                    chatType: 'oneOnOne',
                    members: [
                        { '@odata.type': '#microsoft.graph.aadUserConversationMember', roles: ['owner'], 'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${args.user_id}')` },
                        { '@odata.type': '#microsoft.graph.aadUserConversationMember', roles: ['owner'], 'user@odata.bind': `https://graph.microsoft.com/v1.0/me` }
                    ]
                };
                const chat = await client.api('/chats').post(chatPayload);
                const msg = { body: { content: args.message } };
                const res = await client.api(`/chats/${chat.id}/messages`).post(msg);
                return { content: [{ type: 'text', text: JSON.stringify({ id: res.id, chatId: chat.id }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('teams_reply_to_message',
        {
            team_id: z.string(),
            channel_id: z.string(),
            message_id: z.string(),
            reply: z.string(),
            confirm: z.boolean().describe('Confirm mutation (safety gate)')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set confirm:true to reply." }] };
            try {
                const client = await ensureConnected();
                const msg = { body: { content: args.reply } };
                const res = await client.api(`/teams/${args.team_id}/channels/${args.channel_id}/messages/${args.message_id}/replies`).post(msg);
                return { content: [{ type: 'text', text: JSON.stringify({ id: res.id }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('teams_send_report',
        {
            team_id: z.string(),
            channel_id: z.string(),
            title: z.string(),
            summary: z.string().optional(),
            details: z.string().optional(),
            confirm: z.boolean().describe('Confirm mutation (safety gate)')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set confirm:true to send report." }] };
            try {
                const client = await ensureConnected();
                let content = `<h1>${args.title}</h1><p><strong>${args.summary || ''}</strong></p>`;
                if (args.details) content += `<pre>${args.details}</pre>`;
                const msg = { body: { contentType: 'html', content } };
                const res = await client.api(`/teams/${args.team_id}/channels/${args.channel_id}/messages`).post(msg);
                return { content: [{ type: 'text', text: JSON.stringify({ id: res.id }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('teams_notify_on_workflow_complete',
        {
            team_id: z.string(),
            channel_id: z.string(),
            workflow_name: z.string(),
            status: z.enum(['success', 'failure']),
            summary: z.string().optional(),
            confirm: z.boolean().describe('Confirm mutation (safety gate)')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set confirm:true to notify." }] };
            try {
                const client = await ensureConnected();
                const color = args.status === 'success' ? '#22bb33' : '#bb2124';
                const icon = args.status === 'success' ? '✅' : '❌';
                const content = `<h2>${icon} Workflow: ${args.workflow_name}</h2><p>Status: <span style="color:${color}">${args.status}</span></p><p>${args.summary || ''}</p>`;
                const msg = { body: { contentType: 'html', content } };
                const res = await client.api(`/teams/${args.team_id}/channels/${args.channel_id}/messages`).post(msg);
                return { content: [{ type: 'text', text: JSON.stringify({ id: res.id }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.__test = {
        sessionConfig,
        ensureConnected,
        setConfig: (next) => { Object.assign(sessionConfig, next); api = null; },
        getConfig: () => ({ ...sessionConfig })
    };

    return server;
}

if (require.main === module) {
    const server = createTeamsServer();
    const transport = new StdioServerTransport();
    server.connect(transport).then(() => {
        console.error('Teams MCP server running on stdio');
    }).catch(error => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createTeamsServer };
