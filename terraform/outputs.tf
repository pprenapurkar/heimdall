output "cluster_arn" {
  description = "Set as AURORA_CLUSTER_ARN in Vercel env"
  value       = aws_rds_cluster.this.arn
}

output "secret_arn" {
  description = "Set as AURORA_SECRET_ARN in Vercel env"
  value       = aws_secretsmanager_secret.db.arn
}

output "database_name" {
  description = "Set as AURORA_DATABASE in Vercel env"
  value       = aws_rds_cluster.this.database_name
}

output "cluster_endpoint" {
  description = "Writer endpoint (for one-time psql schema apply)"
  value       = aws_rds_cluster.this.endpoint
}

output "bedrock_role_arn" {
  description = "IAM role the cluster uses to call Bedrock from SQL (Aurora ML)"
  value       = aws_iam_role.bedrock.arn
}
