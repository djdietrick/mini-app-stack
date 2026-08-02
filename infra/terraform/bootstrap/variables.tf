variable "admin_project" {
  description = "Project that owns the state bucket, deployer SA and WIF pool. Can be the prod project."
  type        = string
}

variable "managed_projects" {
  description = "Projects the CI deployer is allowed to manage (staging and prod)."
  type        = list(string)
}

variable "github_repo" {
  description = "owner/repo allowed to impersonate the deployer over OIDC."
  type        = string
}

variable "state_bucket" {
  description = "Globally unique GCS bucket name for Terraform remote state."
  type        = string
}

variable "region" {
  description = "Default region."
  type        = string
  default     = "us-central1"
}
