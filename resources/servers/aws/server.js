const path = require('path');
const z = require('zod');

const { McpServer } = require(path.join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js'));
const { StdioServerTransport } = require(path.join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/stdio.js'));

const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');
const { S3Client, ListBucketsCommand, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { LambdaClient, ListFunctionsCommand, GetFunctionCommand, InvokeCommand } = require('@aws-sdk/client-lambda');
const { CloudWatchLogsClient, DescribeLogGroupsCommand, DescribeLogStreamsCommand, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
const { ECSClient, ListClustersCommand, ListServicesCommand, DescribeServicesCommand, UpdateServiceCommand } = require('@aws-sdk/client-ecs');
const { EKSClient, ListClustersCommand: EksListClustersCommand, DescribeClusterCommand } = require('@aws-sdk/client-eks');
const { EC2Client, DescribeInstancesCommand, StartInstancesCommand, StopInstancesCommand } = require('@aws-sdk/client-ec2');
const { IAMClient, ListRolesCommand, GetRoleCommand } = require('@aws-sdk/client-iam');
const { SQSClient, ListQueuesCommand, ReceiveMessageCommand, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { SNSClient, ListTopicsCommand, PublishCommand } = require('@aws-sdk/client-sns');
const { CloudWatchClient, GetMetricStatisticsCommand } = require('@aws-sdk/client-cloudwatch');
const { streamToString } = require('@aws-sdk/util-stream-node');

const SERVER_INFO = { name: 'aws-mcp', version: '0.1.0' };

const sessionConfig = {
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
    credentials: (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN
    } : undefined,
    services: undefined,
    identity: undefined
};

const clients = {};

function normalizeError(message, code = 'AWS_ERROR', details, http_status) {
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { message, code, details, http_status } }) }] };
}

function requireConfigured() {
    // If Proxy is used, we might rely on stored credentials in Vault, so local credentials might be missing.
    // However, region is still usually needed for endpoints.
    if ((!sessionConfig.region || !sessionConfig.credentials) && !process.env.FLOCCA_PROXY_URL) {
        throw new Error('AWS is not configured. Call aws_configure first.');
    }
    // If Proxy, we default region if missing
    if (process.env.FLOCCA_PROXY_URL && !sessionConfig.region) {
        sessionConfig.region = 'us-east-1'; // Fallback
    }
}

const PROXY_URL = process.env.FLOCCA_PROXY_URL; // e.g., http://localhost:3000/proxy/aws
const PROXY_USER_ID = process.env.FLOCCA_USER_ID;

function client(key, Factory) {
    if (!clients[key]) {
        const config = {
            region: sessionConfig.region || 'us-east-1', // Default region
            credentials: sessionConfig.credentials
        };

        // If Proxy is configured, override endpoint and signer
        if (PROXY_URL && PROXY_USER_ID) {
            // 1. Point to Proxy
            // For AWS SDK v3, endpoint can be a string or a provider.
            // We need to route specific service calls to specific proxy sub-paths?
            // The backend proxy expects /proxy/aws/<service_endpoint>
            // So we need a custom endpoint provider that builds this URL.

            config.endpoint = async (endpointParams) => {
                // Return proxy URL. The proxy logic handles the final destination including region/service.
                // However, SDK usually appends paths.
                // Simple approach: Point ALL requests to the base proxy URL, 
                // but the backend needs to know the target. The backend parses target from URL path.
                // We need to make the SDK send requests effectively to:
                // http://localhost:3000/proxy/aws/sts.us-east-1.amazonaws.com/

                // Let's rely on constructing the target URL here.
                // But SDK `endpoint` option is usually fixed per client.
                // Hack: If we set endpoint to Proxy Base, the SDK will append path.
                // e.g. Proxy Base: http://localhost:3000/proxy/aws/service.region.amazonaws.com

                // Determining the real AWS endpoint is hard inside this generic factory without mapping keys to services.
                // 'key' is 'sts', 's3', etc.
                const service = key; // e.g. 'sts'
                const region = config.region;
                let targetHost = `${service}.${region}.amazonaws.com`;
                if (service === 's3') targetHost = `s3.${region}.amazonaws.com`;
                if (service === 'execute-api') targetHost = `execute-api.${region}.amazonaws.com`; // Generic

                // Construct Proxy Endpoint
                const proxyEndpoint = `${PROXY_URL}/${targetHost}`;

                const urlObj = new URL(proxyEndpoint);
                return {
                    protocol: urlObj.protocol.replace(':', ''),
                    hostname: urlObj.hostname,
                    port: parseInt(urlObj.port) || undefined,
                    path: urlObj.pathname
                };
            };

            // 2. Disable Local Signing (The Proxy Signs)
            // We use an anonymous signer so SDK doesn't try to sign with empty creds
            config.signer = { sign: async (request) => request };
        }

        const clientInstance = new Factory(config);

        // 3. Middleware to Inject User ID Header (if Proxying)
        if (PROXY_URL && PROXY_USER_ID) {
            clientInstance.middlewareStack.add(
                (next, context) => async (args) => {
                    const { request } = args;
                    if (request.headers) {
                        request.headers['x-flocca-user-id'] = PROXY_USER_ID;
                        // Force JSON content type if not present, to match Proxy expectations
                        // if (!request.headers['Content-Type']) request.headers['Content-Type'] = 'application/json';
                    }
                    return next(args);
                },
                {
                    step: "build",
                    name: "floccaProxyMiddleware",
                    priority: "high"
                }
            );
        }

        clients[key] = clientInstance;
    }
    return clients[key];
}

