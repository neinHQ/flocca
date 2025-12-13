## TestRail MCP Server

### Configure at runtime
Call `testrail.configure` first:
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
- `testrail.health`
- `testrail.configure`
- `testrail.listTestCases`
- `testrail.getTestCase`
- `testrail.createTestCase`
- `testrail.createTestRun`
- `testrail.closeTestRun`
- `testrail.addTestResult`
- `testrail.mapAutomatedResults` (batch add results for cases in a run)
- `testrail.searchCases`
- `testrail.searchRuns`
- `testrail.listTestPlans` (phase-2 placeholder)

### Error shape
All errors return:
```json
{ "error": { "message": "...", "code": 400, "details": "..." } }
```
Auth objects are never returned or logged.

### Example workflows
- Run Pytest/Playwright → `testrail.createTestRun` → `testrail.mapAutomatedResults` → `testrail.closeTestRun`
- Generate new cases → `testrail.createTestCase` → include in runs
