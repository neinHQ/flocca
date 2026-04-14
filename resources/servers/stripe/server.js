const axios = require('axios');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const SERVER_INFO = { name: 'stripe-mcp', version: '2.0.0' };

let config = {
    key: process.env.STRIPE_SECRET_KEY,
    proxyUrl: process.env.FLOCCA_PROXY_URL,
    userId: process.env.FLOCCA_USER_ID
};

function normalizeError(err) {
    const data = err.response?.data || {};
    const msg = data.error?.message || err.message || JSON.stringify(data);
    return { isError: true, content: [{ type: 'text', text: `Stripe Error: ${msg}` }] };
}

function createStripeServer() {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });
    let api = null;

    async function ensureConnected() {
        if (!config.key && !(config.proxyUrl && config.userId)) {
            // Re-read env for dynamic updates
            config.key = process.env.STRIPE_SECRET_KEY;
            config.proxyUrl = process.env.FLOCCA_PROXY_URL;
            config.userId = process.env.FLOCCA_USER_ID;

            if (!config.key && !(config.proxyUrl && config.userId)) {
                throw new Error("Stripe Not Configured. Provide STRIPE_SECRET_KEY or use Proxy.");
            }
        }

        if (!api) {
            const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
            let baseURL = 'https://api.stripe.com';

            if (config.proxyUrl && config.userId) {
                baseURL = config.proxyUrl.replace(/\/$/, '');
                headers['X-Flocca-User-ID'] = config.userId;
            } else {
                headers['Authorization'] = `Bearer ${config.key}`;
            }

            api = axios.create({ baseURL, headers });
        }
        return api;
    }

    server.tool('stripe_health', {}, async () => {
        try {
            const client = await ensureConnected();
            await client.get('/v1/balance');
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, mode: config.proxyUrl ? 'proxy' : 'direct' }) }] };
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
