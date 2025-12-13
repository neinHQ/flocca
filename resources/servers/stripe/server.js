#!/usr/bin/env node

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const axios = require("axios");

// Config: Use Proxy if available, else local Key
const proxyUrl = process.env.FLOCCA_PROXY_URL;
const userId = process.env.FLOCCA_USER_ID;
const localKey = process.env.STRIPE_SECRET_KEY;

if (!localKey && !(proxyUrl && userId)) {
    console.error("Stripe not configured. Set STRIPE_SECRET_KEY or Connect via Flocca Vault.");
    process.exit(1);
}

// Axios Instance
let api;
if (proxyUrl && userId) {
    api = axios.create({
        baseURL: proxyUrl, // e.g. http://localhost:3000/proxy/stripe
        headers: {
            'X-Flocca-User-ID': userId,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });
} else {
    api = axios.create({
        baseURL: 'https://api.stripe.com',
        headers: {
            'Authorization': `Bearer ${localKey}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });
}

const server = new Server(
    {
        name: "stripe-server",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

// Tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "get_balance",
                description: "Retrieve current Stripe balance.",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
            },
            {
                name: "list_customers",
                description: "List recent customers.",
                inputSchema: {
                    type: "object",
                    properties: {
                        limit: { type: "number", description: "Number of customers to return (default 10)" }
                    },
                },
            }
        ],
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        if (name === "get_balance") {
            const response = await api.get('/v1/balance');
            return {
                content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }],
            };
        }

        if (name === "list_customers") {
            const limit = args?.limit || 10;
            const response = await api.get('/v1/customers', { params: { limit } });
            return {
                content: [{ type: "text", text: JSON.stringify(response.data.data, null, 2) }],
            };
        }

        throw new Error(`Unknown tool: ${name}`);
    } catch (error) {
        return {
            content: [{ type: "text", text: `Error: ${error.message} \n ${JSON.stringify(error.response?.data || {})}` }],
            isError: true,
        };
    }
});

const transport = new StdioServerTransport();
server.connect(transport);
console.error("Stripe MCP Server running on stdio");
