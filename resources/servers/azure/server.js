const { ResourceManagementClient } = require("@azure/arm-resources");
const { ComputeManagementClient } = require("@azure/arm-compute");
const { WebSiteManagementClient } = require("@azure/arm-appservice");
const { ContainerServiceClient } = require("@azure/arm-containerservice");
const { MonitorClient } = require("@azure/arm-monitor");
const { LogsQueryClient, MetricsQueryClient } = require("@azure/monitor-query");
const { BlobServiceClient } = require("@azure/storage-blob");
const { QueueServiceClient } = require("@azure/storage-queue");
const { SqlManagementClient } = require("@azure/arm-sql");
const { CosmosDBManagementClient } = require("@azure/arm-cosmosdb");
const { NetworkManagementClient } = require("@azure/arm-network");
const { SecretClient } = require("@azure/keyvault-secrets");
const { OpenAIClient } = require("@azure/openai");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const z = require("zod");

const SERVER_INFO = { name: "azure-mcp", version: "2.0.0" };

function createAzureServer() {
    let config = {
        tenantId: process.env.AZURE_TENANT_ID,
        subscriptionId: process.env.AZURE_SUBSCRIPTION_ID,
        token: process.env.AZURE_ACCESS_TOKEN
    };

    class StaticTokenCredential {
        constructor(token) { this.token = token; }
        async getToken(scopes) {
            return { token: this.token, expiresOnTimestamp: Date.now() + 3600 * 1000 };
        }
    }

    function getCreds() {
        if (!config.token) throw new Error("Azure Not Configured. Call azure.configure.");
        return new StaticTokenCredential(config.token);
    }

    // Clients
    function getResourceClient() { return new ResourceManagementClient(getCreds(), config.subscriptionId); }
    function getComputeClient() { return new ComputeManagementClient(getCreds(), config.subscriptionId); }
    function getWebClient() { return new WebSiteManagementClient(getCreds(), config.subscriptionId); }
    function getAksClient() { return new ContainerServiceClient(getCreds(), config.subscriptionId); }
    function getMetricsClient() { return new MetricsQueryClient(getCreds()); }
    function getLogsClient() { return new LogsQueryClient(getCreds()); }
    function getSqlClient() { return new SqlManagementClient(getCreds(), config.subscriptionId); }
    function getCosmosClient() { return new CosmosDBManagementClient(getCreds(), config.subscriptionId); }
    function getNetworkClient() { return new NetworkManagementClient(getCreds(), config.subscriptionId); }
    function getVaultClient(url) { return new SecretClient(url, getCreds()); }
    function getOpenAIClient(endpoint) { return new OpenAIClient(endpoint, getCreds()); }
    function getBlobClient(accountName) { return new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, getCreds()); }
    function getQueueClient(accountName) { return new QueueServiceClient(`https://${accountName}.queue.core.windows.net`, getCreds()); }

    function normalizeError(err) {
        const msg = err.message || JSON.stringify(err);
        return { isError: true, content: [{ type: "text", text: `Azure API Error: ${msg}` }] };
    }

    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    const registerTool = (name, aliases, schema, handler) => {
        server.tool(name, schema, handler);
        aliases.forEach(a => server.tool(a, schema, handler));
    };

    // --- CORE ---
    registerTool("azure_health", ["azure.health"], {}, async () => {
        try {
            const client = getResourceClient();
            for await (const rg of client.resourceGroups.list()) { break; }
            return { content: [{ type: "text", text: JSON.stringify({ ok: true, verified: true }) }] };
        } catch (e) { return normalizeError(e); }
    });

    registerTool("azure_configure", ["azure.configure"], {
        token: z.string(),
        subscription_id: z.string(),
        tenant_id: z.string().optional()
    }, async (args) => {
        config.token = args.token;
        config.subscriptionId = args.subscription_id;
        if (args.tenant_id) config.tenantId = args.tenant_id;
        try {
            const client = getResourceClient();
            for await (const rg of client.resourceGroups.list()) { break; }
            return { content: [{ type: "text", text: JSON.stringify({ ok: true, subscription: config.subscriptionId, verified: true }) }] };
        } catch (e) {
            config.token = undefined;
            return normalizeError(e);
        }
    });

    registerTool("azure_list_resource_groups", ["azure.listResourceGroups"], {
        filter: z.string().optional(),
        top: z.number().optional()
    }, async (args) => {
        try {
            const client = getResourceClient();
            const rgs = [];
            for await (const rg of client.resourceGroups.list({ filter: args.filter, top: args.top })) {
                rgs.push({ name: rg.name, location: rg.location, state: rg.provisioningState });
            }
            return { content: [{ type: "text", text: JSON.stringify({ resource_groups: rgs }) }] };
        } catch (e) { return normalizeError(e); }
    });

    registerTool("azure_list_resources", ["azure.listResources"], {
        resource_group: z.string().optional(),
        type_filter: z.string().optional(),
        filter: z.string().optional(),
        top: z.number().optional()
    }, async (args) => {
        try {
            const client = getResourceClient();
            const res = [];
            const iter = args.resource_group ? client.resources.listByResourceGroup(args.resource_group, { filter: args.filter, top: args.top }) : client.resources.list({ filter: args.filter, top: args.top });
            for await (const r of iter) {
                if (args.type_filter && r.type !== args.type_filter) continue;
                res.push({ name: r.name, type: r.type, location: r.location, id: r.id });
            }
            return { content: [{ type: "text", text: JSON.stringify({ resources: res }) }] };
        } catch (e) { return normalizeError(e); }
    });

    // --- VMs ---
    registerTool("azure_vm_list", ["azure.vm.list"], {
        resource_group: z.string().optional(),
        filter: z.string().optional()
    }, async (args) => {
        try {
            const client = getComputeClient();
            const vms = [];
            const iter = args.resource_group ? client.virtualMachines.list(args.resource_group, { filter: args.filter }) : client.virtualMachines.listAll({ filter: args.filter });
            for await (const vm of iter) {
                vms.push({ name: vm.name, id: vm.id, location: vm.location, size: vm.hardwareProfile?.vmSize });
            }
            return { content: [{ type: "text", text: JSON.stringify({ vms }) }] };
        } catch (e) { return normalizeError(e); }
    });

    registerTool("azure_vm_start", ["azure.vm.start"], {
        name: z.string(),
        resource_group: z.string()
    }, async (args) => {
        try {
            await getComputeClient().virtualMachines.beginStartAndWait(args.resource_group, args.name);
            return { content: [{ type: "text", text: JSON.stringify({ status: "started" }) }] };
        } catch (e) { return normalizeError(e); }
    });

    registerTool("azure_vm_stop", ["azure.vm.stop"], {
        name: z.string(),
        resource_group: z.string(),
        confirm: z.boolean().describe("Safety gate")
    }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: "text", text: "CONFIRMATION_REQUIRED" }] };
        try {
            await getComputeClient().virtualMachines.beginDeallocateAndWait(args.resource_group, args.name);
            return { content: [{ type: "text", text: JSON.stringify({ status: "stopped/deallocated" }) }] };
        } catch (e) { return normalizeError(e); }
    });

    registerTool("azure_vm_restart", ["azure.vm.restart"], {
        name: z.string(),
        resource_group: z.string(),
        confirm: z.boolean().describe("Safety gate")
    }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: "text", text: "CONFIRMATION_REQUIRED" }] };
        try {
            await getComputeClient().virtualMachines.beginRestartAndWait(args.resource_group, args.name);
            return { content: [{ type: "text", text: JSON.stringify({ status: "restarted" }) }] };
        } catch (e) { return normalizeError(e); }
    });

    // --- APP SERVICE ---
    registerTool("azure_app_list_web_apps", ["azure.app.listWebApps"], {
        resource_group: z.string().optional(),
        filter: z.string().optional()
    }, async (args) => {
        try {
            const client = getWebClient();
            const apps = [];
            const iter = args.resource_group ? client.webApps.listByResourceGroup(args.resource_group, { filter: args.filter }) : client.webApps.list({ filter: args.filter });
            for await (const app of iter) {
                apps.push({ name: app.name, state: app.state, defaultHostName: app.defaultHostName, kind: app.kind });
            }
            return { content: [{ type: "text", text: JSON.stringify({ apps }) }] };
        } catch (e) { return normalizeError(e); }
    });

    registerTool("azure_app_restart_web_app", ["azure.app.restartWebApp"], {
        name: z.string(),
        resource_group: z.string(),
        confirm: z.boolean().describe("Safety gate")
    }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: "text", text: "CONFIRMATION_REQUIRED" }] };
        try {
            await getWebClient().webApps.restart(args.resource_group, args.name);
            return { content: [{ type: "text", text: JSON.stringify({ status: "restarted" }) }] };
        } catch (e) { return normalizeError(e); }
    });

    registerTool("azure_functions_list", ["azure.functions.list"], {
        function_app: z.string(),
        resource_group: z.string()
    }, async (args) => {
        try {
            const client = getWebClient();
            const funcs = [];
            for await (const f of client.webApps.listFunctions(args.resource_group, args.function_app)) {
                funcs.push({ name: f.name, id: f.id });
            }
            return { content: [{ type: "text", text: JSON.stringify({ functions: funcs }) }] };
        } catch (e) { return normalizeError(e); }
    });

    // --- AKS ---
    registerTool("azure_aks_list_clusters", ["azure.aks.listClusters"], {
        resource_group: z.string().optional()
    }, async (args) => {
        try {
            const client = getAksClient();
            const clusters = [];
            const iter = args.resource_group ? client.managedClusters.listByResourceGroup(args.resource_group) : client.managedClusters.list();
            for await (const c of iter) {
                clusters.push({ name: c.name, version: c.kubernetesVersion, state: c.provisioningState });
            }
            return { content: [{ type: "text", text: JSON.stringify({ clusters }) }] };
        } catch (e) { return normalizeError(e); }
    });

    registerTool("azure_aks_get_kube_access_token", ["azure.aks.getKubeAccessToken"], {
        name: z.string(),
        resource_group: z.string()
    }, async (args) => {
        try {
            const client = getAksClient();
            const creds = await client.managedClusters.listClusterUserCredentials(args.resource_group, args.name);
            if (!creds.kubeconfigs || creds.kubeconfigs.length === 0) throw new Error("No kubeconfigs found");
            const kubeconfig = Buffer.from(creds.kubeconfigs[0].value).toString("utf8");
            return { content: [{ type: "text", text: JSON.stringify({ kubeconfig_preview: kubeconfig.substring(0, 50) + "...", full_kubeconfig: kubeconfig }) }] };
        } catch (e) { return normalizeError(e); }
    });

    // --- MONITOR ---
    registerTool("azure_monitor_query_metrics", ["azure.monitor.queryMetrics"], {
        resource_id: z.string(),
        metric_names: z.array(z.string()).optional(),
        time_range: z.string().optional()
    }, async (args) => {
        try {
            const client = getMetricsClient();
            const result = await client.queryResource(args.resource_id, args.metric_names || [], { timespan: { duration: args.time_range || "PT1H" } });
            return { content: [{ type: "text", text: JSON.stringify(result) }] };
        } catch (e) { return normalizeError(e); }
    });

    registerTool("azure_logs_query", ["azure.logs.query"], {
        workspace_id: z.string(),
        query: z.string()
    }, async (args) => {
        try {
            const client = getLogsClient();
            const result = await client.queryWorkspace(args.workspace_id, args.query, { duration: "P1D" });
            return { content: [{ type: "text", text: JSON.stringify(result.tables) }] };
        } catch (e) { return normalizeError(e); }
    });

    // --- DATA ---
    registerTool("azure_sql_list_servers", ["azure.sql.listServers"], {
        resource_group: z.string().optional()
    }, async (args) => {
        try {
            const client = getSqlClient();
            const servers = [];
            const iter = args.resource_group ? client.servers.listByResourceGroup(args.resource_group) : client.servers.list();
            for await (const s of iter) {
                servers.push({ name: s.name, id: s.id, location: s.location, version: s.version });
            }
            return { content: [{ type: "text", text: JSON.stringify({ servers }) }] };
        } catch (e) { return normalizeError(e); }
    });

    registerTool("azure_sql_list_databases", ["azure.sql.listDatabases"], {
        server_name: z.string(),
        resource_group: z.string()
    }, async (args) => {
        try {
            const client = getSqlClient();
            const dbs = [];
            for await (const db of client.databases.listByServer(args.resource_group, args.server_name)) {
                dbs.push({ name: db.name, id: db.id, state: db.status, collation: db.collation });
            }
            return { content: [{ type: "text", text: JSON.stringify({ databases: dbs }) }] };
        } catch (e) { return normalizeError(e); }
    });

    // --- KEY VAULT ---
    registerTool("azure_keyvault_list_vaults", ["azure.keyvault.listVaults"], {
        resource_group: z.string().optional()
    }, async (args) => {
        try {
            const client = getResourceClient();
            const vaults = [];
            const iter = args.resource_group ? client.resources.listByResourceGroup(args.resource_group) : client.resources.list();
            for await (const r of iter) {
                if (r.type === "Microsoft.KeyVault/vaults") {
                    vaults.push({ name: r.name, id: r.id, location: r.location });
                }
            }
            return { content: [{ type: "text", text: JSON.stringify({ vaults }) }] };
        } catch (e) { return normalizeError(e); }
    });

    registerTool("azure_keyvault_get_secret", ["azure.keyvault.getSecret"], {
        vault_url: z.string(),
        secret_name: z.string()
    }, async (args) => {
        try {
            const client = getVaultClient(args.vault_url);
            const secret = await client.getSecret(args.secret_name);
            return { content: [{ type: "text", text: JSON.stringify({ name: secret.name, value: secret.value, properties: secret.properties }) }] };
        } catch (e) { return normalizeError(e); }
    });

    // --- STORAGE ---
    registerTool("azure_storage_list_containers", ["azure.storage.listContainers"], {
        account_name: z.string()
    }, async (args) => {
        try {
            const client = getBlobClient(args.account_name);
            const containers = [];
            for await (const container of client.listContainers()) {
                containers.push({ name: container.name, properties: container.properties });
            }
            return { content: [{ type: "text", text: JSON.stringify({ containers }) }] };
        } catch (e) { return normalizeError(e); }
    });

    // Final connector
    return {
        server,
        __test: {
            normalizeError,
            setConfig: (next) => { config = { ...config, ...next }; },
            getConfig: () => ({ ...config })
        }
    };
}

const { server, __test } = createAzureServer();

if (require.main === module) {
    const transport = new StdioServerTransport();
    server.connect(transport).catch(console.error);
    console.error("Azure MCP Server running on stdio");
}

module.exports = { createAzureServer, __test };
