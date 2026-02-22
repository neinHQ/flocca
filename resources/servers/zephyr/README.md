## Zephyr MCP Server (Zephyr Scale Cloud)

### Configure at runtime
Call `zephyr_configure` with Atlassian OAuth access token (in-memory only):
```json
{
  "deployment": "cloud",
  "site_url": "https://your-domain.atlassian.net",
  "auth": { "type": "atlassian_oauth", "access_token": "..." },
  "jira": { "project_key": "ENG" },
  "zephyr": {
    "default_test_project_key": "ENG",
    "default_folder_id": "optional"
  }
}
```
Validation: Jira `/rest/api/3/myself` + Zephyr Scale capability check. No secrets are persisted or logged.

### Tools
- Core: `zephyr_configure`, `zephyr_health`
- Discovery: `zephyr_get_context`, `zephyr_list_folders`
- Test cases: `zephyr_search_test_cases`, `zephyr_get_test_case`, `zephyr_create_test_case`, `zephyr_update_test_case`
- Cycles/Executions: `zephyr_create_test_cycle`, `zephyr_add_tests_to_cycle`, `zephyr_list_test_executions`, `zephyr_update_execution_status`
- Automation results: `zephyr_publish_automation_results`

### Error shape
`{ "error": { "message": "...", "code": "AUTH_FAILED|PERMISSION_DENIED|NOT_FOUND|RATE_LIMITED|UNSUPPORTED_PRODUCT|INVALID_REQUEST|READ_ONLY_MODE|ZEPHYR_ERROR", "details": "...", "http_status": 400 } }`

### Notes
- Read-only mode can be enabled via `read_only` in `zephyr_configure` (create/update operations will be blocked).
- Attachment uploads are capped (~5MB) and batches are capped (500 results).
- MVP targets Zephyr Scale Cloud endpoints (`/rest/atm/1.0`). Zephyr Squad/Enterprise is out of scope for now.
