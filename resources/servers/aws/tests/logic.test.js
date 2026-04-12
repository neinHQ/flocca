const { createAwsServer, STSClient, S3Client, GetCallerIdentityCommand, ListBucketsCommand } = require('../server');

const mockStsSend = jest.fn();
const mockS3Send = jest.fn();

jest.mock('@aws-sdk/client-sts', () => ({
    STSClient: jest.fn().mockImplementation(() => ({
        send: mockStsSend,
        middlewareStack: { add: jest.fn() }
    })),
    GetCallerIdentityCommand: jest.fn()
}));

jest.mock('@aws-sdk/client-s3', () => ({
    S3Client: jest.fn().mockImplementation(() => ({
        send: mockS3Send,
        middlewareStack: { add: jest.fn() }
    })),
    ListBucketsCommand: jest.fn(),
    ListObjectsV2Command: jest.fn()
}));

describe('AWS MCP Logic Tests', () => {
    let server;

    beforeEach(() => {
        jest.clearAllMocks();
        server = createAwsServer();
        // Set up default mocks
        mockStsSend.mockResolvedValue({ Arn: 'arn:aws:iam::123456789012:user/test' });
        mockS3Send.mockResolvedValue({ Buckets: [{ Name: 'my-bucket', CreationDate: '2024-01-01' }] });
    });

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return await tool.handler(args);
    };

    describe('aws_health', () => {
        it('should verify identity using STS', async () => {
            const res = await callTool('aws_health');
            const data = JSON.parse(res.content[0].text);
            expect(data.ok).toBe(true);
            expect(data.identity).toContain('123456789012');
        });
    });

    describe('aws_s3_list_buckets', () => {
        it('should return bucket list from S3 client', async () => {
            // Ensure environment is "configured" for test
            process.env.AWS_REGION = 'us-east-1';
            process.env.AWS_ACCESS_KEY_ID = 'test';
            process.env.AWS_SECRET_ACCESS_KEY = 'test';

            const res = await callTool('aws_s3_list_buckets');
            const data = JSON.parse(res.content[0].text);
            
            expect(data.buckets[0].name).toBe('my-bucket');
            expect(mockS3Send).toHaveBeenCalledWith(expect.any(ListBucketsCommand));
        });
    });

    describe('aws_configure', () => {
        it('should update session config and verify via STS', async () => {
            const res = await callTool('aws_configure', {
                region: 'us-west-2',
                credentials: { access_key_id: 'AK', secret_access_key: 'SK' }
            });
            expect(res.content[0].text).toContain('"ok":true');
        });
    });
});
