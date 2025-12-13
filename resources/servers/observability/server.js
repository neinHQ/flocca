const path = require('path');

const { McpServer } = require(path.join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js'));
const { StdioServerTransport } = require(path.join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/stdio.js'));

const SERVER_INFO = { name: 'observability-mcp', version: '0.1.0' };
const GUARDRAILS = {
    maxRangeSeconds: 3 * 60 * 60, // 3h
    maxPoints: 5000
};

const sessionConfig = {
    prometheus: process.env.PROMETHEUS_URL ? {
        url: process.env.PROMETHEUS_URL,
        auth: process.env.PROMETHEUS_AUTH_TOKEN ? { type: 'bearer', token: process.env.PROMETHEUS_AUTH_TOKEN } : undefined
    } : undefined,
    grafana: process.env.GRAFANA_URL ? {
        url: process.env.GRAFANA_URL,
        auth: process.env.GRAFANA_TOKEN ? { type: 'bearer', token: process.env.GRAFANA_TOKEN } : undefined
    } : undefined
};

function normalizeError(message, code = 'OBS_ERROR', http_status, details) {
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { message, code, http_status, details } }) }] };
}

function authHeaders(auth) {
    if (!auth) return {};
    if (auth.type === 'bearer') return { Authorization: `Bearer ${auth.token}` };
    if (auth.type === 'api_key') return { Authorization: `Bearer ${auth.api_key}` };
    if (auth.type === 'basic') {
        const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
        return { Authorization: `Basic ${encoded}` };
    }
    return {};
}

async function promFetch(pathPart, { method = 'GET', query, body } = {}) {
    if (!sessionConfig.prometheus) throw { message: 'Prometheus not configured', code: 'NOT_CONFIGURED', http_status: 400 };
    const base = sessionConfig.prometheus.url.replace(/\/+$/, '');
    const url = new URL(`${base}/${pathPart.replace(/^\/+/, '')}`);
    if (query) Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null) url.searchParams.append(k, v); });
    const resp = await fetch(url.toString(), {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders(sessionConfig.prometheus.auth)
        },
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.status === 'error') {
        throw { message: data.error || resp.statusText || 'Prometheus request failed', code: 'PROMETHEUS_ERROR', http_status: resp.status, details: data.error };
    }
    return data;
}

async function grafFetch(pathPart, { query } = {}) {
    if (!sessionConfig.grafana) throw { message: 'Grafana not configured', code: 'NOT_CONFIGURED', http_status: 400 };
    const base = sessionConfig.grafana.url.replace(/\/+$/, '');
    const url = new URL(`${base}/${pathPart.replace(/^\/+/, '')}`);
    if (query) Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null) url.searchParams.append(k, v); });
    const resp = await fetch(url.toString(), {
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders(sessionConfig.grafana.auth)
        }
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
        throw { message: data.message || resp.statusText || 'Grafana request failed', code: 'GRAFANA_ERROR', http_status: resp.status, details: data };
    }
    return data;
}

function normalizePromResult(data) {
    return {
        result_type: data.data?.resultType,
        data: data.data?.result || []
    };
}

function enforceRangeGuard(start, end, step) {
    const s = Date.parse(start);
    const e = Date.parse(end);
    if (Number.isNaN(s) || Number.isNaN(e)) return;
    const diff = (e - s) / 1000;
    if (diff > GUARDRAILS.maxRangeSeconds) {
        throw { message: 'QueryTooBroad: time range exceeds limit', code: 'QUERY_TOO_BROAD', http_status: 400 };
    }
    if (step) {
        const stepSeconds = parseDurationSeconds(step);
        if (stepSeconds && diff / stepSeconds > GUARDRAILS.maxPoints) {
            throw { message: 'QueryTooBroad: too many points', code: 'QUERY_TOO_BROAD', http_status: 400 };
        }
    }
}

function parseDurationSeconds(dur) {
    if (!dur) return undefined;
    const m = dur.match(/^(\d+)([smhdw])$/);
    if (!m) return undefined;
    const n = Number(m[1]);
    const unit = m[2];
    const map = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
    return n * map[unit];
}

