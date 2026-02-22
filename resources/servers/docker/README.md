## Docker MCP Server

### Configure at runtime
Call `docker_configure` first and supply daemon info (no persistence):
```json
{ "daemon": { "type": "local_socket", "socket_path": "/var/run/docker.sock" } }
```
or
```json
{ "daemon": { "type": "tcp", "host": "tcp://192.168.1.40:2375" } }
```
Server validates connectivity immediately; errors are returned in the normalized shape.

### Tools
- `docker_health`
- `docker_configure`
- `docker_list_containers`
- `docker_run_container`
- `docker_stop_container`
- `docker_remove_container`
- `docker_exec`
- `docker_list_images`
- `docker_pull_image`
- `docker_build_image`
- `docker_remove_image`
- `docker_get_logs`
- `docker_inspect_container`
- `docker_list_networks`
- `docker_create_network`
- `docker_remove_network`
- `docker_list_volumes`
- `docker_create_volume`
- `docker_remove_volume`

### Error shape
All failures return:
```json
{ "error": { "message": "...", "code": "SOME_CODE", "details": "..." } }
```
Common codes: `PERMISSION_DENIED`, `DAEMON_UNREACHABLE`, `CONTAINER_NOT_FOUND`, `IMAGE_MISSING`.

### Notes
- No credentials or paths are persisted.
- Mount safety: only mounts you provide are used.
- Uses docker CLI under the hood, honoring the configured daemon (`-H`).
