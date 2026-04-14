const { createKubernetesServer } = require('../server');

describe('Kubernetes MCP Schema Validation', () => {
    let server;

    beforeEach(() => {
        server = createKubernetesServer();
    });

    const getValidator = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    describe('kubernetes_configure', () => {
        it('should allow optional fields', () => {
            const schema = getValidator('kubernetes_configure');
            expect(schema.safeParse({ api_server: 'https://k8s.io' }).success).toBe(true);
            expect(schema.safeParse({ token: 't1' }).success).toBe(true);
            expect(schema.safeParse({}).success).toBe(true);
        });
    });

    describe('kubernetes_get_resource', () => {
        it('should validate required fields', () => {
            const schema = getValidator('kubernetes_get_resource');
            expect(schema.safeParse({ kind: 'Pod', name: 'p1' }).success).toBe(true);
            expect(schema.safeParse({ kind: 'Invalid', name: 'p1' }).success).toBe(false);
            expect(schema.safeParse({ name: 'p1' }).success).toBe(false);
        });
    });

    describe('kubernetes_apply_manifest', () => {
        it('should require manifest and confirm', () => {
            const schema = getValidator('kubernetes_apply_manifest');
            expect(schema.safeParse({ manifest: 'kind: Pod...', confirm: true }).success).toBe(true);
            expect(schema.safeParse({ manifest: 'kind: Pod...' }).success).toBe(false);
        });
    });

    describe('kubernetes_scale_deployment', () => {
        it('should require replicas and confirm', () => {
            const schema = getValidator('kubernetes_scale_deployment');
            expect(schema.safeParse({ name: 'd1', replicas: 3, confirm: true }).success).toBe(true);
            expect(schema.safeParse({ name: 'd1', replicas: 3 }).success).toBe(false);
        });
    });
});
