const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const {
    DynamoDBClient,
    ListTablesCommand,
    DescribeTableCommand,
    GetItemCommand,
    PutItemCommand,
    DeleteItemCommand,
    QueryCommand,
    ScanCommand
} = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const SERVER_INFO = { name: 'dynamodb-mcp', version: '1.0.0' };

function createDynamoServer() {
    let sessionConfig = {
        region: process.env.AWS_REGION,
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        endpoint: process.env.DYNAMODB_ENDPOINT // Custom env for DynamoDB local
    };

    function normalizeError(err) {
        const msg = err.message || JSON.stringify(err);
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: msg, code: err.name || 'DYNAMO_ERROR' }) }] };
    }

    let dynamo = null;

    async function ensureConnected() {
        if (!dynamo) {
            // Re-read env if not explicitly set
            sessionConfig.region = process.env.AWS_REGION || sessionConfig.region;
            sessionConfig.accessKeyId = process.env.AWS_ACCESS_KEY_ID || sessionConfig.accessKeyId;
            sessionConfig.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || sessionConfig.secretAccessKey;
            
            const region = sessionConfig.region;
            if (region) {
                const config = { region: region };
                if (sessionConfig.accessKeyId && sessionConfig.secretAccessKey) {
                    config.credentials = {
                        accessKeyId: sessionConfig.accessKeyId,
                        secretAccessKey: sessionConfig.secretAccessKey
                    };
                }
                if (sessionConfig.endpoint) config.endpoint = sessionConfig.endpoint;
                dynamo = new DynamoDBClient(config);
            } else {
                throw new Error('DynamoDB not connected. Provide environment variables or call dynamo_connect first.');
            }
        }
        return dynamo;
    }

    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    // --- Core ---

    server.tool('dynamo_connect',
        {
            region: z.string().default('us-east-1').describe('AWS region'),
            access_key_id: z.string().optional().describe('AWS Access Key ID (falls back to env/profile)'),
            secret_access_key: z.string().optional().describe('AWS Secret Access Key'),
            endpoint: z.string().optional().describe('Custom endpoint URL (e.g. http://localhost:8000 for DynamoDB Local)')
        },
        async (args) => {
            try {
                const config = { region: args.region };
                sessionConfig.region = args.region;
                if (args.access_key_id && args.secret_access_key) {
                    sessionConfig.accessKeyId = args.access_key_id;
                    sessionConfig.secretAccessKey = args.secret_access_key;
                    config.credentials = { accessKeyId: args.access_key_id, secretAccessKey: args.secret_access_key };
                }
                if (args.endpoint) {
                    sessionConfig.endpoint = args.endpoint;
                    config.endpoint = args.endpoint;
                }
                dynamo = new DynamoDBClient(config);
                // Verify connectivity with a lightweight list call
                await dynamo.send(new ListTablesCommand({ Limit: 1 }));
                return { content: [{ type: 'text', text: `Successfully connected to DynamoDB in region '${args.region}'.` }] };
            } catch (e) {
                dynamo = null;
                return normalizeError(e);
            }
        }
    );

    server.tool('dynamo_health', {}, async () => {
        try {
            const d = await ensureConnected();
            await d.send(new ListTablesCommand({ Limit: 1 }));
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, connected: true }) }] };
        } catch (e) { return normalizeError(e); }
    });

    // --- Introspection ---

    server.tool('dynamo_list_tables',
        {
            limit: z.number().int().min(1).max(100).default(20),
            exclusive_start_table_name: z.string().optional().describe('Pagination token (last table name from previous call)')
        },
        async (args) => {
            try {
                const d = await ensureConnected();
                const res = await d.send(new ListTablesCommand({ Limit: args.limit, ExclusiveStartTableName: args.exclusive_start_table_name }));
                return { content: [{ type: 'text', text: JSON.stringify({ tables: res.TableNames, lastEvaluatedTableName: res.LastEvaluatedTableName || null }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('dynamo_describe_table',
        { table_name: z.string().describe('DynamoDB table name') },
        async (args) => {
            try {
                const d = await ensureConnected();
                const res = await d.send(new DescribeTableCommand({ TableName: args.table_name }));
                const t = res.Table;
                return { content: [{ type: 'text', text: JSON.stringify({ tableName: t.TableName, status: t.TableStatus, itemCount: t.ItemCount, keySchema: t.KeySchema, attributes: t.AttributeDefinitions, billingMode: t.BillingModeSummary }, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- Read ---

    server.tool('dynamo_get_item',
        {
            table_name: z.string(),
            key: z.object({}).catchall(z.any()).describe('Primary key object as plain JS (e.g. { userId: "123", sortKey: "profile" })')
        },
        async (args) => {
            try {
                const d = await ensureConnected();
                const res = await d.send(new GetItemCommand({ TableName: args.table_name, Key: marshall(args.key) }));
                const item = res.Item ? unmarshall(res.Item) : null;
                return { content: [{ type: 'text', text: JSON.stringify({ found: !!item, item }, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('dynamo_query',
        {
            table_name: z.string(),
            key_condition_expression: z.string().describe('KeyConditionExpression (e.g. "pk = :pk")'),
            expression_attribute_values: z.object({}).catchall(z.any()).describe('ExpressionAttributeValues as plain JS'),
            filter_expression: z.string().optional(),
            index_name: z.string().optional().describe('GSI/LSI name to query'),
            limit: z.number().int().min(1).max(500).default(25)
        },
        async (args) => {
            try {
                const d = await ensureConnected();
                const res = await d.send(new QueryCommand({
                    TableName: args.table_name,
                    KeyConditionExpression: args.key_condition_expression,
                    ExpressionAttributeValues: marshall(args.expression_attribute_values),
                    FilterExpression: args.filter_expression,
                    IndexName: args.index_name,
                    Limit: args.limit
                }));
                const items = (res.Items || []).map(unmarshall);
                return { content: [{ type: 'text', text: JSON.stringify({ count: items.length, items }, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('dynamo_scan',
        {
            table_name: z.string(),
            filter_expression: z.string().optional().describe('FilterExpression to apply'),
            expression_attribute_values: z.object({}).catchall(z.any()).optional(),
            limit: z.number().int().min(1).max(500).default(25)
        },
        async (args) => {
            try {
                const d = await ensureConnected();
                const params = { TableName: args.table_name, Limit: args.limit };
                if (args.filter_expression) params.FilterExpression = args.filter_expression;
                if (args.expression_attribute_values) params.ExpressionAttributeValues = marshall(args.expression_attribute_values);
                const res = await d.send(new ScanCommand(params));
                const items = (res.Items || []).map(unmarshall);
                return { content: [{ type: 'text', text: JSON.stringify({ scannedCount: res.ScannedCount, count: items.length, items }, null, 2) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- Write ---

    server.tool('dynamo_put_item',
        {
            table_name: z.string(),
            item: z.object({}).catchall(z.any()).describe('Item to write as plain JS object'),
            confirm: z.boolean().describe('Must be true to write')
        },
        async (args) => {
            try {
                if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set 'confirm: true' to put an item." }] };
                const d = await ensureConnected();
                await d.send(new PutItemCommand({ TableName: args.table_name, Item: marshall(args.item) }));
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, table: args.table_name }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('dynamo_delete_item',
        {
            table_name: z.string(),
            key: z.object({}).catchall(z.any()).describe('Primary key of the item to delete'),
            confirm: z.boolean().describe('Must be true to delete')
        },
        async (args) => {
            try {
                if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set 'confirm: true' to delete an item." }] };
                const d = await ensureConnected();
                await d.send(new DeleteItemCommand({ TableName: args.table_name, Key: marshall(args.key) }));
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, table: args.table_name }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.__test = {
        sessionConfig,
        normalizeError,
        ensureConnected,
        setConfig: (next) => { Object.assign(sessionConfig, next); dynamo = null; },
        getConfig: () => ({ ...sessionConfig })
    };

    return server;
}

if (require.main === module) {
    const serverInstance = createDynamoServer();
    const transport = new StdioServerTransport();
    serverInstance.connect(transport).then(() => {
        console.error('DynamoDB MCP server running on stdio');
    }).catch((error) => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createDynamoServer, DynamoDBClient };
