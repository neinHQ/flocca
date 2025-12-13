## Azure DevOps MCP Server

### Configure at runtime
Call the `azuredevops.configure` tool before any other tool:

```json
{
  "service_url": "https://dev.azure.com/myorg",
  "project": "myproject",
  "token": "<PAT or OAuth token>"
}
```

Values are kept in-memory only for the session (no persistence, no logging of tokens).

### Tool reference
- `azuredevops.health` — health check, returns `{ "ok": true }`
- `azuredevops.configure` — set service URL, project, and token for this session
- `azuredevops.listRepositories`
- `azuredevops.getRepositoryItems` — params: `repository_id`, `path`, `recursionLevel (none|oneLevel|full)`, optional `version`
- `azuredevops.getFileContent` — params: `repository_id`, `path`, optional `version`
- `azuredevops.createBranch` — params: `repository_id`, `source_branch`, `new_branch`
- `azuredevops.createPullRequest` — params: `repository_id`, `source_branch`, `target_branch`, `title`, `description?`
- `azuredevops.listWorkItems` — params: `wiql` (string)
- `azuredevops.getWorkItem` — params: `id`
- `azuredevops.updateWorkItem` — params: `id`, `fields` object (atomic update)
- `azuredevops.runPipeline` — params: `pipeline_id`, `branch`
- `azuredevops.getPipelineRuns` — params: `pipeline_id`
- `azuredevops.getPipelineRunStatus` — params: `pipeline_id`, `run_id`

### Workflows
- **Create PR from work item**: configure → listWorkItems (WIQL) → getWorkItem (details) → listRepositories → createBranch → apply patches → createPullRequest → updateWorkItem with PR link.
- **Trigger CI on branch**: configure → runPipeline (pipeline_id + branch) → poll with getPipelineRunStatus.

### Errors
All failures return `{ "error": { "message": string, "code": number, "details": string, "operation?": string } }` — tokens are never logged or returned.
