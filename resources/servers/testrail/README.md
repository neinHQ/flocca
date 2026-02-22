## TestRail MCP Server

### Configure at runtime
Call `testrail_configure` first:
```json
{
  "base_url": "https://mycompany.testrail.io",
  "auth": { "type": "apikey", "username": "qa@company.com", "api_key": "…" },
  "project_id": 10,
  "suite_id": 5,
  "run_defaults": { "include_all": false }
}
```
Values are stored in memory only for the session.

### Tools
- `testrail_health`
- `testrail_configure`
- `testrail_list_test_cases`
- `testrail_get_test_case`
- `testrail_create_test_case`
- `testrail_create_test_run`
- `testrail_close_test_run`
- `testrail_add_test_result`
- `testrail_map_automated_results` (batch add results for cases in a run)
- `testrail_search_cases`
- `testrail_search_runs`
- `testrail_list_test_plans` (phase-2 placeholder)

### Error shape
All errors return:
```json
{ "error": { "message": "...", "code": 400, "details": "..." } }
```
Auth objects are never returned or logged.

### Example workflows
- Run Pytest/Playwright → `testrail_create_test_run` → `testrail_map_automated_results` → `testrail_close_test_run`
- Generate new cases → `testrail_create_test_case` → include in runs
