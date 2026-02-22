## GCP MCP Server

### Configure at runtime
Call `gcp_configure` with bearer token (in-memory only):
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
- Core: `gcp_configure`, `gcp_health`
- Discovery: `gcp_list_services`, `gcp_list_regions`, `gcp_list_zones`
- Cloud Run: `gcp_cloudrun_list_services`, `gcp_cloudrun_get_service`, `gcp_cloudrun_invoke`
- Cloud Functions: `gcp_functions_list_functions`, `gcp_functions_get_function`, `gcp_functions_invoke`
- Compute: `gcp_compute_list_instances`, `gcp_compute_get_instance`, `gcp_compute_start_instance`, `gcp_compute_stop_instance`, `gcp_compute_reset_instance`
- GKE: `gcp_gke_list_clusters`, `gcp_gke_get_cluster`, `gcp_gke_get_kube_access_token`
- Storage (GCS): `gcp_storage_list_buckets`, `gcp_storage_list_objects`, `gcp_storage_get_object`, `gcp_storage_put_object`
- Pub/Sub: `gcp_pubsub_list_topics`, `gcp_pubsub_publish_message`, `gcp_pubsub_pull_messages`, `gcp_pubsub_ack_message`
- Monitoring: `gcp_monitoring_query_metrics`
- Logging: `gcp_logging_query_logs`, `gcp_logging_get_log_context`
- Incident helpers: `gcp_incident_find_recent_errors`, `gcp_incident_summarize_service_health`

### Error shape
`{ "error": { "message": "...", "code": "GCP_ERROR|AUTH_FAILED|PERMISSION_DENIED|INVALID_PROJECT|NOT_FOUND|INVALID_REQUEST", "details": "...", "http_status": 400 } }`

### Notes
- All state is session-only. No file writes.
- Read-focused; no delete operations in this MVP.
- Some operations require specifying region/zone; defaults from `gcp_configure` are used when provided.
