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

const SERVER_INFO = { name: 'aws-mcp', version: '0.1.0' };

function createAwsServer() {
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
                    const service = key; // e.g. 'sts'
                    const region = config.region;
                    let targetHost = `${service}.${region}.amazonaws.com`;
                    if (service === 's3') targetHost = `s3.${region}.amazonaws.com`;
                    if (service === 'execute-api') targetHost = `execute-api.${region}.amazonaws.com`;
                    if (service === 'dynamodb') targetHost = `dynamodb.${region}.amazonaws.com`;
                    if (service === 'rds-data') targetHost = `rds-data.${region}.amazonaws.com`;
                    if (service === 'secretsmanager') targetHost = `secretsmanager.${region}.amazonaws.com`;
                    if (service === 'ssm') targetHost = `ssm.${region}.amazonaws.com`;
                    if (service === 'apigateway') targetHost = `apigateway.${region}.amazonaws.com`;
                    if (service === 'cloudformation') targetHost = `cloudformation.${region}.amazonaws.com`;
                    if (service === 'bedrock') targetHost = `bedrock.${region}.amazonaws.com`;
                    if (service === 'bedrock-runtime') targetHost = `bedrock-runtime.${region}.amazonaws.com`;
                    if (service === 'states') targetHost = `states.${region}.amazonaws.com`;
                    if (service === 'autoscaling') targetHost = `autoscaling.${region}.amazonaws.com`;

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
        if (!sessionConfig.services || sessionConfig.services.length === 0) return true;
        return sessionConfig.services.includes(service) || sessionConfig.services.includes('*');
    }

    async function discovery() {
        if (sessionConfig.identity) return sessionConfig.identity;
        try {
            const sts = client('sts', STSClient);
            const resp = await sts.send(new GetCallerIdentityCommand({}));
            sessionConfig.identity = resp.Arn;
            return sessionConfig.identity;
        } catch {
            return undefined;
        }
    }

    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    server.tool(
        'aws_health',
        {},
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

    server.tool(
        'aws_configure',
        {
            region: z.string(),
            credentials: z.object({
                access_key_id: z.string(),
                secret_access_key: z.string(),
                session_token: z.string().optional()
            }),
            services: z.array(z.string()).optional()
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
    server.tool(
        'aws_s3_list_buckets',
        {},
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

    server.tool(
        'aws_s3_list_objects',
        {
            bucket: z.string(),
            prefix: z.string().optional(),
            max_keys: z.number().optional().default(100),
            continuation_token: z.string().optional()
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('s3')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const s3 = client('s3', S3Client);
                const resp = await s3.send(new ListObjectsV2Command({
                    Bucket: args.bucket,
                    Prefix: args.prefix,
                    MaxKeys: args.max_keys,
                    ContinuationToken: args.continuation_token
                }));
                const objects = (resp.Contents || []).map((o) => ({ key: o.Key, size: o.Size, lastModified: o.LastModified }));
                return { content: [{ type: 'text', text: JSON.stringify({ objects, isTruncated: resp.IsTruncated, nextContinuationToken: resp.NextContinuationToken }) }] };
            } catch (err) {
                return normalizeError(err.message, err.name === 'AccessDenied' ? 'ACCESS_DENIED' : 'AWS_ERROR', err);
            }
        }
    );

    server.tool(
        'aws_s3_get_object',
        { 
            bucket: z.string(), 
            key: z.string() 
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

    server.tool(
        'aws_s3_put_object',
        {
            bucket: z.string(),
            key: z.string(),
            content: z.string(),
            content_type: z.string().optional().default('text/plain')
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
                    ContentType: args.content_type
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, bucket: args.bucket, key: args.key }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    // Lambda
    server.tool(
        'aws_lambda_list_functions',
        {
            limit: z.number().optional().default(50),
            marker: z.string().optional()
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('lambda')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const lambda = client('lambda', LambdaClient);
                const resp = await lambda.send(new ListFunctionsCommand({
                    MaxItems: args.limit,
                    Marker: args.marker
                }));
                const functions = (resp.Functions || []).map((f) => ({ name: f.FunctionName, runtime: f.Runtime, lastModified: f.LastModified, arn: f.FunctionArn }));
                return { content: [{ type: 'text', text: JSON.stringify({ functions, nextMarker: resp.NextMarker }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.tool(
        'aws_lambda_get_function',
        { function_name: z.string() },
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

    server.tool(
        'aws_lambda_invoke',
        {
            function_name: z.string(),
            payload: z.record(z.string(), z.any()).optional(),
            invocation_type: z.enum(['RequestResponse', 'Event']).optional().default('RequestResponse'),
            log_type: z.enum(['None', 'Tail']).optional().default('None')
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('lambda')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const lambda = client('lambda', LambdaClient);
                const resp = await lambda.send(new InvokeCommand({
                    FunctionName: args.function_name,
                    Payload: args.payload ? Buffer.from(JSON.stringify(args.payload)) : undefined,
                    InvocationType: args.invocation_type,
                    LogType: args.log_type
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
    server.tool(
        'aws_logs_list_log_groups',
        {
            prefix: z.string().optional(),
            limit: z.number().optional().default(50),
            next_token: z.string().optional()
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('cloudwatch')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const logs = client('logs', CloudWatchLogsClient);
                const resp = await logs.send(new DescribeLogGroupsCommand({
                    logGroupNamePrefix: args.prefix,
                    limit: args.limit,
                    nextToken: args.next_token
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ logGroups: resp.logGroups || [], nextToken: resp.nextToken }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.tool(
        'aws_logs_get_log_streams',
        {
            log_group_name: z.string(),
            limit: z.number().optional().default(50),
            next_token: z.string().optional()
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('cloudwatch')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const logs = client('logs', CloudWatchLogsClient);
                const resp = await logs.send(new DescribeLogStreamsCommand({
                    logGroupName: args.log_group_name,
                    orderBy: 'LastEventTime',
                    descending: true,
                    limit: args.limit,
                    nextToken: args.next_token
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ logStreams: resp.logStreams || [], nextToken: resp.nextToken }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.tool(
        'aws_logs_get_log_events',
        {
            log_group_name: z.string(),
            log_stream_name: z.string().optional(),
            start_time: z.number().optional(),
            end_time: z.number().optional(),
            filter_pattern: z.string().optional(),
            limit: z.number().optional().default(100),
            next_token: z.string().optional()
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
                    limit: args.limit,
                    nextToken: args.next_token
                }));
                const events = (resp.events || []).map((e) => ({ message: e.message, timestamp: e.timestamp, logStreamName: e.logStreamName }));
                return { content: [{ type: 'text', text: JSON.stringify({ events, nextToken: resp.nextToken }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    // ECS
    server.tool(
        'aws_ecs_list_clusters',
        {
            max_results: z.number().optional(),
            next_token: z.string().optional()
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('ecs')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const ecs = client('ecs', ECSClient);
                const resp = await ecs.send(new ListClustersCommand({
                    maxResults: args.max_results,
                    nextToken: args.next_token
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ clusterArns: resp.clusterArns || [], nextToken: resp.nextToken }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.tool(
        'aws_ecs_list_services',
        {
            cluster: z.string(),
            max_results: z.number().optional(),
            next_token: z.string().optional()
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('ecs')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const ecs = client('ecs', ECSClient);
                const resp = await ecs.send(new ListServicesCommand({
                    cluster: args.cluster,
                    maxResults: args.max_results,
                    nextToken: args.next_token
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ serviceArns: resp.serviceArns || [], nextToken: resp.nextToken }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.tool(
        'aws_ecs_describe_service',
        { 
            cluster: z.string(), 
            service: z.string() 
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

    server.tool(
        'aws_ecs_update_service',
        { 
            cluster: z.string(), 
            service: z.string(), 
            desired_count: z.number() 
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
    server.tool(
        'aws_eks_list_clusters',
        {},
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

    server.tool(
        'aws_eks_describe_cluster',
        { name: z.string() },
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

    server.tool(
        'aws_eks_update_kubeconfig_token',
        { cluster: z.string() },
        async () => normalizeError('Not implemented in this MVP', 'NOT_IMPLEMENTED', 400)
    );

    // EC2
    server.tool(
        'aws_ec2_list_instances',
        {
            filters: z.array(z.object({
                name: z.string(),
                values: z.array(z.string())
            })).optional(),
            next_token: z.string().optional(),
            max_results: z.number().optional()
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('ec2')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const ec2 = client('ec2', EC2Client);
                const resp = await ec2.send(new DescribeInstancesCommand({
                    Filters: args.filters ? args.filters.map(f => ({ Name: f.name, Values: f.values })) : undefined,
                    NextToken: args.next_token,
                    MaxResults: args.max_results
                }));
                const instances = [];
                (resp.Reservations || []).forEach((r) => {
                    (r.Instances || []).forEach((i) => instances.push(i));
                });
                return { content: [{ type: 'text', text: JSON.stringify({ instances, nextToken: resp.NextToken }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.tool(
        'aws_ec2_describe_instance',
        { instance_id: z.string() },
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

    server.tool(
        'aws_ec2_start_instance',
        { instance_id: z.string() },
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

    server.tool(
        'aws_ec2_stop_instance',
        { instance_id: z.string() },
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
    server.tool(
        'aws_iam_get_caller_identity',
        {},
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

    server.tool(
        'aws_iam_list_roles',
        {
            limit: z.number().optional().default(100),
            marker: z.string().optional()
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('iam')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const iam = client('iam', IAMClient);
                const resp = await iam.send(new ListRolesCommand({
                    MaxItems: args.limit,
                    Marker: args.marker
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ roles: resp.Roles || [], isTruncated: resp.IsTruncated, marker: resp.Marker }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.tool(
        'aws_iam_get_role',
        { role_name: z.string() },
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
    server.tool(
        'aws_sqs_list_queues',
        {
            prefix: z.string().optional(),
            max_results: z.number().optional(),
            next_token: z.string().optional()
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('sqs')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const sqs = client('sqs', SQSClient);
                const resp = await sqs.send(new ListQueuesCommand({
                    QueueNamePrefix: args.prefix,
                    MaxResults: args.max_results,
                    NextToken: args.next_token
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ queueUrls: resp.QueueUrls || [], nextToken: resp.NextToken }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.tool(
        'aws_sqs_receive_messages',
        {
            queue_url: z.string(),
            max_number: z.number().optional().default(1),
            wait_time_seconds: z.number().optional().default(0)
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('sqs')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const sqs = client('sqs', SQSClient);
                const resp = await sqs.send(new ReceiveMessageCommand({
                    QueueUrl: args.queue_url,
                    MaxNumberOfMessages: args.max_number,
                    WaitTimeSeconds: args.wait_time_seconds
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ messages: resp.Messages || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.tool(
        'aws_sqs_send_message',
        { 
            queue_url: z.string(), 
            message_body: z.string() 
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
    server.tool(
        'aws_sns_list_topics',
        {
            next_token: z.string().optional()
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('sns')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const sns = client('sns', SNSClient);
                const resp = await sns.send(new ListTopicsCommand({ NextToken: args.next_token }));
                return { content: [{ type: 'text', text: JSON.stringify({ topics: resp.Topics || [], nextToken: resp.NextToken }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.tool(
        'aws_sns_publish',
        { 
            topic_arn: z.string(), 
            message: z.string(), 
            subject: z.string().optional() 
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

    // Pillar 1: Data & State (DynamoDB & RDS Data)
    server.tool(
        'aws_dynamodb_list_tables',
        {
            limit: z.number().optional(),
            exclusive_start_table_name: z.string().optional()
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('dynamodb')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const dynamodb = client('dynamodb', DynamoDBClient);
                const resp = await dynamodb.send(new ListTablesCommand({
                    Limit: args.limit,
                    ExclusiveStartTableName: args.exclusive_start_table_name
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ tableNames: resp.TableNames || [], lastEvaluatedTableName: resp.LastEvaluatedTableName }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.tool(
        'aws_dynamodb_describe_table',
        { table_name: z.string() },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('dynamodb')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const dynamodb = client('dynamodb', DynamoDBClient);
                const resp = await dynamodb.send(new DescribeTableCommand({ TableName: args.table_name }));
                return { content: [{ type: 'text', text: JSON.stringify({ table: resp.Table }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.tool(
        'aws_dynamodb_get_item',
        {
            table_name: z.string(),
            key: z.record(z.string(), z.any())
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('dynamodb')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const dynamodb = client('dynamodb', DynamoDBClient);
                const resp = await dynamodb.send(new GetItemCommand({
                    TableName: args.table_name,
                    Key: args.key
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ item: resp.Item }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.tool(
        'aws_dynamodb_put_item',
        {
            table_name: z.string(),
            item: z.record(z.string(), z.any())
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('dynamodb')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const dynamodb = client('dynamodb', DynamoDBClient);
                await dynamodb.send(new PutItemCommand({
                    TableName: args.table_name,
                    Item: args.item
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.tool(
        'aws_dynamodb_query',
        {
            table_name: z.string(),
            key_condition_expression: z.string(),
            expression_attribute_values: z.record(z.string(), z.any()).optional(),
            limit: z.number().optional()
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('dynamodb')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const dynamodb = client('dynamodb', DynamoDBClient);
                const resp = await dynamodb.send(new QueryCommand({
                    TableName: args.table_name,
                    KeyConditionExpression: args.key_condition_expression,
                    ExpressionAttributeValues: args.expression_attribute_values,
                    Limit: args.limit
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ items: resp.Items || [], count: resp.Count }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.tool(
        'aws_rds_execute_statement',
        {
            resource_arn: z.string(),
            secret_arn: z.string(),
            sql: z.string(),
            database: z.string().optional()
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('rds-data')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const rdsData = client('rds-data', RDSDataClient);
                const resp = await rdsData.send(new ExecuteStatementCommand({
                    resourceArn: args.resource_arn,
                    secretArn: args.secret_arn,
                    sql: args.sql,
                    database: args.database
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ records: resp.records, numberOfRecordsUpdated: resp.numberOfRecordsUpdated }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    // Pillar 2: Configuration & Secrets (Secrets Manager & SSM)
    server.tool(
        'aws_secrets_get_value',
        { secret_id: z.string() },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('secretsmanager')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const secrets = client('secretsmanager', SecretsManagerClient);
                const resp = await secrets.send(new GetSecretValueCommand({ SecretId: args.secret_id }));
                return { content: [{ type: 'text', text: JSON.stringify({ secret: resp.SecretString || resp.SecretBinary }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.tool(
        'aws_ssm_get_parameter',
        {
            name: z.string(),
            with_decryption: z.boolean().optional().default(true)
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('ssm')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const ssm = client('ssm', SSMClient);
                const resp = await ssm.send(new GetParameterCommand({
                    Name: args.name,
                    WithDecryption: args.with_decryption
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ parameter: resp.Parameter }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    // Pillar 3: Infrastructure (API Gateway, CloudFormation, Networking)
    server.tool(
        'aws_apigateway_list_rest_apis',
        {
            limit: z.number().optional().default(25),
            position: z.string().optional()
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('apigateway')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const apigw = client('apigateway', ApiGatewayClient);
                const resp = await apigw.send(new GetRestApisCommand({
                    limit: args.limit,
                    position: args.position
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ items: resp.items || [], position: resp.position }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.tool(
        'aws_apigateway_get_resources',
        {
            rest_api_id: z.string(),
            limit: z.number().optional().default(25),
            position: z.string().optional()
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('apigateway')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const apigw = client('apigateway', ApiGatewayClient);
                const resp = await apigw.send(new GetResourcesCommand({
                    restApiId: args.rest_api_id,
                    limit: args.limit,
                    position: args.position
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ items: resp.items || [], position: resp.position }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.tool(
        'aws_cloudformation_describe_stacks',
        {
            stack_name: z.string().optional(),
            next_token: z.string().optional()
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('cloudformation')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const cf = client('cloudformation', CloudFormationClient);
                const resp = await cf.send(new DescribeStacksCommand({
                    StackName: args.stack_name,
                    NextToken: args.next_token
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ stacks: resp.Stacks || [], nextToken: resp.NextToken }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.tool(
        'aws_ec2_describe_security_groups',
        {
            group_ids: z.array(z.string()).optional(),
            next_token: z.string().optional(),
            max_results: z.number().optional().default(50)
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('ec2')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const ec2 = client('ec2', EC2Client);
                const resp = await ec2.send(new DescribeSecurityGroupsCommand({
                    GroupIds: args.group_ids,
                    NextToken: args.next_token,
                    MaxResults: args.max_results
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ securityGroups: resp.SecurityGroups || [], nextToken: resp.NextToken }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.tool(
        'aws_ec2_describe_subnets',
        {
            subnet_ids: z.array(z.string()).optional(),
            next_token: z.string().optional(),
            max_results: z.number().optional()
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('ec2')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const ec2 = client('ec2', EC2Client);
                const resp = await ec2.send(new DescribeSubnetsCommand({
                    SubnetIds: args.subnet_ids,
                    NextToken: args.next_token,
                    MaxResults: args.max_results
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ subnets: resp.Subnets || [], nextToken: resp.NextToken }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    // Pillar 4: AI & Orchestration (Bedrock & Step Functions)
    server.tool(
        'aws_bedrock_list_foundation_models',
        {
            by_provider: z.string().optional(),
            by_customization_type: z.string().optional()
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('bedrock')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const bedrock = client('bedrock', BedrockClient);
                const resp = await bedrock.send(new ListFoundationModelsCommand({
                    byProvider: args.by_provider,
                    byCustomizationType: args.by_customization_type
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ modelSummaries: resp.modelSummaries || [] }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.tool(
        'aws_bedrock_invoke_model',
        {
            model_id: z.string(),
            body: z.record(z.string(), z.any()),
            content_type: z.string().optional().default('application/json'),
            accept: z.string().optional().default('application/json')
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('bedrock')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const runtime = client('bedrock-runtime', BedrockRuntimeClient);
                const resp = await runtime.send(new InvokeModelCommand({
                    modelId: args.model_id,
                    body: JSON.stringify(args.body),
                    contentType: args.content_type,
                    accept: args.accept
                }));
                const payload = Buffer.from(resp.body).toString('utf-8');
                return { content: [{ type: 'text', text: JSON.stringify({ body: JSON.parse(payload), contentType: resp.contentType }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.tool(
        'aws_sfn_start_execution',
        {
            state_machine_arn: z.string(),
            name: z.string().optional(),
            input: z.record(z.string(), z.any()).optional()
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('states')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const sfn = client('states', SFNClient);
                const resp = await sfn.send(new StartExecutionCommand({
                    stateMachineArn: args.state_machine_arn,
                    name: args.name,
                    input: args.input ? JSON.stringify(args.input) : undefined
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ executionArn: resp.executionArn, startDate: resp.startDate }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    // --- DevOps & Environment Pillar ---
    server.tool(
        'aws_cloudwatch_describe_alarms',
        {
            alarm_names: z.array(z.string()).optional(),
            state_value: z.enum(['OK', 'ALARM', 'INSUFFICIENT_DATA']).optional(),
            next_token: z.string().optional(),
            max_records: z.number().optional().default(50)
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('cloudwatch')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const cw = client('cloudwatch', CloudWatchClient);
                const resp = await cw.send(new DescribeAlarmsCommand({
                    AlarmNames: args.alarm_names,
                    StateValue: args.state_value,
                    NextToken: args.next_token,
                    MaxRecords: args.max_records
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ metricAlarms: resp.MetricAlarms || [], nextToken: resp.NextToken }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.tool(
        'aws_autoscaling_describe_auto_scaling_groups',
        {
            auto_scaling_group_names: z.array(z.string()).optional(),
            next_token: z.string().optional(),
            max_records: z.number().optional().default(50)
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('autoscaling')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const asg = client('autoscaling', AutoScalingClient);
                const resp = await asg.send(new DescribeAutoScalingGroupsCommand({
                    AutoScalingGroupNames: args.auto_scaling_group_names,
                    NextToken: args.next_token,
                    MaxRecords: args.max_records
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ autoScalingGroups: resp.AutoScalingGroups || [], nextToken: resp.NextToken }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    // Incident helpers
    server.tool(
        'aws_incident_find_errors',
        {
            log_group_name: z.string().optional(),
            service: z.string().optional(),
            minutes: z.number().optional().default(30),
            limit: z.number().optional().default(100)
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('cloudwatch')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const logs = client('logs', CloudWatchLogsClient);
                const end = Date.now();
                const start = end - (args.minutes) * 60 * 1000;
                const logGroup = args.log_group_name || `/aws/lambda/${args.service || ''}`;
                const resp = await logs.send(new FilterLogEventsCommand({
                    logGroupName: logGroup,
                    startTime: start,
                    endTime: end,
                    filterPattern: '?"ERROR" ?Exception ?Traceback',
                    limit: args.limit
                }));
                const events = (resp.events || []).map((e) => ({ message: e.message, timestamp: e.timestamp, logStreamName: e.logStreamName }));
                return { content: [{ type: 'text', text: JSON.stringify({ logGroup, events }) }] };
            } catch (err) {
                return normalizeError(err.message, 'AWS_ERROR', err);
            }
        }
    );

    server.tool(
        'aws_incident_summarize_service_health',
        {
            namespace: z.string(),
            metric_error: z.string(),
            metric_count: z.string(),
            dimensions: z.array(z.record(z.string(), z.any())),
            minutes: z.number().optional().default(30)
        },
        async (args) => {
            try {
                requireConfigured();
                if (!allowed('cloudwatch')) return normalizeError('Service not allowed', 'ACCESS_DENIED');
                const cw = client('cloudwatch', CloudWatchClient);
                const end = new Date();
                const start = new Date(end.getTime() - (args.minutes) * 60 * 1000);
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

    return server;
}

if (require.main === module) {
    const server = createAwsServer();
    const transport = new StdioServerTransport();
    server.connect(transport).then(() => {
        console.error('AWS MCP server running on stdio');
    }).catch((error) => {
        console.error("Server error:", error);
        process.exit(1);
    });
}

module.exports = { 
    createAwsServer, 
    STSClient, S3Client, LambdaClient, CloudWatchLogsClient, ECSClient, 
    EKSClient, EC2Client, IAMClient, SQSClient, SNSClient, CloudWatchClient,
    AutoScalingClient, DynamoDBClient, RDSDataClient, SecretsManagerClient,
    SSMClient, ApiGatewayClient, CloudFormationClient, BedrockClient,
    BedrockRuntimeClient, SFNClient, GetCallerIdentityCommand, ListBucketsCommand
};
