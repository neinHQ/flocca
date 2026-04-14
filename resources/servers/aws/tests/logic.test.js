const { createAwsServer } = require('../server');
const { STSClient } = require('@aws-sdk/client-sts');
const { S3Client } = require('@aws-sdk/client-s3');
const { EC2Client } = require('@aws-sdk/client-ec2');

jest.mock('@aws-sdk/client-sts');
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/client-ec2');

describe('AWS MCP Logic', () => {
    let server;
    let mockSts;
    let mockS3;
    let mockEc2;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.AWS_REGION = 'us-east-1';
        process.env.AWS_ACCESS_KEY_ID = 'test';
        process.env.AWS_SECRET_ACCESS_KEY = 'test';
        
        mockSts = { send: jest.fn() };
        mockS3 = { send: jest.fn() };
        mockEc2 = { send: jest.fn() };
        
        STSClient.prototype.send = mockSts.send;
        S3Client.prototype.send = mockS3.send;
        EC2Client.prototype.send = mockEc2.send;
        
        server = createAwsServer();
    });

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return await tool.handler(args);
    };

    describe('aws_health', () => {
        it('should verify identity', async () => {
            mockSts.send.mockResolvedValue({ Arn: 'arn:aws:iam::123:user/test' });
            const res = await callTool('aws_health');
            const data = JSON.parse(res.content[0].text);
            expect(data.ok).toBe(true);
            expect(data.identity).toContain('test');
        });
    });

    describe('aws_s3_list_buckets', () => {
        it('should list buckets', async () => {
            mockS3.send.mockResolvedValue({ Buckets: [{ Name: 'b1' }] });
            const res = await callTool('aws_s3_list_buckets');
            const data = JSON.parse(res.content[0].text);
            expect(data.buckets).toHaveLength(1);
            expect(data.buckets[0].Name).toBe('b1');
        });
    });

    describe('aws_ec2_start_instance', () => {
        it('should block if not confirmed', async () => {
            const res = await callTool('aws_ec2_start_instance', { instance_id: 'i-1', confirm: false });
            expect(res.isError).toBe(true);
            expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
        });

        it('should start if confirmed', async () => {
            mockEc2.send.mockResolvedValue({});
            const res = await callTool('aws_ec2_start_instance', { instance_id: 'i-1', confirm: true });
            expect(res.content[0].text).toContain('starting');
        });
    });
});
