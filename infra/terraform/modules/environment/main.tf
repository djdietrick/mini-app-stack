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
  default     = ["crate", "pantry", "ytdigest", "fretwork"]
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

/**
 * Hosting site ids share one namespace across every Firebase project, so a
 * plain `crate-prod` collides with somebody else's. A short hash of the project
 * id is stable across applies and unique per project, and needs no choosing or
 * coordinating. The site's real URL comes out of the hosting_sites output.
 */
locals {
  site_suffix = substr(sha1(var.project), 0, 5)
}

module "sites" {
  source   = "../app-site"
  for_each = toset(var.apps)

  project     = var.project
  app         = each.key
  env         = var.env
  site_suffix = local.site_suffix

  depends_on = [module.firebase]
}

/**
 * The landing page: a static list of the apps above, with no function, no
 * service account and no web app registration, because it never signs anyone
 * in. Same naming scheme as the app sites, so .firebaserc can be filled in
 * before the first apply creates it.
 */
resource "google_firebase_hosting_site" "landing" {
  provider = google-beta
  project  = var.project
  site_id  = "landing-${var.env}-${local.site_suffix}"

  depends_on = [module.firebase]
}

module "identity" {
  source  = "../identity"
  project = var.project

  authorized_domains = concat(
    ["localhost", "${var.project}.firebaseapp.com", "${var.project}.web.app"],
    # Every Hosting site answers on both of these; Google sign-in fails on
    # whichever one is missing here.
    flatten([for app, site in module.sites : ["${site.site_id}.web.app", "${site.site_id}.firebaseapp.com"]]),
    var.extra_authorized_domains,
  )

  depends_on = [module.firebase]
}

/**
 * Runtime identity for the authApi function.
 *
 * Separate from the per-app service accounts because authApi is app-agnostic —
 * every app's /auth/* rewrite points at it — and because it is the only
 * function that needs Firebase Auth write access. Borrowing crate's identity
 * would hand crate the ability to mint session cookies for anyone.
 */
resource "google_service_account" "auth_function" {
  project      = var.project
  account_id   = "fn-auth-${var.env}"
  display_name = "auth (${var.env}) function runtime"

  depends_on = [module.services]
}

# Writes the users/{uid} mirror doc on session mint.
resource "google_project_iam_member" "auth_firestore" {
  project = var.project
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.auth_function.email}"
}

# verifyIdToken / revokeRefreshTokens.
resource "google_project_iam_member" "auth_admin" {
  project = var.project
  role    = "roles/firebaseauth.admin"
  member  = "serviceAccount:${google_service_account.auth_function.email}"
}

/**
 * createSessionCookie signs a JWT through the IAM signBlob API, which requires
 * the service account to be able to act as *itself*.
 *
 * Scoped to this one service account deliberately. The same role granted at
 * the project level — which is what this replaced — would let the function
 * impersonate every service account in the project, turning a bug in the auth
 * function into full lateral movement.
 */
resource "google_service_account_iam_member" "auth_self_signer" {
  service_account_id = google_service_account.auth_function.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.auth_function.email}"
}

/**
 * Secrets every environment needs. AUTH_VERIFY_SECRET is absent on purpose —
 * it only exists for the self-hosted apps/auth service-to-service call, which
 * Firebase Auth replaces in the cloud.
 *
 * The ids are the names functions/src/index.ts binds with defineSecret(), and
 * Firebase requires those to be valid env var names, so they are upper case.
 * Only ytdigest's function can read them; no other app needs either.
 */
module "secrets" {
  source  = "../secrets"
  project = var.project

  names = [
    "YOUTUBE_API_KEY",
    "SMTP_PASSWORD",
  ]

  accessor_members = [
    for app, site in module.sites : site.service_account_member if app == "ytdigest"
  ]

  depends_on = [module.services]
}

output "hosting_sites" {
  value = merge(
    { for app, site in module.sites : app => site.site_id },
    { landing = google_firebase_hosting_site.landing.site_id },
  )
}

output "hosting_urls" {
  value = merge(
    { for app, site in module.sites : app => site.default_url },
    { landing = google_firebase_hosting_site.landing.default_url },
  )
}

/**
 * Feed these into the *_FUNCTION_SA GitHub variables. functions/src/index.ts
 * reads them at deploy time so each function runs as its own identity instead
 * of the default compute service account, which carries project Editor.
 */
output "function_service_accounts" {
  value = merge(
    { for app, site in module.sites : app => site.service_account_email },
    { auth = google_service_account.auth_function.email },
  )
}

/**
 * Register every one of these as an "Authorized redirect URI" on the Google
 * OAuth client Firebase uses for Google sign-in (Google Cloud console → APIs &
 * Services → Credentials → "Web client (auto created by Google Service)").
 *
 * Each app is its own authDomain, so Google sign-in completes on the app's own
 * origin (see sameOriginAuthDomain in @stack/auth-ui). OAuth clients have no
 * API, so this list cannot be applied from here.
 */
output "oauth_redirect_uris" {
  value = flatten([
    for app, site in module.sites : [
      "https://${site.site_id}.web.app/__/auth/handler",
      "https://${site.site_id}.firebaseapp.com/__/auth/handler",
    ]
  ])
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
