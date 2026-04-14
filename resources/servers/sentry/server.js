const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const axios = require('axios');

const SERVER_INFO = { name: 'sentry-mcp', version: '2.0.0' };

let config = {
    token: process.env.SENTRY_TOKEN,
    baseUrl: process.env.SENTRY_BASE_URL || 'https://sentry.io/api/0',
    orgSlug: process.env.SENTRY_ORG_SLUG,
    proxyUrl: process.env.FLOCCA_PROXY_URL,
    userId: process.env.FLOCCA_USER_ID
};

function normalizeBaseUrl(url) {
    const raw = String(url || '').trim().replace(/\/+$/, '');
    if (!raw) return 'https://sentry.io/api/0';
    if (/\/api\/0$/i.test(raw)) return raw;
    return `${raw}/api/0`;
}

function normalizeError(err) {
    const msg = err.response?.data?.detail || err.message || JSON.stringify(err);
    return { isError: true, content: [{ type: 'text', text: `Sentry Error: ${msg}` }] };
}

function createSentryServer() {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });
    let api = null;

    async function ensureConnected() {
        if (!config.token && !(config.proxyUrl && config.userId)) {
            // Re-check env vars
            config.token = process.env.SENTRY_TOKEN;
            config.orgSlug = process.env.SENTRY_ORG_SLUG;
            config.baseUrl = process.env.SENTRY_BASE_URL || config.baseUrl;
            config.proxyUrl = process.env.FLOCCA_PROXY_URL;
            config.userId = process.env.FLOCCA_USER_ID;

            if (!config.token && !(config.proxyUrl && config.userId)) {
                throw new Error("Sentry Not Configured. Provide SENTRY_TOKEN or FLOCCA_PROXY_URL.");
            }
        }

        if (!api) {
            let finalBaseUrl = normalizeBaseUrl(config.baseUrl);
            const headers = { 'Content-Type': 'application/json' };

            if (config.proxyUrl && config.userId) {
                finalBaseUrl = normalizeBaseUrl(config.proxyUrl);
                headers['X-Flocca-User-ID'] = config.userId;
            } else {
                headers['Authorization'] = `Bearer ${config.token}`;
            }

            api = axios.create({
                baseURL: finalBaseUrl,
                headers: headers
            });
        }
        return api;
    }

    server.tool('sentry_health', {}, async () => {
        try {
            if (!config.orgSlug) throw new Error("SENTRY_ORG_SLUG required for health check");
            const client = await ensureConnected();
            await client.get(`/organizations/${config.orgSlug}/`);
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, org: config.orgSlug, mode: config.proxyUrl ? 'proxy' : 'direct' }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('sentry_configure',
        {
            token: z.string().describe('Sentry Auth Token'),
            org_slug: z.string().describe('Sentry Organization Slug'),
            base_url: z.string().optional().describe('Sentry Base URL (e.g. https://sentry.io)')
        },
        async (args) => {
            try {
                config.token = args.token;
                config.orgSlug = args.org_slug;
                if (args.base_url) config.baseUrl = args.base_url;
                api = null; // force re-init
                const client = await ensureConnected();
                await client.get(`/organizations/${config.orgSlug}/`);
                return { content: [{ type: 'text', text: "Sentry configuration updated and verified." }] };
            } catch (e) {
                config.token = undefined;
                api = null;
                return normalizeError(e);
            }
        }
    );

    server.tool('sentry_list_projects', {}, async () => {
        try {
            if (!config.orgSlug) throw new Error("SENTRY_ORG_SLUG required");
            const client = await ensureConnected();
            const res = await client.get(`/organizations/${config.orgSlug}/projects/`);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(res.data.map(p => ({
                        slug: p.slug,
                        name: p.name,
                        platform: p.platform
                    })), null, 2)
                }]
            };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('sentry_list_issues',
        {
            project_slug: z.string().describe('Filter issues by project slug'),
            query: z.string().optional().default('is:unresolved').describe('Sentry search query'),
            limit: z.number().optional().default(20).describe('Max issues to return')
        },
        async (args) => {
            try {
                if (!config.orgSlug) throw new Error("SENTRY_ORG_SLUG required");
                const client = await ensureConnected();
                const res = await client.get(`/projects/${config.orgSlug}/${args.project_slug}/issues/`, {
                    params: { query: args.query, limit: args.limit }
                });
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(res.data.map(i => ({
                            id: i.id,
                            title: i.title,
                            count: i.count,
                            userCount: i.userCount,
                            status: i.status,
                            level: i.level,
                            lastSeen: i.lastSeen,
                            permalink: i.permalink
                        })), null, 2)
                    }]
                };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('sentry_get_issue',
        { issue_id: z.string().describe('The ID of the issue to retrieve') },
        async (args) => {
            try {
                const client = await ensureConnected();
                const res = await client.get(`/issues/${args.issue_id}/`);
                return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    return server;
}

if (require.main === module) {
    const server = createSentryServer();
    const transport = new StdioServerTransport();
    server.connect(transport).then(() => {
        console.error('Sentry MCP server running on stdio');
    }).catch((error) => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createSentryServer };
