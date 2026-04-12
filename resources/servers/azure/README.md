## Azure MCP Server

### Configure at runtime
Call `azure_configure` (in-memory only):
```json
{
  "subscriptionId": "...",
  "tenantId": "...",
  "token": "..."
}
```

### Tools
- **Core**: `azure_configure`, `azure_health`, `azure_listResourceGroups`, `azure_listResources`
- **Compute**: `azure_vm_list`, `azure_vm_start`, `azure_vm_stop`, `azure_vm_restart`
- **App Service**: `azure_app_listWebApps`, `azure_app_restartWebApp`
- **Kubernetes**: `azure_aks_listClusters`, `azure_aks_getKubeAccessToken`
- **Data**: `azure_sql_listServers`, `azure_sql_listDatabases`, `azure_cosmosdb_listAccounts`
- **Secrets**: `azure_keyvault_listVaults`, `azure_keyvault_getSecret`
- **Networking**: `azure_network_listVNETs`, `azure_network_listSubnets`, `azure_network_listNSGs`
- **AI (OpenAI)**: `azure_openai_listDeployments`, `azure_openai_getChatCompletions`
- **Storage**: `azure_storage_listContainers`, `azure_storage_listBlobs`, `azure_storage_listQueues`
- **DevOps & Monitor**: `azure_monitor_queryMetrics`, `azure_monitor_listAlertRules`, `azure_logs_query`, `azure_incident_summarize`

### Notes
- All tools support both `dot.notation` (e.g., `azure.vm.list`) and `snake_case` (e.g., `azure_vm_list`).
- Requires an Azure Access Token with appropriate RBAC permissions.
- Hardened with OData pagination (`top`, `filter`) for listing tools.
