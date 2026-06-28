variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "name" {
  description = "Name prefix for all resources"
  type        = string
  default     = "tracejudge"
}

variable "database_name" {
  description = "Initial database name"
  type        = string
  default     = "tracejudge"
}

variable "master_username" {
  description = "Aurora master username"
  type        = string
  default     = "tracejudge"
}

variable "engine_version" {
  description = "Aurora PostgreSQL engine version (16.x, must support Data API + pgvector)"
  type        = string
  default     = "16.4"
}

variable "min_acu" {
  description = "Serverless v2 minimum Aurora Capacity Units"
  type        = number
  default     = 0.5
}

variable "max_acu" {
  description = "Serverless v2 maximum Aurora Capacity Units"
  type        = number
  default     = 4
}

variable "admin_cidrs" {
  description = "CIDRs allowed direct psql (5432) access for one-time setup"
  type        = list(string)
  default     = [] # set to ["YOUR.IP/32"] only if you need psql; the app uses the Data API
}

variable "publicly_accessible" {
  description = "Expose the instance for one-time psql schema apply. Set false after setup."
  type        = bool
  default     = true
}
