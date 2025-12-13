## GCP MCP Server

### Configure at runtime
Call `gcp.configure` with bearer token (in-memory only):
```json
{
  "project_id": "my-gcp-project",
  "credentials": { "type": "access_token", "token": "ya29..." },
  "default_region": "us-central1",
  "default_zone": "us-central1-a"
}
```
Validation: tokeninfo + Cloud Resource Manager project check. No persistence; credentials never logged.

### Tools
- Core: `gcp.configure`, `gcp.health`
- Discovery: `gcp.listServices`, `gcp.listRegions`, `gcp.listZones`
- Cloud Run: `gcp.cloudrun.listServices`, `gcp.cloudrun.getService`, `gcp.cloudrun.invoke`
- Cloud Functions: `gcp.functions.listFunctions`, `gcp.functions.getFunction`, `gcp.functions.invoke`
- Compute: `gcp.compute.listInstances`, `gcp.compute.getInstance`, `gcp.compute.startInstance`, `gcp.compute.stopInstance`, `gcp.compute.resetInstance`
- GKE: `gcp.gke.listClusters`, `gcp.gke.getCluster`, `gcp.gke.getKubeAccessToken`
- Storage (GCS): `gcp.storage.listBuckets`, `gcp.storage.listObjects`, `gcp.storage.getObject`, `gcp.storage.putObject`
- Pub/Sub: `gcp.pubsub.listTopics`, `gcp.pubsub.publishMessage`, `gcp.pubsub.pullMessages`, `gcp.pubsub.ackMessage`
- Monitoring: `gcp.monitoring.queryMetrics`
- Logging: `gcp.logging.queryLogs`, `gcp.logging.getLogContext`
- Incident helpers: `gcp.incident.findRecentErrors`, `gcp.incident.summarizeServiceHealth`

### Error shape
`{ "error": { "message": "...", "code": "GCP_ERROR|AUTH_FAILED|PERMISSION_DENIED|INVALID_PROJECT|NOT_FOUND|INVALID_REQUEST", "details": "...", "http_status": 400 } }`

### Notes
- All state is session-only. No file writes.
- Read-focused; no delete operations in this MVP.
- Some operations require specifying region/zone; defaults from `gcp.configure` are used when provided.
