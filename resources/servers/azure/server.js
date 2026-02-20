const { ResourceManagementClient } = require("@azure/arm-resources");
const { ComputeManagementClient } = require("@azure/arm-compute");
const { WebSiteManagementClient } = require("@azure/arm-appservice");
const { ContainerServiceClient } = require("@azure/arm-containerservice");
const { MonitorClient } = require("@azure/arm-monitor");
const { LogsQueryClient, MetricsQueryClient } = require("@azure/monitor-query");
const { BlobServiceClient } = require("@azure/storage-blob");
const { QueueServiceClient } = require("@azure/storage-queue");
const { McpServer } = require(require('path').join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js'));
const { StdioServerTransport } = require(require('path').join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/stdio.js'));

const SERVER_INFO = { name: 'azure-mcp', version: '1.0.0' };

// Configuration State
let config = {
    tenantId: process.env.AZURE_TENANT_ID,
    subscriptionId: process.env.AZURE_SUBSCRIPTION_ID,
    token: process.env.AZURE_ACCESS_TOKEN
};

// --- Credentials ---
// We create a TokenCredential-like object that returns our static token.
// The SDKs expect an object with `getToken(scopes)`.
class StaticTokenCredential {
    constructor(token) { this.token = token; }
    async getToken(scopes) {
        // Return explicit token. ExpiresOn irrelevant for this shim usually, but good to have.
        return { token: this.token, expiresOnTimestamp: Date.now() + 3600 * 1000 };
    }
}

// Helpers to get clients
function getCreds() {
    if (!config.token) throw new Error("Azure Not Configured. Call azure.configure.");
    return new StaticTokenCredential(config.token);
}

function getResourceClient() { return new ResourceManagementClient(getCreds(), config.subscriptionId); }
function getComputeClient() { return new ComputeManagementClient(getCreds(), config.subscriptionId); }
function getWebClient() { return new WebSiteManagementClient(getCreds(), config.subscriptionId); }
function getAksClient() { return new ContainerServiceClient(getCreds(), config.subscriptionId); }
function getMetricsClient() { return new MetricsQueryClient(getCreds()); }
function getLogsClient() { return new LogsQueryClient(getCreds()); }

function normalizeError(err) {
    const msg = err.message || JSON.stringify(err);
    return { isError: true, content: [{ type: 'text', text: `Azure API Error: ${msg}` }] };
}

function createToolAliases(name) {
    const alias = name
        .replace(/\./g, '_')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase();
    return alias !== name ? [alias] : [];
}

function registerToolWithAliases(server, name, config, handler) {
    const aliases = createToolAliases(name);
    if (aliases.length === 0) {
        server.registerTool(name, config, handler);
        return;
    }
    for (const alias of aliases) {
        server.registerTool(alias, config, handler);
    }
}

async function main() {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    // --- Core ---
    registerToolWithAliases(server, 'azure.configure',
        {
            description: 'Configure Azure Session',
            inputSchema: {
                type: 'object',
                properties: {
                    tenant_id: { type: 'string' },
                    subscription_id: { type: 'string' },
                    token: { type: 'string' }
                },
                required: ['token', 'subscription_id']
            }
        },
        async (args) => {
            config.token = args.token;
            config.subscriptionId = args.subscription_id;
            if (args.tenant_id) config.tenantId = args.tenant_id;

            try {
                // Verify by listing resource groups (lightweight)
                const client = getResourceClient();
                const rgs = [];
                for await (const rg of client.resourceGroups.list()) { rgs.push(rg.name); break; }
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, subscription: config.subscriptionId, verified: true }) }] };
            } catch (e) {
                config.token = undefined;
                return normalizeError(e);
            }
        }
    );

    registerToolWithAliases(server, 'azure.listResourceGroups',
        { description: 'List Resource Groups', inputSchema: { type: 'object', properties: {} } },
        async () => {
            try {
                const client = getResourceClient();
                const rgs = [];
                for await (const rg of client.resourceGroups.list()) {
                    rgs.push({ name: rg.name, location: rg.location, state: rg.provisioningState });
                }
                return { content: [{ type: 'text', text: JSON.stringify({ resource_groups: rgs }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'azure.listResources',
        {
            description: 'List Resources',
            inputSchema: { type: 'object', properties: { resource_group: { type: 'string' }, type_filter: { type: 'string' } } }
        },
        async (args) => {
            try {
                const client = getResourceClient();
                const res = [];
                const iterator = args.resource_group
                    ? client.resources.listByResourceGroup(args.resource_group)
                    : client.resources.list();

                for await (const r of iterator) {
                    if (args.type_filter && r.type !== args.type_filter) continue;
                    res.push({ name: r.name, type: r.type, location: r.location, id: r.id });
                }
                return { content: [{ type: 'text', text: JSON.stringify({ resources: res }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- VMs ---
    registerToolWithAliases(server, 'azure.vm.list',
        { description: 'List VMs', inputSchema: { type: 'object', properties: { resource_group: { type: 'string' } } } },
        async (args) => {
            try {
                const client = getComputeClient();
                const vms = [];
                const iter = args.resource_group ? client.virtualMachines.list(args.resource_group) : client.virtualMachines.listAll();
                for await (const vm of iter) {
                    // Try get instance view for status if possible, but list might be basic
                    vms.push({ name: vm.name, id: vm.id, location: vm.location, size: vm.hardwareProfile?.vmSize });
                }
                return { content: [{ type: 'text', text: JSON.stringify({ vms }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'azure.vm.start',
        { description: 'Start VM', inputSchema: { type: 'object', properties: { name: { type: 'string' }, resource_group: { type: 'string' } }, required: ['name', 'resource_group'] } },
        async (args) => {
            try {
                await getComputeClient().virtualMachines.beginStartAndWait(args.resource_group, args.name);
                return { content: [{ type: 'text', text: JSON.stringify({ status: 'started' }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'azure.vm.stop',
        { description: 'Stop VM', inputSchema: { type: 'object', properties: { name: { type: 'string' }, resource_group: { type: 'string' } }, required: ['name', 'resource_group'] } },
        async (args) => { // Deallocate is cleaner stop usually
            try {
                await getComputeClient().virtualMachines.beginDeallocateAndWait(args.resource_group, args.name);
                return { content: [{ type: 'text', text: JSON.stringify({ status: 'stopped/deallocated' }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'azure.vm.restart',
        { description: 'Restart VM', inputSchema: { type: 'object', properties: { name: { type: 'string' }, resource_group: { type: 'string' } }, required: ['name', 'resource_group'] } },
        async (args) => {
            try {
                await getComputeClient().virtualMachines.beginRestartAndWait(args.resource_group, args.name);
                return { content: [{ type: 'text', text: JSON.stringify({ status: 'restarted' }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- App Service ---
    registerToolWithAliases(server, 'azure.app.listWebApps',
        { description: 'List Web Apps', inputSchema: { type: 'object', properties: { resource_group: { type: 'string' } } } },
        async (args) => {
            try {
                const client = getWebClient();
                const apps = [];
                const iter = args.resource_group ? client.webApps.listByResourceGroup(args.resource_group) : client.webApps.list();
                for await (const app of iter) {
                    apps.push({ name: app.name, state: app.state, defaultHostName: app.defaultHostName, kind: app.kind });
                }
                return { content: [{ type: 'text', text: JSON.stringify({ apps }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'azure.app.restartWebApp',
        { description: 'Restart Web App', inputSchema: { type: 'object', properties: { name: { type: 'string' }, resource_group: { type: 'string' } }, required: ['name', 'resource_group'] } },
        async (args) => {
            try {
                await getWebClient().webApps.restart(args.resource_group, args.name);
                return { content: [{ type: 'text', text: JSON.stringify({ status: 'restarted' }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'azure.functions.list',
        { description: 'List Functions', inputSchema: { type: 'object', properties: { function_app: { type: 'string' }, resource_group: { type: 'string' } }, required: ['function_app', 'resource_group'] } },
        async (args) => {
            try {
                const client = getWebClient();
                const funcs = [];
                for await (const f of client.webApps.listFunctions(args.resource_group, args.function_app)) {
                    funcs.push({ name: f.name, id: f.id });
                }
                return { content: [{ type: 'text', text: JSON.stringify({ functions: funcs }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- AKS ---
    registerToolWithAliases(server, 'azure.aks.listClusters',
        { description: 'List AKS Clusters', inputSchema: { type: 'object', properties: { resource_group: { type: 'string' } } } },
        async (args) => {
            try {
                const client = getAksClient();
                const clusters = [];
                const iter = args.resource_group ? client.managedClusters.listByResourceGroup(args.resource_group) : client.managedClusters.list();
                for await (const c of iter) {
                    clusters.push({ name: c.name, version: c.kubernetesVersion, state: c.provisioningState });
                }
                return { content: [{ type: 'text', text: JSON.stringify({ clusters }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'azure.aks.getKubeAccessToken',
        { description: 'Get AKS Credentials', inputSchema: { type: 'object', properties: { name: { type: 'string' }, resource_group: { type: 'string' } }, required: ['name', 'resource_group'] } },
        async (args) => {
            try {
                const client = getAksClient();
                const creds = await client.managedClusters.listClusterUserCredentials(args.resource_group, args.name);
                // creds.kubeconfigs is array of bytes
                // decode base64
                if (!creds.kubeconfigs || creds.kubeconfigs.length === 0) throw new Error("No kubeconfigs found");
                const kubeconfig = Buffer.from(creds.kubeconfigs[0].value).toString('utf8');
                return { content: [{ type: 'text', text: JSON.stringify({ kubeconfig_preview: kubeconfig.substring(0, 50) + "...", full_kubeconfig: kubeconfig }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- Monitor & Logs ---
    registerToolWithAliases(server, 'azure.monitor.queryMetrics',
        { description: 'Query Metrics', inputSchema: { type: 'object', properties: { resource_id: { type: 'string' }, metric_names: { type: 'array', items: { type: 'string' } }, time_range: { type: 'string' } }, required: ['resource_id'] } },
        async (args) => {
            try {
                const client = getMetricsClient();
                // time_range format: "P1D" or explicit start/end via options
                // Basic MVP: last 1 hour if not specified
                const result = await client.queryResource(args.resource_id, args.metric_names || [], { timespan: { duration: args.time_range || "PT1H" } });
                return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'azure.logs.query',
        { description: 'Query Logs (KQL)', inputSchema: { type: 'object', properties: { workspace_id: { type: 'string' }, query: { type: 'string' } }, required: ['workspace_id', 'query'] } },
        async (args) => {
            try {
                const client = getLogsClient();
                const result = await client.queryWorkspace(args.workspace_id, args.query, { duration: "P1D" });
                // Result tables structure
                return { content: [{ type: 'text', text: JSON.stringify(result.tables) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'azure.incident.summarize',
        { description: 'Summarize Health', inputSchema: { type: 'object', properties: { resource_id: { type: 'string' } }, required: ['resource_id'] } },
        async (args) => {
            // MVP: Check provisioning state via Resource Client and some metrics if possible
            // Real implementation would be complex. Returning generic check.
            try {
                const rClient = getResourceClient();
                const r = await rClient.resources.getById(args.resource_id, "2021-04-01");
                return {
                    content: [{
                        type: 'text', text: JSON.stringify({
                            id: r.id,
                            name: r.name,
                            type: r.type,
                            status: r.tags?.status || 'Unknown - Check provisioningState',
                            provisioningState: r.provisioningState
                        })
                    }]
                };
            } catch (e) { return normalizeError(e); }
        }
    );


    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Azure MCP Server running on stdio');
}


if (require.main === module) {
    main().catch(console.error);
}

module.exports = { main };
