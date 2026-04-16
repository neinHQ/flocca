const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const SERVER_INFO = { name: 'prometheus-mcp', version: '1.0.0' };
const GUARDRAILS = {
    maxRangeSeconds: 3 * 60 * 60, // 3h
    maxPoints: 5000
};

function createPrometheusServer() {
    let sessionConfig = {
        url: process.env.PROMETHEUS_URL,
        token: process.env.PROMETHEUS_TOKEN
    };

    function normalizeError(message, details) {
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { message, details } }) }] };
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

    function enforceRangeGuard(start, end, step) {
        const s = Date.parse(start);
        const e = Date.parse(end);
        if (Number.isNaN(s) || Number.isNaN(e)) return;
        const diff = (e - s) / 1000;
        if (diff > GUARDRAILS.maxRangeSeconds) {
            throw new Error('QueryTooBroad: time range exceeds limit (3h)');
        }
        if (step) {
            const stepSeconds = parseDurationSeconds(step);
            if (stepSeconds && diff / stepSeconds > GUARDRAILS.maxPoints) {
                throw new Error('QueryTooBroad: too many points (limit 5000)');
            }
        }
    }

    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    async function ensureConnected() {
        if (!sessionConfig.url) {
            sessionConfig.url = process.env.PROMETHEUS_URL;
            sessionConfig.token = process.env.PROMETHEUS_TOKEN;
            if (!sessionConfig.url) throw new Error("Prometheus Not Configured. Provide PROMETHEUS_URL.");
        }
        return sessionConfig;
    }

    async function promFetch(pathPart, { method = 'GET', query, body } = {}) {
        const conf = await ensureConnected();
        const base = conf.url.replace(/\/+$/, '');
        const url = new URL(`${base}/${pathPart.replace(/^\/+/, '')}`);
        if (query) Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null) url.searchParams.append(k, v); });
        
        const headers = { 'Content-Type': 'application/json' };
        if (conf.token) headers['Authorization'] = `Bearer ${conf.token}`;

        const resp = await fetch(url.toString(), {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.status === 'error') {
            throw new Error(data.error || resp.statusText || 'Prometheus request failed');
        }
        return data;
    }

    server.tool('prometheus_health', {}, async () => {
        try {
            await promFetch('api/v1/status/buildinfo');
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
        } catch (e) { return normalizeError(e.message); }
    });

    server.tool('prometheus_query',
        {
            query: z.string().describe('PromQL instant query'),
            time: z.string().optional().describe('Evaluation timestamp')
        },
        async (args) => {
            try {
                const data = await promFetch('api/v1/query', { query: { query: args.query, time: args.time } });
                return { content: [{ type: 'text', text: JSON.stringify({ type: data.data?.resultType, result: data.data?.result || [] }, null, 2) }] };
            } catch (e) { return normalizeError(e.message); }
        }
    );

    server.tool('prometheus_query_range',
        {
            query: z.string().describe('PromQL range query'),
            start: z.string().describe('Start timestamp'),
            end: z.string().describe('End timestamp'),
            step: z.string().describe('Query resolution step width (e.g. 15s)')
        },
        async (args) => {
            try {
                enforceRangeGuard(args.start, args.end, args.step);
                const data = await promFetch('api/v1/query_range', {
                    query: { query: args.query, start: args.start, end: args.end, step: args.step }
                });
                return { content: [{ type: 'text', text: JSON.stringify({ type: data.data?.resultType, result: data.data?.result || [] }, null, 2) }] };
            } catch (e) { return normalizeError(e.message); }
        }
    );

    server.tool('prometheus_list_alerts',
        { state: z.enum(['firing', 'pending']).optional().describe('Filter by alert state') },
        async (args) => {
            try {
                const data = await promFetch('api/v1/alerts');
                let alerts = data.data?.alerts || [];
                if (args.state) alerts = alerts.filter(a => a.state === args.state);
                return { content: [{ type: 'text', text: JSON.stringify(alerts, null, 2) }] };
            } catch (e) { return normalizeError(e.message); }
        }
    );

    server.tool('prometheus_get_service_health',
        { service: z.string().describe('Service name to check (must have http_requests_total metric)') },
        async (args) => {
            try {
                const to = new Date().toISOString();
                const errorRateQ = `sum(rate(http_requests_total{service="${args.service}",status=~"5.."}[5m])) / sum(rate(http_requests_total{service="${args.service}"}[5m]))`;
                const latencyQ = `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{service="${args.service}"}[5m])) by (le))`;
                
                const [errorRate, latency] = await Promise.all([
                    promFetch('api/v1/query', { query: { query: errorRateQ, time: to } }),
                    promFetch('api/v1/query', { query: { query: latencyQ, time: to } })
                ]);

                const getVal = (res) => {
                    const v = res.data?.result?.[0]?.value?.[1];
                    return v !== undefined ? Number(v) : null;
                };

                const errVal = getVal(errorRate);
                const latVal = getVal(latency);

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            service: args.service,
                            status: (errVal > 0.01 || latVal > 1) ? 'degraded' : 'healthy',
                            error_rate: errVal,
                            p95_latency_sec: latVal
                        }, null, 2)
                    }]
                };
            } catch (e) { return normalizeError(e.message); }
        }
    );

    server.__test = {
        sessionConfig,
        normalizeError,
        promFetch,
        ensureConnected,
        enforceRangeGuard,
        setConfig: (next) => { Object.assign(sessionConfig, next); },
        getConfig: () => ({ ...sessionConfig })
    };

    return server;
}

if (require.main === module) {
    const serverInstance = createPrometheusServer();
    const transport = new StdioServerTransport();
    serverInstance.connect(transport).then(() => {
        console.error('Prometheus MCP server running on stdio');
    }).catch((error) => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createPrometheusServer };
