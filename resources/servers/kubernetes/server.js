const k8s = require('@kubernetes/client-node');
const yaml = require('js-yaml');
const readline = require('readline');

// Configuration State
let config = {
    apiServer: process.env.K8S_API_SERVER,
    authType: process.env.K8S_AUTH_TYPE || 'bearer',
    token: process.env.K8S_TOKEN,
    caData: process.env.K8S_CA_DATA,
    namespace: process.env.K8S_NAMESPACE || 'default'
};

// Helper: Get Kubernetes Client APIs
function getClients() {
    const kc = new k8s.KubeConfig();

    // If explicit config provided, use it
    if (config.apiServer && config.token) {
        kc.loadFromOptions({
            clusters: [{
                name: 'flocca-cluster',
                server: config.apiServer,
                caData: config.caData,
                skipTLSVerify: !config.caData
            }],
            users: [{
                name: 'flocca-user',
                token: config.token
            }],
            contexts: [{
                name: 'flocca-context',
                cluster: 'flocca-cluster',
                user: 'flocca-user',
                namespace: config.namespace || 'default'
            }],
            currentContext: 'flocca-context'
        });
    } else {
        // Fallback to default (e.g. in-cluster or ~/.kube/config if available on host)
        try {
            kc.loadFromDefault();
        } catch (e) {
            // Ignore if load fails, might be waiting for configure
        }
    }

    return {
        core: kc.makeApiClient(k8s.CoreV1Api),
        apps: kc.makeApiClient(k8s.AppsV1Api),
        network: kc.makeApiClient(k8s.NetworkingV1Api),
        batch: kc.makeApiClient(k8s.BatchV1Api),
        log: new k8s.Log(kc),
        exec: new k8s.Exec(kc),
        kc: kc
    };
}

// JSON-RPC Setup
let sendCallback = (response) => {
    process.stdout.write(JSON.stringify(response) + "\n");
};

function send(response) {
    if (sendCallback) sendCallback(response);
}

// Tool Handlers
async function handleToolCall(name, args) {
    try {
        const { core, apps, log, kc } = getClients();
        const namespace = args.namespace || config.namespace || 'default';

        switch (name) {
            case 'kubernetes_health':
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };

            case 'kubernetes_configure':
                if (args.api_server) config.apiServer = args.api_server;
                if (args.auth) {
                    config.authType = args.auth.type || 'bearer';
                    config.token = args.auth.token;
                    config.caData = args.auth.ca;
                }
                if (args.default_namespace) config.namespace = args.default_namespace;

                // Verify
                try {
                    const tempClient = getClients().core;
                    await tempClient.getAPIResources();
                    return { content: [{ type: 'text', text: "Kubernetes configuration updated and verified." }] };
                } catch (e) {
                    return { isError: true, content: [{ type: 'text', text: `Verification Failed: ${e.message}` }] };
                }

            case 'kubernetes_list_namespaces':
                const nsList = await core.listNamespace();
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(nsList.body.items.map(n => ({
                            name: n.metadata.name,
                            status: n.status.phase
                        })), null, 2)
                    }]
                };

            case 'kubernetes_list_pods':
                const podRes = await core.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, args.label_selector);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(podRes.body.items.map(p => ({
                            name: p.metadata.name,
                            phase: p.status.phase,
                            node: p.spec.nodeName,
                            ip: p.status.podIP,
                            startTime: p.status.startTime,
                            labels: p.metadata.labels
                        })), null, 2)
                    }]
                };

            case 'kubernetes_get_resource':
                // Note: Only simplified get for Pod/Deployment for MVP. Generic requires Discovery or dynamic client.
                let res;
                if (args.kind.toLowerCase() === 'deployment') {
                    res = await apps.readNamespacedDeployment(args.name, namespace);
                } else if (args.kind.toLowerCase() === 'pod') {
                    res = await core.readNamespacedPod(args.name, namespace);
                } else if (args.kind.toLowerCase() === 'service') {
                    res = await core.readNamespacedService(args.name, namespace);
                } else {
                    return { isError: true, content: [{ type: 'text', text: `Unsupported kind for simple get: ${args.kind}` }] };
                }
                return { content: [{ type: 'text', text: JSON.stringify(res.body, null, 2) }] };

            case 'kubernetes_get_pod_logs':
                const logRes = await core.readNamespacedPodLog(
                    args.name,
                    namespace,
                    args.container,
                    false,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    args.tail_lines || 100,
                    args.timestamps
                );
                return { content: [{ type: 'text', text: logRes.body }] };

            case 'kubernetes_apply_manifest':
                const client = k8s.KubernetesObjectApi.makeApiClient(kc);
                const results = [];
                const docs = yaml.loadAll(args.manifest); // Supports multi-doc string

                for (const spec of docs) {
                    if (!spec) continue;
                    spec.metadata = spec.metadata || {};
                    if (!spec.metadata.namespace && namespace) spec.metadata.namespace = namespace;

                    try {
                        // Try to read first to decide create or patch
                        await client.read(spec);
                        // Exists, patch it
                        const patched = await client.patch(spec);
                        results.push(`Updated ${spec.kind}/${spec.metadata.name}`);
                    } catch (e) {
                        // Not found, create
                        if (e.body && e.body.code === 404) {
                            await client.create(spec);
                            results.push(`Created ${spec.kind}/${spec.metadata.name}`);
                        } else {
                            throw e;
                        }
                    }
                }
                return { content: [{ type: 'text', text: results.join('\n') }] };

            case 'kubernetes_delete_resource':
                if (args.kind.toLowerCase() === 'deployment') {
                    await apps.deleteNamespacedDeployment(args.name, namespace);
                } else if (args.kind.toLowerCase() === 'pod') {
                    await core.deleteNamespacedPod(args.name, namespace);
                } else if (args.kind.toLowerCase() === 'service') {
                    await core.deleteNamespacedService(args.name, namespace);
                } else {
                    return { isError: true, content: [{ type: 'text', text: `Unsupported kind for delete: ${args.kind}` }] };
                }
                return { content: [{ type: 'text', text: `Deleted ${args.kind}/${args.name}` }] };

            case 'kubernetes_scale_deployment':
                // Patch the scale subresource
                // Requires the patch content type header usually?
                // Client node has a method patchNamespacedDeploymentScale
                // Or just patch the deployment spec
                const patch = [
                    { op: 'replace', path: '/spec/replicas', value: args.replicas }
                ];
                const options = { headers: { "Content-Type": "application/json-patch+json" } };
                // Using simple patch on deployment body might be easier with client-node
                // Actually read -> update spec -> replace is safer for MVP than JSON patch if headers tricky
                const d = await apps.readNamespacedDeployment(args.name, namespace);
                d.body.spec.replicas = args.replicas;
                await apps.replaceNamespacedDeployment(args.name, namespace, d.body);

                return { content: [{ type: 'text', text: `Scaled ${args.name} to ${args.replicas} replicas.` }] };

            case 'kubernetes_get_deployment_status':
                const statusDep = await apps.readNamespacedDeployment(args.name, namespace);
                const s = statusDep.body.status;
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            readyReplicas: s.readyReplicas,
                            updatedReplicas: s.updatedReplicas,
                            availableReplicas: s.availableReplicas,
                            conditions: s.conditions
                        }, null, 2)
                    }]
                };

            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error) {
        const msg = error.body ? `${error.body.code} - ${error.body.message}` : error.message;
        return {
            isError: true,
            content: [{ type: 'text', text: `Kubernetes API Error: ${msg}` }]
        };
    }
}

