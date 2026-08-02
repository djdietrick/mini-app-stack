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
    prefix = "mini-app-stack/prod"
  }
}

provider "google" {
  project = var.project
  region  = var.region
}

provider "google-beta" {
  project = var.project
  region  = var.region
}

module "env" {
  source = "../../modules/environment"

  project = var.project
  env     = "prod"
  region  = var.region

  # Real data lives here; a stray destroy must not be able to take Firestore
  # with it.
  deletion_protection = true

  extra_authorized_domains = var.extra_authorized_domains
}

output "hosting_sites" { value = module.env.hosting_sites }
output "hosting_urls" { value = module.env.hosting_urls }
output "function_service_accounts" { value = module.env.function_service_accounts }

# Feed these into the VITE_FIREBASE_* GitHub variables.
output "web_config" { value = module.env.web_config }
