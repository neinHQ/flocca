## Figma MCP Server

### Configure at runtime
Call `figma.configure` (in-memory only):
```json
{
  "auth": { "type": "pat", "token": "FIGMA_TOKEN" },
  "defaults": { "file_key": "AbCdEf123" }
}
```
Validation: `GET /v1/me`. No secrets persisted or logged.

### Tools
- Core: `figma.configure`, `figma.health`
- Discovery: `figma.getFileMetadata`, `figma.listPages`, `figma.findFrames`
- QA layer: `figma.getFrameSpec` (inputs/buttons/toggles/texts), `figma.getComponentVariants`, `figma.extractDesignTokens`
- Test enablement: `figma.suggestTestScenarios`, `figma.generateStableSelectors`
- Exports: `figma.exportFrameImage`, `figma.exportNodeImagesBatch`
- Versions: `figma.diffVersions` (placeholder summary)

### Error shape
`{ "error": { "message": "...", "code": "FIGMA_ERROR|AUTH_FAILED|RATE_LIMITED|INVALID_REQUEST|NOT_FOUND", "details": "...", "http_status": 400 } }`

### Notes
- Read-only operations; tokens kept in memory.
- Batch/image payloads capped (nodes ~500).
- Backend adapter pattern: REST today, can swap later.
