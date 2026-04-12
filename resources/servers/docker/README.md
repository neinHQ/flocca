## Docker MCP Server

### Configuration
Call `docker_configure` or set the `DOCKER_HOST` environment variable:
* `DOCKER_HOST`: Path to the Docker socket (e.g., `unix:///var/run/docker.sock`) or TCP host.

### Tools
- **Core**: `docker_health`, `docker_configure`
- **Containers**: `docker_run_container`, `docker_stop_container`, `docker_remove_container`, `docker_list_containers`, `docker_exec`, `docker_inspect_container`
- **Images**: `docker_list_images`, `docker_pull_image`, `docker_build_image`, `docker_remove_image`
- **Infrastructure (Cleanup)**:
    - `docker_system_prune`: Remove unused data (containers, networks, images).
    - `docker_image_prune`: Remove dangling or unused images.
- **Observability (DevOps)**: 
    - `docker_container_stats`: Get real-time CPU, Memory, and Network usage.
    - `docker_get_logs`: Retrieve container logs with tailing support.
    - `docker_system_info`: Detailed system-wide information and configuration.
- **Utility**:
    - `docker_cp`: Copy files/folders between the host and containers.
    - `docker_top`: List processes running inside a container.
- **Networking & Volumes**: `docker_list_networks`, `docker_list_volumes`

### Hardening
1. **Safety**: All destructive or high-resource tasks (pruning) are explicit and require confirmation via arguments where applicable.
2. **SDK Migration**: Fully refactored to use the official **MCP SDK** for better stability and protocol compliance.
3. **Validation**: All tool inputs are strictly validated.
