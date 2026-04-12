## Postgres MCP Server

### Configuration
Call `db_connect` with a valid Postgres connection string:
```json
{
  "connectionString": "postgres://user:password@localhost:5432/mydb"
}
```
*   **Security**: Connection and SSL handling are managed by the `pg` driver. SSL is enabled by default for non-localhost connections.

### Tools
- **Core**: `db_connect`, `postgres_health`
- **Introspection (SDET/Dev)**:
    - `db_list_tables`: Lists all tables in the environment.
    - `db_get_schema`: Returns a grouped map of tables and their columns/types.
    - `db_describe_table`: Detailed view of constraints and defaults for a specific table.
- **Execution**: 
    - `db_query`: Execute SQL queries with parameter support.

### Safety & Hardening
1. **Destructive Detection**: Any query containing `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, or `CREATE` requires the `confirm: true` parameter.
2. **Context Safety**: `SELECT` queries are automatically appended with `LIMIT 100` if no limit is specified, preventing large data dumps from overwhelming the AI context window.
3. **Strict Validation**: All inputs are validated via Zod.
