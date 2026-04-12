## Azure DevOps MCP Server

### Configure at runtime
Call the `azuredevops_configure` tool before any other tool:

```json
{
  "service_url": "https://dev.azure.com/myorg",
  "project": "myproject",
  "token": "<PAT or OAuth token>"
}
```

Values are kept in-memory only for the session (no persistence, no logging of tokens).

### Tool reference
- `azuredevops_health` — health check, returns `{ "ok": true }`
- `azuredevops_configure` — set service URL, project, and token for this session
- `azuredevops_list_repositories`
- `azuredevops_get_repository_items` — params: `repository_id`, `path`, `recursionLevel (none|oneLevel|full)`, optional `version`
- `azuredevops_get_file_content` — params: `repository_id`, `path`, optional `version`
- `azuredevops_create_branch` — params: `repository_id`, `source_branch`, `new_branch`
- `azuredevops_create_pull_request` — params: `repository_id`, `source_branch`, `target_branch`, `title`, `description?`
- **Work Items**: `azuredevops_create_work_item`, `azuredevops_add_work_item_comment`, `azuredevops_query_work_items` (Helper), `azuredevops_list_work_items` (WIQL), `azuredevops_get_work_item`, `azuredevops_update_work_item`
- **Pipelines**: `azuredevops_list_pipelines`, `azuredevops_run_pipeline`, `azuredevops_get_pipeline_runs`, `azuredevops_get_pipeline_run_status`, `azuredevops_get_build_logs`
- **Testing (SDET)**: `azuredevops_list_test_plans`, `azuredevops_list_test_suites`, `azuredevops_list_test_runs`, `azuredevops_get_test_run_results`
- **Discovery**: `azuredevops_list_projects`, `azuredevops_list_releases`

### Workflows
- **Create PR from work item**: configure → listWorkItems (WIQL) → getWorkItem (details) → listRepositories → createBranch → apply patches → createPullRequest → updateWorkItem with PR link.
- **Trigger CI on branch**: configure → runPipeline (pipeline_id + branch) → poll with getPipelineRunStatus.

### Errors
All failures return `{ "error": { "message": string, "code": number, "details": string, "operation?": string } }` — tokens are never logged or returned.
