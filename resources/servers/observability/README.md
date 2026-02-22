## Observability MCP Server (Prometheus + Grafana)

### Configure at runtime
Call `observability_configure` with one or both backends:
```json
{
  "prometheus": {
    "url": "https://prometheus.example.com",
    "auth": { "type": "bearer", "token": "…" }
  },
  "grafana": {
    "url": "https://grafana.example.com",
    "auth": { "type": "api_key", "api_key": "…" },
    "default_folder": "Production"
  }
}
```
Config is in-memory only. Health checks: Prometheus `/api/v1/status/buildinfo`, Grafana `/api/health`.

### Tools
- `observability_health`
- `observability_configure`
- Prometheus: `observability_query_prometheus`, `observability_query_range`, `observability_list_prometheus_series`
- Grafana: `observability_list_dashboards`, `observability_get_dashboard`, `observability_render_panel_snapshot` (returns a render URL)
- Incident helpers: `observability_get_recent_alerts` (Prometheus alerts), `observability_get_service_health_summary` (error rate/latency/availability)

### Error shape
`{ "error": { "message": "...", "code": "OBS_ERROR|PROMETHEUS_ERROR|GRAFANA_ERROR|QUERY_TOO_BROAD|NOT_CONFIGURED", "http_status": 400, "details": "..." } }`

### Guardrails
- Max range ~3h for range queries; step/points capped (~5000)
- Max result size enforced by Prometheus defaults; avoid extremely fine steps over long windows

### Usage patterns
- Instant PromQL: `observability_query_prometheus` with `query`
- Range PromQL: `observability_query_range` with `start/end/step`
- List series/labels: `observability_list_prometheus_series`
- Dashboards: `observability_list_dashboards` (optional folder filter), `observability_get_dashboard`
- Alerts: `observability_get_recent_alerts`
- Quick service health: `observability_get_service_health_summary` (uses PromQL error rate/latency/availability)
