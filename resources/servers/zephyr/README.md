## Zephyr MCP Server (Zephyr Scale Cloud)

### Configure at runtime
Call `zephyr.configure` with Atlassian OAuth access token (in-memory only):
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
- Core: `zephyr.configure`, `zephyr.health`
- Discovery: `zephyr.getContext`, `zephyr.listFolders`
- Test cases: `zephyr.searchTestCases`, `zephyr.getTestCase`, `zephyr.createTestCase`, `zephyr.updateTestCase`
- Cycles/Executions: `zephyr.createTestCycle`, `zephyr.addTestsToCycle`, `zephyr.listTestExecutions`, `zephyr.updateExecutionStatus`
- Automation results: `zephyr.publishAutomationResults`

### Error shape
`{ "error": { "message": "...", "code": "AUTH_FAILED|PERMISSION_DENIED|NOT_FOUND|RATE_LIMITED|UNSUPPORTED_PRODUCT|INVALID_REQUEST|READ_ONLY_MODE|ZEPHYR_ERROR", "details": "...", "http_status": 400 } }`

### Notes
- Read-only mode can be enabled via `read_only` in `zephyr.configure` (create/update operations will be blocked).
- Attachment uploads are capped (~5MB) and batches are capped (500 results).
- MVP targets Zephyr Scale Cloud endpoints (`/rest/atm/1.0`). Zephyr Squad/Enterprise is out of scope for now.
