const axios = require('axios');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const SERVER_INFO = { name: 'jenkins-mcp', version: '1.0.0' };

let config = {
    url: process.env.JENKINS_URL,
    user: process.env.JENKINS_USER,
    token: process.env.JENKINS_TOKEN
};

function normalizeError(err) {
    const data = err.response?.data || {};
    const msg = data.message || err.message || JSON.stringify(data);
    return { isError: true, content: [{ type: 'text', text: `Jenkins Error: ${msg}` }] };
}

function createJenkinsServer() {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });
    let api = null;
    let crumb = null;

    async function ensureConnected() {
        if (!config.url || !config.user || !config.token) {
            config.url = process.env.JENKINS_URL;
            config.user = process.env.JENKINS_USER;
            config.token = process.env.JENKINS_TOKEN;

            if (!config.url || !config.user || !config.token) {
                throw new Error("Jenkins Not Configured. Set JENKINS_URL, JENKINS_USER, and JENKINS_TOKEN.");
            }
        }

        if (!api) {
            const auth = Buffer.from(`${config.user}:${config.token}`).toString('base64');
            api = axios.create({
                baseURL: config.url.replace(/\/$/, ''),
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Accept': 'application/json'
                }
            });
        }

        // Try to get Crumb for POST requests (if not already fetched)
        if (!crumb) {
            try {
                const resp = await api.get('/crumbIssuer/api/json');
                crumb = { field: resp.data.crumbRequestField, value: resp.data.crumb };
            } catch (e) {
                // Jenkins might have CSRF protection disabled, ignore error
                console.error('Jenkins: CSRF protection might be disabled or unreachable.');
            }
        }

        return api;
    }

    server.tool('jenkins_health', {}, async () => {
        try {
            const client = await ensureConnected();
            const resp = await client.get('/api/json');
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, nodeName: resp.data.nodeName || 'master' }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('jenkins_list_jobs', {}, async () => {
        try {
            const client = await ensureConnected();
            const resp = await client.get('/api/json');
            const jobs = (resp.data.jobs || []).map(j => ({ name: j.name, url: j.url, color: j.color }));
            return { content: [{ type: 'text', text: JSON.stringify({ jobs }, null, 2) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('jenkins_get_job_details',
        { job_name: z.string() },
        async (args) => {
            try {
                const client = await ensureConnected();
                const resp = await client.get(`/job/${args.job_name}/api/json`);
                return { content: [{ type: 'text', text: JSON.stringify(resp.data, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('jenkins_build_job',
        {
            job_name: z.string(),
            parameters: z.record(z.string(), z.any()).optional(),
            confirm: z.boolean().describe('Safety gate')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set confirm:true to trigger build." }] };
            try {
                const client = await ensureConnected();
                const headers = crumb ? { [crumb.field]: crumb.value } : {};
                const endpoint = args.parameters ? `/job/${args.job_name}/buildWithParameters` : `/job/${args.job_name}/build`;
                const params = args.parameters || {};
                await client.post(endpoint, null, { headers, params });
                return { content: [{ type: 'text', text: `Build triggered for ${args.job_name}.` }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('jenkins_abort_build',
        {
            job_name: z.string(),
            build_number: z.number().int(),
            confirm: z.boolean().describe('Safety gate')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set confirm:true to abort." }] };
            try {
                const client = await ensureConnected();
                const headers = crumb ? { [crumb.field]: crumb.value } : {};
                await client.post(`/job/${args.job_name}/${args.build_number}/stop`, null, { headers });
                return { content: [{ type: 'text', text: `Build ${args.build_number} of ${args.job_name} aborted.` }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('jenkins_get_console_output',
        {
            job_name: z.string(),
            build_number: z.number().int()
        },
        async (args) => {
            try {
                const client = await ensureConnected();
                const resp = await client.get(`/job/${args.job_name}/${args.build_number}/consoleText`);
                return { content: [{ type: 'text', text: resp.data }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    return server;
}

if (require.main === module) {
    const server = createJenkinsServer();
    const transport = new StdioServerTransport();
    server.connect(transport).then(() => {
        console.error('Jenkins MCP server running on stdio');
    }).catch(error => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createJenkinsServer };
