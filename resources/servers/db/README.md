# Database MCP Servers

This directory contains database-specific Model Context Protocol (MCP) servers. Flocca connects these robust integrations to AI agents safely.

### Supported Databases

-   **PostgreSQL** (`/postgres`): Relational introspection and execution.
-   **MySQL & MariaDB** (`/mysql`): Native connection, schema insights, limits-enforced querying.
-   **MongoDB** (`/mongodb`): Document query operations and precise collection-level read/write tools.
-   **Redis** (`/redis`): Fast key-value inspection, cache modification, TTL analysis, and Hash/List operations.
-   **Elasticsearch** (`/elasticsearch`): Data mapping and search DSL testing/automation.
-   **DynamoDB** (`/dynamodb`): AWS fully managed tables, Get/Put/Delete Item, Query, and Scan endpoints.

### Universal Safety Features

All Flocca database servers are built with built-in telemetry validation and the following unified safety patterns:

1.  **Destructive Ops Gating**: Any query or operation resulting in `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER` modification mandates a `"confirm": true` argument sent by the LLM (requires user-side awareness).
2.  **Context Overflows Prevention**: Automatic limits are inserted into payload parsing. `SELECT` calls missing a `LIMIT` implicitly get capped to prevent breaking the MCP communication channel.
3.  **Strict Validation**: Input is securely sanitized through `Zod` validation.
