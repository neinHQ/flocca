const axios = require('axios');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const fs = require('fs');
const path = require('path');

const SERVER_INFO = { name: 'slack-mcp', version: '2.0.0' };

function createSlackServer() {
    let sessionConfig = {
        token: process.env.SLACK_BOT_TOKEN,
        proxyUrl: process.env.FLOCCA_PROXY_URL,
        userId: process.env.FLOCCA_USER_ID
    };

    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });
    let api = null;

    async function ensureConnected() {
        if (!sessionConfig.token && !(sessionConfig.proxyUrl && sessionConfig.userId)) {
            // Re-read env for dynamic updates
            sessionConfig.token = process.env.SLACK_BOT_TOKEN || sessionConfig.token;
            sessionConfig.proxyUrl = process.env.FLOCCA_PROXY_URL || sessionConfig.proxyUrl;
            sessionConfig.userId = process.env.FLOCCA_USER_ID || sessionConfig.userId;

            if (!sessionConfig.token && !(sessionConfig.proxyUrl && sessionConfig.userId)) {
                throw new Error("Slack Not Configured. Provide SLACK_BOT_TOKEN or use Proxy.");
            }
        }

        if (!api) {
            const headers = { 'Content-Type': 'application/json; charset=utf-8' };
            let baseURL = 'https://slack.com/api';

            if (sessionConfig.proxyUrl && sessionConfig.userId) {
                baseURL = sessionConfig.proxyUrl.replace(/\/$/, '') + '/api';
                headers['X-Flocca-User-ID'] = sessionConfig.userId;
            } else {
                headers['Authorization'] = `Bearer ${sessionConfig.token}`;
            }

            api = axios.create({ baseURL, headers });
        }
        return api;
    }

    async function slackReq(method, pathPart, options = {}) {
        const client = await ensureConnected();
        try {
            const res = await client.request({ method, url: pathPart, ...options });
            if (!res.data.ok && res.data.error) {
                const err = new Error(res.data.error);
                err.response = res;
                throw err;
            }
            return res.data;
        } catch (err) {
            if (err.response?.status === 429) {
                const retryAfter = err.response.headers['retry-after'] || 1;
                console.error(`Rate limited. Retry after ${retryAfter}s`);
            }
            throw err;
        }
    }

    async function resolveChannel(channel) {
        if (channel.startsWith('C') || channel.startsWith('G') || channel.startsWith('D')) return channel;
        
        if (channel.startsWith('@') || channel.startsWith('U')) {
            const user = channel.replace('@', '');
            const data = await slackReq('POST', 'conversations.open', { data: { users: user } });
            return data.channel.id;
        }
        return channel;
    }

    server.tool('slack_health', {}, async () => {
        try {
            await slackReq('POST', 'auth.test');
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, mode: sessionConfig.proxyUrl ? 'proxy' : 'direct' }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('slack_list_channels',
        { types: z.string().optional().default('public_channel,private_channel').describe('Comma-separated list of channel types') },
        async (args) => {
            try {
                const channels = [];
                let cursor;
                do {
                    const data = await slackReq('POST', 'conversations.list', {
                        data: { limit: 200, cursor, types: args.types }
                    });
                    (data.channels || []).forEach(ch => channels.push({ id: ch.id, name: ch.name, is_private: ch.is_private }));
                    cursor = data.response_metadata?.next_cursor;
                } while (cursor);
                return { content: [{ type: 'text', text: JSON.stringify({ channels }, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('slack_list_users',
        {
            include_bots: z.boolean().optional().default(false),
            only_active: z.boolean().optional().default(true)
        },
        async (args) => {
            try {
                const users = [];
                let cursor;
                do {
                    const data = await slackReq('POST', 'users.list', { data: { limit: 200, cursor } });
                    (data.members || []).forEach(m => {
                        if (!args.include_bots && m.is_bot) return;
                        if (args.only_active && m.deleted) return;
                        users.push({ id: m.id, name: m.name, real_name: m.real_name, email: m.profile?.email });
                    });
                    cursor = data.response_metadata?.next_cursor;
                } while (cursor);
                return { content: [{ type: 'text', text: JSON.stringify({ users }, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('slack_send_message',
        {
            channel: z.string().describe('Channel ID, user ID, or @username'),
            text: z.string().describe('Message text'),
            confirm: z.boolean().describe('Confirm mutation (safety gate)')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set confirm:true to send this message." }] };
            try {
                const channelId = await resolveChannel(args.channel);
                const data = await slackReq('POST', 'chat.postMessage', { data: { channel: channelId, text: args.text } });
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, ts: data.ts }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('slack_send_thread_reply',
        {
            channel: z.string().describe('Channel ID, user ID, or @username'),
            thread_ts: z.string().describe('Thread timestamp of parent message'),
            text: z.string().describe('Reply text'),
            confirm: z.boolean().describe('Confirm mutation (safety gate)')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set confirm:true to reply." }] };
            try {
                const channelId = await resolveChannel(args.channel);
                const data = await slackReq('POST', 'chat.postMessage', {
                    data: { channel: channelId, thread_ts: args.thread_ts, text: args.text }
                });
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, ts: data.ts }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('slack_get_thread_messages',
        {
            channel: z.string().describe('Channel ID'),
            thread_ts: z.string().describe('Thread timestamp')
        },
        async (args) => {
            try {
                const channelId = await resolveChannel(args.channel);
                const messages = [];
                let cursor;
                do {
                    const data = await slackReq('POST', 'conversations.replies', {
                        data: { channel: channelId, ts: args.thread_ts, cursor, limit: 100 }
                    });
                    (data.messages || []).forEach(m => messages.push({ user: m.user, text: m.text, ts: m.ts }));
                    cursor = data.response_metadata?.next_cursor;
                } while (cursor);
                return { content: [{ type: 'text', text: JSON.stringify({ messages }, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('slack_search_messages',
        {
            query: z.string().describe('Search query'),
            count: z.number().int().optional().default(20)
        },
        async (args) => {
            try {
                const data = await slackReq('POST', 'search.messages', { data: { query: args.query, count: args.count } });
                const matches = (data.messages?.matches || []).map(m => ({
                    channel: m.channel?.id,
                    username: m.username,
                    text: m.text,
                    ts: m.ts,
                    permalink: m.permalink
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ matches }, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('slack_upload_file',
        {
            channels: z.array(z.string()).describe('Channel IDs to share with'),
            file_path: z.string().describe('Absolute path to file'),
            initial_comment: z.string().optional(),
            confirm: z.boolean().describe('Confirm mutation (safety gate)')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set confirm:true to upload." }] };
            try {
                if (!fs.existsSync(args.file_path)) throw new Error('File not found');
                const client = await ensureConnected();
                const FormData = require('form-data');
                const form = new FormData();
                form.append('channels', args.channels.join(','));
                form.append('file', fs.createReadStream(args.file_path));
                if (args.initial_comment) form.append('initial_comment', args.initial_comment);

                // Note: files.upload is a multipart-form-data POST
                const res = await client.post('files.upload', form, {
                    headers: { ...form.getHeaders() }
                });
                if (!res.data.ok) throw new Error(res.data.error);
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, file_id: res.data.file?.id }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.__test = {
        sessionConfig,
        ensureConnected,
        slackReq,
        resolveChannel,
        setConfig: (next) => { Object.assign(sessionConfig, next); api = null; },
        getConfig: () => ({ ...sessionConfig })
    };

    return server;
}

if (require.main === module) {
    const server = createSlackServer();
    const transport = new StdioServerTransport();
    server.connect(transport).then(() => {
        console.error('Slack MCP server running on stdio');
    }).catch(error => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createSlackServer };
