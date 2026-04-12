## AWS MCP Server

### Configure at runtime
Call `aws_configure` (in-memory only):
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
- Core: `aws_configure`, `aws_health` (STS identity)
- S3: `aws_s3_list_buckets`, `aws_s3_list_objects`, `aws_s3_get_object`, `aws_s3_put_object`
- Lambda: `aws_lambda_list_functions`, `aws_lambda_get_function`, `aws_lambda_invoke`
- CloudWatch Logs: `aws_logs_list_log_groups`, `aws_logs_get_log_streams`, `aws_logs_get_log_events` (supports filterPattern/time)
- ECS: `aws_ecs_list_clusters`, `aws_ecs_list_services`, `aws_ecs_describe_service`, `aws_ecs_update_service`
- EC2: `aws_ec2_list_instances`, `aws_ec2_describe_instance`, `aws_ec2_start_instance`, `aws_ec2_stop_instance`, `aws_ec2_describe_security_groups`, `aws_ec2_describe_subnets`
- Data: `aws_dynamodb_list_tables`, `aws_dynamodb_describe_table`, `aws_dynamodb_get_item`, `aws_dynamodb_put_item`, `aws_dynamodb_query`, `aws_rds_execute_statement`
- Configuration: `aws_secrets_get_value`, `aws_ssm_get_parameter`
- Infrastructure: `aws_apigateway_list_rest_apis`, `aws_apigateway_get_resources`, `aws_cloudformation_describe_stacks`
- AI & Orchestration: `aws_bedrock_list_foundation_models`, `aws_bedrock_invoke_model`, `aws_sfn_start_execution`
- DevOps & Monitor: `aws_cloudwatch_describe_alarms`, `aws_autoscaling_describe_auto_scaling_groups`
- IAM (read-only): `aws_iam_get_caller_identity`, `aws_iam_list_roles`, `aws_iam_get_role`
- SQS/SNS: `aws_sqs_list_queues`, `aws_sns_list_topics`, `aws_sns_publish`
- Incident helpers: `aws_incident_find_errors`, `aws_incident_summarize_service_health`

### Error shape
All errors: `{ "error": { "message": "...", "code": "AWS_ERROR|ACCESS_DENIED|NOT_FOUND|NOT_CONFIGURED|NOT_IMPLEMENTED", "details": "...", "http_status": 400 } }`

### Notes
- Services can be constrained via `services` list in `aws_configure`.
- No credentials or secrets are logged; all state is memory-only for the session.
- `aws_eks_update_kubeconfig_token` is a placeholder in this MVP.
