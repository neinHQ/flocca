## Elastic / OpenSearch MCP Server

### Configure at runtime
Call `elastic.configure` first (no persistence):
```json
{
  "url": "https://es.company.com:9200",
  "auth": { "type": "basic", "username": "observer", "password": "…" },
  "default_indices": ["logs-*"]
}
```
Supports `basic`, `bearer`, or `api_key` auth.

### Tools
- `elastic.health`
- `elastic.configure`
- `elastic.listIndices`
- `elastic.getIndexStats`
- `elastic.getMappings`
- `elastic.searchLogs` (query_string + optional time_range)
- `elastic.searchStructured` (raw JSON body)
- `elastic.aggregate`
- `elastic.findRecentErrors` (service + time range, level=ERROR)
- `elastic.getLogContext` (doc + before/after)

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
- Find service errors in last 15m: `elastic.findRecentErrors` with `service` and `time_range`
- Freeform search: `elastic.searchLogs` with query_string
- Structured queries/aggregations: `elastic.searchStructured` / `elastic.aggregate`
- Context around a log ID: `elastic.getLogContext`
