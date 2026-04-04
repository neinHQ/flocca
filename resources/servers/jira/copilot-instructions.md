# Jira Copilot Instructions

To ensure seamless and error-free Jira automation via MCP tools, strictly adhere to the following rules:

## 1. No Guessing Project Keys
**NEVER** hallucinate or invent a `projectKey`. 
Always use the `jira_get_create_metadata` tool, or `jira_list_projects` to discover valid projects in the workspace.

## 2. No Guessing Issue Types 
**NEVER** guess the `issueType` (e.g., Bug, Task, Story, Epic). 
Always rely on the `jira_get_create_metadata` tool to identify the available issue types for the chosen `projectKey`.

## 3. Creating Issues (Strict Workflow)
Before calling `jira_create_issue`, you MUST perform the following checks:
1. Verify the `projectKey` exists.
2. Call `jira_get_create_metadata` to retrieve the mandatory fields required for that specific `projectKey` and `issueType`.
3. Provide all required fields accurately based on the returned schema.

## 4. Status Transitions 
When closing, advancing, or reopening an issue via `jira_transition_issue`:
1. **NEVER** guess the `transition_id`.
2. First call `jira_list_transitions` for the specific `issue_key`.
3. Use the exact `id` returned by the transitions list to perform the status change.

## 5. Identifying the Current User
If assigning an issue to "me" or needing the current user's context, always fetch it using `jira_get_myself`. Do not assume usernames or account IDs.
