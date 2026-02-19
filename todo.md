# TODO

## Phase 2: Remote MCP Exposure to VS Code LM API

- Add LM provider support for remote MCP connections (`connectRemote`) in addition to local stdio servers.
- Align transport with VS Code MCP definition expectations (use compatible HTTP/streamable transport mapping).
- Register remote server definitions dynamically so Copilot/LM tools can discover them out of the box.
- Add tests to verify:
  - Remote definitions are registered on connect.
  - Remote definitions are removed on disconnect.
  - Tool discovery works for both local and remote connected MCP servers.
