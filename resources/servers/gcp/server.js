const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const SERVER_INFO = { name: 'gcp-mcp', version: '2.0.0' };

let sessionConfig = {
    project_id: process.env.GCP_PROJECT_ID,
    token: process.env.GCP_ACCESS_TOKEN,
    default_region: process.env.GCP_REGION,
    default_zone: process.env.GCP_ZONE,
    identity: undefined
};

function normalizeError(err) {
    const msg = err.message || JSON.stringify(err);
    const code = err.code || 'GCP_ERROR';
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { message: msg, code, status: err.http_status, details: err.details } }) }] };
}

async function gcpFetch(url, { method = 'GET', query, body, headers } = {}) {
    const u = new URL(url);
    if (query) {
        Object.entries(query).forEach(([k, v]) => {
            if (v !== undefined && v !== null) u.searchParams.append(k, v);
        });
    }

    if (!sessionConfig.token) throw { message: 'GCP access token not configured', code: 'AUTH_FAILED' };

    const resp = await fetch(u.toString(), {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionConfig.token}`,
            ...(headers || {})
        },
        body: body ? JSON.stringify(body) : undefined
    });

    let data = {};
    try { data = await resp.json(); } catch (_) { data = {}; }

    if (!resp.ok || data.error) {
        const err = data.error || {};
        throw { message: err.message || resp.statusText || 'GCP request failed', code: err.status || 'GCP_ERROR', details: err, http_status: resp.status };
    }
    return data;
}

function parseRelativeNow(expr) {
    if (!expr || expr === 'now') return new Date();
    const m = expr.match(/^now-(\d+)([smhd])$/);
    if (!m) return new Date(expr);
    const value = Number(m[1]);
    const unit = m[2];
    const map = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return new Date(Date.now() - value * map[unit]);
}

function createGcpServer() {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    async function ensureConnected() {
        if (!sessionConfig.project_id || !sessionConfig.token) {
            // Re-check environment variables in case they were set later
            sessionConfig.project_id = process.env.GCP_PROJECT_ID;
            sessionConfig.token = process.env.GCP_ACCESS_TOKEN;
            sessionConfig.default_region = process.env.GCP_REGION;
            sessionConfig.default_zone = process.env.GCP_ZONE;

            if (!sessionConfig.project_id || !sessionConfig.token) {
                throw { message: 'GCP not configured. Provide GCP_PROJECT_ID and GCP_ACCESS_TOKEN.', code: 'AUTH_FAILED' };
            }
        }
    }

    // --- Core & Config ---

    server.tool('gcp_health', {}, async () => {
        try {
            await ensureConnected();
            const info = await gcpFetch(`https://cloudresourcemanager.googleapis.com/v1/projects/${sessionConfig.project_id}`);
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, project_id: sessionConfig.project_id, project_number: info.projectNumber }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('gcp_configure',
        {
            project_id: z.string().describe('GCP Project ID'),
            token: z.string().describe('GCP Access Token'),
            default_region: z.string().optional(),
            default_zone: z.string().optional()
        },
        async (args) => {
            try {
                sessionConfig.project_id = args.project_id;
                sessionConfig.token = args.token;
                sessionConfig.default_region = args.default_region;
                sessionConfig.default_zone = args.default_zone;

                const info = await gcpFetch(`https://cloudresourcemanager.googleapis.com/v1/projects/${args.project_id}`);
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, project_id: args.project_id, message: "Successfully configured GCP." }) }] };
            } catch (e) {
                sessionConfig.token = undefined;
                return normalizeError(e);
            }
        }
    );

    // --- Discovery ---

    server.tool('gcp_list_services', {}, async () => {
        try {
            await ensureConnected();
            const data = await gcpFetch(`https://serviceusage.googleapis.com/v1/projects/${sessionConfig.project_id}/services`, { query: { filter: 'state:ENABLED' } });
            return { content: [{ type: 'text', text: JSON.stringify({ services: (data.services || []).map(s => ({ name: s.name, state: s.state })) }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('gcp_list_regions', {}, async () => {
        try {
            await ensureConnected();
            const data = await gcpFetch(`https://compute.googleapis.com/compute/v1/projects/${sessionConfig.project_id}/regions`);
            return { content: [{ type: 'text', text: JSON.stringify({ regions: (data.items || []).map(r => ({ name: r.name, status: r.status })) }) }] };
        } catch (e) { return normalizeError(e); }
    });

    // --- Cloud Run ---

    server.tool('gcp_cloudrun_list_services',
        { region: z.string().describe('GCP region (e.g. us-central1)') },
        async (args) => {
            try {
                await ensureConnected();
                const data = await gcpFetch(`https://run.googleapis.com/apis/serving.knative.dev/v1/namespaces/${sessionConfig.project_id}/services`, { query: { location: args.region } });
                return { content: [{ type: 'text', text: JSON.stringify({ services: (data.items || []).map(s => ({ name: s.metadata?.name, url: s.status?.url })) }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('gcp_cloudrun_invoke',
        {
            url: z.string().describe('Full service URL'),
            method: z.string().default('GET'),
            body: z.object({}).catchall(z.any()).optional(),
            headers: z.object({}).catchall(z.any()).optional()
        },
        async (args) => {
            try {
                await ensureConnected();
                const resp = await fetch(args.url, {
                    method: args.method,
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionConfig.token}`, ...(args.headers || {}) },
                    body: args.body ? JSON.stringify(args.body) : undefined
                });
                const text = await resp.text();
                return { content: [{ type: 'text', text: JSON.stringify({ status: resp.status, body: text }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- Compute Engine ---

    server.tool('gcp_compute_list_instances',
        { zone: z.string().optional().describe('GCP zone (e.g. us-central1-a)') },
        async (args) => {
            try {
                await ensureConnected();
                const zone = args.zone || sessionConfig.default_zone;
                if (!zone) throw { message: 'Zone required', code: 'INVALID_REQUEST' };
                const data = await gcpFetch(`https://compute.googleapis.com/compute/v1/projects/${sessionConfig.project_id}/zones/${zone}/instances`);
                return { content: [{ type: 'text', text: JSON.stringify({ instances: data.items || [] }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    async function handleComputeAction(zone, name, action, confirm) {
        if (!confirm) return { isError: true, content: [{ type: 'text', text: `CONFIRMATION_REQUIRED: Are you sure you want to ${action} instance ${name} in ${zone}? Set confirm: true to proceed.` }] };
        await ensureConnected();
        const data = await gcpFetch(`https://compute.googleapis.com/compute/v1/projects/${sessionConfig.project_id}/zones/${zone}/instances/${name}/${action}`, { method: 'POST' });
        return { content: [{ type: 'text', text: JSON.stringify({ operation: data }) }] };
    }

    server.tool('gcp_compute_start_instance',
        { zone: z.string(), name: z.string(), confirm: z.boolean().describe('Safety gate') },
        async (args) => {
            try { return await handleComputeAction(args.zone, args.name, 'start', args.confirm); }
            catch (e) { return normalizeError(e); }
        }
    );

    server.tool('gcp_compute_stop_instance',
        { zone: z.string(), name: z.string(), confirm: z.boolean().describe('Safety gate') },
        async (args) => {
            try { return await handleComputeAction(args.zone, args.name, 'stop', args.confirm); }
            catch (e) { return normalizeError(e); }
        }
    );

    // --- Storage (GCS) ---

    server.tool('gcp_storage_list_buckets', {}, async () => {
        try {
            await ensureConnected();
            const data = await gcpFetch(`https://storage.googleapis.com/storage/v1/b`, { query: { project: sessionConfig.project_id } });
            return { content: [{ type: 'text', text: JSON.stringify({ buckets: data.items || [] }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('gcp_storage_list_objects',
        { bucket: z.string(), prefix: z.string().optional() },
        async (args) => {
            try {
                await ensureConnected();
                const data = await gcpFetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(args.bucket)}/o`, { query: { prefix: args.prefix } });
                return { content: [{ type: 'text', text: JSON.stringify({ objects: data.items || [] }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('gcp_storage_put_object',
        {
            bucket: z.string(),
            object: z.string().describe('Target object path'),
            content: z.string().describe('Text content to upload'),
            content_type: z.string().default('text/plain'),
            confirm: z.boolean().describe('Safety gate')
        },
        async (args) => {
            try {
                if (!args.confirm) return { isError: true, content: [{ type: 'text', text: `CONFIRMATION_REQUIRED: Uploading to gs://${args.bucket}/${args.object}. Set confirm: true to proceed.` }] };
                await ensureConnected();
                const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(args.bucket)}/o?uploadType=media&name=${encodeURIComponent(args.object)}`;
                const resp = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': args.content_type, 'Authorization': `Bearer ${sessionConfig.token}` },
                    body: args.content
                });
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok) throw { message: 'GCS putObject failed', code: 'PERMISSION_DENIED', details: data, http_status: resp.status };
                return { content: [{ type: 'text', text: JSON.stringify({ bucket: args.bucket, object: args.object, mediaLink: data.mediaLink }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- Pub/Sub ---

    server.tool('gcp_pubsub_publish_message',
        {
            topic: z.string().describe('Full topic name: projects/[ID]/topics/[NAME]'),
            data: z.string().describe('Message string'),
            attributes: z.object({}).catchall(z.any()).optional(),
            confirm: z.boolean().describe('Safety gate')
        },
        async (args) => {
            try {
                if (!args.confirm) return { isError: true, content: [{ type: 'text', text: `CONFIRMATION_REQUIRED: Publishing to ${args.topic}. Set confirm: true to proceed.` }] };
                await ensureConnected();
                const body = { messages: [{ data: Buffer.from(args.data).toString('base64'), attributes: args.attributes }] };
                const data = await gcpFetch(`https://pubsub.googleapis.com/v1/${args.topic}:publish`, { method: 'POST', body });
                return { content: [{ type: 'text', text: JSON.stringify({ messageIds: data.messageIds }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- Monitoring & Logging ---

    server.tool('gcp_logging_query_logs',
        {
            filter: z.string().describe('Logging query filter'),
            limit: z.number().default(100),
            time_range: z.object({ from: z.string().optional(), to: z.string().optional() }).optional()
        },
        async (args) => {
            try {
                await ensureConnected();
                const tr = args.time_range || {};
                const from = parseRelativeNow(tr.from || 'now-1h').toISOString();
                const to = parseRelativeNow(tr.to || 'now').toISOString();
                
                const body = {
                    resourceNames: [`projects/${sessionConfig.project_id}`],
                    filter: args.filter,
                    pageSize: args.limit,
                    orderBy: 'timestamp desc'
                };
                if (from) body['interval'] = { startTime: from, endTime: to };
                
                const data = await gcpFetch(`https://logging.googleapis.com/v2/entries:list`, { method: 'POST', body });
                return { content: [{ type: 'text', text: JSON.stringify({ entries: data.entries || [] }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('gcp_incident_find_recent_errors',
        {
            service: z.string().describe('Cloud Run / GAE service name'),
            minutes: z.number().default(30)
        },
        async (args) => {
            try {
                await ensureConnected();
                const to = new Date().toISOString();
                const from = new Date(Date.now() - args.minutes * 60000).toISOString();
                const filter = `resource.labels.service_name="${args.service}" AND severity>=ERROR AND timestamp>="${from}" AND timestamp<="${to}"`;
                const data = await gcpFetch(`https://logging.googleapis.com/v2/entries:list`, { 
                    method: 'POST', 
                    body: { resourceNames: [`projects/${sessionConfig.project_id}`], filter, orderBy: 'timestamp desc', pageSize: 200 } 
                });
                return { content: [{ type: 'text', text: JSON.stringify({ entries: (data.entries || []).map(e => ({ severity: e.severity, message: e.textPayload || e.jsonPayload })) }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    return server;
}

if (require.main === module) {
    const server = createGcpServer();
    const transport = new StdioServerTransport();
    server.connect(transport).then(() => {
        console.error('GCP MCP server running on stdio');
    }).catch((error) => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createGcpServer };
