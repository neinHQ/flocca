const axios = require('axios');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const SERVER_INFO = { name: 'stripe-mcp', version: '2.0.0' };

function createStripeServer() {
    let sessionConfig = {
        key: process.env.STRIPE_SECRET_KEY,
        proxyUrl: process.env.FLOCCA_PROXY_URL,
        userId: process.env.FLOCCA_USER_ID
    };

    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });
    let api = null;

    async function ensureConnected() {
        if (!sessionConfig.key && !(sessionConfig.proxyUrl && sessionConfig.userId)) {
            // Re-read env for dynamic updates
            sessionConfig.key = process.env.STRIPE_SECRET_KEY || sessionConfig.key;
            sessionConfig.proxyUrl = process.env.FLOCCA_PROXY_URL || sessionConfig.proxyUrl;
            sessionConfig.userId = process.env.FLOCCA_USER_ID || sessionConfig.userId;

            if (!sessionConfig.key && !(sessionConfig.proxyUrl && sessionConfig.userId)) {
                throw new Error("Stripe Not Configured. Provide STRIPE_SECRET_KEY or use Proxy.");
            }
        }

        if (!api) {
            const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
            let baseURL = 'https://api.stripe.com';

            if (sessionConfig.proxyUrl && sessionConfig.userId) {
                baseURL = sessionConfig.proxyUrl.replace(/\/$/, '');
                headers['X-Flocca-User-ID'] = sessionConfig.userId;
            } else {
                headers['Authorization'] = `Bearer ${sessionConfig.key}`;
            }

            api = axios.create({ baseURL, headers });
        }
        return api;
    }

    server.tool('stripe_health', {}, async () => {
        try {
            const client = await ensureConnected();
            await client.get('/v1/balance');
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, mode: sessionConfig.proxyUrl ? 'proxy' : 'direct' }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('stripe_get_balance', {}, async () => {
        try {
            const client = await ensureConnected();
            const res = await client.get('/v1/balance');
            return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('stripe_list_customers',
        { limit: z.number().int().positive().optional().default(10) },
        async (args) => {
            try {
                const client = await ensureConnected();
                const res = await client.get('/v1/customers', { params: { limit: args.limit } });
                return { content: [{ type: 'text', text: JSON.stringify(res.data.data || [], null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('stripe_get_customer',
        { customer_id: z.string().describe('Stripe customer ID (e.g. cus_...)') },
        async (args) => {
            try {
                const client = await ensureConnected();
                const res = await client.get(`/v1/customers/${args.customer_id}`);
                return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('stripe_list_recent_charges',
        { limit: z.number().int().positive().optional().default(10) },
        async (args) => {
            try {
                const client = await ensureConnected();
                const res = await client.get('/v1/charges', { params: { limit: args.limit } });
                return { content: [{ type: 'text', text: JSON.stringify(res.data.data || [], null, 2) }] };
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
    const server = createStripeServer();
    const transport = new StdioServerTransport();
    server.connect(transport).then(() => {
        console.error('Stripe MCP server running on stdio');
    }).catch(error => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createStripeServer };