function allowed(service) {
    if (!sessionConfig.services || !sessionConfig.services.length) return true;
    return sessionConfig.services.includes(service);
}

async function main() {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });
    const originalRegisterTool = server.registerTool.bind(server);
    const permissiveInputSchema = z.object({}).passthrough();
    server.registerTool = (name, config, handler) => {
        const nextConfig = { ...(config || {}) };
        if (!nextConfig.inputSchema || typeof nextConfig.inputSchema.safeParseAsync !== 'function') {
            nextConfig.inputSchema = permissiveInputSchema;
        }
        return originalRegisterTool(name, nextConfig, handler);
    };

    server.registerTool(
        'aws_health',
        {
            description: 'Health check for AWS MCP server.',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false }
        },
        async () => {
            try {
                requireConfigured();
                const sts = client('sts', STSClient);
                const resp = await sts.send(new GetCallerIdentityCommand({}));
                sessionConfig.identity = resp.Arn;
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, identity: resp.Arn }) }] };
            } catch (err) {
                return normalizeError(err.message || 'AWS health check failed', 'ACCESS_DENIED', err.$metadata?.httpStatusCode);
            }
        }
    );

    server.registerTool(
        'aws_configure',
        {
            description: 'Configure AWS for this session using temporary credentials.',
            inputSchema: {
                type: 'object',
                properties: {
                    region: { type: 'string' },
                    credentials: {
                        type: 'object',
                        properties: {
                            access_key_id: { type: 'string' },
                            secret_access_key: { type: 'string' },
                            session_token: { type: 'string' }
                        },
                        required: ['access_key_id', 'secret_access_key']
                    },
                    services: { type: 'array', items: { type: 'string' } }
                },
                required: ['region', 'credentials'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                sessionConfig.region = args.region;
                sessionConfig.credentials = {
                    accessKeyId: args.credentials.access_key_id,
                    secretAccessKey: args.credentials.secret_access_key,
                    sessionToken: args.credentials.session_token
                };
                sessionConfig.services = args.services || [];
                const sts = client('sts', STSClient);
                const resp = await sts.send(new GetCallerIdentityCommand({}));
                sessionConfig.identity = resp.Arn;
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, identity: resp.Arn }) }] };
            } catch (err) {
                sessionConfig.region = undefined;
                sessionConfig.credentials = undefined;
                sessionConfig.services = undefined;
                Object.keys(clients).forEach((k) => delete clients[k]);
                return normalizeError(err.message || 'STS validation failed', 'ACCESS_DENIED', err.$metadata?.httpStatusCode);
            }
        }
    );

    // S3
    server.registerTool(
        'aws_s3_list_buckets',
        { description: 'List S3 buckets.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                requireConfigured();
                if (!allowed('s3')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const s3 = client('s3', S3Client);
                const resp = await s3.send(new ListBucketsCommand({}));
                const buckets = (resp.Buckets || []).map((b) => ({ name: b.Name, created: b.CreationDate }));
                return { content: [{ type: 'text', text: JSON.stringify({ buckets }) }] };
            } catch (err) {
                return normalizeError(err.message, err.name === 'AccessDenied' ? 'ACCESS_DENIED' : 'AWS_ERROR', err);
            }
        }
    );

    server.registerTool(
        'aws_s3_list_objects',
        {
            description: 'List S3 objects in a bucket/prefix.',
            inputSchema: {
                type: 'object',
                properties: {
                    bucket: { type: 'string' },
                    prefix: { type: 'string' },
                    max_keys: { type: 'number' }
                },
                required: ['bucket'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('s3')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const s3 = client('s3', S3Client);
                const resp = await s3.send(new ListObjectsV2Command({
                    Bucket: args.bucket,
                    Prefix: args.prefix,
                    MaxKeys: args.max_keys || 100
                }));
                const objects = (resp.Contents || []).map((o) => ({ key: o.Key, size: o.Size, lastModified: o.LastModified }));
                return { content: [{ type: 'text', text: JSON.stringify({ objects, isTruncated: resp.IsTruncated }) }] };
            } catch (err) {
                return normalizeError(err.message, err.name === 'AccessDenied' ? 'ACCESS_DENIED' : 'AWS_ERROR', err);
            }
        }
    );

    server.registerTool(
        'aws_s3_get_object',
        {
            description: 'Get an S3 object (returns text content).',
            inputSchema: {
                type: 'object',
                properties: { bucket: { type: 'string' }, key: { type: 'string' } },
                required: ['bucket', 'key'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('s3')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const s3 = client('s3', S3Client);
                const resp = await s3.send(new GetObjectCommand({ Bucket: args.bucket, Key: args.key }));
                const body = await streamToString(resp.Body);
                return { content: [{ type: 'text', text: JSON.stringify({ key: args.key, content: body, metadata: resp.Metadata }) }] };
            } catch (err) {
                return normalizeError(err.message, err.name === 'NoSuchKey' ? 'NOT_FOUND' : 'AWS_ERROR', err);
            }
        }
    );

    server.registerTool(
        'aws_s3_put_object',
        {
            description: 'Upload text content to S3.',
            inputSchema: {
                type: 'object',
                properties: {
                    bucket: { type: 'string' },
                    key: { type: 'string' },
                    content: { type: 'string' },
                    content_type: { type: 'string' }
                },
                required: ['bucket', 'key', 'content'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('s3')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const s3 = client('s3', S3Client);
                await s3.send(new PutObjectCommand({
                    Bucket: args.bucket,
                    Key: args.key,
                    Body: args.content,
                    ContentType: args.content_type || 'text/plain'
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, bucket: args.bucket, key: args.key }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    // Lambda
    server.registerTool(
        'aws_lambda_list_functions',
        { description: 'List Lambda functions.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                requireConfigured();
                if (!allowed('lambda')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const lambda = client('lambda', LambdaClient);
                const resp = await lambda.send(new ListFunctionsCommand({}));
                const functions = (resp.Functions || []).map((f) => ({ name: f.FunctionName, runtime: f.Runtime, lastModified: f.LastModified, arn: f.FunctionArn }));
                return { content: [{ type: 'text', text: JSON.stringify({ functions }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.registerTool(
        'aws_lambda_get_function',
        { description: 'Get Lambda function configuration.', inputSchema: { type: 'object', properties: { function_name: { type: 'string' } }, required: ['function_name'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('lambda')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const lambda = client('lambda', LambdaClient);
                const resp = await lambda.send(new GetFunctionCommand({ FunctionName: args.function_name }));
                return { content: [{ type: 'text', text: JSON.stringify({ config: resp.Configuration, code: resp.Code }) }] };
            } catch (err) {
                return normalizeError(err.message, err.name === 'ResourceNotFoundException' ? 'NOT_FOUND' : 'AWS_ERROR', err);
            }
        }
    );

    server.registerTool(
        'aws_lambda_invoke',
        {
            description: 'Invoke a Lambda function.',
            inputSchema: {
                type: 'object',
                properties: {
                    function_name: { type: 'string' },
                    payload: { type: 'object' },
                    invocation_type: { type: 'string', enum: ['RequestResponse', 'Event'], default: 'RequestResponse' },
                    log_type: { type: 'string', enum: ['None', 'Tail'], default: 'None' }
                },
                required: ['function_name'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('lambda')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const lambda = client('lambda', LambdaClient);
                const resp = await lambda.send(new InvokeCommand({
                    FunctionName: args.function_name,
                    Payload: args.payload ? Buffer.from(JSON.stringify(args.payload)) : undefined,
                    InvocationType: args.invocation_type || 'RequestResponse',
                    LogType: args.log_type || 'None'
                }));
                let payload;
                if (resp.Payload) {
                    payload = Buffer.from(resp.Payload).toString('utf-8');
                    try { payload = JSON.parse(payload); } catch (_) { }
                }
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            statusCode: resp.StatusCode,
                            executedVersion: resp.ExecutedVersion,
                            logResult: resp.LogResult ? Buffer.from(resp.LogResult, 'base64').toString('utf-8') : undefined,
                            payload
                        })
                    }]
                };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    // CloudWatch Logs
    server.registerTool(
        'aws_logs_list_log_groups',
        { description: 'List CloudWatch log groups.', inputSchema: { type: 'object', properties: { prefix: { type: 'string' } }, additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('cloudwatch')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const logs = client('logs', CloudWatchLogsClient);
                const resp = await logs.send(new DescribeLogGroupsCommand({ logGroupNamePrefix: args.prefix }));
                return { content: [{ type: 'text', text: JSON.stringify({ logGroups: resp.logGroups || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.registerTool(
        'aws_logs_get_log_streams',
        {
            description: 'List log streams for a log group.',
            inputSchema: { type: 'object', properties: { log_group_name: { type: 'string' } }, required: ['log_group_name'], additionalProperties: false }
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('cloudwatch')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const logs = client('logs', CloudWatchLogsClient);
                const resp = await logs.send(new DescribeLogStreamsCommand({ logGroupName: args.log_group_name, orderBy: 'LastEventTime', descending: true }));
                return { content: [{ type: 'text', text: JSON.stringify({ logStreams: resp.logStreams || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.registerTool(
        'aws_logs_get_log_events',
        {
            description: 'Get log events (with optional filter pattern).',
            inputSchema: {
                type: 'object',
                properties: {
                    log_group_name: { type: 'string' },
                    log_stream_name: { type: 'string' },
                    start_time: { type: 'number' },
                    end_time: { type: 'number' },
                    filter_pattern: { type: 'string' },
                    limit: { type: 'number' }
                },
                required: ['log_group_name'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('cloudwatch')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const logs = client('logs', CloudWatchLogsClient);
                const resp = await logs.send(new FilterLogEventsCommand({
                    logGroupName: args.log_group_name,
                    logStreamNames: args.log_stream_name ? [args.log_stream_name] : undefined,
                    startTime: args.start_time,
                    endTime: args.end_time,
                    filterPattern: args.filter_pattern,
                    limit: args.limit || 100
                }));
                const events = (resp.events || []).map((e) => ({ message: e.message, timestamp: e.timestamp, logStreamName: e.logStreamName }));
                return { content: [{ type: 'text', text: JSON.stringify({ events }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    // ECS
    server.registerTool(
        'aws_ecs_list_clusters',
        { description: 'List ECS clusters.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                requireConfigured();
                if (!allowed('ecs')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const ecs = client('ecs', ECSClient);
                const resp = await ecs.send(new ListClustersCommand({}));
                return { content: [{ type: 'text', text: JSON.stringify({ clusterArns: resp.clusterArns || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.registerTool(
        'aws_ecs_list_services',
        {
            description: 'List ECS services for a cluster.',
            inputSchema: { type: 'object', properties: { cluster: { type: 'string' } }, required: ['cluster'], additionalProperties: false }
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('ecs')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const ecs = client('ecs', ECSClient);
                const resp = await ecs.send(new ListServicesCommand({ cluster: args.cluster }));
                return { content: [{ type: 'text', text: JSON.stringify({ serviceArns: resp.serviceArns || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.registerTool(
        'aws_ecs_describe_service',
        {
            description: 'Describe an ECS service.',
            inputSchema: { type: 'object', properties: { cluster: { type: 'string' }, service: { type: 'string' } }, required: ['cluster', 'service'], additionalProperties: false }
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('ecs')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const ecs = client('ecs', ECSClient);
                const resp = await ecs.send(new DescribeServicesCommand({ cluster: args.cluster, services: [args.service] }));
                return { content: [{ type: 'text', text: JSON.stringify({ services: resp.services || [], failures: resp.failures || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.registerTool(
        'aws_ecs_update_service',
        {
            description: 'Update an ECS service (e.g., desired count).',
            inputSchema: {
                type: 'object',
                properties: { cluster: { type: 'string' }, service: { type: 'string' }, desired_count: { type: 'number' } },
                required: ['cluster', 'service', 'desired_count'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('ecs')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const ecs = client('ecs', ECSClient);
                const resp = await ecs.send(new UpdateServiceCommand({
                    cluster: args.cluster,
                    service: args.service,
                    desiredCount: args.desired_count
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ service: resp.service }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    // EKS
    server.registerTool(
        'aws_eks_list_clusters',
        { description: 'List EKS clusters.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                requireConfigured();
                if (!allowed('eks')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const eks = client('eks', EKSClient);
                const resp = await eks.send(new EksListClustersCommand({}));
                return { content: [{ type: 'text', text: JSON.stringify({ clusters: resp.clusters || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.registerTool(
        'aws_eks_describe_cluster',
        { description: 'Describe an EKS cluster.', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('eks')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const eks = client('eks', EKSClient);
                const resp = await eks.send(new DescribeClusterCommand({ name: args.name }));
                return { content: [{ type: 'text', text: JSON.stringify({ cluster: resp.cluster }) }] };
            } catch (err) {
                return normalizeError(err.message, err.name === 'ResourceNotFoundException' ? 'NOT_FOUND' : 'AWS_ERROR', err);
            }
        }
    );

    server.registerTool(
        'aws_eks_update_kubeconfig_token',
        {
            description: 'Placeholder for EKS auth token (not implemented).',
            inputSchema: { type: 'object', properties: { cluster: { type: 'string' } }, required: ['cluster'], additionalProperties: false }
        },
        async () => normalizeError('Not implemented in this MVP', 'NOT_IMPLEMENTED', 400)
    );

    // EC2
    server.registerTool(
        'aws_ec2_list_instances',
        { description: 'List EC2 instances.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                requireConfigured();
                if (!allowed('ec2')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const ec2 = client('ec2', EC2Client);
                const resp = await ec2.send(new DescribeInstancesCommand({}));
                const instances = [];
                (resp.Reservations || []).forEach((r) => {
                    (r.Instances || []).forEach((i) => instances.push(i));
                });
                return { content: [{ type: 'text', text: JSON.stringify({ instances }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.registerTool(
        'aws_ec2_describe_instance',
        { description: 'Describe a single EC2 instance.', inputSchema: { type: 'object', properties: { instance_id: { type: 'string' } }, required: ['instance_id'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('ec2')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const ec2 = client('ec2', EC2Client);
                const resp = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [args.instance_id] }));
                const inst = resp.Reservations?.[0]?.Instances?.[0];
                return { content: [{ type: 'text', text: JSON.stringify({ instance: inst }) }] };
            } catch (err) {
                return normalizeError(err.message, err.name === 'InvalidInstanceID.NotFound' ? 'NOT_FOUND' : 'AWS_ERROR', err);
            }
        }
    );

    server.registerTool(
        'aws_ec2_start_instance',
        { description: 'Start an EC2 instance.', inputSchema: { type: 'object', properties: { instance_id: { type: 'string' } }, required: ['instance_id'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('ec2')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const ec2 = client('ec2', EC2Client);
                const resp = await ec2.send(new StartInstancesCommand({ InstanceIds: [args.instance_id] }));
                return { content: [{ type: 'text', text: JSON.stringify({ starting: resp.StartingInstances || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.registerTool(
        'aws_ec2_stop_instance',
        { description: 'Stop an EC2 instance.', inputSchema: { type: 'object', properties: { instance_id: { type: 'string' } }, required: ['instance_id'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('ec2')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const ec2 = client('ec2', EC2Client);
                const resp = await ec2.send(new StopInstancesCommand({ InstanceIds: [args.instance_id] }));
                return { content: [{ type: 'text', text: JSON.stringify({ stopping: resp.StoppingInstances || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    // IAM (read-only)
    server.registerTool(
        'aws_iam_get_caller_identity',
        { description: 'Return STS caller identity.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                requireConfigured();
                const sts = client('sts', STSClient);
                const resp = await sts.send(new GetCallerIdentityCommand({}));
                return { content: [{ type: 'text', text: JSON.stringify(resp) }] };
            } catch (err) {
                return normalizeError(err.message, 'ACCESS_DENIED', err);
            }
        }
    );

    server.registerTool(
        'aws_iam_list_roles',
        { description: 'List IAM roles (paginated first page).', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                requireConfigured();
                if (!allowed('iam')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const iam = client('iam', IAMClient);
                const resp = await iam.send(new ListRolesCommand({}));
                return { content: [{ type: 'text', text: JSON.stringify({ roles: resp.Roles || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.registerTool(
        'aws_iam_get_role',
        { description: 'Get IAM role.', inputSchema: { type: 'object', properties: { role_name: { type: 'string' } }, required: ['role_name'], additionalProperties: false } },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('iam')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const iam = client('iam', IAMClient);
                const resp = await iam.send(new GetRoleCommand({ RoleName: args.role_name }));
                return { content: [{ type: 'text', text: JSON.stringify({ role: resp.Role }) }] };
            } catch (err) {
                return normalizeError(err.message, err.name === 'NoSuchEntity' ? 'NOT_FOUND' : 'AWS_ERROR', err);
            }
        }
    );

    // SQS
    server.registerTool(
        'aws_sqs_list_queues',
        { description: 'List SQS queues.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                requireConfigured();
                if (!allowed('sqs')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const sqs = client('sqs', SQSClient);
                const resp = await sqs.send(new ListQueuesCommand({}));
                return { content: [{ type: 'text', text: JSON.stringify({ queueUrls: resp.QueueUrls || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.registerTool(
        'aws_sqs_receive_messages',
        {
            description: 'Receive messages from SQS.',
            inputSchema: {
                type: 'object',
                properties: {
                    queue_url: { type: 'string' },
                    max_number: { type: 'number' },
                    wait_time_seconds: { type: 'number' }
                },
                required: ['queue_url'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('sqs')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const sqs = client('sqs', SQSClient);
                const resp = await sqs.send(new ReceiveMessageCommand({
                    QueueUrl: args.queue_url,
                    MaxNumberOfMessages: args.max_number || 1,
                    WaitTimeSeconds: args.wait_time_seconds || 0
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ messages: resp.Messages || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.registerTool(
        'aws_sqs_send_message',
        {
            description: 'Send a message to SQS.',
            inputSchema: {
                type: 'object',
                properties: { queue_url: { type: 'string' }, message_body: { type: 'string' } },
                required: ['queue_url', 'message_body'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('sqs')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const sqs = client('sqs', SQSClient);
                const resp = await sqs.send(new SendMessageCommand({ QueueUrl: args.queue_url, MessageBody: args.message_body }));
                return { content: [{ type: 'text', text: JSON.stringify({ messageId: resp.MessageId }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    // SNS
    server.registerTool(
        'aws_sns_list_topics',
        { description: 'List SNS topics.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            try {
                requireConfigured();
                if (!allowed('sns')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const sns = client('sns', SNSClient);
                const resp = await sns.send(new ListTopicsCommand({}));
                return { content: [{ type: 'text', text: JSON.stringify({ topics: resp.Topics || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.registerTool(
        'aws_sns_publish',
        {
            description: 'Publish a message to SNS.',
            inputSchema: {
                type: 'object',
                properties: { topic_arn: { type: 'string' }, message: { type: 'string' }, subject: { type: 'string' } },
                required: ['topic_arn', 'message'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('sns')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const sns = client('sns', SNSClient);
                const resp = await sns.send(new PublishCommand({ TopicArn: args.topic_arn, Message: args.message, Subject: args.subject }));
                return { content: [{ type: 'text', text: JSON.stringify({ messageId: resp.MessageId }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    // Incident helpers
    server.registerTool(
        'aws_incident_find_errors',
        {
            description: 'Find recent errors in CloudWatch Logs for a service.',
            inputSchema: {
                type: 'object',
                properties: {
                    log_group_name: { type: 'string' },
                    service: { type: 'string' },
                    minutes: { type: 'number', default: 30 },
                    limit: { type: 'number' }
                },
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('cloudwatch')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const logs = client('logs', CloudWatchLogsClient);
                const end = Date.now();
                const start = end - (args.minutes || 30) * 60 * 1000;
                const logGroup = args.log_group_name || `/aws/lambda/${args.service || ''}`;
                const resp = await logs.send(new FilterLogEventsCommand({
                    logGroupName: logGroup,
                    startTime: start,
                    endTime: end,
                    filterPattern: '?"ERROR" ?Exception ?Traceback',
                    limit: args.limit || 100
                }));
                const events = (resp.events || []).map((e) => ({ message: e.message, timestamp: e.timestamp, logStreamName: e.logStreamName }));
                return { content: [{ type: 'text', text: JSON.stringify({ logGroup, events }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.registerTool(
        'aws_incident_summarize_service_health',
        {
            description: 'Summarize service health using CloudWatch metrics.',
            inputSchema: {
                type: 'object',
                properties: {
                    namespace: { type: 'string', description: 'CloudWatch namespace, e.g., AWS/ApplicationELB' },
                    metric_error: { type: 'string', description: 'Metric name for errors, e.g., HTTPCode_Target_5XX_Count' },
                    metric_count: { type: 'string', description: 'Metric name for total requests, e.g., RequestCount' },
                    dimensions: { type: 'array', items: { type: 'object' }, description: 'Array of {Name,Value} pairs' },
                    minutes: { type: 'number', default: 30 }
                },
                required: ['namespace', 'metric_error', 'metric_count', 'dimensions'],
                additionalProperties: false
            }
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('cloudwatch')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const cw = client('cloudwatch', CloudWatchClient);
                const end = new Date();
                const start = new Date(end.getTime() - (args.minutes || 30) * 60 * 1000);

                const errResp = await cw.send(new GetMetricStatisticsCommand({
                    Namespace: args.namespace,
                    MetricName: args.metric_error,
                    Dimensions: args.dimensions,
                    StartTime: start,
                    EndTime: end,
                    Period: Math.max(60, Math.floor((end - start) / 10)),
                    Statistics: ['Sum']
                }));
                const countResp = await cw.send(new GetMetricStatisticsCommand({
                    Namespace: args.namespace,
                    MetricName: args.metric_count,
                    Dimensions: args.dimensions,
                    StartTime: start,
                    EndTime: end,
                    Period: Math.max(60, Math.floor((end - start) / 10)),
                    Statistics: ['Sum']
                }));

                const sum = (datapoints) => datapoints.reduce((acc, d) => acc + (d.Sum || 0), 0);
                const errors = sum(errResp.Datapoints || []);
                const total = sum(countResp.Datapoints || []);
                const errorRate = total > 0 ? errors / total : null;

                const summary = {
                    status: errorRate !== null && errorRate > 0.01 ? 'degraded' : 'healthy',
                    error_rate: errorRate,
                    errors,
                    total
                };
                return { content: [{ type: 'text', text: JSON.stringify(summary) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.server.oninitialized = () => {
        console.log('AWS MCP server initialized.');
    };

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.log('AWS MCP server running on stdio.');
}

main().catch((err) => {
    console.error('AWS MCP server failed to start:', err);
    process.exit(1);
});
