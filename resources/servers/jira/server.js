const axios = require('axios');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const SERVER_INFO = { name: 'jira-mcp', version: '2.0.0' };

function normalizeBaseUrl(url) {
    const trimmed = (url || '').trim().replace(/\/+$/, '');
    if (!trimmed) return trimmed;
    if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
    return trimmed;
}

function normalizeError(err) {
    const data = err.response?.data;
    const msg = data?.errorMessages?.join(', ') || data?.message || err.message || JSON.stringify(data);
    return { isError: true, content: [{ type: 'text', text: `Jira Error: ${msg}` }] };
}

function createJiraServer() {
    let config = {
        email: process.env.JIRA_EMAIL,
        token: process.env.JIRA_API_TOKEN || process.env.JIRA_TOKEN,
        url: process.env.JIRA_SITE_URL || process.env.JIRA_URL,
        deploymentMode: (process.env.JIRA_DEPLOYMENT_MODE || 'cloud').toLowerCase(),
        proxyUrl: process.env.FLOCCA_PROXY_URL,
        userId: process.env.FLOCCA_USER_ID
    };

    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    function getHeaderCandidates() {
        if (config.proxyUrl && config.userId) {
            return [{ 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Flocca-User-ID': config.userId }];
        }
        if (!config.token || !config.url) throw new Error("Jira Not Configured. Missing token or url.");
        const baseHeaders = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
        const candidates = [];
        const basic = config.email ? { ...baseHeaders, 'Authorization': `Basic ${Buffer.from(`${config.email}:${config.token}`).toString('base64')}` } : null;
        const bearer = { ...baseHeaders, 'Authorization': `Bearer ${config.token}` };

        if (config.deploymentMode === 'server' || config.deploymentMode === 'self_hosted') {
            candidates.push(bearer);
            if (basic) candidates.push(basic);
        } else {
            if (basic) candidates.push(basic);
            candidates.push(bearer);
        }
        return candidates;
    }

    async function jiraReq(method, pathPart, options = {}) {
        const versions = (config.deploymentMode === 'server' || config.deploymentMode === 'self_hosted') ? ['2', '3'] : ['3', '2'];
        const headers = getHeaderCandidates();
        const baseURL = normalizeBaseUrl(config.proxyUrl && config.userId ? config.proxyUrl : config.url);
        let lastErr;

        for (const v of versions) {
            for (const h of headers) {
                try {
                    const url = `${baseURL}/rest/api/${v}/${pathPart.replace(/^\/+/, '')}`;
                    const res = await axios({
                        method,
                        url,
                        ...options,
                        headers: { ...(options.headers || {}), ...h, 'X-Atlassian-Token': 'no-check' }
                    });
                    return res;
                } catch (err) {
                    lastErr = err;
                    const status = err.response?.status;
                    if (status === 401 && headers.length > 1) continue;
                    if ([404, 405].includes(status)) break;
                    throw err;
                }
            }
        }
        throw lastErr;
    }

    async function jiraAgileReq(method, pathPart, options = {}) {
        const headers = getHeaderCandidates();
        const baseURL = normalizeBaseUrl(config.proxyUrl && config.userId ? config.proxyUrl : config.url);
        let lastErr;

        for (const h of headers) {
            try {
                const url = `${baseURL}/rest/agile/1.0/${pathPart.replace(/^\/+/, '')}`;
                return await axios({
                    method,
                    url,
                    ...options,
                    headers: { ...(options.headers || {}), ...h }
                });
            } catch (err) {
                lastErr = err;
                if (err.response?.status === 401 && headers.length > 1) continue;
                throw err;
            }
        }
        throw lastErr;
    }

    server.tool('jira_health', {}, async () => {
        try {
            await jiraReq('GET', 'myself');
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, mode: config.proxyUrl ? 'proxy' : 'direct', deployment: config.deploymentMode }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('jira_configure',
        {
            email: z.string().optional().describe('Atlassian Email'),
            token: z.string().describe('Atlassian API Token or PAT'),
            url: z.string().describe('Jira Site URL'),
            deployment_mode: z.enum(['cloud', 'server']).optional().default('cloud')
        },
        async (args) => {
            try {
                config.email = args.email;
                config.token = args.token;
                config.url = args.url;
                config.deploymentMode = args.deployment_mode;
                await jiraReq('GET', 'myself');
                return { content: [{ type: 'text', text: "Jira configured successfully." }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('jira_list_projects',
        { limit: z.number().int().positive().optional().default(50) },
        async (args) => {
            try {
                const res = await jiraReq('GET', 'project/search', { params: { maxResults: args.limit } });
                let result = [];
                if (res && res.data) {
                    if (res.data.values && Array.isArray(res.data.values)) {
                        result = res.data.values;
                    } else if (Array.isArray(res.data)) {
                        result = res.data;
                    } else {
                        result = [res.data];
                    }
                }
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('jira_search_issues',
        {
            jql: z.string().describe('Jira Query Language string'),
            limit: z.number().int().positive().optional().default(10)
        },
        async (args) => {
            try {
                const res = await jiraReq('GET', 'search', { params: { jql: args.jql, maxResults: args.limit } });
                let issues = [];
                if (res && res.data) {
                    if (res.data.issues && Array.isArray(res.data.issues)) {
                        issues = res.data.issues;
                    } else if (Array.isArray(res.data)) {
                        issues = res.data;
                    }
                }
                return { content: [{ type: 'text', text: JSON.stringify(issues, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('jira_get_issue',
        {
            issue_key: z.string().describe('The Jira issue key (e.g. PROJ-123)'),
            issueKey: z.string().optional().describe('Legacy issue key alias')
        },
        async (args) => {
            try {
                const key = args.issue_key || args.issueKey;
                const res = await jiraReq('GET', `issue/${key}`);
                return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('jira_create_issue',
        {
            projectKey: z.string().describe("Lowercase 'key' not supported, use uppercase 'PROJ'"),
            issueType: z.enum(['Bug', 'Task', 'Story', 'Epic', 'Subtask', 'Sub-task', 'Defect']),
            summary: z.string(),
            description: z.string().optional(),
            priority: z.enum(['Highest', 'High', 'Medium', 'Low', 'Lowest']).optional(),
            assigneeAccountId: z.string().optional(),
            labels: z.array(z.string()).optional(),
            additionalFields: z.object({}).catchall(z.any()).optional(),
            confirm: z.boolean().describe('Confirm mutation (safety gate)')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set confirm:true to create this issue." }] };
            try {
                const fields = {
                    project: { key: args.projectKey },
                    summary: args.summary,
                    issuetype: { name: args.issueType },
                    ...(args.description ? { description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: args.description }] }] } } : {}),
                    ...(args.priority ? { priority: { name: args.priority } } : {}),
                    ...(args.assigneeAccountId ? { assignee: { accountId: args.assigneeAccountId } } : {}),
                    ...(args.labels ? { labels: args.labels } : {}),
                    ...(args.additionalFields || {})
                };
                const res = await jiraReq('POST', 'issue', { data: { fields } });
                return { content: [{ type: 'text', text: JSON.stringify({ key: res.data.key, id: res.data.id }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('jira_update_issue',
        {
            issue_key: z.string(),
            summary: z.string().optional(),
            description: z.string().optional(),
            priority: z.string().optional(),
            assignee_account_id: z.string().optional(),
            labels: z.array(z.string()).optional(),
            additional_fields: z.object({}).catchall(z.any()).optional(),
            confirm: z.boolean().describe('Confirm mutation (safety gate)')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set confirm:true to update this issue." }] };
            try {
                const fields = {
                    ...(args.summary ? { summary: args.summary } : {}),
                    ...(args.description ? { description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: args.description }] }] } } : {}),
                    ...(args.priority ? { priority: { name: args.priority } } : {}),
                    ...(args.assignee_account_id ? { assignee: { accountId: args.assignee_account_id } } : {}),
                    ...(args.labels ? { labels: args.labels } : {}),
                    ...(args.additional_fields || {})
                };
                await jiraReq('PUT', `issue/${args.issue_key}`, { data: { fields } });
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, key: args.issue_key }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('jira_list_transitions',
        { issue_key: z.string() },
        async (args) => {
            try {
                const res = await jiraReq('GET', `issue/${args.issue_key}/transitions`);
                return { content: [{ type: 'text', text: JSON.stringify(res.data.transitions || [], null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('jira_transition_issue',
        {
            issue_key: z.string(),
            transition_id: z.string(),
            confirm: z.boolean().describe('Confirm mutation (safety gate)')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set confirm:true to transition this issue." }] };
            try {
                await jiraReq('POST', `issue/${args.issue_key}/transitions`, { data: { transition: { id: args.transition_id } } });
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, key: args.issue_key }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('jira_add_comment',
        {
            issue_key: z.string(),
            body: z.string(),
            confirm: z.boolean().describe('Confirm mutation (safety gate)')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set confirm:true to add comment." }] };
            try {
                const comment = { body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: args.body }] }] } };
                const res = await jiraReq('POST', `issue/${args.issue_key}/comment`, { data: comment });
                return { content: [{ type: 'text', text: JSON.stringify({ id: res.data.id, created: res.data.created }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('jira_link_issues',
        {
            link_type: z.string().describe('e.g. "Blocks", "Relates"'),
            inward_issue_key: z.string(),
            outward_issue_key: z.string(),
            confirm: z.boolean().describe('Confirm mutation (safety gate)')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set confirm:true to link issues." }] };
            try {
                const data = {
                    type: { name: args.link_type },
                    inwardIssue: { key: args.inward_issue_key },
                    outwardIssue: { key: args.outward_issue_key }
                };
                await jiraReq('POST', 'issueLink', { data });
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // Agile Tools
    server.tool('jira_list_boards',
        { project_key: z.string().optional(), limit: z.number().int().positive().optional().default(25) },
        async (args) => {
            try {
                const res = await jiraAgileReq('GET', 'board', { params: { maxResults: args.limit, projectKeyOrId: args.project_key } });
                return { content: [{ type: 'text', text: JSON.stringify(res.data.values || [], null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('jira_list_sprints',
        { board_id: z.number().int(), state: z.enum(['active', 'closed', 'future']).optional() },
        async (args) => {
            try {
                const res = await jiraAgileReq('GET', `board/${args.board_id}/sprint`, { params: { state: args.state } });
                return { content: [{ type: 'text', text: JSON.stringify(res.data.values || [], null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.__test = {
        normalizeBaseUrl,
        normalizeError,
        getHeaderCandidates,
        jiraReq,
        setConfig: (next) => { config = { ...config, ...next }; },
        getConfig: () => ({ ...config })
    };

    return server;
}

if (require.main === module) {
    const server = createJiraServer();
    const transport = new StdioServerTransport();
    server.connect(transport).then(() => {
        console.error('Jira MCP server running on stdio');
    }).catch((error) => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createJiraServer };