// Request Handler
async function handleRequest(request) {
    if (request.method === 'initialize') {
        send({
            jsonrpc: "2.0",
            id: request.id,
            result: {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "kubernetes-mcp", version: "1.0.0" }
            }
        });
    } else if (request.method === 'tools/list') {
        send({
            jsonrpc: "2.0",
            id: request.id,
            result: {
                tools: [
                    {
                        name: "kubernetes_health",
                        description: "Check connection health",
                        inputSchema: { type: "object", properties: {} }
                    },
                    {
                        name: "kubernetes_configure",
                        description: "Configure Cluster Connection",
                        inputSchema: {
                            type: "object",
                            properties: {
                                api_server: { type: "string" },
                                auth: { type: "object" },
                                default_namespace: { type: "string" }
                            }
                        }
                    },
                    {
                        name: "kubernetes_list_namespaces",
                        description: "List Namespaces",
                        inputSchema: { type: "object", properties: {} }
                    },
                    {
                        name: "kubernetes_list_pods",
                        description: "List Pods",
                        inputSchema: {
                            type: "object",
                            properties: { namespace: { type: "string" }, label_selector: { type: "string" } }
                        }
                    },
                    {
                        name: "kubernetes_get_resource",
                        description: "Get Resource Spec",
                        inputSchema: {
                            type: "object",
                            properties: { kind: { type: "string" }, name: { type: "string" }, namespace: { type: "string" } },
                            required: ["kind", "name"]
                        }
                    },
                    {
                        name: "kubernetes_get_pod_logs",
                        description: "Get Pod Logs",
                        inputSchema: {
                            type: "object",
                            properties: { name: { type: "string" }, namespace: { type: "string" }, container: { type: "string" }, tail_lines: { type: "integer" } },
                            required: ["name"]
                        }
                    },
                    {
                        name: "kubernetes_apply_manifest",
                        description: "Apply YAML Manifest",
                        inputSchema: {
                            type: "object",
                            properties: { manifest: { type: "string" }, namespace: { type: "string" } },
                            required: ["manifest"]
                        }
                    },
                    {
                        name: "kubernetes_delete_resource",
                        description: "Delete Resource",
                        inputSchema: {
                            type: "object",
                            properties: { kind: { type: "string" }, name: { type: "string" }, namespace: { type: "string" } },
                            required: ["kind", "name"]
                        }
                    },
                    {
                        name: "kubernetes_scale_deployment",
                        description: "Scale Deployment",
                        inputSchema: {
                            type: "object",
                            properties: { name: { type: "string" }, namespace: { type: "string" }, replicas: { type: "integer" } },
                            required: ["name", "replicas"]
                        }
                    },
                    {
                        name: "kubernetes_get_deployment_status",
                        description: "Get Deployment Status",
                        inputSchema: {
                            type: "object",
                            properties: { name: { type: "string" }, namespace: { type: "string" } },
                            required: ["name"]
                        }
                    }
                ]
            }
        });
    } else if (request.method === 'tools/call') {
        handleToolCall(request.params.name, request.params.arguments || {}).then(result => {
            send({
                jsonrpc: "2.0",
                id: request.id,
                result: result
            });
        });
    }
}

// Stdio Loop
if (require.main === module) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
    });

    rl.on('line', (line) => {
        try {
            const request = JSON.parse(line);
            handleRequest(request);
        } catch (e) {
            // console.error(e);
        }
    });
}
