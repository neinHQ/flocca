const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const k8s = require('@kubernetes/client-node');
const yaml = require('js-yaml');

const SERVER_INFO = { name: 'kubernetes-mcp', version: '2.0.0' };

function createKubernetesServer() {
    let sessionConfig = {
        apiServer: process.env.K8S_API_SERVER,
        token: process.env.K8S_TOKEN,
        caData: process.env.K8S_CA_DATA,
        namespace: process.env.K8S_NAMESPACE || 'default',
        kubeconfigPath: process.env.K8S_KUBECONFIG
    };

    function normalizeError(err) {
        const msg = err.body ? `${err.body.code} - ${err.body.message}` : (err.message || JSON.stringify(err));
        return { isError: true, content: [{ type: 'text', text: `Kubernetes Error: ${msg}` }] };
    }

    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });
    let kubeConfig = null;

    async function ensureConnected() {
        if (!kubeConfig) {
            // Re-check env vars
            sessionConfig.apiServer = process.env.K8S_API_SERVER;
            sessionConfig.token = process.env.K8S_TOKEN;
            sessionConfig.caData = process.env.K8S_CA_DATA;
            sessionConfig.kubeconfigPath = process.env.K8S_KUBECONFIG;
            sessionConfig.namespace = process.env.K8S_NAMESPACE || sessionConfig.namespace;

            const kc = new k8s.KubeConfig();
            if (sessionConfig.apiServer && sessionConfig.token) {
                kc.loadFromOptions({
                    clusters: [{
                        name: 'flocca-cluster',
                        server: sessionConfig.apiServer,
                        caData: sessionConfig.caData,
                        skipTLSVerify: !sessionConfig.caData
                    }],
                    users: [{
                        name: 'flocca-user',
                        token: sessionConfig.token
                    }],
                    contexts: [{
                        name: 'flocca-context',
                        cluster: 'flocca-cluster',
                        user: 'flocca-user',
                        namespace: sessionConfig.namespace
                    }],
                    currentContext: 'flocca-context'
                });
                kubeConfig = kc;
            } else {
                try {
                    if (sessionConfig.kubeconfigPath) {
                        kc.loadFromFile(sessionConfig.kubeconfigPath);
                    } else {
                        kc.loadFromDefault();
                    }
                    kubeConfig = kc;
                } catch (e) {
                    throw new Error("Kubernetes not configured. Provide K8S_API_SERVER/TOKEN or a valid Kubeconfig.");
                }
            }
        }
        return kubeConfig;
    }

    function getApis(kc) {
        return {
            core: kc.makeApiClient(k8s.CoreV1Api),
            apps: kc.makeApiClient(k8s.AppsV1Api),
            batch: kc.makeApiClient(k8s.BatchV1Api),
            network: kc.makeApiClient(k8s.NetworkingV1Api),
            object: k8s.KubernetesObjectApi.makeApiClient(kc)
        };
    }

    server.tool('kubernetes_health', {}, async () => {
        try {
            const kc = await ensureConnected();
            const { core } = getApis(kc);
            await core.getAPIResources();
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, context: kc.getCurrentContext() }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('kubernetes_configure',
        {
            api_server: z.string().optional().describe('Kubernetes API Server URL'),
            token: z.string().optional().describe('Bearer Token'),
            ca: z.string().optional().describe('CA Certificate data'),
            default_namespace: z.string().optional().describe('Default namespace'),
            kubeconfig: z.string().optional().describe('Path to kubeconfig file')
        },
        async (args) => {
            try {
                if (args.api_server) sessionConfig.apiServer = args.api_server;
                if (args.token) sessionConfig.token = args.token;
                if (args.ca) sessionConfig.caData = args.ca;
                if (args.default_namespace) sessionConfig.namespace = args.default_namespace;
                if (args.kubeconfig) sessionConfig.kubeconfigPath = args.kubeconfig;

                kubeConfig = null; // Force re-init
                const kc = await ensureConnected();
                const { core } = getApis(kc);
                await core.getAPIResources();
                return { content: [{ type: 'text', text: "Kubernetes configuration updated and verified." }] };
            } catch (e) {
                kubeConfig = null;
                return normalizeError(e);
            }
        }
    );

    server.tool('kubernetes_list_namespaces', {}, async () => {
        try {
            const kc = await ensureConnected();
            const { core } = getApis(kc);
            const res = await core.listNamespace();
            return { content: [{ type: 'text', text: JSON.stringify(res.body.items.map(n => ({ name: n.metadata.name, status: n.status.phase })), null, 2) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('kubernetes_list_pods',
        {
            namespace: z.string().optional().describe('Filter by namespace'),
            label_selector: z.string().optional().describe('Standard K8s label selector')
        },
        async (args) => {
            try {
                const kc = await ensureConnected();
                const { core } = getApis(kc);
                const namespace = args.namespace || sessionConfig.namespace;
                const res = await core.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, args.label_selector);
                return { content: [{ type: 'text', text: JSON.stringify(res.body.items.map(p => ({
                    name: p.metadata.name,
                    phase: p.status.phase,
                    node: p.spec.nodeName,
                    startTime: p.status.startTime
                })), null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('kubernetes_get_resource',
        {
            kind: z.enum(['Pod', 'Deployment', 'Service', 'ConfigMap', 'Secret']).describe('Resource kind'),
            name: z.string().describe('Resource name'),
            namespace: z.string().optional().describe('Namespace')
        },
        async (args) => {
            try {
                const kc = await ensureConnected();
                const { core, apps } = getApis(kc);
                const namespace = args.namespace || sessionConfig.namespace;
                let res;
                switch (args.kind) {
                    case 'Pod': res = await core.readNamespacedPod(args.name, namespace); break;
                    case 'Deployment': res = await apps.readNamespacedDeployment(args.name, namespace); break;
                    case 'Service': res = await core.readNamespacedService(args.name, namespace); break;
                    case 'ConfigMap': res = await core.readNamespacedConfigMap(args.name, namespace); break;
                    case 'Secret': res = await core.readNamespacedSecret(args.name, namespace); break;
                }
                return { content: [{ type: 'text', text: JSON.stringify(res.body, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('kubernetes_get_pod_logs',
        {
            name: z.string().describe('Pod name'),
            namespace: z.string().optional().describe('Namespace'),
            container: z.string().optional().describe('Container name'),
            tail_lines: z.number().optional().default(100)
        },
        async (args) => {
            try {
                const kc = await ensureConnected();
                const { core } = getApis(kc);
                const namespace = args.namespace || sessionConfig.namespace;
                const res = await core.readNamespacedPodLog(args.name, namespace, args.container, false, undefined, undefined, undefined, undefined, undefined, args.tail_lines);
                return { content: [{ type: 'text', text: res.body }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('kubernetes_apply_manifest',
        {
            manifest: z.string().describe('YAML manifest (supports multi-doc)'),
            namespace: z.string().optional().describe('Target namespace'),
            confirm: z.boolean().describe('Safety gate')
        },
        async (args) => {
            try {
                if (!args.confirm) return { isError: true, content: [{ type: 'text', text: `CONFIRMATION_REQUIRED: Are you sure you want to apply the provided manifest? This may update or create multiple resources. Set confirm: true to proceed.` }] };
                
                const kc = await ensureConnected();
                const { object: client } = getApis(kc);
                const namespace = args.namespace || sessionConfig.namespace;
                const docs = yaml.loadAll(args.manifest).filter(d => d);
                const results = [];

                for (const spec of docs) {
                    spec.metadata = spec.metadata || {};
                    if (!spec.metadata.namespace && namespace) spec.metadata.namespace = namespace;

                    try {
                        await client.read(spec);
                        await client.patch(spec);
                        results.push(`Updated ${spec.kind}/${spec.metadata.name}`);
                    } catch (e) {
                        if (e.body && e.body.code === 404) {
                            await client.create(spec);
                            results.push(`Created ${spec.kind}/${spec.metadata.name}`);
                        } else throw e;
                    }
                }
                return { content: [{ type: 'text', text: results.join('\n') }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('kubernetes_delete_resource',
        {
            kind: z.enum(['Pod', 'Deployment', 'Service', 'Namespace', 'ConfigMap', 'Secret']),
            name: z.string(),
            namespace: z.string().optional(),
            confirm: z.boolean().describe('Safety gate')
        },
        async (args) => {
            try {
                if (!args.confirm) return { isError: true, content: [{ type: 'text', text: `CONFIRMATION_REQUIRED: Delete ${args.kind}/${args.name} in ${args.namespace || 'current namespace'}? Set confirm: true to proceed.` }] };
                
                const kc = await ensureConnected();
                const { core, apps } = getApis(kc);
                const namespace = args.namespace || sessionConfig.namespace;
                
                switch (args.kind) {
                    case 'Pod': await core.deleteNamespacedPod(args.name, namespace); break;
                    case 'Deployment': await apps.deleteNamespacedDeployment(args.name, namespace); break;
                    case 'Service': await core.deleteNamespacedService(args.name, namespace); break;
                    case 'Namespace': await core.deleteNamespace(args.name); break;
                    case 'ConfigMap': await core.deleteNamespacedConfigMap(args.name, namespace); break;
                    case 'Secret': await core.deleteNamespacedSecret(args.name, namespace); break;
                }
                return { content: [{ type: 'text', text: `Successfully deleted ${args.kind}/${args.name}` }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('kubernetes_scale_deployment',
        {
            name: z.string().describe('Deployment name'),
            replicas: z.number().int().describe('Target replica count'),
            namespace: z.string().optional(),
            confirm: z.boolean().describe('Safety gate')
        },
        async (args) => {
            try {
                if (!args.confirm) return { isError: true, content: [{ type: 'text', text: `CONFIRMATION_REQUIRED: Scale deployment ${args.name} to ${args.replicas} replicas? Set confirm: true to proceed.` }] };
                
                const kc = await ensureConnected();
                const { apps } = getApis(kc);
                const namespace = args.namespace || sessionConfig.namespace;
                
                const d = await apps.readNamespacedDeployment(args.name, namespace);
                d.body.spec.replicas = args.replicas;
                await apps.replaceNamespacedDeployment(args.name, namespace, d.body);
                
                return { content: [{ type: 'text', text: `Scaled ${args.name} to ${args.replicas} replicas.` }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.__test = {
        sessionConfig,
        normalizeError,
        ensureConnected,
        getApis,
        setConfig: (next) => { Object.assign(sessionConfig, next); kubeConfig = null; },
        getConfig: () => ({ ...sessionConfig })
    };

    return server;
}

if (require.main === module) {
    const server = createKubernetesServer();
    const transport = new StdioServerTransport();
    server.connect(transport).then(() => {
        console.error('Kubernetes MCP server running on stdio');
    }).catch((error) => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createKubernetesServer };
