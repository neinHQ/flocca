const { createGrafanaServer } = require('../server');

// Mock global fetch
global.fetch = jest.fn();

describe('Grafana MCP Logic', () => {
    let server;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.GRAFANA_URL = 'http://localhost:3000';
        process.env.GRAFANA_TOKEN = 'test-token';
        server = createGrafanaServer();
    });

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        const result = await tool.handler(args);
        return result;
    };

    describe('grafana_health', () => {
        it('should verify connection', async () => {
            fetch.mockResolvedValue({
                ok: true,
                json: async () => ({ database: 'ok' })
            });

            const res = await callTool('grafana_health');
            const data = JSON.parse(res.content[0].text);
            expect(data.ok).toBe(true);
            expect(fetch).toHaveBeenCalledWith(expect.stringContaining('api/health'), expect.anything());
        });
    });

    describe('grafana_list_dashboards', () => {
        it('should return dashboards', async () => {
            fetch.mockResolvedValue({
                ok: true,
                json: async () => [
                    { uid: 'u1', title: 'Dash 1', url: '/d/u1', folderTitle: 'General' }
                ]
            });

            const res = await callTool('grafana_list_dashboards', { query: 'test' });
            const data = JSON.parse(res.content[0].text);
            expect(data.dashboards).toHaveLength(1);
            expect(data.dashboards[0].uid).toBe('u1');
        });
    });

    describe('grafana_render_panel', () => {
        it('should return a valid render URL', async () => {
            const res = await callTool('grafana_render_panel', { dashboard_uid: 'u1', panel_id: 5 });
            const data = JSON.parse(res.content[0].text);
            expect(data.render_url).toContain('/render/d-solo/u1');
            expect(data.render_url).toContain('panelId=5');
        });
    });
});
