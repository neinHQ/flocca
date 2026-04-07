const path = require('path');
const fs = require('fs');
const z = require('zod');

// Load SDK via absolute path so we can use CJS without changing package type
const sdkServerPath = path.join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server');
// eslint-disable-next-line import/no-dynamic-require, global-require
const { McpServer } = require(path.join(sdkServerPath, 'mcp.js'));
// eslint-disable-next-line import/no-dynamic-require, global-require
const { StdioServerTransport } = require(path.join(sdkServerPath, 'stdio.js'));

const SERVER_INFO = {
    name: 'slack-mcp',
    version: '0.1.0'
};

async function validateSlackToken(token) {
    try {
        const response = await fetch('https://slack.com/api/auth.test', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: ''
        });

        const data = await response.json();
        if (!data.ok) {
            throw new Error(data.error || 'Invalid Slack token');
        }
        return data;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Slack token validation failed: ${message}`);
    }
}

class SlackApiError extends Error {
    constructor(message, { status, slackError, retryAfter, slackResponse } = {}) {
        super(message);
        this.status = status;
        this.slackError = slackError;
        this.retryAfter = retryAfter;
        this.slackResponse = slackResponse;
    }
}

function suggestFix(slackError) {
    switch (slackError) {
        case 'not_in_channel':
            return 'Invite the bot to the channel and retry.';
        case 'channel_not_found':
            return 'Verify the channel ID or invite the bot to the channel.';
        case 'invalid_auth':
        case 'not_authed':
            return 'Re-authenticate the Slack bot token.';
        case 'rate_limited':
            return 'Wait for the retry_after duration before calling again.';
        case 'file_too_large':
            return 'Reduce the file size below Slack limits.';
        default:
            return 'Check the Slack API permissions and inputs.';
    }
}

function errorResult(err, context) {
    const payload = {
        ok: false,
        error: err.message,
        slack_error: err.slackError,
        http_status: err.status,
        retry_after: err.retryAfter,
        suggestion: suggestFix(err.slackError),
        context
    };
    return { isError: true, content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

async function slackFetch(token, url, options = {}, attempt = 1) {
    let fetchUrl = url;
    const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        ...(options.headers || {})
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    if (process.env.FLOCCA_PROXY_URL && process.env.FLOCCA_USER_ID) {
        fetchUrl = url.replace('https://slack.com', process.env.FLOCCA_PROXY_URL);
        headers['X-Flocca-User-ID'] = process.env.FLOCCA_USER_ID;
        delete headers['Authorization'];
    }

    const response = await fetch(fetchUrl, {
        ...options,
        headers
    });

    if (response.status === 429) {
        const retryAfter = Number(response.headers.get('retry-after')) || 1;
        if (attempt <= 3) {
            const delay = retryAfter * 1000 * Math.pow(2, attempt - 1);
            await new Promise((r) => setTimeout(r, delay));
            return slackFetch(token, url, options, attempt + 1);
        }
        throw new SlackApiError('Rate limited by Slack', { status: response.status, slackError: 'rate_limited', retryAfter });
    }

    const data = await response.json();
    if (!response.ok || !data.ok) {
        if (data.message === 'Proxy Success') return { ok: true };

        const err = data.error || 'unknown_error';
        throw new SlackApiError(`Slack API error: ${err}`, {
            status: response.status,
            slackError: err,
            slackResponse: data
        });
    }

    return data;
}

async function slackFetchMultipart(token, url, formData, attempt = 1) {
    const response = await fetch(url, {
        method: 'POST',
        body: formData,
        headers: {
            Authorization: `Bearer ${token}`
        }
    });

    if (response.status === 429) {
        const retryAfter = Number(response.headers.get('retry-after')) || 1;
        if (attempt <= 3) {
            const delay = retryAfter * 1000 * Math.pow(2, attempt - 1);
            await new Promise((r) => setTimeout(r, delay));
            return slackFetchMultipart(token, url, formData, attempt + 1);
        }
        throw new SlackApiError('Rate limited by Slack', { status: response.status, slackError: 'rate_limited', retryAfter });
    }

    const data = await response.json();
    if (!response.ok || !data.ok) {
        const err = data.error || 'unknown_error';
        throw new SlackApiError(`Slack API error: ${err}`, {
            status: response.status,
            slackError: err,
            slackResponse: data
        });
    }

    return data;
}

async function resolveChannel(token, channel) {
    if (channel.startsWith('C') || channel.startsWith('G')) return channel;

    if (channel.startsWith('@') || channel.startsWith('U')) {
        const user = channel.replace('@', '');
        const data = await slackFetch(token, 'https://slack.com/api/conversations.open', {
            method: 'POST',
            body: JSON.stringify({ users: user })
        });
        if (!data.channel || !data.channel.id) {
            throw new Error('Failed to open DM channel for user');
        }
        return data.channel.id;
    }

    return channel;
}

async function main() {
    const token = process.env.SLACK_BOT_TOKEN;
    const PROXY_URL = process.env.FLOCCA_PROXY_URL;
    const USER_ID = process.env.FLOCCA_USER_ID;

    if (!token && (!PROXY_URL || !USER_ID)) {
        console.error('SLACK_BOT_TOKEN (or Proxy) is required to start the Slack MCP server.');
        process.exit(1);
    }

    const validation = await validateSlackToken(token).catch((err) => {
        console.error(err.message || err);
        process.exit(1);
    });
    console.log(`Slack token validated for team ${validation.team || 'unknown'}.`);

    const server = new McpServer(SERVER_INFO, {
        capabilities: { tools: {} }
    });

    server.registerTool(
        'slack_health',
        {
            description: 'Health check for Slack connectivity and auth.',
            inputSchema: z.object({})
        },
        async () => {
            try {
                await validateSlackToken(token);
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
            } catch (e) {
                return errorResult(e, 'slack_health');
            }
        }
    );

    server.registerTool(
        'slack_list_channels',
        {
            description: 'List all accessible Slack channels (public + private where the bot is invited).',
            inputSchema: z.object({})
        },
        async () => {
            console.log('[slack_list_channels] <-');
            const channels = [];
            let cursor;
            do {
                const data = await slackFetch(token, 'https://slack.com/api/conversations.list', {
                    method: 'POST',
                    body: JSON.stringify({
                        limit: 200,
                        cursor,
                        types: 'public_channel,private_channel'
                    })
                });
                (data.channels || []).forEach((ch) => {
                    channels.push({ id: ch.id, name: ch.name });
                });
                cursor = data.response_metadata && data.response_metadata.next_cursor ? data.response_metadata.next_cursor : undefined;
            } while (cursor);

            const result = { channels };
            console.log('[slack_list_channels] ->', JSON.stringify({ count: channels.length }));
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }
    );

    server.registerTool(
        'slack_list_users',
        {
            description: 'List Slack workspace users with optional filtering.',
            inputSchema: z.object({
                includeBots: z.boolean().optional().default(false).describe('Include bot users'),
                onlyActive: z.boolean().optional().default(false).describe('Only active (not deleted)')
            })
        },
        async (args) => {
            console.log('[slack_list_users] <-', JSON.stringify(args || {}));
            const includeBots = args?.includeBots || false;
            const onlyActive = args?.onlyActive || false;

            const users = [];
            let cursor;
            do {
                const data = await slackFetch(token, 'https://slack.com/api/users.list', {
                    method: 'POST',
                    body: JSON.stringify({ limit: 200, cursor })
                });

                (data.members || []).forEach((member) => {
                    if (!includeBots && member.is_bot) return;
                    if (onlyActive && member.deleted) return;
                    users.push({
                        id: member.id,
                        name: member.name,
                        real_name: member.real_name,
                        email: member.profile ? member.profile.email : undefined
                    });
                });
                cursor = data.response_metadata && data.response_metadata.next_cursor ? data.response_metadata.next_cursor : undefined;
            } while (cursor);

            const result = { users };
            console.log('[slack_list_users] ->', JSON.stringify({ count: users.length }));
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }
    );

    server.registerTool(
        'slack_send_message',
        {
            description: 'Send a message to a Slack channel or user.',
            inputSchema: z.object({
                channel: z.string().describe('Channel ID, user ID, @user, or #channel'),
                text: z.string().describe('Message text')
            })
        },
        async (args) => {
            console.log('[slack_send_message] <-', JSON.stringify(args));
            try {
                const channelId = await resolveChannel(token, args.channel);
                const data = await slackFetch(token, 'https://slack.com/api/chat.postMessage', {
                    method: 'POST',
                    body: JSON.stringify({ channel: channelId, text: args.text })
                });

                const result = { ok: data.ok, ts: data.ts };
                console.log('[slack_send_message] ->', JSON.stringify(result));
                return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            } catch (err) {
                return errorResult(err, 'slack_send_message');
            }
        }
    );

    server.registerTool(
        'slack_send_thread_reply',
        {
            description: 'Post a threaded reply to an existing Slack message.',
            inputSchema: z.object({
                channel: z.string().describe('Channel ID, user ID, @user, or #channel'),
                thread_ts: z.string().describe('Thread timestamp of the parent message'),
                text: z.string().describe('Reply text (supports markdown formatting)')
            })
        },
        async (args) => {
            console.log('[slack_send_thread_reply] <-', JSON.stringify(args));
            try {
                const channelId = await resolveChannel(token, args.channel);
                const data = await slackFetch(token, 'https://slack.com/api/chat.postMessage', {
                    method: 'POST',
                    body: JSON.stringify({
                        channel: channelId,
                        thread_ts: args.thread_ts,
                        text: args.text
                    })
                });

                const result = { ok: data.ok, ts: data.ts };
                console.log('[slack_send_thread_reply] ->', JSON.stringify(result));
                return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            } catch (err) {
                return errorResult(err, 'slack_send_thread_reply');
            }
        }
    );

    server.registerTool(
        'slack_get_thread_messages',
        {
            description: 'Get all messages in a Slack thread.',
            inputSchema: z.object({
                channel: z.string().describe('Channel ID, user ID, @user, or #channel'),
                thread_ts: z.string().describe('Thread timestamp of the parent message')
            })
        },
        async (args) => {
            console.log('[slack_get_thread_messages] <-', JSON.stringify(args));
            try {
                const channelId = await resolveChannel(token, args.channel);
                const messages = [];
                let cursor;
                do {
                    const data = await slackFetch(token, 'https://slack.com/api/conversations.replies', {
                        method: 'POST',
                        body: JSON.stringify({
                            channel: channelId,
                            ts: args.thread_ts,
                            cursor,
                            limit: 200
                        })
                    });
                    (data.messages || []).forEach((msg) => {
                        messages.push({ user: msg.user, text: msg.text, ts: msg.ts });
                    });
                    cursor = data.response_metadata && data.response_metadata.next_cursor ? data.response_metadata.next_cursor : undefined;
                } while (cursor);

                const result = { messages };
                console.log('[slack_get_thread_messages] ->', JSON.stringify({ count: messages.length }));
                return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            } catch (err) {
                return errorResult(err, 'slack_get_thread_messages');
            }
        }
    );

    server.registerTool(
        'slack_search_messages',
        {
            description: 'Search Slack messages using Slack search syntax.',
            inputSchema: z.object({
                query: z.string().describe('Search query'),
                count: z.number().optional().default(20).describe('Max results (default 20)')
            })
        },
        async (args) => {
            console.log('[slack_search_messages] <-', JSON.stringify(args));
            try {
                const count = args.count || 20;
                const data = await slackFetch(token, 'https://slack.com/api/search.messages', {
                    method: 'POST',
                    body: JSON.stringify({
                        query: args.query,
                        count
                    })
                });

                const matches = (data.messages && data.messages.matches) ? data.messages.matches.map((m) => ({
                    channel: m.channel ? m.channel.id : undefined,
                    username: m.username,
                    text: m.text,
                    permalink: m.permalink,
                    ts: m.ts
                })) : [];

                const result = { matches };
                console.log('[slack_search_messages] ->', JSON.stringify({ count: matches.length }));
                return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            } catch (err) {
                return errorResult(err, 'slack_search_messages');
            }
        }
    );

    server.registerTool(
        'slack_upload_file',
        {
            description: 'Upload a file to Slack with optional message.',
            inputSchema: z.object({
                channels: z.array(z.string()).describe('Channel IDs to share the file with'),
                file_path: z.string().describe('Absolute path to the file'),
                initial_comment: z.string().optional().describe('Optional message to include with the file')
            })
        },
        async (args) => {
            console.log('[slack_upload_file] <-', JSON.stringify({ ...args, file_path: '[redacted]' }));
            try {
                if (!fs.existsSync(args.file_path)) {
                    throw new SlackApiError('File not found', { slackError: 'file_not_found', status: 400 });
                }
                const buffer = fs.readFileSync(args.file_path);
                const fileName = path.basename(args.file_path);
                const formData = new FormData();
                formData.append('channels', args.channels.join(','));
                formData.append('file', new Blob([buffer]), fileName);
                if (args.initial_comment) formData.append('initial_comment', args.initial_comment);

                const data = await slackFetchMultipart(token, 'https://slack.com/api/files.upload', formData);
                const result = {
                    ok: data.ok,
                    file: data.file ? { id: data.file.id, permalink: data.file.permalink } : undefined
                };
                console.log('[slack_upload_file] ->', JSON.stringify(result));
                return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            } catch (err) {
                return errorResult(err, 'slack_upload_file');
            }
        }
    );

    server.server.oninitialized = () => {
        console.log('Slack MCP server initialized with client.');
    };

    const transport = new StdioServerTransport();
    transport.onclose = () => console.log('Slack MCP server transport closed.');
    transport.onerror = (error) => console.error('Slack MCP server transport error:', error);

    await server.connect(transport);
    console.log('Slack MCP server is running on stdio.');
}

main().catch((err) => {
    console.error('Slack MCP server failed to start:', err);
    process.exit(1);
});
