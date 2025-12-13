## Zephyr Enterprise MCP Server (Enterprise-only)

### Configure at runtime
Use `zephyr_enterprise.configure` (in-memory only):
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
- Core: `zephyr_enterprise.configure`, `zephyr_enterprise.health`
- Discovery: `zephyr_enterprise.getContext`, `zephyr_enterprise.listProjects`, `zephyr_enterprise.listFolders`
- Test cases: `zephyr_enterprise.searchTestCases`, `zephyr_enterprise.getTestCase`, `zephyr_enterprise.createTestCase`, `zephyr_enterprise.updateTestCase`
- Cycles/Executions: `zephyr_enterprise.createCycle`, `zephyr_enterprise.addTestCasesToCycle`, `zephyr_enterprise.listExecutions`, `zephyr_enterprise.updateExecution`
- Evidence: `zephyr_enterprise.attachEvidence` (size cap ~5MB)
- Automation ingest: `zephyr_enterprise.publishAutomationResults` (batch cap ~2000)

### Error shape
`{ "error": { "message": "...", "code": "AUTH_FAILED|PERMISSION_DENIED|NOT_FOUND|RATE_LIMITED|INVALID_REQUEST|READ_ONLY_MODE|ZEPHYR_ENTERPRISE_ERROR", "details": "...", "http_status": 400 } }`

### Notes
- Separate server from Zephyr Scale to avoid API confusion.
- Read-only mode blocks create/update/ingest tools.
- Supports API token/basic auth; TLS assumed.
- Version stored from `/projects` response when available.
