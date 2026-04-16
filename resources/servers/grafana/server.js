const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const SERVER_INFO = { name: 'grafana-mcp', version: '1.0.0' };

function createGrafanaServer() {
    let sessionConfig = {
        url: process.env.GRAFANA_URL,
        token: process.env.GRAFANA_TOKEN
    };

    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    async function ensureConnected() {
        if (!sessionConfig.url) {
            sessionConfig.url = process.env.GRAFANA_URL || sessionConfig.url;
            sessionConfig.token = process.env.GRAFANA_TOKEN || sessionConfig.token;
            if (!sessionConfig.url) throw new Error("Grafana Not Configured. Provide GRAFANA_URL.");
        }
        return sessionConfig;
    }

    async function grafFetch(pathPart, { method = 'GET', query, body } = {}) {
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
        if (!resp.ok) {
            throw new Error(data.message || resp.statusText || 'Grafana request failed');
        }
        return data;
    }

    server.tool('grafana_health', {}, async () => {
        try {
            await grafFetch('api/health');
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
        } catch (e) { return normalizeError(e.message); }
    });

    server.tool('grafana_list_dashboards',
        { query: z.string().optional().describe('Search term for dashboards') },
        async (args) => {
            try {
                const data = await grafFetch('api/search', { query: { type: 'dash-db', query: args.query || '' } });
                const dashboards = (data || []).map(d => ({
                    uid: d.uid,
                    title: d.title,
                    url: d.url,
                    folderTitle: d.folderTitle
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ dashboards }, null, 2) }] };
            } catch (e) { return normalizeError(e.message); }
        }
    );

    server.tool('grafana_get_dashboard',
        { uid: z.string().describe('Dashboard UID') },
        async (args) => {
            try {
                const data = await grafFetch(`api/dashboards/uid/${args.uid}`);
                return { content: [{ type: 'text', text: JSON.stringify({ dashboard: data.dashboard, meta: data.meta }, null, 2) }] };
            } catch (e) { return normalizeError(e.message); }
        }
    );

    server.tool('grafana_render_panel',
        {
            dashboard_uid: z.string().describe('Dashboard UID'),
            panel_id: z.number().describe('Panel ID'),
            from: z.string().optional().default('now-1h').describe('Time from (e.g. now-6h)'),
            to: z.string().optional().default('now').describe('Time to (e.g. now)'),
            width: z.number().optional().default(1000),
            height: z.number().optional().default(500)
        },
        async (args) => {
            try {
                const conf = await ensureConnected();
                const base = conf.url.replace(/\/+$/, '');
                // Note: Grafana rendering usually requires the Image Renderer plugin.
                // We return the URL that can be used to fetch the PNG or embed it.
                const url = `${base}/render/d-solo/${args.dashboard_uid}/_?panelId=${args.panel_id}&from=${args.from}&to=${args.to}&width=${args.width}&height=${args.height}`;
                return { content: [{ type: 'text', text: JSON.stringify({ render_url: url }) }] };
            } catch (e) { return normalizeError(e.message); }
        }
    );

    server.__test = {
        sessionConfig,
        ensureConnected,
        grafFetch,
        setConfig: (next) => { Object.assign(sessionConfig, next); },
        getConfig: () => ({ ...sessionConfig })
    };

    return server;
}

if (require.main === module) {
    const server = createGrafanaServer();
    const transport = new StdioServerTransport();
    server.connect(transport).then(() => {
        console.error('Grafana MCP server running on stdio');
    }).catch((error) => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createGrafanaServer };
