/**
 * Run once, by hand, with local state. Creates the things every later
 * terraform run depends on: the remote state bucket, the CI deployer service
 * account, and the Workload Identity Federation pool that lets GitHub Actions
 * impersonate it over OIDC — so no long-lived service account JSON key ever
 * exists or needs to be pasted into a GitHub secret.
 */
terraform {
  required_version = ">= 1.6"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
  # Local state on purpose: this is what creates the remote backend.
}

provider "google" {
  project = var.admin_project
  region  = var.region
}

resource "google_project_service" "bootstrap" {
  for_each = toset([
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "storage.googleapis.com",
    "serviceusage.googleapis.com",
  ])
  service            = each.key
  disable_on_destroy = false
}

# ---------------------------------------------------------------- state bucket

resource "google_storage_bucket" "tf_state" {
  name     = var.state_bucket
  location = var.region
  project  = var.admin_project

  uniform_bucket_level_access = true
  # Terraform state is the record of what exists; keep history so a corrupt
  # apply can be rolled back.
  versioning { enabled = true }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.bootstrap]
}

# ------------------------------------------------------------- deployer + WIF

resource "google_service_account" "deployer" {
  account_id   = "gh-deployer"
  display_name = "GitHub Actions deployer"
  project      = var.admin_project
  depends_on   = [google_project_service.bootstrap]
}

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github-pool"
  display_name              = "GitHub Actions"
  project                   = var.admin_project
  depends_on                = [google_project_service.bootstrap]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-provider"
  project                            = var.admin_project

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  # Without this condition, ANY GitHub repository in the world could mint
  # tokens for this pool. Scope it to the one repo.
  attribute_condition = "assertion.repository == '${var.github_repo}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# Only workflows in this repository may impersonate the deployer.
resource "google_service_account_iam_member" "github_impersonation" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}

resource "google_storage_bucket_iam_member" "deployer_state" {
  bucket = google_storage_bucket.tf_state.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.deployer.email}"
}

# The deployer needs to manage resources in each app project. Granted per
# project rather than at the org level so its blast radius stays visible.
resource "google_project_iam_member" "deployer_roles" {
  for_each = {
    for pair in setproduct(var.managed_projects, [
      "roles/editor",
      "roles/iam.serviceAccountAdmin",
      "roles/resourcemanager.projectIamAdmin",
      "roles/secretmanager.admin",
      "roles/firebase.admin",
    ]) : "${pair[0]}|${pair[1]}" => { project = pair[0], role = pair[1] }
  }
  project = each.value.project
  role    = each.value.role
  member  = "serviceAccount:${google_service_account.deployer.email}"
}
