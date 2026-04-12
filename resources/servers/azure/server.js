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
function getSqlClient() { return new SqlManagementClient(getCreds(), config.subscriptionId); }
function getCosmosClient() { return new CosmosDBManagementClient(getCreds(), config.subscriptionId); }
function getNetworkClient() { return new NetworkManagementClient(getCreds(), config.subscriptionId); }
function getVaultClient(url) { return new SecretClient(url, getCreds()); }
function getOpenAIClient(endpoint) { return new OpenAIClient(endpoint, getCreds()); }
function getBlobClient(accountName) {
    const url = `https://${accountName}.blob.core.windows.net`;
    return new BlobServiceClient(url, getCreds());
}
function getQueueClient(accountName) {
    const url = `https://${accountName}.queue.core.windows.net`;
    return new QueueServiceClient(url, getCreds());
}

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
    registerToolWithAliases(server, 'azure.health',
        { description: 'Health check for Azure Session', inputSchema: { type: 'object', properties: {} } },
        async () => {
            try {
                const client = getResourceClient();
                const rgs = [];
                for await (const rg of client.resourceGroups.list()) { rgs.push(rg.name); break; }
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, verified: true }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

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
        {
            description: 'List Resource Groups',
            inputSchema: {
                type: 'object',
                properties: {
                    filter: { type: 'string', description: 'OData filter, e.g. "name eq \'my-rg\'"' },
                    top: { type: 'number', description: 'Number of results to return' }
                }
            }
        },
        async (args) => {
            try {
                const client = getResourceClient();
                const rgs = [];
                const options = { filter: args.filter, top: args.top };
                for await (const rg of client.resourceGroups.list(options)) {
                    rgs.push({ name: rg.name, location: rg.location, state: rg.provisioningState });
                }
                return { content: [{ type: 'text', text: JSON.stringify({ resource_groups: rgs }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'azure.listResources',
        {
            description: 'List Resources',
            inputSchema: {
                type: 'object',
                properties: {
                    resource_group: { type: 'string' },
                    type_filter: { type: 'string' },
                    filter: { type: 'string' },
                    top: { type: 'number' }
                }
            }
        },
        async (args) => {
            try {
                const client = getResourceClient();
                const res = [];
                const options = { filter: args.filter, top: args.top };
                const iterator = args.resource_group
                    ? client.resources.listByResourceGroup(args.resource_group, options)
                    : client.resources.list(options);

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
        {
            description: 'List VMs',
            inputSchema: {
                type: 'object',
                properties: {
                    resource_group: { type: 'string' },
                    filter: { type: 'string' }
                }
            }
        },
        async (args) => {
            try {
                const client = getComputeClient();
                const vms = [];
                const options = { filter: args.filter };
                const iter = args.resource_group ? client.virtualMachines.list(args.resource_group, options) : client.virtualMachines.listAll(options);
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
        {
            description: 'List Web Apps',
            inputSchema: {
                type: 'object',
                properties: {
                    resource_group: { type: 'string' },
                    filter: { type: 'string' }
                }
            }
        },
        async (args) => {
            try {
                const client = getWebClient();
                const apps = [];
                const options = { filter: args.filter };
                const iter = args.resource_group ? client.webApps.listByResourceGroup(args.resource_group, options) : client.webApps.list(options);
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

    // --- Pillar 1: Data (SQL & Cosmos DB) ---
    registerToolWithAliases(server, 'azure.sql.listServers',
        { description: 'List SQL Servers', inputSchema: { type: 'object', properties: { resource_group: { type: 'string' } } } },
        async (args) => {
            try {
                const client = getSqlClient();
                const servers = [];
                const iter = args.resource_group ? client.servers.listByResourceGroup(args.resource_group) : client.servers.list();
                for await (const s of iter) {
                    servers.push({ name: s.name, id: s.id, location: s.location, version: s.version });
                }
                return { content: [{ type: 'text', text: JSON.stringify({ servers }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'azure.sql.listDatabases',
        { description: 'List SQL Databases', inputSchema: { type: 'object', properties: { server_name: { type: 'string' }, resource_group: { type: 'string' } }, required: ['server_name', 'resource_group'] } },
        async (args) => {
            try {
                const client = getSqlClient();
                const dbs = [];
                for await (const db of client.databases.listByServer(args.resource_group, args.server_name)) {
                    dbs.push({ name: db.name, id: db.id, state: db.status, collation: db.collation });
                }
                return { content: [{ type: 'text', text: JSON.stringify({ databases: dbs }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'azure.cosmosdb.listAccounts',
        { description: 'List Cosmos DB Accounts', inputSchema: { type: 'object', properties: { resource_group: { type: 'string' } } } },
        async (args) => {
            try {
                const client = getCosmosClient();
                const accounts = [];
                const iter = args.resource_group ? client.databaseAccounts.listByResourceGroup(args.resource_group) : client.databaseAccounts.list();
                for await (const a of iter) {
                    accounts.push({ name: a.name, id: a.id, kind: a.kind, documentEndpoint: a.documentEndpoint });
                }
                return { content: [{ type: 'text', text: JSON.stringify({ accounts }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- Pillar 2: Configuration & Secrets (Key Vault) ---
    registerToolWithAliases(server, 'azure.keyvault.listVaults',
        { description: 'List Key Vaults', inputSchema: { type: 'object', properties: { resource_group: { type: 'string' } } } },
        async (args) => {
            try {
                // Key Vault Management is part of arm-resources or a separate arm-keyvault.
                // For simplicity we use listing resources of type 'Microsoft.KeyVault/vaults'
                const client = getResourceClient();
                const vaults = [];
                const iter = args.resource_group
                    ? client.resources.listByResourceGroup(args.resource_group)
                    : client.resources.list();
                for await (const r of iter) {
                    if (r.type === 'Microsoft.KeyVault/vaults') {
                        vaults.push({ name: r.name, id: r.id, location: r.location });
                    }
                }
                return { content: [{ type: 'text', text: JSON.stringify({ vaults }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'azure.keyvault.getSecret',
        {
            description: 'Get a secret from Key Vault.',
            inputSchema: {
                type: 'object',
                properties: {
                    vault_url: { type: 'string', description: 'e.g. https://myvault.vault.azure.net/' },
                    secret_name: { type: 'string' }
                },
                required: ['vault_url', 'secret_name']
            }
        },
        async (args) => {
            try {
                const client = getVaultClient(args.vault_url);
                const secret = await client.getSecret(args.secret_name);
                return { content: [{ type: 'text', text: JSON.stringify({ name: secret.name, value: secret.value, properties: secret.properties }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- Pillar 3: Infrastructure (Networking) ---
    registerToolWithAliases(server, 'azure.network.listVNETs',
        { description: 'List Virtual Networks', inputSchema: { type: 'object', properties: { resource_group: { type: 'string' } } } },
        async (args) => {
            try {
                const client = getNetworkClient();
                const vnets = [];
                const iter = args.resource_group
                    ? client.virtualNetworks.list(args.resource_group)
                    : client.virtualNetworks.listAll();
                for await (const v of iter) {
                    vnets.push({ name: v.name, id: v.id, location: v.location, addressSpace: v.addressSpace });
                }
                return { content: [{ type: 'text', text: JSON.stringify({ vnets }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'azure.network.listSubnets',
        {
            description: 'List subnets in a VNET.',
            inputSchema: {
                type: 'object',
                properties: {
                    vnet_name: { type: 'string' },
                    resource_group: { type: 'string' }
                },
                required: ['vnet_name', 'resource_group']
            }
        },
        async (args) => {
            try {
                const client = getNetworkClient();
                const subnets = [];
                for await (const s of client.subnets.list(args.resource_group, args.vnet_name)) {
                    subnets.push({ name: s.name, id: s.id, addressPrefix: s.addressPrefix });
                }
                return { content: [{ type: 'text', text: JSON.stringify({ subnets }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'azure.network.listNSGs',
        { description: 'List Network Security Groups', inputSchema: { type: 'object', properties: { resource_group: { type: 'string' } } } },
        async (args) => {
            try {
                const client = getNetworkClient();
                const nsgs = [];
                const iter = args.resource_group
                    ? client.networkSecurityGroups.list(args.resource_group)
                    : client.networkSecurityGroups.listAll();
                for await (const n of iter) {
                    nsgs.push({ name: n.name, id: n.id, location: n.location, securityRules: n.securityRules });
                }
                return { content: [{ type: 'text', text: JSON.stringify({ nsgs }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- Pillar 4: AI (Azure OpenAI) ---
    registerToolWithAliases(server, 'azure.openai.listDeployments',
        {
            description: 'List Azure OpenAI deployments.',
            inputSchema: {
                type: 'object',
                properties: {
                    endpoint: { type: 'string', description: 'Azure OpenAI endpoint URL' }
                },
                required: ['endpoint']
            }
        },
        async (args) => {
            try {
                const client = getOpenAIClient(args.endpoint);
                const deployments = await client.getDeployments(); // Note: Some versions might use different methods
                return { content: [{ type: 'text', text: JSON.stringify({ deployments }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'azure.openai.getChatCompletions',
        {
            description: 'Get chat completions from Azure OpenAI.',
            inputSchema: {
                type: 'object',
                properties: {
                    endpoint: { type: 'string' },
                    deployment_id: { type: 'string' },
                    messages: { type: 'array', items: { type: 'object' } },
                    max_tokens: { type: 'number' },
                    temperature: { type: 'number' }
                },
                required: ['endpoint', 'deployment_id', 'messages']
            }
        },
        async (args) => {
            try {
                const client = getOpenAIClient(args.endpoint);
                const resp = await client.getChatCompletions(args.deployment_id, args.messages, {
                    maxTokens: args.max_tokens,
                    temperature: args.temperature
                });
                return { content: [{ type: 'text', text: JSON.stringify({ choices: resp.choices, usage: resp.usage }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- Pillar 5: Storage (Blobs & Queues) ---
    registerToolWithAliases(server, 'azure.storage.listContainers',
        {
            description: 'List blob containers in a storage account.',
            inputSchema: {
                type: 'object',
                properties: {
                    account_name: { type: 'string' }
                },
                required: ['account_name']
            }
        },
        async (args) => {
            try {
                const client = getBlobClient(args.account_name);
                const containers = [];
                for await (const container of client.listContainers()) {
                    containers.push({ name: container.name, properties: container.properties });
                }
                return { content: [{ type: 'text', text: JSON.stringify({ containers }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'azure.storage.listBlobs',
        {
            description: 'List blobs in a container.',
            inputSchema: {
                type: 'object',
                properties: {
                    account_name: { type: 'string' },
                    container_name: { type: 'string' }
                },
                required: ['account_name', 'container_name']
            }
        },
        async (args) => {
            try {
                const client = getBlobClient(args.account_name);
                const containerClient = client.getContainerClient(args.container_name);
                const blobs = [];
                for await (const blob of containerClient.listBlobsFlat()) {
                    blobs.push({ name: blob.name, properties: blob.properties });
                }
                return { content: [{ type: 'text', text: JSON.stringify({ blobs }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    registerToolWithAliases(server, 'azure.storage.listQueues',
        {
            description: 'List queues in a storage account.',
            inputSchema: {
                type: 'object',
                properties: {
                    account_name: { type: 'string' }
                },
                required: ['account_name']
            }
        },
        async (args) => {
            try {
                const client = getQueueClient(args.account_name);
                const queues = [];
                for await (const queue of client.listQueues()) {
                    queues.push({ name: queue.name, metadata: queue.metadata });
                }
                return { content: [{ type: 'text', text: JSON.stringify({ queues }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- DevOps & Environment (Monitor) ---
    registerToolWithAliases(server, 'azure.monitor.listAlertRules',
        {
            description: 'List metric alert rules in a resource group.',
            inputSchema: {
                type: 'object',
                properties: {
                    resource_group: { type: 'string' }
                },
                required: ['resource_group']
            }
        },
        async (args) => {
            try {
                const client = new MonitorClient(getCreds(), config.subscriptionId);
                const alerts = [];
                for await (const alert of client.metricAlerts.listByResourceGroup(args.resource_group)) {
                    alerts.push({ name: alert.name, id: alert.id, enabled: alert.enabled, severity: alert.severity });
                }
                return { content: [{ type: 'text', text: JSON.stringify({ alerts }) }] };
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
