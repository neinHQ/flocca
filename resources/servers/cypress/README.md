## Cypress MCP Server

### Configuration
Call `cypress_configure` or set environment variables:
* `CYPRESS_PROJECT_ROOT`: Absolute path to your Cypress project.
* `CYPRESS_EXEC_PATH`: Path to cypress binary (default: `npx`).
* `CYPRESS_BROWSER`: Default browser (default: `chrome`).

### Tools
- **Core**: `cypress_health`, `cypress_configure`
- **Execution**: `cypress_run_spec`, `cypress_run_all`, `cypress_list_specs`
- **Environment**: `cypress_list_browsers`, `cypress_verify` (doctor)
- **Observability (SDET Focus)**: 
    - `cypress_get_failed_tests`: Extract clean error summaries and stack traces from JSON reports.
    - `cypress_get_video`, `cypress_get_screenshot`: Retrieve artifact paths for debugging.

### Notes
- Migrated to official **MCP SDK** with robust **Zod validation**.
- Standardized for high-scale enterprise testing projects.
- Improved JSON result extraction to handle mixed console output.
