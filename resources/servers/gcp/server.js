const path = require('path');

const { McpServer } = require(path.join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js'));
const { StdioServerTransport } = require(path.join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/stdio.js'));

const SERVER_INFO = { name: 'gcp-mcp', version: '0.1.0' };

const sessionConfig = {
    project_id: process.env.GCP_PROJECT_ID,
    token: process.env.GCP_ACCESS_TOKEN, // Access Token
    default_region: process.env.GCP_REGION,
    default_zone: process.env.GCP_ZONE,
    identity: undefined
};

function normalizeError(message, code = 'GCP_ERROR', details, http_status) {
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { message, code, details, http_status } }) }] };
}

function requireConfigured() {
    if (!sessionConfig.project_id || !sessionConfig.token) {
        throw new Error('GCP not configured. Call gcp.configure first.');
    }
}

function authHeaders() {
    return { Authorization: `Bearer ${sessionConfig.token}` };
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

async function gcpFetch(url, { method = 'GET', query, body, headers } = {}) {
    const u = new URL(url);
    if (query) {
        Object.entries(query).forEach(([k, v]) => {
            if (v !== undefined && v !== null) u.searchParams.append(k, v);
        });
    }
    const resp = await fetch(u.toString(), {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders(),
            ...(headers || {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    let data = {};
    try { data = await resp.json(); } catch (_) { data = {}; }
    if (!resp.ok || data.error) {
        const err = data.error || {};
        const message = err.message || resp.statusText || 'GCP request failed';
        throw { message, code: err.status || 'GCP_ERROR', details: err, http_status: resp.status };
    }
    return data;
}

async function validateToken(projectId, token) {
    const infoResp = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(token)}`);
    const info = await infoResp.json().catch(() => ({}));
    if (!infoResp.ok || info.error) {
        throw { message: 'Token validation failed', code: 'AUTH_FAILED', details: info, http_status: infoResp.status };
    }
    // Try to fetch project metadata to confirm access
    const resp = await fetch(`https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) {
        const detail = await resp.json().catch(() => ({}));
        throw { message: 'Project access failed', code: 'INVALID_PROJECT', details: detail, http_status: resp.status };
    }
    const identity = info.email ? `serviceAccount:${info.email}` : info.issued_to || 'unknown';
    return { identity };
}

function timeRangeFilter(time_range) {
    if (!time_range) return {};
    const from = parseRelativeNow(time_range.from || 'now-1h').toISOString();
    const to = parseRelativeNow(time_range.to || 'now').toISOString();
    return { from, to };
}

async function main() {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    server.registerTool(
        'gcp.health',
        { description: 'Health check for GCP MCP server.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                requireConfigured();
                const info = await gcpFetch('https://cloudresourcemanager.googleapis.com/v1/projects/' + sessionConfig.project_id);
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, project_id: sessionConfig.project_id, identity: sessionConfig.identity || 'unknown', project_number: info.projectNumber }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code || 'GCP_ERROR', err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'gcp.configure',
        {
            description: 'Configure GCP session with bearer token.',
            inputSchema: {
                type: 'object',
                properties: {
                    project_id: { type: 'string' },
                    credentials: {
                        type: 'object',
                        properties: {
                            type: { type: 'string', enum: ['access_token'] },
                            token: { type: 'string' }
                        },
                        required: ['type', 'token']
                    },
                    default_region: { type: 'string' },
                    default_zone: { type: 'string' }
                },
                required: ['project_id', 'credentials'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                sessionConfig.project_id = args.project_id;
                sessionConfig.token = args.credentials.token;
                sessionConfig.default_region = args.default_region;
                sessionConfig.default_zone = args.default_zone;

                const validation = await validateToken(args.project_id, args.credentials.token);
                sessionConfig.identity = validation.identity;
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, project_id: args.project_id, identity: validation.identity }) }] };
            } catch (err) {
                sessionConfig.project_id = undefined;
                sessionConfig.token = undefined;
                sessionConfig.default_region = undefined;
                sessionConfig.default_zone = undefined;
                sessionConfig.identity = undefined;
                return normalizeError(err.message, err.code || 'AUTH_FAILED', err.details, err.http_status);
            }
        }
    );

    // Resource discovery
    server.registerTool(
        'gcp.listServices',
        { description: 'List enabled services (APIs).', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                requireConfigured();
                const data = await gcpFetch(`https://serviceusage.googleapis.com/v1/projects/${sessionConfig.project_id}/services`, { query: { filter: 'state:ENABLED' } });
                const services = (data.services || []).map((s) => ({ name: s.name, state: s.state }));
                return { content: [{ type: 'text', text: JSON.stringify({ services }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'gcp.listRegions',
        { description: 'List GCP regions.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                requireConfigured();
                const data = await gcpFetch(`https://compute.googleapis.com/compute/v1/projects/${sessionConfig.project_id}/regions`);
                const regions = (data.items || []).map((r) => ({ name: r.name, status: r.status }));
                return { content: [{ type: 'text', text: JSON.stringify({ regions }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'gcp.listZones',
        { description: 'List GCP zones.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                requireConfigured();
                const data = await gcpFetch(`https://compute.googleapis.com/compute/v1/projects/${sessionConfig.project_id}/zones`);
                const zones = (data.items || []).map((z) => ({ name: z.name, status: z.status, region: z.region }));
                return { content: [{ type: 'text', text: JSON.stringify({ zones }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    // Cloud Run
    server.registerTool(
        'gcp.cloudrun.listServices',
        { description: 'List Cloud Run services for a region.', inputSchema: { type: 'object', properties: { region: { type: 'string' } }, required: ['region'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const data = await gcpFetch(`https://run.googleapis.com/apis/serving.knative.dev/v1/namespaces/${sessionConfig.project_id}/services`, { query: { location: args.region } });
                const services = (data.items || []).map((s) => ({
                    name: s.metadata?.name,
                    url: s.status?.url,
                    latestReadyRevision: s.status?.latestReadyRevisionName,
                    traffic: s.status?.traffic
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ services }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'gcp.cloudrun.getService',
        { description: 'Get Cloud Run service details.', inputSchema: { type: 'object', properties: { region: { type: 'string' }, name: { type: 'string' } }, required: ['region', 'name'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const data = await gcpFetch(`https://run.googleapis.com/apis/serving.knative.dev/v1/namespaces/${sessionConfig.project_id}/services/${args.name}`);
                const info = {
                    name: data.metadata?.name,
                    url: data.status?.url,
                    env: data.spec?.template?.spec?.containers?.[0]?.env,
                    traffic: data.status?.traffic,
                    latestReadyRevision: data.status?.latestReadyRevisionName
                };
                return { content: [{ type: 'text', text: JSON.stringify(info) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'gcp.cloudrun.invoke',
        {
            description: 'Invoke a Cloud Run service URL.',
            inputSchema: {
                type: 'object',
                properties: {
                    url: { type: 'string' },
                    method: { type: 'string' },
                    body: { type: 'object' },
                    headers: { type: 'object' }
                },
                required: ['url'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const resp = await fetch(args.url, {
                    method: args.method || 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${sessionConfig.token}`,
                        ...(args.headers || {})
                    },
                    body: args.body ? JSON.stringify(args.body) : undefined
                });
                const text = await resp.text();
                let json;
                try { json = JSON.parse(text); } catch (_) { json = text; }
                if (!resp.ok) throw { message: 'Cloud Run invocation failed', code: 'PERMISSION_DENIED', details: text, http_status: resp.status };
                return { content: [{ type: 'text', text: JSON.stringify({ status: resp.status, body: json }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    // Cloud Functions
    server.registerTool(
        'gcp.functions.listFunctions',
        { description: 'List Cloud Functions in a region.', inputSchema: { type: 'object', properties: { region: { type: 'string' } }, required: ['region'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const data = await gcpFetch(`https://cloudfunctions.googleapis.com/v1/projects/${sessionConfig.project_id}/locations/${args.region}/functions`);
                const functions = (data.functions || []).map((f) => ({ name: f.name, runtime: f.runtime, entryPoint: f.entryPoint, updateTime: f.updateTime, httpsTrigger: f.httpsTrigger }));
                return { content: [{ type: 'text', text: JSON.stringify({ functions }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'gcp.functions.getFunction',
        { description: 'Get Cloud Function details.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, region: { type: 'string' } }, required: ['name', 'region'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const data = await gcpFetch(`https://cloudfunctions.googleapis.com/v1/projects/${sessionConfig.project_id}/locations/${args.region}/functions/${args.name}`);
                return { content: [{ type: 'text', text: JSON.stringify(data) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'gcp.functions.invoke',
        {
            description: 'Invoke HTTP-triggered Cloud Function.',
            inputSchema: {
                type: 'object',
                properties: { name: { type: 'string' }, region: { type: 'string' }, payload: { type: 'object' } },
                required: ['name', 'region'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const meta = await gcpFetch(`https://cloudfunctions.googleapis.com/v1/projects/${sessionConfig.project_id}/locations/${args.region}/functions/${args.name}`);
                if (!meta.httpsTrigger?.url) throw { message: 'Function is not HTTP-triggered', code: 'INVALID_REQUEST' };
                const resp = await fetch(meta.httpsTrigger.url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionConfig.token}` },
                    body: args.payload ? JSON.stringify(args.payload) : undefined
                });
                const text = await resp.text();
                let json;
                try { json = JSON.parse(text); } catch (_) { json = text; }
                if (!resp.ok) throw { message: 'Function invocation failed', code: 'PERMISSION_DENIED', details: json, http_status: resp.status };
                return { content: [{ type: 'text', text: JSON.stringify({ status: resp.status, body: json }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    // Compute Engine
    server.registerTool(
        'gcp.compute.listInstances',
        { description: 'List Compute Engine instances.', inputSchema: { type: 'object', properties: { zone: { type: 'string' } }, additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const zone = args.zone || sessionConfig.default_zone;
                if (!zone) throw { message: 'Zone required', code: 'INVALID_REQUEST' };
                const data = await gcpFetch(`https://compute.googleapis.com/compute/v1/projects/${sessionConfig.project_id}/zones/${zone}/instances`);
                return { content: [{ type: 'text', text: JSON.stringify({ instances: data.items || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'gcp.compute.getInstance',
        { description: 'Get a Compute Engine instance.', inputSchema: { type: 'object', properties: { zone: { type: 'string' }, name: { type: 'string' } }, required: ['zone', 'name'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const data = await gcpFetch(`https://compute.googleapis.com/compute/v1/projects/${sessionConfig.project_id}/zones/${args.zone}/instances/${args.name}`);
                return { content: [{ type: 'text', text: JSON.stringify({ instance: data }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    async function computeAction(zone, name, action) {
        return await gcpFetch(`https://compute.googleapis.com/compute/v1/projects/${sessionConfig.project_id}/zones/${zone}/instances/${name}/${action}`, { method: 'POST' });
    }

    server.registerTool(
        'gcp.compute.startInstance',
        { description: 'Start a Compute Engine instance.', inputSchema: { type: 'object', properties: { zone: { type: 'string' }, name: { type: 'string' } }, required: ['zone', 'name'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const data = await computeAction(args.zone, args.name, 'start');
                return { content: [{ type: 'text', text: JSON.stringify({ operation: data }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'gcp.compute.stopInstance',
        { description: 'Stop a Compute Engine instance.', inputSchema: { type: 'object', properties: { zone: { type: 'string' }, name: { type: 'string' } }, required: ['zone', 'name'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const data = await computeAction(args.zone, args.name, 'stop');
                return { content: [{ type: 'text', text: JSON.stringify({ operation: data }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'gcp.compute.resetInstance',
        { description: 'Reset a Compute Engine instance.', inputSchema: { type: 'object', properties: { zone: { type: 'string' }, name: { type: 'string' } }, required: ['zone', 'name'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const data = await computeAction(args.zone, args.name, 'reset');
                return { content: [{ type: 'text', text: JSON.stringify({ operation: data }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    // GKE
    server.registerTool(
        'gcp.gke.listClusters',
        { description: 'List GKE clusters.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                requireConfigured();
                const data = await gcpFetch(`https://container.googleapis.com/v1/projects/${sessionConfig.project_id}/locations/-/clusters`);
                return { content: [{ type: 'text', text: JSON.stringify({ clusters: data.clusters || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'gcp.gke.getCluster',
        { description: 'Get a GKE cluster.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, location: { type: 'string' } }, required: ['name', 'location'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const data = await gcpFetch(`https://container.googleapis.com/v1/projects/${sessionConfig.project_id}/locations/${args.location}/clusters/${args.name}`);
                return { content: [{ type: 'text', text: JSON.stringify({ cluster: data }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'gcp.gke.getKubeAccessToken',
        { description: 'Return kube API info with bearer token for client handoff.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, location: { type: 'string' } }, required: ['name', 'location'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const data = await gcpFetch(`https://container.googleapis.com/v1/projects/${sessionConfig.project_id}/locations/${args.location}/clusters/${args.name}`);
                return { content: [{ type: 'text', text: JSON.stringify({ api_server: data.endpoint, auth: { type: 'bearer', token: sessionConfig.token } }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    // GCS
    server.registerTool(
        'gcp.storage.listBuckets',
        { description: 'List GCS buckets.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                requireConfigured();
                const data = await gcpFetch(`https://storage.googleapis.com/storage/v1/b`, { query: { project: sessionConfig.project_id } });
                return { content: [{ type: 'text', text: JSON.stringify({ buckets: data.items || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'gcp.storage.listObjects',
        { description: 'List objects in a bucket/prefix.', inputSchema: { type: 'object', properties: { bucket: { type: 'string' }, prefix: { type: 'string' } }, required: ['bucket'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const data = await gcpFetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(args.bucket)}/o`, { query: { prefix: args.prefix } });
                return { content: [{ type: 'text', text: JSON.stringify({ objects: data.items || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'gcp.storage.getObject',
        { description: 'Get object content (text).', inputSchema: { type: 'object', properties: { bucket: { type: 'string' }, object: { type: 'string' } }, required: ['bucket', 'object'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(args.bucket)}/o/${encodeURIComponent(args.object)}?alt=media`;
                const resp = await fetch(url, { headers: authHeaders() });
                const text = await resp.text();
                if (!resp.ok) throw { message: 'GCS getObject failed', code: 'PERMISSION_DENIED', details: text, http_status: resp.status };
                return { content: [{ type: 'text', text: JSON.stringify({ bucket: args.bucket, object: args.object, content: text }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'gcp.storage.putObject',
        {
            description: 'Upload text content to GCS.',
            inputSchema: {
                type: 'object',
                properties: { bucket: { type: 'string' }, object: { type: 'string' }, content: { type: 'string' }, content_type: { type: 'string' } },
                required: ['bucket', 'object', 'content'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(args.bucket)}/o?uploadType=media&name=${encodeURIComponent(args.object)}`;
                const resp = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': args.content_type || 'text/plain', ...authHeaders() },
                    body: args.content
                });
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok) throw { message: 'GCS putObject failed', code: 'PERMISSION_DENIED', details: data, http_status: resp.status };
                return { content: [{ type: 'text', text: JSON.stringify({ bucket: args.bucket, object: args.object, mediaLink: data.mediaLink }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    // Pub/Sub
    server.registerTool(
        'gcp.pubsub.listTopics',
        { description: 'List Pub/Sub topics.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                requireConfigured();
                const data = await gcpFetch(`https://pubsub.googleapis.com/v1/projects/${sessionConfig.project_id}/topics`);
                return { content: [{ type: 'text', text: JSON.stringify({ topics: data.topics || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'gcp.pubsub.publishMessage',
        {
            description: 'Publish a message to Pub/Sub topic.',
            inputSchema: {
                type: 'object',
                properties: { topic: { type: 'string' }, data: { type: 'string' }, attributes: { type: 'object' } },
                required: ['topic', 'data'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const body = { messages: [{ data: Buffer.from(args.data).toString('base64'), attributes: args.attributes }] };
                const data = await gcpFetch(`https://pubsub.googleapis.com/v1/${args.topic}:publish`, { method: 'POST', body });
                return { content: [{ type: 'text', text: JSON.stringify({ messageIds: data.messageIds }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'gcp.pubsub.pullMessages',
        {
            description: 'Pull messages from a subscription.',
            inputSchema: {
                type: 'object',
                properties: { subscription: { type: 'string' }, max_messages: { type: 'number' } },
                required: ['subscription'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const body = { maxMessages: args.max_messages || 1 };
                const data = await gcpFetch(`https://pubsub.googleapis.com/v1/${args.subscription}:pull`, { method: 'POST', body });
                return { content: [{ type: 'text', text: JSON.stringify({ receivedMessages: data.receivedMessages || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'gcp.pubsub.ackMessage',
        {
            description: 'Acknowledge Pub/Sub messages.',
            inputSchema: {
                type: 'object',
                properties: { subscription: { type: 'string' }, ack_ids: { type: 'array', items: { type: 'string' } } },
                required: ['subscription', 'ack_ids'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const body = { ackIds: args.ack_ids };
                await gcpFetch(`https://pubsub.googleapis.com/v1/${args.subscription}:acknowledge`, { method: 'POST', body });
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    // Monitoring
    server.registerTool(
        'gcp.monitoring.queryMetrics',
        {
            description: 'Query Cloud Monitoring metrics via timeSeries:list.',
            inputSchema: {
                type: 'object',
                properties: {
                    metric: { type: 'string' },
                    resource_type: { type: 'string' },
                    filter: { type: 'string' },
                    time_range: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
                    interval_minutes: { type: 'number' }
                },
                required: ['metric'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const tr = timeRangeFilter(args.time_range);
                const filter = args.filter || `metric.type="${args.metric}"`;
                const data = await gcpFetch(`https://monitoring.googleapis.com/v3/projects/${sessionConfig.project_id}/timeSeries`, {
                    query: {
                        filter,
                        interval_startTime: tr.from,
                        interval_endTime: tr.to,
                        'view': 'FULL'
                    }
                });
                return { content: [{ type: 'text', text: JSON.stringify({ timeSeries: data.timeSeries || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    // Logging
    server.registerTool(
        'gcp.logging.queryLogs',
        {
            description: 'Query Cloud Logging entries.',
            inputSchema: {
                type: 'object',
                properties: {
                    filter: { type: 'string' },
                    limit: { type: 'number' },
                    time_range: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } }
                },
                required: ['filter'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const tr = timeRangeFilter(args.time_range);
                const body = {
                    resourceNames: [`projects/${sessionConfig.project_id}`],
                    filter: args.filter,
                    pageSize: args.limit || 100,
                    orderBy: 'timestamp desc'
                };
                if (tr.from) body['interval'] = { startTime: tr.from, endTime: tr.to };
                const data = await gcpFetch(`https://logging.googleapis.com/v2/entries:list`, { method: 'POST', body });
                const entries = (data.entries || []).map((e) => ({
                    timestamp: e.timestamp,
                    textPayload: e.textPayload,
                    jsonPayload: e.jsonPayload,
                    resource: e.resource,
                    insertId: e.insertId,
                    severity: e.severity,
                    trace: e.trace
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ entries }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'gcp.logging.getLogContext',
        {
            description: 'Get log context around an insertId.',
            inputSchema: { type: 'object', properties: { insertId: { type: 'string' }, before: { type: 'number' }, after: { type: 'number' } }, required: ['insertId'], additionalProperties: false }
        },
        async (args) => {
            try {
                requireConfigured();
                const baseFilter = `insertId="${args.insertId}"`;
                const centerResp = await gcpFetch(`https://logging.googleapis.com/v2/entries:list`, {
                    method: 'POST',
                    body: { resourceNames: [`projects/${sessionConfig.project_id}`], filter: baseFilter, pageSize: 1 }
                });
                const entry = centerResp.entries?.[0];
                if (!entry) throw { message: 'Log entry not found', code: 'NOT_FOUND' };
                const ts = entry.timestamp;
                const before = parseRelativeNow('now');
                const tsDate = new Date(ts);
                const windowMs = 5 * 60 * 1000;
                const start = new Date(tsDate.getTime() - (args.before || 20) * 1000) || new Date(tsDate.getTime() - windowMs);
                const end = new Date(tsDate.getTime() + (args.after || 20) * 1000) || new Date(tsDate.getTime() + windowMs);
                const contextResp = await gcpFetch(`https://logging.googleapis.com/v2/entries:list`, {
                    method: 'POST',
                    body: {
                        resourceNames: [`projects/${sessionConfig.project_id}`],
                        filter: `timestamp>="${start.toISOString()}" AND timestamp<="${end.toISOString()}"`,
                        orderBy: 'timestamp asc',
                        pageSize: 200
                    }
                });
                return { content: [{ type: 'text', text: JSON.stringify({ target: entry, context: contextResp.entries || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    // Incident helpers
    server.registerTool(
        'gcp.incident.findRecentErrors',
        {
            description: 'Search recent errors in Cloud Logging.',
            inputSchema: {
                type: 'object',
                properties: { service: { type: 'string' }, minutes: { type: 'number', default: 30 } },
                required: ['service'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                const to = new Date();
                const from = new Date(to.getTime() - (args.minutes || 30) * 60000);
                const filter = `resource.labels.service_name="${args.service}" AND severity>=ERROR AND timestamp>="${from.toISOString()}" AND timestamp<="${to.toISOString()}"`;
                const data = await gcpFetch(`https://logging.googleapis.com/v2/entries:list`, { method: 'POST', body: { resourceNames: [`projects/${sessionConfig.project_id}`], filter, orderBy: 'timestamp desc', pageSize: 200 } });
                return { content: [{ type: 'text', text: JSON.stringify({ entries: data.entries || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.registerTool(
        'gcp.incident.summarizeServiceHealth',
        {
            description: 'Summarize service health via logging + metrics.',
            inputSchema: { type: 'object', properties: { service: { type: 'string' }, minutes: { type: 'number' } }, required: ['service'], additionalProperties: false }
        },
        async (args) => {
            try {
                requireConfigured();
                const minutes = args.minutes || 30;
                const to = new Date();
                const from = new Date(to.getTime() - minutes * 60000);

                // Error logs
                const logFilter = `resource.labels.service_name="${args.service}" AND severity>=ERROR AND timestamp>="${from.toISOString()}" AND timestamp<="${to.toISOString()}"`;
                const logs = await gcpFetch(`https://logging.googleapis.com/v2/entries:list`, { method: 'POST', body: { resourceNames: [`projects/${sessionConfig.project_id}`], filter: logFilter, pageSize: 100, orderBy: 'timestamp desc' } });

                // Basic latency/error metrics via Monitoring if available
                const metricFilter = `metric.type="run.googleapis.com/request_latencies" AND resource.labels.service_name="${args.service}"`;
                let metrics = {};
                try {
                    const mdata = await gcpFetch(`https://monitoring.googleapis.com/v3/projects/${sessionConfig.project_id}/timeSeries`, {
                        query: {
                            filter: metricFilter,
                            interval_startTime: from.toISOString(),
                            interval_endTime: to.toISOString(),
                            view: 'FULL'
                        }
                    });
                    metrics = { timeSeries: mdata.timeSeries || [] };
                } catch (_) {
                    metrics = { note: 'metrics unavailable or permission denied' };
                }

                const summary = {
                    status: (logs.entries || []).length > 0 ? 'degraded' : 'healthy',
                    logs: logs.entries || [],
                    metrics
                };
                return { content: [{ type: 'text', text: JSON.stringify(summary) }] };
            } catch (err) {
                return normalizeError(err.message, err.code, err.details, err.http_status);
            }
        }
    );

    server.server.oninitialized = () => {
        console.log('GCP MCP server initialized.');
    };

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.log('GCP MCP server running on stdio.');
}

main().catch((err) => {
    console.error('GCP MCP server failed to start:', err);
    process.exit(1);
});
