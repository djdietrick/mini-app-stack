terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
  }

  # Bucket is supplied by CI: -backend-config=bucket=$TF_STATE_BUCKET
  backend "gcs" {
    prefix = "mini-app-stack/staging"
  }
}

# Bill API quota to this project rather than to the caller's credentials.
# Local Application Default Credentials otherwise attribute calls to Google's
# own gcloud client project, and identitytoolkit.googleapis.com (Firebase Auth
# config) rejects that with "requires a quota project". Harmless under CI's
# service account, which already belongs to a project.
provider "google" {
  project               = var.project
  region                = var.region
  billing_project       = var.project
  user_project_override = true
}

provider "google-beta" {
  project               = var.project
  region                = var.region
  billing_project       = var.project
  user_project_override = true
}

module "env" {
  source = "../../modules/environment"

  project = var.project
  env     = "staging"
  region  = var.region

  # Staging is meant to be disposable — every PR preview writes into it, and
  # being able to tear it down and rebuild is worth more than the data.
  deletion_protection = false
}

output "hosting_sites" { value = module.env.hosting_sites }
output "hosting_urls" { value = module.env.hosting_urls }
output "function_service_accounts" { value = module.env.function_service_accounts }

# Feed these into the VITE_FIREBASE_* GitHub variables.
output "web_config" { value = module.env.web_config }
