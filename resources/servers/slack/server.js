const path = require('path');
const fs = require('fs');

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

    // PROXY MODE
    if (process.env.FLOCCA_PROXY_URL && process.env.FLOCCA_USER_ID) {
        // url: https://slack.com/api/chat.postMessage
        // proxy: http://localhost:3000/proxy/slack/api/chat.postMessage
        fetchUrl = url.replace('https://slack.com', process.env.FLOCCA_PROXY_URL);
        headers['X-Flocca-User-ID'] = process.env.FLOCCA_USER_ID;
        // Token is injected by Proxy, but we can leave it if present (or remove it to be safe)
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
        // Proxy generic validation might return mock success, handle that
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
    // If channel already looks like an ID, return as-is
    if (channel.startsWith('C') || channel.startsWith('G')) return channel;

    // @user or U123 -> open an IM to get channel id
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

    // #channel name support via conversations.list? Could be expensive; Slack allows channel names in chat.postMessage in some cases.
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
        'slack.healthCheck',
        {
            description: 'Returns "ok" when the Slack MCP server is reachable.',
            inputSchema: {
                type: 'object',
                properties: {},
                additionalProperties: false
            }
        },
        async () => {
            console.log('[slack.healthCheck] <- request');
            const result = { content: [{ type: 'text', text: 'ok' }] };
            console.log('[slack.healthCheck] ->', JSON.stringify(result));
            return result;
        }
    );

    server.registerTool(
        'slack.listChannels',
        {
            description: 'List all accessible Slack channels (public + private where the bot is invited).',
            inputSchema: {
                type: 'object',
                properties: {},
                additionalProperties: false
            },
            outputSchema: {
                type: 'object',
                properties: {
                    channels: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' },
                                name: { type: 'string' }
                            },
                            required: ['id', 'name']
                        }
                    }
                },
                required: ['channels']
            }
        },
        async () => {
            console.log('[slack.listChannels] <-');
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
            console.log('[slack.listChannels] ->', JSON.stringify({ count: channels.length }));
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }
    );

    server.registerTool(
        'slack.listUsers',
        {
            description: 'List Slack workspace users with optional filtering.',
            inputSchema: {
                type: 'object',
                properties: {
                    includeBots: { type: 'boolean', description: 'Include bot users', default: false },
                    onlyActive: { type: 'boolean', description: 'Only active (not deleted)', default: false }
                },
                additionalProperties: false
            },
            outputSchema: {
                type: 'object',
                properties: {
                    users: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' },
                                name: { type: 'string' },
                                real_name: { type: 'string' },
                                email: { type: 'string' }
                            }
                        }
                    }
                },
                required: ['users']
            }
        },
        async (args) => {
            console.log('[slack.listUsers] <-', JSON.stringify(args || {}));
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
            console.log('[slack.listUsers] ->', JSON.stringify({ count: users.length }));
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }
    );

    server.registerTool(
        'slack.sendMessage',
        {
            description: 'Send a message to a Slack channel or user.',
            inputSchema: {
                type: 'object',
                properties: {
                    channel: { type: 'string', description: 'Channel ID, user ID, @user, or #channel' },
                    text: { type: 'string', description: 'Message text' }
                },
                required: ['channel', 'text'],
                additionalProperties: false
            },
            outputSchema: {
                type: 'object',
                properties: {
                    ok: { type: 'boolean' },
                    ts: { type: 'string' }
                },
                required: ['ok', 'ts']
            }
        },
        async (args) => {
            console.log('[slack.sendMessage] <-', JSON.stringify(args));
            try {
                const channelId = await resolveChannel(token, args.channel);
                const data = await slackFetch(token, 'https://slack.com/api/chat.postMessage', {
                    method: 'POST',
                    body: JSON.stringify({ channel: channelId, text: args.text })
                });

                const result = { ok: data.ok, ts: data.ts };
                console.log('[slack.sendMessage] ->', JSON.stringify(result));
                return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            } catch (err) {
                return errorResult(err, 'slack.sendMessage');
            }
        }
    );

    server.registerTool(
        'slack.sendThreadReply',
        {
            description: 'Post a threaded reply to an existing Slack message.',
            inputSchema: {
                type: 'object',
                properties: {
                    channel: { type: 'string', description: 'Channel ID, user ID, @user, or #channel' },
                    thread_ts: { type: 'string', description: 'Thread timestamp of the parent message' },
                    text: { type: 'string', description: 'Reply text (supports markdown formatting)' }
                },
                required: ['channel', 'thread_ts', 'text'],
                additionalProperties: false
            },
            outputSchema: {
                type: 'object',
                properties: {
                    ok: { type: 'boolean' },
                    ts: { type: 'string' }
                },
                required: ['ok', 'ts']
            }
        },
        async (args) => {
            console.log('[slack.sendThreadReply] <-', JSON.stringify(args));
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
                console.log('[slack.sendThreadReply] ->', JSON.stringify(result));
                return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            } catch (err) {
                return errorResult(err, 'slack.sendThreadReply');
            }
        }
    );

    server.registerTool(
        'slack.getThreadMessages',
        {
            description: 'Get all messages in a Slack thread.',
            inputSchema: {
                type: 'object',
                properties: {
                    channel: { type: 'string', description: 'Channel ID, user ID, @user, or #channel' },
                    thread_ts: { type: 'string', description: 'Thread timestamp of the parent message' }
                },
                required: ['channel', 'thread_ts'],
                additionalProperties: false
            },
            outputSchema: {
                type: 'object',
                properties: {
                    messages: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                user: { type: 'string' },
                                text: { type: 'string' },
                                ts: { type: 'string' }
                            }
                        }
                    }
                },
                required: ['messages']
            }
        },
        async (args) => {
            console.log('[slack.getThreadMessages] <-', JSON.stringify(args));
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
                console.log('[slack.getThreadMessages] ->', JSON.stringify({ count: messages.length }));
                return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            } catch (err) {
                return errorResult(err, 'slack.getThreadMessages');
            }
        }
    );

    server.registerTool(
        'slack.searchMessages',
        {
            description: 'Search Slack messages using Slack search syntax.',
            inputSchema: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search query' },
                    count: { type: 'number', description: 'Max results (default 20)', minimum: 1, maximum: 100 }
                },
                required: ['query'],
                additionalProperties: false
            },
            outputSchema: {
                type: 'object',
                properties: {
                    matches: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                channel: { type: 'string' },
                                username: { type: 'string' },
                                text: { type: 'string' },
                                permalink: { type: 'string' },
                                ts: { type: 'string' }
                            }
                        }
                    }
                },
                required: ['matches']
            }
        },
        async (args) => {
            console.log('[slack.searchMessages] <-', JSON.stringify(args));
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
                console.log('[slack.searchMessages] ->', JSON.stringify({ count: matches.length }));
                return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            } catch (err) {
                return errorResult(err, 'slack.searchMessages');
            }
        }
    );

    server.registerTool(
        'slack.uploadFile',
        {
            description: 'Upload a file to Slack with optional message.',
            inputSchema: {
                type: 'object',
                properties: {
                    channels: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Channel IDs to share the file with'
                    },
                    file_path: { type: 'string', description: 'Absolute path to the file' },
                    initial_comment: { type: 'string', description: 'Optional message to include with the file' }
                },
                required: ['channels', 'file_path'],
                additionalProperties: false
            },
            outputSchema: {
                type: 'object',
                properties: {
                    ok: { type: 'boolean' },
                    file: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            permalink: { type: 'string' }
                        }
                    }
                },
                required: ['ok']
            }
        },
        async (args) => {
            console.log('[slack.uploadFile] <-', JSON.stringify({ ...args, file_path: '[redacted]' }));
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
                console.log('[slack.uploadFile] ->', JSON.stringify(result));
                return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            } catch (err) {
                return errorResult(err, 'slack.uploadFile');
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
