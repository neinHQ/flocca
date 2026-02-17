
const axios = require('axios');
const { McpServer } = require(require('path').join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js'));
const { StdioServerTransport } = require(require('path').join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/stdio.js'));

const SERVER_INFO = { name: 'jira-mcp', version: '1.0.0' };

const PROXY_URL = process.env.FLOCCA_PROXY_URL;
const USER_ID = process.env.FLOCCA_USER_ID;

let config = {
    email: process.env.JIRA_EMAIL,
    token: process.env.JIRA_API_TOKEN || process.env.JIRA_TOKEN,
    url: process.env.JIRA_SITE_URL || process.env.JIRA_URL,
    deploymentMode: (process.env.JIRA_DEPLOYMENT_MODE || 'cloud').toLowerCase()
};

// Override config if Proxy is active
if (PROXY_URL && USER_ID) {
    config.url = PROXY_URL;
    // We don't need email/token locally
}
config.url = normalizeBaseUrl(config.url);

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

function normalizeBaseUrl(url) {
    return (url || '').replace(/\/+$/, '');
}

function getApiVersions() {
    if (config.deploymentMode === 'server' || config.deploymentMode === 'self_hosted') return ['2', '3'];
    return ['3', '2'];
}

async function jiraGet(pathSuffix, options = {}) {
    const versions = getApiVersions();
    let lastError;

    for (const version of versions) {
        try {
            const url = `${config.url}/rest/api/${version}/${pathSuffix.replace(/^\/+/, '')}`;
            return await axios.get(url, options);
        } catch (err) {
            lastError = err;
            const status = err?.response?.status;
            // If endpoint doesn't exist, try next API version.
            if (status === 404 || status === 405) continue;
            throw err;
        }
    }

    throw lastError || new Error('Jira request failed');
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
                    url: { type: 'string' },
                    deployment_mode: { type: 'string' }
                },
                required: ['email', 'token', 'url']
            }
        },
        async (args) => {
            config.email = args.email;
            config.token = args.token;
            config.url = normalizeBaseUrl(args.url);
            if (args.deployment_mode) config.deploymentMode = args.deployment_mode.toLowerCase();
            try {
                await jiraGet('myself', { headers: getHeaders() });
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
                const res = await jiraGet('search', {
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
                const res = await jiraGet(`issue/${args.issue_key}`, { headers: getHeaders() });
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

module.exports = {
    main,
    __test: {
        normalizeBaseUrl,
        getApiVersions,
        jiraGet,
        setConfig: (next) => { config = { ...config, ...next }; },
        getConfig: () => ({ ...config })
    }
};
