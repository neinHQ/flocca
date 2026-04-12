const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { Client } = require('pg');

let client = null;

function normalizeError(err) {
    const msg = err.message || JSON.stringify(err);
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: msg, code: err.code || 'DB_ERROR' }) }] };
}

async function ensureConnected() {
    if (!client) throw new Error("Database not connected. Call db_connect first.");
    return client;
}

function createPostgresServer() {
    const server = new McpServer({
        name: "postgres-mcp",
        version: "1.1.0"
    });

    // --- Core Tools ---

    server.tool("db_connect",
        {
            connectionString: z.string().describe("Postgres connection string (postgres://user:pass@host:port/db)")
        },
        async (args) => {
            try {
                if (client) {
                    await client.end().catch(() => {});
                }
                client = new Client({
                    connectionString: args.connectionString,
                    ssl: args.connectionString.includes('localhost') ? false : { rejectUnauthorized: false }
                });
                await client.connect();
                return { content: [{ type: 'text', text: "Successfully connected to Postgres." }] };
            } catch (e) {
                client = null;
                return normalizeError(e);
            }
        }
    );

    server.tool("postgres_health", {}, async () => {
        try {
            const c = await ensureConnected();
            await c.query('SELECT 1');
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, connected: true }) }] };
        } catch (e) {
            return normalizeError(e);
        }
    });

    // --- Introspection Pillar ---

    server.tool("db_list_tables", {}, async () => {
        try {
            const c = await ensureConnected();
            const res = await c.query(`
                SELECT table_name, table_schema 
                FROM information_schema.tables 
                WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
                ORDER BY table_schema, table_name
            `);
            return { content: [{ type: 'text', text: JSON.stringify(res.rows) }] };
        } catch (e) {
            return normalizeError(e);
        }
    });

    server.tool("db_get_schema", 
        {
            schema_name: z.string().default('public')
        },
        async (args) => {
            try {
                const c = await ensureConnected();
                const res = await c.query(`
                    SELECT 
                        t.table_name, 
                        c.column_name, 
                        c.data_type, 
                        c.is_nullable
                    FROM information_schema.tables t
                    JOIN information_schema.columns c ON t.table_name = c.table_name 
                        AND t.table_schema = c.table_schema
                    WHERE t.table_schema = $1
                    ORDER BY t.table_name, c.ordinal_position
                `, [args.schema_name]);
                
                // Group by table
                const schema = res.rows.reduce((acc, row) => {
                    if (!acc[row.table_name]) acc[row.table_name] = [];
                    acc[row.table_name].push({
                        column: row.column_name,
                        type: row.data_type,
                        nullable: row.is_nullable === 'YES'
                    });
                    return acc;
                }, {});

                return { content: [{ type: 'text', text: JSON.stringify(schema, null, 2) }] };
            } catch (e) {
                return normalizeError(e);
            }
        }
    );

    server.tool("db_describe_table",
        {
            table_name: z.string(),
            schema_name: z.string().default('public')
        },
        async (args) => {
            try {
                const c = await ensureConnected();
                const res = await c.query(`
                    SELECT column_name, data_type, column_default, is_nullable
                    FROM information_schema.columns
                    WHERE table_name = $1 AND table_schema = $2
                    ORDER BY ordinal_position
                `, [args.table_name, args.schema_name]);
                return { content: [{ type: 'text', text: JSON.stringify(res.rows, null, 2) }] };
            } catch (e) {
                return normalizeError(e);
            }
        }
    );

    // --- Execution Pillar ---

    server.tool("db_query",
        {
            text: z.string().describe("The SQL query to execute"),
            params: z.array(z.any()).optional().describe("Query parameters for parameterized queries"),
            confirm: z.boolean().optional().describe("Must be true for destructive operations (INSERT, UPDATE, DELETE, etc.)")
        },
        async (args) => {
            try {
                const c = await ensureConnected();
                const query = args.text.trim().toUpperCase();
                const isDestructive = /INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE/.test(query);

                if (isDestructive && !args.confirm) {
                    return {
                        isError: true,
                        content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: This query appears to be destructive. Please set 'confirm: true' to execute." }]
                    };
                }

                // Append LIMIT 100 to SELECT queries if not present
                let finalQuery = args.text;
                if (query.startsWith('SELECT') && !query.includes('LIMIT')) {
                    finalQuery += ' LIMIT 100';
                }

                const res = await c.query(finalQuery, args.params || []);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            command: res.command,
                            rowCount: res.rowCount,
                            rows: res.rows
                        }, null, 2)
                    }]
                };
            } catch (e) {
                return normalizeError(e);
            }
        }
    );

    return server;
}

if (require.main === module) {
    const server = createPostgresServer();
    const transport = new StdioServerTransport();
    server.connect(transport).then(() => {
        console.error('Postgres MCP server running on stdio');
    }).catch((error) => {
        console.error("Server error:", error);
        process.exit(1);
    });
}

module.exports = { createPostgresServer, Client };
