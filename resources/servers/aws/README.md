## AWS MCP Server

### Configure at runtime
Call `aws.configure` (in-memory only):
```json
{
  "region": "us-east-1",
  "credentials": {
    "access_key_id": "AKIA...",
    "secret_access_key": "...",
    "session_token": "..."
  },
  "services": ["s3", "lambda", "cloudwatch"]
}
```
Validation uses STS GetCallerIdentity; credentials are not logged or persisted.

### Tools
- Core: `aws.configure`, `aws.health` (STS identity)
- S3: `aws.s3.listBuckets`, `aws.s3.listObjects`, `aws.s3.getObject`, `aws.s3.putObject`
- Lambda: `aws.lambda.listFunctions`, `aws.lambda.getFunction`, `aws.lambda.invoke`
- CloudWatch Logs: `aws.logs.listLogGroups`, `aws.logs.getLogStreams`, `aws.logs.getLogEvents` (supports filterPattern/time)
- ECS: `aws.ecs.listClusters`, `aws.ecs.listServices`, `aws.ecs.describeService`, `aws.ecs.updateService`
- EKS: `aws.eks.listClusters`, `aws.eks.describeCluster`, `aws.eks.updateKubeconfigToken` (placeholder, not implemented)
- EC2: `aws.ec2.listInstances`, `aws.ec2.describeInstance`, `aws.ec2.startInstance`, `aws.ec2.stopInstance`
- IAM (read-only): `aws.iam.getCallerIdentity`, `aws.iam.listRoles`, `aws.iam.getRole`
- SQS: `aws.sqs.listQueues`, `aws.sqs.receiveMessages`, `aws.sqs.sendMessage`
- SNS: `aws.sns.listTopics`, `aws.sns.publish`
- Incident helpers: `aws.incident.findErrors` (logs), `aws.incident.summarizeServiceHealth` (CloudWatch metrics)

### Error shape
All errors: `{ "error": { "message": "...", "code": "AWS_ERROR|ACCESS_DENIED|NOT_FOUND|NOT_CONFIGURED|NOT_IMPLEMENTED", "details": "...", "http_status": 400 } }`

### Notes
- Services can be constrained via `services` list in `aws.configure`.
- No credentials or secrets are logged; all state is memory-only for the session.
- `aws.eks.updateKubeconfigToken` is a placeholder in this MVP.
