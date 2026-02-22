## Zephyr Enterprise MCP Server (Enterprise-only)

### Configure at runtime
Use `zephyr_enterprise_configure` (in-memory only):
```json
{
  "deployment": "enterprise",
  "base_url": "https://zephyr.company.com",
  "auth": { "type": "api_token", "username": "qa-admin", "token": "..." },
  "project": { "key": "ENG", "id": 42 },
  "read_only": false
}
```
Validation: `/public/rest/api/1.0/projects` for auth/version/project access. No secrets persisted or logged.

### Tools
- Core: `zephyr_enterprise_configure`, `zephyr_enterprise_health`
- Discovery: `zephyr_enterprise_get_context`, `zephyr_enterprise_list_projects`, `zephyr_enterprise_list_folders`
- Test cases: `zephyr_enterprise_search_test_cases`, `zephyr_enterprise_get_test_case`, `zephyr_enterprise_create_test_case`, `zephyr_enterprise_update_test_case`
- Cycles/Executions: `zephyr_enterprise_create_cycle`, `zephyr_enterprise_add_test_cases_to_cycle`, `zephyr_enterprise_list_executions`, `zephyr_enterprise_update_execution`
- Evidence: `zephyr_enterprise_attach_evidence` (size cap ~5MB)
- Automation ingest: `zephyr_enterprise_publish_automation_results` (batch cap ~2000)

### Error shape
`{ "error": { "message": "...", "code": "AUTH_FAILED|PERMISSION_DENIED|NOT_FOUND|RATE_LIMITED|INVALID_REQUEST|READ_ONLY_MODE|ZEPHYR_ENTERPRISE_ERROR", "details": "...", "http_status": 400 } }`

### Notes
- Separate server from Zephyr Scale to avoid API confusion.
- Read-only mode blocks create/update/ingest tools.
- Supports API token/basic auth; TLS assumed.
- Version stored from `/projects` response when available.
