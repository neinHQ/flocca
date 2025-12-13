## Docker MCP Server

### Configure at runtime
Call `docker.configure` first and supply daemon info (no persistence):
```json
{ "daemon": { "type": "local_socket", "socket_path": "/var/run/docker.sock" } }
```
or
```json
{ "daemon": { "type": "tcp", "host": "tcp://192.168.1.40:2375" } }
```
Server validates connectivity immediately; errors are returned in the normalized shape.

### Tools
- `docker.health`
- `docker.configure`
- `docker.listContainers`
- `docker.runContainer`
- `docker.stopContainer`
- `docker.removeContainer`
- `docker.exec`
- `docker.listImages`
- `docker.pullImage`
- `docker.buildImage`
- `docker.removeImage`
- `docker.getLogs`
- `docker.inspectContainer`
- `docker.listNetworks`
- `docker.createNetwork`
- `docker.removeNetwork`
- `docker.listVolumes`
- `docker.createVolume`
- `docker.removeVolume`

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
