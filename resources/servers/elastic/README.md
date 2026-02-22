## Elastic / OpenSearch MCP Server

### Configure at runtime
Call `elastic_configure` first (no persistence):
```json
{
  "url": "https://es.company.com:9200",
  "auth": { "type": "basic", "username": "observer", "password": "…" },
  "default_indices": ["logs-*"]
}
```
Supports `basic`, `bearer`, or `api_key` auth.

### Tools
- `elastic_health`
- `elastic_configure`
- `elastic_list_indices`
- `elastic_get_index_stats`
- `elastic_get_mappings`
- `elastic_search_logs` (query_string + optional time_range)
- `elastic_search_structured` (raw JSON body)
- `elastic_aggregate`
- `elastic_find_recent_errors` (service + time range, level=ERROR)
- `elastic_get_log_context` (doc + before/after)

### Error shape
All errors return:
```json
{ "error": { "message": "...", "code": "ELASTICSEARCH_ERROR", "http_status": 400, "details": "..." } }
```
Common codes: `AUTH_FAILED`, `CONNECTION_FAILED`, `QUERY_TOO_BROAD`, `INDEX_NOT_FOUND`.

### Guardrails
- Default max size: 1000 docs
- Simplified tools support time-range inputs; avoid unbounded queries
- Read-only by default (write/admin not included)

### Usage patterns
- Find service errors in last 15m: `elastic_find_recent_errors` with `service` and `time_range`
- Freeform search: `elastic_search_logs` with query_string
- Structured queries/aggregations: `elastic_search_structured` / `elastic_aggregate`
- Context around a log ID: `elastic_get_log_context`
