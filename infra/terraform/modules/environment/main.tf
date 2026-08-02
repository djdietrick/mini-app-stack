variable "project" { type = string }
variable "env" { type = string }
variable "region" {
  type    = string
  default = "us-central1"
}
variable "firestore_location" {
  type    = string
  default = "nam5"
}
variable "apps" {
  description = "Apps that get a Hosting site and a function service account."
  type        = list(string)
  default     = ["crate", "pantry", "ytdigest"]
}
variable "deletion_protection" {
  type    = bool
  default = true
}
variable "extra_authorized_domains" {
  description = "Custom domains beyond the Hosting defaults."
  type        = list(string)
  default     = []
}

/**
 * One whole environment. envs/staging and envs/prod are thin wrappers around
 * this so the two cannot drift structurally — only in the variables that are
 * genuinely meant to differ (project, deletion protection, domains).
 */

module "services" {
  source  = "../project-services"
  project = var.project
}

# Must exist before any google_firebase_* resource in this project.
module "firebase" {
  source  = "../firebase-project"
  project = var.project

  depends_on = [module.services]
}

module "firestore" {
  source              = "../firestore"
  project             = var.project
  location            = var.firestore_location
  deletion_protection = var.deletion_protection

  depends_on = [module.services]
}

module "sites" {
  source   = "../app-site"
  for_each = toset(var.apps)

  project = var.project
  app     = each.key
  env     = var.env

  depends_on = [module.firebase]
}

module "identity" {
  source  = "../identity"
  project = var.project

  authorized_domains = concat(
    ["localhost", "${var.project}.firebaseapp.com", "${var.project}.web.app"],
    [for app in var.apps : "${app}-${var.env}.web.app"],
    var.extra_authorized_domains,
  )

  depends_on = [module.firebase]
}

/**
 * Secrets every environment needs. AUTH_VERIFY_SECRET is absent on purpose —
 * it only exists for the self-hosted apps/auth service-to-service call, which
 * Firebase Auth replaces in the cloud.
 */
module "secrets" {
  source  = "../secrets"
  project = var.project

  names = [
    "youtube-api-key",
    "mail-api-key",
  ]

  accessor_members = [for app, site in module.sites : site.service_account_member]

  depends_on = [module.services]
}

output "hosting_sites" {
  value = { for app, site in module.sites : app => site.site_id }
}

output "hosting_urls" {
  value = { for app, site in module.sites : app => site.default_url }
}

output "function_service_accounts" {
  value = { for app, site in module.sites : app => site.service_account_email }
}

/**
 * Frontend build config. Set these as the VITE_FIREBASE_* GitHub variables;
 * they are public values that ship in the SPA bundle, not secrets.
 */
output "web_config" {
  value = {
    for app, site in module.sites : app => {
      apiKey     = site.web_api_key
      authDomain = site.web_auth_domain
      projectId  = var.project
    }
  }
}
