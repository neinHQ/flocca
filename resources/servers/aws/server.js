const path = require('path');
const z = require('zod');

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');
const { S3Client, ListBucketsCommand, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { LambdaClient, ListFunctionsCommand, GetFunctionCommand, InvokeCommand } = require('@aws-sdk/client-lambda');
const { CloudWatchLogsClient, DescribeLogGroupsCommand, DescribeLogStreamsCommand, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
const { ECSClient, ListClustersCommand, ListServicesCommand, DescribeServicesCommand, UpdateServiceCommand } = require('@aws-sdk/client-ecs');
const { EKSClient, ListClustersCommand: EksListClustersCommand, DescribeClusterCommand } = require('@aws-sdk/client-eks');
const { EC2Client, DescribeInstancesCommand, StartInstancesCommand, StopInstancesCommand, DescribeSecurityGroupsCommand, DescribeSubnetsCommand } = require('@aws-sdk/client-ec2');
const { IAMClient, ListRolesCommand, GetRoleCommand } = require('@aws-sdk/client-iam');
const { SQSClient, ListQueuesCommand, ReceiveMessageCommand, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { SNSClient, ListTopicsCommand, PublishCommand } = require('@aws-sdk/client-sns');
const { CloudWatchClient, GetMetricStatisticsCommand, DescribeAlarmsCommand } = require('@aws-sdk/client-cloudwatch');
const { AutoScalingClient, DescribeAutoScalingGroupsCommand } = require('@aws-sdk/client-auto-scaling');
const { streamToString } = require('@aws-sdk/util-stream-node');
const { DynamoDBClient, ListTablesCommand, DescribeTableCommand, GetItemCommand, PutItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { RDSDataClient, ExecuteStatementCommand } = require('@aws-sdk/client-rds-data');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { ApiGatewayClient, GetRestApisCommand, GetResourcesCommand } = require('@aws-sdk/client-api-gateway');
const { CloudFormationClient, DescribeStacksCommand } = require('@aws-sdk/client-cloudformation');
const { BedrockClient, ListFoundationModelsCommand } = require('@aws-sdk/client-bedrock');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { SFNClient, StartExecutionCommand } = require('@aws-sdk/client-sfn');

const SERVER_INFO = { name: 'aws-mcp', version: '2.0.0' };

function createAwsServer() {
    let config = {
        region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
        credentials: (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            sessionToken: process.env.AWS_SESSION_TOKEN
        } : undefined,
        proxyUrl: process.env.FLOCCA_PROXY_URL,
        userId: process.env.FLOCCA_USER_ID,
        allowedServices: undefined,
        identity: undefined
    };

    const clients = {};

    function normalizeError(err) {
        const msg = err.message || JSON.stringify(err);
        const code = err.name || 'AWS_ERROR';
        return { isError: true, content: [{ type: 'text', text: `AWS Error [${code}]: ${msg}` }] };
    }

    async function ensureConnected(serviceKey, Factory) {
        if (!config.region || (!config.credentials && !(config.proxyUrl && config.userId))) {
            // Re-read env for dynamic updates
            config.region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
            config.credentials = (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) ? {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
                sessionToken: process.env.AWS_SESSION_TOKEN
            } : undefined;
            config.proxyUrl = process.env.FLOCCA_PROXY_URL;
            config.userId = process.env.FLOCCA_USER_ID;

            if (!config.credentials && !(config.proxyUrl && config.userId)) {
                throw new Error("AWS Not Configured. Provide Credentials or use Proxy.");
            }
        }

        const cacheKey = `${serviceKey}:${config.region}`;
        if (!clients[cacheKey]) {
            const clientConfig = { region: config.region, credentials: config.credentials };

            if (config.proxyUrl && config.userId) {
                clientConfig.endpoint = async () => {
                    const targetHost = `${serviceKey}.${config.region}.amazonaws.com`;
                    const proxyEndpoint = `${config.proxyUrl.replace(/\/$/, '')}/${targetHost}`;
                    const urlObj = new URL(proxyEndpoint);
                    return {
                        protocol: urlObj.protocol.replace(':', ''),
                        hostname: urlObj.hostname,
                        port: parseInt(urlObj.port) || undefined,
                        path: urlObj.pathname
                    };
                };
                clientConfig.signer = { sign: async (request) => request };
            }

            const clientInstance = new Factory(clientConfig);

            if (config.proxyUrl && config.userId) {
                clientInstance.middlewareStack.add(
                    (next) => async (args) => {
                        const { request } = args;
                        if (request.headers) request.headers['x-flocca-user-id'] = config.userId;
                        return next(args);
                    },
                    { step: "build", name: "floccaProxyMiddleware", priority: "high" }
                );
            }
            clients[cacheKey] = clientInstance;
        }
        return clients[cacheKey];
    }

    function isAllowed(service) {
        if (!config.allowedServices || config.allowedServices.length === 0) return true;
        return config.allowedServices.includes(service) || config.allowedServices.includes('*');
    }

    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    // --- SYSTEM TOOLS ---
    server.tool('aws_health', {}, async () => {
        try {
            const sts = await ensureConnected('sts', STSClient);
            const resp = await sts.send(new GetCallerIdentityCommand({}));
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, identity: resp.Arn, region: config.region }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('aws_configure',
        {
            region: z.string(),
            credentials: z.object({
                access_key_id: z.string(),
                secret_access_key: z.string(),
                session_token: z.string().optional()
            }).optional(),
            services: z.array(z.string()).optional()
        },
        async (args) => {
            try {
                config.region = args.region;
                if (args.credentials) {
                    config.credentials = {
                        accessKeyId: args.credentials.access_key_id,
                        secretAccessKey: args.credentials.secret_access_key,
                        sessionToken: args.credentials.session_token
                    };
                }
                config.allowedServices = args.services;
                // Clear clients cache
                Object.keys(clients).forEach(k => delete clients[k]);
                
                const sts = await ensureConnected('sts', STSClient);
                const resp = await sts.send(new GetCallerIdentityCommand({}));
                return { content: [{ type: 'text', text: `AWS configured as ${resp.Arn}` }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- S3 ---
    server.tool('aws_s3_list_buckets', {}, async () => {
        try {
            const s3 = await ensureConnected('s3', S3Client);
            const resp = await s3.send(new ListBucketsCommand({}));
            return { content: [{ type: 'text', text: JSON.stringify({ buckets: resp.Buckets }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('aws_s3_list_objects',
        { bucket: z.string(), prefix: z.string().optional(), max_keys: z.number().int().optional().default(100) },
        async (args) => {
            try {
                const s3 = await ensureConnected('s3', S3Client);
                const resp = await s3.send(new ListObjectsV2Command({ Bucket: args.bucket, Prefix: args.prefix, MaxKeys: args.max_keys }));
                return { content: [{ type: 'text', text: JSON.stringify({ objects: resp.Contents }) }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('aws_s3_get_object', { bucket: z.string(), key: z.string() }, async (args) => {
        try {
            const s3 = await ensureConnected('s3', S3Client);
            const resp = await s3.send(new GetObjectCommand({ Bucket: args.bucket, Key: args.key }));
            const body = await streamToString(resp.Body);
            return { content: [{ type: 'text', text: body }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('aws_s3_put_object',
        { bucket: z.string(), key: z.string(), content: z.string(), confirm: z.boolean().describe('Safety gate') },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set confirm:true to upload." }] };
            try {
                const s3 = await ensureConnected('s3', S3Client);
                await s3.send(new PutObjectCommand({ Bucket: args.bucket, Key: args.key, Body: args.content }));
                return { content: [{ type: 'text', text: "Object uploaded successfully." }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- LAMBDA ---
    server.tool('aws_lambda_list_functions', {}, async () => {
        try {
            const lambda = await ensureConnected('lambda', LambdaClient);
            const resp = await lambda.send(new ListFunctionsCommand({}));
            return { content: [{ type: 'text', text: JSON.stringify({ functions: resp.Functions }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('aws_lambda_invoke',
        { function_name: z.string(), payload: z.record(z.string(), z.any()).optional(), confirm: z.boolean().describe('Safety gate') },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set confirm:true to invoke." }] };
            try {
                const lambda = await ensureConnected('lambda', LambdaClient);
                const resp = await lambda.send(new InvokeCommand({
                    FunctionName: args.function_name,
                    Payload: args.payload ? Buffer.from(JSON.stringify(args.payload)) : undefined
                }));
                const payload = resp.Payload ? Buffer.from(resp.Payload).toString() : '';
                return { content: [{ type: 'text', text: payload }] };
            } catch (e) { return normalizeError(e); }
        }
    );

    // --- EC2 ---
    server.tool('aws_ec2_list_instances', {}, async () => {
        try {
            const ec2 = await ensureConnected('ec2', EC2Client);
            const resp = await ec2.send(new DescribeInstancesCommand({}));
            const instances = (resp.Reservations || []).flatMap(r => r.Instances || []);
            return { content: [{ type: 'text', text: JSON.stringify({ instances }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('aws_ec2_start_instance', { instance_id: z.string(), confirm: z.boolean() }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
        try {
            const ec2 = await ensureConnected('ec2', EC2Client);
            await ec2.send(new StartInstancesCommand({ InstanceIds: [args.instance_id] }));
            return { content: [{ type: 'text', text: "Instance starting..." }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('aws_ec2_stop_instance', { instance_id: z.string(), confirm: z.boolean() }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
        try {
            const ec2 = await ensureConnected('ec2', EC2Client);
            await ec2.send(new StopInstancesCommand({ InstanceIds: [args.instance_id] }));
            return { content: [{ type: 'text', text: "Instance stopping..." }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('aws_ec2_describe_security_groups', {}, async () => {
        try {
            const ec2 = await ensureConnected('ec2', EC2Client);
            const resp = await ec2.send(new DescribeSecurityGroupsCommand({}));
            return { content: [{ type: 'text', text: JSON.stringify({ securityGroups: resp.SecurityGroups }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('aws_ec2_describe_subnets', {}, async () => {
        try {
            const ec2 = await ensureConnected('ec2', EC2Client);
            const resp = await ec2.send(new DescribeSubnetsCommand({}));
            return { content: [{ type: 'text', text: JSON.stringify({ subnets: resp.Subnets }) }] };
        } catch (e) { return normalizeError(e); }
    });

    // --- CLOUDWATCH ---
    server.tool('aws_logs_list_log_groups', { prefix: z.string().optional() }, async (args) => {
        try {
            const logs = await ensureConnected('logs', CloudWatchLogsClient);
            const resp = await logs.send(new DescribeLogGroupsCommand({ logGroupNamePrefix: args.prefix }));
            return { content: [{ type: 'text', text: JSON.stringify({ logGroups: resp.logGroups }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('aws_logs_get_log_events', { log_group_name: z.string(), log_stream_name: z.string().optional(), limit: z.number().int().optional().default(50) }, async (args) => {
        try {
            const logs = await ensureConnected('logs', CloudWatchLogsClient);
            const resp = await logs.send(new FilterLogEventsCommand({ 
                logGroupName: args.log_group_name, 
                logStreamNames: args.log_stream_name ? [args.log_stream_name] : undefined,
                limit: args.limit
            }));
            return { content: [{ type: 'text', text: JSON.stringify({ events: resp.events }) }] };
        } catch (e) { return normalizeError(e); }
    });

    // --- DYNAMODB ---
    server.tool('aws_dynamodb_list_tables', {}, async () => {
        try {
            const ddb = await ensureConnected('dynamodb', DynamoDBClient);
            const resp = await ddb.send(new ListTablesCommand({}));
            return { content: [{ type: 'text', text: JSON.stringify({ tableNames: resp.TableNames }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('aws_dynamodb_get_item', { table_name: z.string(), key: z.record(z.string(), z.any()) }, async (args) => {
        try {
            const ddb = await ensureConnected('dynamodb', DynamoDBClient);
            const resp = await ddb.send(new GetItemCommand({ TableName: args.table_name, Key: args.key }));
            return { content: [{ type: 'text', text: JSON.stringify({ item: resp.Item }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('aws_dynamodb_put_item', { table_name: z.string(), item: z.record(z.string(), z.any()), confirm: z.boolean() }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
        try {
            const ddb = await ensureConnected('dynamodb', DynamoDBClient);
            await ddb.send(new PutItemCommand({ TableName: args.table_name, Item: args.item }));
            return { content: [{ type: 'text', text: "Item added." }] };
        } catch (e) { return normalizeError(e); }
    });

    // --- SQS / SNS ---
    server.tool('aws_sqs_send_message', { queue_url: z.string(), message_body: z.string(), confirm: z.boolean() }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
        try {
            const sqs = await ensureConnected('sqs', SQSClient);
            const resp = await sqs.send(new SendMessageCommand({ QueueUrl: args.queue_url, MessageBody: args.message_body }));
            return { content: [{ type: 'text', text: `Message sent: ${resp.MessageId}` }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('aws_sns_publish', { topic_arn: z.string(), message: z.string(), confirm: z.boolean() }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
        try {
            const sns = await ensureConnected('sns', SNSClient);
            const resp = await sns.send(new PublishCommand({ TopicArn: args.topic_arn, Message: args.message }));
            return { content: [{ type: 'text', text: `Published: ${resp.MessageId}` }] };
        } catch (e) { return normalizeError(e); }
    });

    // --- RDS DATA ---
    server.tool('aws_rds_execute_statement', { resource_arn: z.string(), secret_arn: z.string(), sql: z.string(), confirm: z.boolean() }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
        try {
            const rds = await ensureConnected('rds-data', RDSDataClient);
            const resp = await rds.send(new ExecuteStatementCommand({ resourceArn: args.resource_arn, secretArn: args.secret_arn, sql: args.sql }));
            return { content: [{ type: 'text', text: JSON.stringify(resp) }] };
        } catch (e) { return normalizeError(e); }
    });

    // --- SECRETS / SSM ---
    server.tool('aws_secrets_get_value', { secret_id: z.string() }, async (args) => {
        try {
            const secrets = await ensureConnected('secretsmanager', SecretsManagerClient);
            const resp = await secrets.send(new GetSecretValueCommand({ SecretId: args.secret_id }));
            return { content: [{ type: 'text', text: resp.SecretString || '<Binary Value>' }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('aws_ssm_get_parameter', { name: z.string() }, async (args) => {
        try {
            const ssm = await ensureConnected('ssm', SSMClient);
            const resp = await ssm.send(new GetParameterCommand({ Name: args.name, WithDecryption: true }));
            return { content: [{ type: 'text', text: resp.Parameter.Value }] };
        } catch (e) { return normalizeError(e); }
    });

    // --- AI & ORCHESTRATION ---
    server.tool('aws_bedrock_invoke_model', { model_id: z.string(), body: z.record(z.string(), z.any()), confirm: z.boolean() }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
        try {
            const runtime = await ensureConnected('bedrock-runtime', BedrockRuntimeClient);
            const resp = await runtime.send(new InvokeModelCommand({ modelId: args.model_id, body: JSON.stringify(args.body) }));
            const payload = Buffer.from(resp.body).toString();
            return { content: [{ type: 'text', text: payload }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('aws_sfn_start_execution', { state_machine_arn: z.string(), input: z.record(z.string(), z.any()).optional(), confirm: z.boolean() }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
        try {
            const sfn = await ensureConnected('states', SFNClient);
            const resp = await sfn.send(new StartExecutionCommand({ stateMachineArn: args.state_machine_arn, input: args.input ? JSON.stringify(args.input) : undefined }));
            return { content: [{ type: 'text', text: `Execution started: ${resp.executionArn}` }] };
        } catch (e) { return normalizeError(e); }
    });

    // --- ECS / EKS ---
    server.tool('aws_ecs_update_service', { cluster: z.string(), service: z.string(), desired_count: z.number().int(), confirm: z.boolean() }, async (args) => {
        if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED" }] };
        try {
            const ecs = await ensureConnected('ecs', ECSClient);
            await ecs.send(new UpdateServiceCommand({ cluster: args.cluster, service: args.service, desiredCount: args.desired_count }));
            return { content: [{ type: 'text', text: "Service update initiated." }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('aws_eks_list_clusters', {}, async () => {
        try {
            const eks = await ensureConnected('eks', EKSClient);
            const resp = await eks.send(new EksListClustersCommand({}));
            return { content: [{ type: 'text', text: JSON.stringify({ clusters: resp.clusters }) }] };
        } catch (e) { return normalizeError(e); }
    });

    // --- INCIDENT HELPERS ---
    server.tool('aws_incident_find_errors', { log_group_name: z.string(), minutes: z.number().int().optional().default(30) }, async (args) => {
        try {
            const logs = await ensureConnected('logs', CloudWatchLogsClient);
            const end = Date.now();
            const start = end - (args.minutes * 60 * 1000);
            const resp = await logs.send(new FilterLogEventsCommand({
                logGroupName: args.log_group_name,
                startTime: start,
                endTime: end,
                filterPattern: '?"ERROR" ?Exception ?Traceback'
            }));
            const events = (resp.events || []).map(e => ({ message: e.message, timestamp: e.timestamp }));
            return { content: [{ type: 'text', text: JSON.stringify({ events }) }] };
        } catch (e) { return normalizeError(e); }
    });

    return server;
}

if (require.main === module) {
    const server = createAwsServer();
    const transport = new StdioServerTransport();
    server.connect(transport).then(() => {
        console.error('AWS MCP server running on stdio');
    }).catch(error => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createAwsServer };
