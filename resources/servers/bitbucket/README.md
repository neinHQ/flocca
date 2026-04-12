## Bitbucket MCP Server

### Configuration
Set environment variables or call `bitbucket_configure`:
* `BITBUCKET_USERNAME`
* `BITBUCKET_PASSWORD` (App Password)
* `BITBUCKET_WORKSPACE` (Default workspace)

### Tools
- **Core**: `bitbucket_configure`, `bitbucket_health`
- **Git**: `bitbucket_list_repositories`, `bitbucket_list_branches`, `bitbucket_get_repository_tree`, `bitbucket_get_file_content`, `bitbucket_create_branch`
- **Pull Requests**: `bitbucket_create_pull_request`, `bitbucket_list_pull_requests`, `bitbucket_get_pull_request_diff`, `bitbucket_add_pull_request_comment`
- **Pipelines**: `bitbucket_run_pipeline`, `bitbucket_get_pipeline_logs`
- **Discovery**: `bitbucket_list_workspaces`, `bitbucket_list_deployments`

### Notes
- Supports both **Bitbucket Cloud** and **Bitbucket Server** (Data Center).
- Migrated to the official MCP SDK with Zod validation.
- All listing tools support pagination via `pagelen` and `page`.
