const { createGrafanaServer } = require('../server');

describe('Grafana MCP Schema Validation', () => {
    let server;

    beforeEach(() => {
        server = createGrafanaServer();
    });

    const getValidator = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    describe('grafana_get_dashboard', () => {
        it('should require uid', () => {
            const schema = getValidator('grafana_get_dashboard');
            expect(schema.safeParse({ uid: 'u1' }).success).toBe(true);
            expect(schema.safeParse({}).success).toBe(false);
        });
    });

    describe('grafana_render_panel', () => {
        it('should require dashboard_uid and panel_id', () => {
            const schema = getValidator('grafana_render_panel');
            expect(schema.safeParse({ dashboard_uid: 'u1', panel_id: 1 }).success).toBe(true);
            expect(schema.safeParse({ dashboard_uid: 'u1' }).success).toBe(false);
        });
    });
});
