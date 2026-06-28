# ============================================================================
# TraceJudge — Aurora PostgreSQL Serverless v2 with RDS Data API + Aurora ML.
# ----------------------------------------------------------------------------
# Provisions the production "control plane" that the Vercel app talks to over the
# connection-free RDS Data API. Aurora ML (X2) is enabled via an IAM role that
# lets the cluster call Amazon Bedrock from SQL.
#
# This is a reference module for the operator (see DEPLOY.md). Review CIDRs,
# region, and capacity before `terraform apply`. Costs accrue while running.
# ============================================================================

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region = var.region
}

# --- Networking: use the default VPC for a quick demo deploy -----------------
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.name}-subnets"
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_security_group" "db" {
  name        = "${var.name}-db-sg"
  description = "TraceJudge Aurora access"
  vpc_id      = data.aws_vpc.default.id

  # The RDS Data API is reached via the AWS API (HTTPS), not direct TCP, so no
  # public 5432 ingress is required for the Vercel path. This rule is for
  # optional psql access from your own IP during setup.
  ingress {
    description = "Postgres from admin CIDR (setup only)"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = var.admin_cidrs
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# --- Master credentials in Secrets Manager (referenced by the Data API) ------
resource "random_password" "master" {
  length  = 24
  special = false
}

resource "aws_secretsmanager_secret" "db" {
  name = "${var.name}/master"
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({
    username = var.master_username
    password = random_password.master.result
  })
}

# --- IAM role so Aurora can invoke Bedrock from SQL (Aurora ML, X2) ----------
data "aws_iam_policy_document" "rds_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "bedrock" {
  name               = "${var.name}-aurora-bedrock"
  assume_role_policy = data.aws_iam_policy_document.rds_assume.json
}

data "aws_iam_policy_document" "bedrock" {
  statement {
    actions   = ["bedrock:InvokeModel"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "bedrock" {
  name   = "invoke-bedrock"
  role   = aws_iam_role.bedrock.id
  policy = data.aws_iam_policy_document.bedrock.json
}

# --- Aurora PostgreSQL Serverless v2 cluster --------------------------------
resource "aws_rds_cluster" "this" {
  cluster_identifier   = var.name
  engine               = "aurora-postgresql"
  engine_mode          = "provisioned" # Serverless v2 runs under provisioned mode
  engine_version       = var.engine_version
  database_name        = var.database_name
  master_username      = var.master_username
  master_password      = random_password.master.result
  db_subnet_group_name = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]

  # Connection-free access for serverless frontends (Vercel).
  enable_http_endpoint = true # RDS Data API

  # Let the cluster call Bedrock from SQL (Aurora ML).
  iam_roles = [aws_iam_role.bedrock.arn]

  serverlessv2_scaling_configuration {
    min_capacity = var.min_acu
    max_capacity = var.max_acu
  }

  skip_final_snapshot = true
  apply_immediately   = true
}

resource "aws_rds_cluster_instance" "this" {
  identifier          = "${var.name}-1"
  cluster_identifier  = aws_rds_cluster.this.id
  engine              = aws_rds_cluster.this.engine
  engine_version      = aws_rds_cluster.this.engine_version
  instance_class      = "db.serverless"
  # Only needed for one-time psql schema apply; the Vercel app uses the Data API.
  # Set false (and clear admin_cidrs) after setup to lock the cluster down.
  publicly_accessible = var.publicly_accessible
}
