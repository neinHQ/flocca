// server requirement moved down to after mock
const { createKubernetesServer } = require('../server'); 

// Mocking Kubernetes Client
const mockListNamespace = jest.fn();
const mockListPods = jest.fn();
const mockGetAPIResources = jest.fn();
const mockReadDeployment = jest.fn();
const mockReplaceDeployment = jest.fn();

jest.mock('@kubernetes/client-node', () => {
    return {
        KubeConfig: jest.fn().mockImplementation(() => ({
            loadFromDefault: jest.fn(),
            makeApiClient: jest.fn().mockImplementation((apiClass) => {
                if (apiClass.name === 'CoreV1Api') {
                    return {
                        getAPIResources: mockGetAPIResources,
                        listNamespace: mockListNamespace,
                        listNamespacedPod: mockListPods
                    };
                }
                if (apiClass.name === 'AppsV1Api') {
                    return {
                        readNamespacedDeployment: mockReadDeployment,
                        replaceNamespacedDeployment: mockReplaceDeployment
                    };
                }
                return {};
            }),
            getCurrentContext: () => 'test-context'
        })),
        CoreV1Api: class {},
        AppsV1Api: class {},
        BatchV1Api: class {},
        NetworkingV1Api: class {},
        KubernetesObjectApi: {
            makeApiClient: jest.fn()
        }
    };
});

describe('Kubernetes MCP Logic', () => {
    let server;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        // Setup default mocks
        mockGetAPIResources.mockResolvedValue({ body: {} });
        
        const { createKubernetesServer } = require('../server');
        server = createKubernetesServer();
    });

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        const result = await tool.handler(args);
        if (result.isError) {
            console.error(`Tool ${name} failed:`, result.content[0].text);
        }
        return result;
    };

    describe('Safety Gates', () => {
        it('kubernetes_delete_resource requires confirm: true', async () => {
            const res = await callTool('kubernetes_delete_resource', { kind: 'Pod', name: 'p1', confirm: false });
            expect(res.isError).toBe(true);
            expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
        });

        it('kubernetes_scale_deployment requires confirm: true', async () => {
            const res = await callTool('kubernetes_scale_deployment', { name: 'd1', replicas: 3, confirm: false });
            expect(res.isError).toBe(true);
            expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
        });
    });

    describe('kubernetes_health', () => {
        it('should verify connection', async () => {
            const result = await callTool('kubernetes_health');
            const data = JSON.parse(result.content[0].text);
            expect(data.ok).toBe(true);
            expect(mockGetAPIResources).toHaveBeenCalled();
        });
    });

    describe('kubernetes_list_namespaces', () => {
        it('should return mocked namespaces', async () => {
            mockListNamespace.mockResolvedValue({
                body: { items: [{ metadata: { name: 'default' }, status: { phase: 'Active' } }] }
            });

            const result = await callTool('kubernetes_list_namespaces');
            const data = JSON.parse(result.content[0].text);

            expect(data).toHaveLength(1);
            expect(data[0].name).toBe('default');
        });
    });
});
