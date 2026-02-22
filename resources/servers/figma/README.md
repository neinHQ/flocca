## Figma MCP Server

### Configure at runtime
Call `figma_configure` (in-memory only):
```json
{
  "auth": { "type": "pat", "token": "FIGMA_TOKEN" },
  "defaults": { "file_key": "AbCdEf123" }
}
```
Validation: `GET /v1/me`. No secrets persisted or logged.

### Tools
- Core: `figma_configure`, `figma_health`
- Discovery: `figma_get_file_metadata`, `figma_list_pages`, `figma_find_frames`
- QA layer: `figma_get_frame_spec` (inputs/buttons/toggles/texts), `figma_get_component_variants`, `figma_extract_design_tokens`
- Test enablement: `figma_suggest_test_scenarios`, `figma_generate_stable_selectors`
- Exports: `figma_export_frame_image`, `figma_export_node_images_batch`
- Versions: `figma_diff_versions` (placeholder summary)

### Error shape
`{ "error": { "message": "...", "code": "FIGMA_ERROR|AUTH_FAILED|RATE_LIMITED|INVALID_REQUEST|NOT_FOUND", "details": "...", "http_status": 400 } }`

### Notes
- Read-only operations; tokens kept in memory.
- Batch/image payloads capped (nodes ~500).
- Backend adapter pattern: REST today, can swap later.
