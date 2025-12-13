## Observability MCP Server (Prometheus + Grafana)

### Configure at runtime
Call `observability.configure` with one or both backends:
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
- `observability.health`
- `observability.configure`
- Prometheus: `observability.queryPrometheus`, `observability.queryRange`, `observability.listPrometheusSeries`
- Grafana: `observability.listDashboards`, `observability.getDashboard`, `observability.renderPanelSnapshot` (returns a render URL)
- Incident helpers: `observability.getRecentAlerts` (Prometheus alerts), `observability.getServiceHealthSummary` (error rate/latency/availability)

### Error shape
`{ "error": { "message": "...", "code": "OBS_ERROR|PROMETHEUS_ERROR|GRAFANA_ERROR|QUERY_TOO_BROAD|NOT_CONFIGURED", "http_status": 400, "details": "..." } }`

### Guardrails
- Max range ~3h for range queries; step/points capped (~5000)
- Max result size enforced by Prometheus defaults; avoid extremely fine steps over long windows

### Usage patterns
- Instant PromQL: `observability.queryPrometheus` with `query`
- Range PromQL: `observability.queryRange` with `start/end/step`
- List series/labels: `observability.listPrometheusSeries`
- Dashboards: `observability.listDashboards` (optional folder filter), `observability.getDashboard`
- Alerts: `observability.getRecentAlerts`
- Quick service health: `observability.getServiceHealthSummary` (uses PromQL error rate/latency/availability)
