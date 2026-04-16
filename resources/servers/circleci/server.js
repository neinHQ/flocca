const axios = require('axios');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const SERVER_INFO = { name: 'circleci-mcp', version: '1.0.0' };

function createCircleCiServer() {
    let sessionConfig = {
        token: process.env.CIRCLECI_TOKEN,
        baseUrl: 'https://circleci.com/api/v2'
    };

    function normalizeError(err) {
        const data = err.response?.data || {};
        const msg = data.message || err.message || JSON.stringify(data);
        return { isError: true, content: [{ type: 'text', text: `CircleCI Error: ${msg}` }] };
    }

    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });
    let api = null;

    async function ensureConnected() {
        if (!sessionConfig.token) {
            sessionConfig.token = process.env.CIRCLECI_TOKEN;
            if (!sessionConfig.token) {
                throw new Error("CircleCI Not Configured. Set CIRCLECI_TOKEN environment variable.");
            }
        }

        if (!api) {
            api = axios.create({
                baseURL: sessionConfig.baseUrl,
                headers: {
                    'Circle-Token': sessionConfig.token,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
        }
        return api;
    }

    server.tool('circleci_health', {}, async () => {
        try {
            const client = await ensureConnected();
            const resp = await client.get('/me');
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, user: resp.data.login }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('circleci_list_pipelines',
        { 
            project_slug: z.string().describe('Project slug in form {vcs}/{org}/{repo}, e.g., gh/circleci/circleci-docs'),
            mine: z.boolean().optional().default(false)
        },
        async (args) => {
            try {
                const client = await ensureConnected();
                const params = args.mine ? { 'mine': true } : {};
                const resp = await client.get(`/project/${args.project_slug}/pipeline`, { params });
                return { content: [{ type: 'text', text: JSON.stringify({ items: resp.data.items }, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('circleci_get_pipeline',
        { pipeline_id: z.string() },
        async (args) => {
            try {
                const client = await ensureConnected();
                const resp = await client.get(`/pipeline/${args.pipeline_id}`);
                return { content: [{ type: 'text', text: JSON.stringify(resp.data, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('circleci_list_workflow_jobs',
        { workflow_id: z.string() },
        async (args) => {
            try {
                const client = await ensureConnected();
                const resp = await client.get(`/workflow/${args.workflow_id}/job`);
                return { content: [{ type: 'text', text: JSON.stringify({ items: resp.data.items }, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('circleci_trigger_pipeline',
        { 
            project_slug: z.string().describe('e.g., gh/org/repo'),
            branch: z.string().optional(),
            tag: z.string().optional(),
            parameters: z.record(z.string(), z.any()).optional().describe('Pipeline parameters to control workflow execution'),
            confirm: z.boolean().describe('Safety gate (Required to trigger new pipeline/workflow)')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set confirm:true to trigger pipeline." }] };
            try {
                const client = await ensureConnected();
                const data = {
                    branch: args.branch,
                    tag: args.tag,
                    parameters: args.parameters
                };
                const resp = await client.post(`/project/${args.project_slug}/pipeline`, data);
                return { content: [{ type: 'text', text: JSON.stringify(resp.data, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('circleci_cancel_job',
        { 
            project_slug: z.string(), 
            job_number: z.number().int(),
            confirm: z.boolean().describe('Safety gate')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set confirm:true to cancel job." }] };
            try {
                const client = await ensureConnected();
                await client.post(`/project/${args.project_slug}/job/${args.job_number}/cancel`);
                return { content: [{ type: 'text', text: `Job ${args.job_number} cancellation initiated.` }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('circleci_approve_job',
        { 
            workflow_id: z.string(), 
            approval_request_id: z.string(),
            confirm: z.boolean().describe('Safety gate')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set confirm:true to approve." }] };
            try {
                const client = await ensureConnected();
                await client.post(`/workflow/${args.workflow_id}/approve/${args.approval_request_id}`);
                return { content: [{ type: 'text', text: "Job approved." }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('circleci_rerun_workflow',
        {
            workflow_id: z.string(),
            from_failed: z.boolean().optional().default(false),
            confirm: z.boolean().describe('Safety gate')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set confirm:true to rerun workflow." }] };
            try {
                const client = await ensureConnected();
                const data = { from_failed: args.from_failed };
                const resp = await client.post(`/workflow/${args.workflow_id}/rerun`, data);
                return { content: [{ type: 'text', text: JSON.stringify(resp.data, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('circleci_get_job_details',
        { 
            project_slug: z.string(), 
            job_number: z.number().int() 
        },
        async (args) => {
            try {
                const client = await ensureConnected();
                const resp = await client.get(`/project/${args.project_slug}/job/${args.job_number}`);
                return { content: [{ type: 'text', text: JSON.stringify(resp.data, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.__test = {
        sessionConfig,
        normalizeError,
        ensureConnected,
        setConfig: (next) => { Object.assign(sessionConfig, next); api = null; },
        getConfig: () => ({ ...sessionConfig })
    };

    return server;
}

if (require.main === module) {
    const serverInstance = createCircleCiServer();
    const transport = new StdioServerTransport();
    serverInstance.connect(transport).then(() => {
        console.error('CircleCI MCP server running on stdio');
    }).catch(error => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createCircleCiServer };