async function main() {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    server.registerTool(
        'observability.health',
        { description: 'Health check for observability MCP server.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                let ok = false;
                if (sessionConfig.prometheus) {
                    await promFetch('api/v1/status/buildinfo');
                    ok = true;
                }
                if (sessionConfig.grafana) {
                    await grafFetch('api/health');
                    ok = true;
                }
                if (!ok) throw { message: 'No backend configured', code: 'NOT_CONFIGURED', http_status: 400 };
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code || 'OBS_ERROR', err.http_status, err.details);
            }
        }
    );

    server.registerTool(
        'observability.configure',
        {
            description: 'Configure Prometheus and/or Grafana backends.',
            inputSchema: {
                type: 'object',
                properties: {
                    prometheus: {
                        type: 'object',
                        properties: {
                            url: { type: 'string' },
                            auth: {
                                type: 'object',
                                properties: {
                                    type: { type: 'string', enum: ['bearer', 'basic', 'api_key'] },
                                    token: { type: 'string' },
                                    username: { type: 'string' },
                                    password: { type: 'string' },
                                    api_key: { type: 'string' }
                                }
                            }
                        }
                    },
                    grafana: {
                        type: 'object',
                        properties: {
                            url: { type: 'string' },
                            auth: {
                                type: 'object',
                                properties: {
                                    type: { type: 'string', enum: ['api_key', 'bearer', 'basic'] },
                                    api_key: { type: 'string' },
                                    token: { type: 'string' },
                                    username: { type: 'string' },
                                    password: { type: 'string' }
                                }
                            },
                            default_folder: { type: 'string' }
                        }
                    }
                },
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                sessionConfig.prometheus = args.prometheus;
                sessionConfig.grafana = args.grafana;

                if (sessionConfig.prometheus) {
                    await promFetch('api/v1/status/buildinfo');
                }
                if (sessionConfig.grafana) {
                    await grafFetch('api/health');
                }
                if (!sessionConfig.prometheus && !sessionConfig.grafana) {
                    throw { message: 'No backend provided', code: 'NOT_CONFIGURED', http_status: 400 };
                }
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
            } catch (err) {
                sessionConfig.prometheus = undefined;
                sessionConfig.grafana = undefined;
                return normalizeError(err.message, err.code || 'OBS_ERROR', err.http_status, err.details);
            }
        }
    );

    server.registerTool(
        'observability.queryPrometheus',
        {
            description: 'Run a PromQL instant query.',
            inputSchema: {
                type: 'object',
                properties: {
                    query: { type: 'string' },
                    time: { type: 'string' },
                    timeout: { type: 'string' }
                },
                required: ['query'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                const data = await promFetch('api/v1/query', {
                    query: { query: args.query, time: args.time, timeout: args.timeout }
                });
                return { content: [{ type: 'text', text: JSON.stringify(normalizePromResult(data)) }] };
            } catch (err) {
                return normalizeError(err.message, err.code || 'PROMETHEUS_ERROR', err.http_status, err.details);
            }
        }
    );

    server.registerTool(
        'observability.queryRange',
        {
            description: 'Run a PromQL range query.',
            inputSchema: {
                type: 'object',
                properties: {
                    query: { type: 'string' },
                    start: { type: 'string' },
                    end: { type: 'string' },
                    step: { type: 'string' },
                    timeout: { type: 'string' }
                },
                required: ['query', 'start', 'end', 'step'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                enforceRangeGuard(args.start, args.end, args.step);
                const data = await promFetch('api/v1/query_range', {
                    query: { query: args.query, start: args.start, end: args.end, step: args.step, timeout: args.timeout }
                });
                return { content: [{ type: 'text', text: JSON.stringify(normalizePromResult(data)) }] };
            } catch (err) {
                return normalizeError(err.message, err.code || 'PROMETHEUS_ERROR', err.http_status, err.details);
            }
        }
    );

    server.registerTool(
        'observability.listPrometheusSeries',
        {
            description: 'List Prometheus series/labels for given matchers.',
            inputSchema: { type: 'object', properties: { match: { type: 'array', items: { type: 'string' } } }, required: ['match'], additionalProperties: false }
        },
        async (args) => {
            try {
                const data = await promFetch('api/v1/series', { query: { 'match[]': args.match } });
                return { content: [{ type: 'text', text: JSON.stringify({ series: data.data || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code || 'PROMETHEUS_ERROR', err.http_status, err.details);
            }
        }
    );

    // Grafana
    server.registerTool(
        'observability.listDashboards',
        {
            description: 'List Grafana dashboards (optional folder filter).',
            inputSchema: { type: 'object', properties: { folder: { type: 'string' } }, additionalProperties: false }
        },
        async (args) => {
            try {
                const data = await grafFetch('api/search', { query: { type: 'dash-db', query: args.folder || '' } });
                const dashboards = (data || []).map((d) => ({
                    uid: d.uid,
                    title: d.title,
                    url: d.url,
                    folderTitle: d.folderTitle
                })).filter((d) => !args.folder || d.folderTitle === args.folder);
                return { content: [{ type: 'text', text: JSON.stringify({ dashboards }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code || 'GRAFANA_ERROR', err.http_status, err.details);
            }
        }
    );

    server.registerTool(
        'observability.getDashboard',
        {
            description: 'Get Grafana dashboard JSON by UID.',
            inputSchema: { type: 'object', properties: { uid: { type: 'string' } }, required: ['uid'], additionalProperties: false }
        },
        async (args) => {
            try {
                const data = await grafFetch(`api/dashboards/uid/${args.uid}`);
                return { content: [{ type: 'text', text: JSON.stringify({ dashboard: data.dashboard, meta: data.meta }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code || 'GRAFANA_ERROR', err.http_status, err.details);
            }
        }
    );

    server.registerTool(
        'observability.renderPanelSnapshot',
        {
            description: 'Return a render URL for a Grafana panel.',
            inputSchema: {
                type: 'object',
                properties: {
                    dashboard_uid: { type: 'string' },
                    panel_id: { type: 'number' },
                    time_range: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } }
                },
                required: ['dashboard_uid', 'panel_id'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                const base = sessionConfig.grafana?.url?.replace(/\/+$/, '');
                if (!base) throw { message: 'Grafana not configured', code: 'NOT_CONFIGURED', http_status: 400 };
                const from = args.time_range?.from || 'now-1h';
                const to = args.time_range?.to || 'now';
                const url = `${base}/render/d-solo/${args.dashboard_uid}/_panel?panelId=${args.panel_id}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
                return { content: [{ type: 'text', text: JSON.stringify({ url }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code || 'GRAFANA_ERROR', err.http_status, err.details);
            }
        }
    );

    // Alerts (Prometheus/Alertmanager compatible)
    server.registerTool(
        'observability.getRecentAlerts',
        {
            description: 'Fetch active/recent alerts from Prometheus/Alertmanager.',
            inputSchema: { type: 'object', properties: { state: { type: 'string' }, limit: { type: 'number' } }, additionalProperties: false }
        },
        async (args) => {
            try {
                const data = await promFetch('api/v1/alerts');
                let alerts = data.data?.alerts || [];
                if (args.state) alerts = alerts.filter((a) => a.state === args.state);
                if (args.limit) alerts = alerts.slice(0, args.limit);
                const mapped = alerts.map((a) => ({
                    name: a.labels?.alertname,
                    state: a.state,
                    labels: a.labels,
                    annotations: a.annotations,
                    startsAt: a.startsAt,
                    endsAt: a.endsAt
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ alerts: mapped }) }] };
            } catch (err) {
                return normalizeError(err.message, err.code || 'PROMETHEUS_ERROR', err.http_status, err.details);
            }
        }
    );

    server.registerTool(
        'observability.getServiceHealthSummary',
        {
            description: 'Summarize service health via Prometheus metrics.',
            inputSchema: {
                type: 'object',
                properties: {
                    service: { type: 'string' },
                    time_range: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } }
                },
                required: ['service'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                const from = args.time_range?.from || 'now-30m';
                const to = args.time_range?.to || 'now';
                enforceRangeGuard(from, to, '60s');

                const errorRateQ = `sum(rate(http_requests_total{service="${args.service}",status=~"5.."}[5m])) / sum(rate(http_requests_total{service="${args.service}"}[5m]))`;
                const latencyQ = `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{service="${args.service}"}[5m])) by (le))`;
                const availabilityQ = `1 - sum(rate(http_requests_total{service="${args.service}",status=~"5.."}[5m])) / sum(rate(http_requests_total{service="${args.service}"}[5m]))`;

                const errorRate = await promFetch('api/v1/query', { query: { query: errorRateQ, time: to } });
                const latency = await promFetch('api/v1/query', { query: { query: latencyQ, time: to } });
                const availability = await promFetch('api/v1/query', { query: { query: availabilityQ, time: to } });

                const val = (res) => {
                    const v = res.data?.result?.[0]?.value?.[1];
                    return v !== undefined ? Number(v) : null;
                };

                const summary = {
                    service: args.service,
                    status: val(errorRate) > 0.01 || val(latency) > 1000 ? 'degraded' : 'healthy',
                    error_rate: val(errorRate),
                    latency_p95_ms: val(latency) ? Number(val(latency) * 1000) : null,
                    availability: val(availability)
                };
                return { content: [{ type: 'text', text: JSON.stringify(summary) }] };
            } catch (err) {
                return normalizeError(err.message, err.code || 'PROMETHEUS_ERROR', err.http_status, err.details);
            }
        }
    );

    server.server.oninitialized = () => {
        console.log('Observability MCP server initialized.');
    };

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.log('Observability MCP server running on stdio.');
}

main().catch((err) => {
    console.error('Observability MCP server failed to start:', err);
    process.exit(1);
});
