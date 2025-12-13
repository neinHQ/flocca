
const axios = require('axios');
const { McpServer } = require(require('path').join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js'));
const { StdioServerTransport } = require(require('path').join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/stdio.js'));

const SERVER_INFO = { name: 'jira-mcp', version: '1.0.0' };

const PROXY_URL = process.env.FLOCCA_PROXY_URL;
const USER_ID = process.env.FLOCCA_USER_ID;

let config = {
    email: process.env.JIRA_EMAIL,
    token: process.env.JIRA_API_TOKEN || process.env.JIRA_TOKEN,
    url: process.env.JIRA_SITE_URL || process.env.JIRA_URL
};

// Override config if Proxy is active
if (PROXY_URL && USER_ID) {
    config.url = PROXY_URL;
    // We don't need email/token locally
}

function getHeaders() {
    if (PROXY_URL && USER_ID) {
        return {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Flocca-User-ID': USER_ID
        };
    }

    if (!config.email || !config.token || !config.url) throw new Error("Jira Not Configured. Missing email, token, or url.");
    const auth = Buffer.from(`${config.email}:${config.token}`).toString('base64');
    return {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };
}

function normalizeError(err) {
    const msg = err.response?.data?.errorMessages?.join(', ') || JSON.stringify(err.response?.data) || err.message;
    return { isError: true, content: [{ type: 'text', text: `Jira Error: ${msg}` }] };
}

async function main() {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    server.registerTool('jira.configure',
        {
            description: 'Configure Jira',
            inputSchema: {
                type: 'object',
                properties: {
                    email: { type: 'string' },
                    token: { type: 'string' },
                    url: { type: 'string' }
                },
                required: ['email', 'token', 'url']
            }
        },
        async (args) => {
            config.email = args.email;
            config.token = args.token;
            config.url = args.url.replace(/\/$/, '');
            try {
                // Verify
                const baseUrl = (PROXY_URL && USER_ID) ? PROXY_URL : config.url;
                // Note: Proxy expects /rest/api/... appended? 
                // Our proxy implementation at /proxy/jira/* accepts full path
                // But local Jira URL is usually base.
                // If using Proxy: PROXY_URL is http://localhost:3000/proxy/jira
                // Call needs to be: http://localhost:3000/proxy/jira/rest/api/3/myself
                await axios.get(`${baseUrl}/rest/api/3/myself`, { headers: getHeaders() });
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, status: 'authenticated' }) }] };
            } catch (e) {
                config.token = undefined;
                return normalizeError(e);
            }
        }
    );

    server.registerTool('jira.searchIssues',
        {
            description: 'Search Issues (JQL)',
            inputSchema: {
                type: 'object',
                properties: {
                    jql: { type: 'string' },
                    limit: { type: 'number' }
                },
                required: ['jql']
            }
        },
        async (args) => {
            try {
                const res = await axios.get(`${config.url}/rest/api/3/search`, {
                    headers: getHeaders(),
                    params: { jql: args.jql, maxResults: args.limit || 10 }
                });
                return { content: [{ type: 'text', text: JSON.stringify(res.data.issues) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.registerTool('jira.getIssue',
        {
            description: 'Get Issue Details',
            inputSchema: {
                type: 'object',
                properties: { issue_key: { type: 'string' } },
                required: ['issue_key']
            }
        },
        async (args) => {
            try {
                const res = await axios.get(`${config.url}/rest/api/3/issue/${args.issue_key}`, { headers: getHeaders() });
                return { content: [{ type: 'text', text: JSON.stringify(res.data) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    const transport = new StdioServerTransport();
    await server.connect(transport);
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { main };
