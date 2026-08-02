output "workload_identity_provider" {
  description = "Set as the GCP_WORKLOAD_IDENTITY_PROVIDER GitHub repository variable."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deployer_service_account" {
  description = "Set as the GCP_DEPLOYER_SA GitHub repository variable."
  value       = google_service_account.deployer.email
}

output "state_bucket" {
  description = "Set as the TF_STATE_BUCKET GitHub repository variable."
  value       = google_storage_bucket.tf_state.name
}
