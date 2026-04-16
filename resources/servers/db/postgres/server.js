const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { Client } = require('pg');

const SERVER_INFO = { name: 'postgres-mcp', version: '1.2.0' };

function createPostgresServer() {
    let sessionConfig = {
        host: process.env.POSTGRES_HOST || process.env.DB_HOST,
        port: parseInt(process.env.POSTGRES_PORT || process.env.DB_PORT || '5432', 10),
        user: process.env.POSTGRES_USER || process.env.DB_USER,
        password: process.env.POSTGRES_PASSWORD || process.env.DB_PASSWORD,
        database: process.env.POSTGRES_DATABASE || process.env.DB_NAME
    };

    function normalizeError(err) {
        const msg = err.message || JSON.stringify(err);
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: msg, code: err.code || 'DB_ERROR' }) }] };
    }

    let client = null;

    async function ensureConnected() {
        if (!client) {
            // Re-read env
            sessionConfig.host = process.env.POSTGRES_HOST || process.env.DB_HOST || sessionConfig.host;
            sessionConfig.port = parseInt(process.env.POSTGRES_PORT || process.env.DB_PORT || '5432', 10);
            sessionConfig.user = process.env.POSTGRES_USER || process.env.DB_USER || sessionConfig.user;
            sessionConfig.password = process.env.POSTGRES_PASSWORD || process.env.DB_PASSWORD || sessionConfig.password;
            sessionConfig.database = process.env.POSTGRES_DATABASE || process.env.DB_NAME || sessionConfig.database;

            if (sessionConfig.host) {
                client = new Client({
                    host: sessionConfig.host,
                    port: sessionConfig.port,
                    user: sessionConfig.user,
                    password: sessionConfig.password,
                    database: sessionConfig.database,
                    ssl: sessionConfig.host.includes('localhost') ? false : { rejectUnauthorized: false }
                });
                await client.connect();
            } else {
                throw new Error('Database not connected. Provide environment variables or call db_connect first.');
            }
        }
        return client;
    }

    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    // --- Core ---

    server.tool('db_connect',
        {
            host: z.string().describe('Postgres host'),
            port: z.number().int().default(5432).describe('Postgres port'),
            user: z.string().describe('Postgres username'),
            password: z.string().describe('Postgres password'),
            database: z.string().describe('Database name')
        },
        async (args) => {
            try {
                if (client) await client.end().catch(() => {});
                sessionConfig = { ...args };
                client = new Client({
                    host: args.host,
                    port: args.port,
                    user: args.user,
                    password: args.password,
                    database: args.database,
                    ssl: args.host.includes('localhost') ? false : { rejectUnauthorized: false }
                });
                await client.connect();
                return { content: [{ type: 'text', text: `Successfully connected to Postgres database '${args.database}'.` }] };
            } catch (e) {
                client = null;
                return normalizeError(e);
            }
        }
    );

    server.tool('postgres_health', {}, async () => {
        try {
            const c = await ensureConnected();
            await c.query('SELECT 1');
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, connected: true }) }] };
        } catch (e) { return normalizeError(e); }
    });

    // --- Introspection ---

    server.tool('db_list_tables', {}, async () => {
        try {
            const c = await ensureConnected();
            const res = await c.query(`
                SELECT table_name, table_schema
                FROM information_schema.tables
                WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
                ORDER BY table_schema, table_name
            `);
            return { content: [{ type: 'text', text: JSON.stringify(res.rows) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('db_get_schema',
        { schema_name: z.string().default('public') },
        async (args) => {
            try {
                const c = await ensureConnected();
                const res = await c.query(`
                    SELECT t.table_name, c.column_name, c.data_type, c.is_nullable
                    FROM information_schema.tables t
                    JOIN information_schema.columns c
                        ON t.table_name = c.table_name AND t.table_schema = c.table_schema
                    WHERE t.table_schema = $1
                    ORDER BY t.table_name, c.ordinal_position
                `, [args.schema_name]);
                const schema = res.rows.reduce((acc, row) => {
                    if (!acc[row.table_name]) acc[row.table_name] = [];
                    acc[row.table_name].push({ column: row.column_name, type: row.data_type, nullable: row.is_nullable === 'YES' });
                    return acc;
                }, {});
                return { content: [{ type: 'text', text: JSON.stringify(schema, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('db_describe_table',
        { table_name: z.string(), schema_name: z.string().default('public') },
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
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- Execution ---

    server.tool('db_query',
        {
            text: z.string().describe('The SQL query to execute'),
            params: z.array(z.any()).optional().describe('Query parameters for parameterized queries'),
            confirm: z.boolean().optional().describe('Must be true for destructive operations')
        },
        async (args) => {
            try {
                const c = await ensureConnected();
                const upper = args.text.trim().toUpperCase();
                const isDestructive = /INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE/.test(upper);
                if (isDestructive && !args.confirm) {
                    return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set 'confirm: true' to execute destructive queries." }] };
                }
                let finalQuery = args.text;
                if (upper.startsWith('SELECT') && !upper.includes('LIMIT')) finalQuery += ' LIMIT 100';
                const res = await c.query(finalQuery, args.params || []);
                return { content: [{ type: 'text', text: JSON.stringify({ command: res.command, rowCount: res.rowCount, rows: res.rows }, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.__test = {
        sessionConfig,
        normalizeError,
        ensureConnected,
        setConfig: (next) => { Object.assign(sessionConfig, next); client = null; },
        getConfig: () => ({ ...sessionConfig })
    };

    return server;
}

if (require.main === module) {
    const serverInstance = createPostgresServer();
    const transport = new StdioServerTransport();
    serverInstance.connect(transport).then(() => {
        console.error('Postgres MCP server running on stdio');
    }).catch((error) => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createPostgresServer, Client };
