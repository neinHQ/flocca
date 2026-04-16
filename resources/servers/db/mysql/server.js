const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const mysql = require('mysql2/promise');

const SERVER_INFO = { name: 'mysql-mcp', version: '1.0.0' };

function createMysqlServer() {
    let sessionConfig = {
        host: process.env.MYSQL_HOST,
        port: parseInt(process.env.MYSQL_PORT || '3306', 10),
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    };

    function normalizeError(err) {
        const msg = err.message || JSON.stringify(err);
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: msg, code: err.code || 'MYSQL_ERROR' }) }] };
    }

    let connection = null;

    async function ensureConnected() {
        if (!connection) {
            // Re-read env
            sessionConfig.host = process.env.MYSQL_HOST || sessionConfig.host;
            sessionConfig.port = parseInt(process.env.MYSQL_PORT || '3306', 10);
            sessionConfig.user = process.env.MYSQL_USER || sessionConfig.user;
            sessionConfig.password = process.env.MYSQL_PASSWORD || sessionConfig.password;
            sessionConfig.database = process.env.MYSQL_DATABASE || sessionConfig.database;

            if (sessionConfig.host) {
                connection = await mysql.createConnection({
                    host: sessionConfig.host,
                    port: sessionConfig.port,
                    user: sessionConfig.user,
                    password: sessionConfig.password,
                    database: sessionConfig.database,
                    multipleStatements: true
                });
            } else {
                throw new Error('Database not connected. Provide environment variables or call mysql_connect first.');
            }
        }
        return connection;
    }

    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    // --- Core ---

    server.tool('mysql_connect',
        {
            host: z.string().describe('MySQL host'),
            port: z.number().int().default(3306).describe('MySQL port'),
            user: z.string().describe('MySQL username'),
            password: z.string().describe('MySQL password'),
            database: z.string().describe('Database name')
        },
        async (args) => {
            try {
                if (connection) await connection.end().catch(() => {});
                sessionConfig = { ...args };
                connection = await mysql.createConnection({
                    host: args.host,
                    port: args.port,
                    user: args.user,
                    password: args.password,
                    database: args.database,
                    multipleStatements: true
                });
                return { content: [{ type: 'text', text: `Successfully connected to MySQL database '${args.database}'.` }] };
            } catch (e) {
                connection = null;
                return normalizeError(e);
            }
        }
    );

    server.tool('mysql_health', {}, async () => {
        try {
            const c = await ensureConnected();
            await c.query('SELECT 1');
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, connected: true }) }] };
        } catch (e) { return normalizeError(e); }
    });

    // --- Introspection ---

    server.tool('mysql_list_tables', {}, async () => {
        try {
            const c = await ensureConnected();
            const [rows] = await c.query('SHOW TABLES');
            return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('mysql_get_schema',
        { database: z.string().optional().describe('Database name (defaults to active database)') },
        async (args) => {
            try {
                const c = await ensureConnected();
                const dbFilter = args.database ? 'AND TABLE_SCHEMA = ?' : 'AND TABLE_SCHEMA = DATABASE()';
                const params = args.database ? [args.database] : [];
                const [rows] = await c.query(`
                    SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
                    FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_SCHEMA NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')
                    ${dbFilter}
                    ORDER BY TABLE_NAME, ORDINAL_POSITION
                `, params);
                const schema = rows.reduce((acc, row) => {
                    if (!acc[row.TABLE_NAME]) acc[row.TABLE_NAME] = [];
                    acc[row.TABLE_NAME].push({ column: row.COLUMN_NAME, type: row.DATA_TYPE, nullable: row.IS_NULLABLE === 'YES' });
                    return acc;
                }, {});
                return { content: [{ type: 'text', text: JSON.stringify(schema, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('mysql_describe_table',
        { table_name: z.string().describe('Table name to describe') },
        async (args) => {
            try {
                const c = await ensureConnected();
                const [rows] = await c.query('DESCRIBE ??', [args.table_name]);
                return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- Execution ---

    server.tool('mysql_query',
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
                const [rows] = await c.query(finalQuery, args.params || []);
                return { content: [{ type: 'text', text: JSON.stringify({ rowCount: Array.isArray(rows) ? rows.length : rows.affectedRows, rows: Array.isArray(rows) ? rows : [] }, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.__test = {
        sessionConfig,
        normalizeError,
        ensureConnected,
        setConfig: (next) => { Object.assign(sessionConfig, next); connection = null; },
        getConfig: () => ({ ...sessionConfig })
    };

    return server;
}

if (require.main === module) {
    const serverInstance = createMysqlServer();
    const transport = new StdioServerTransport();
    serverInstance.connect(transport).then(() => {
        console.error('MySQL MCP server running on stdio');
    }).catch((error) => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createMysqlServer };
