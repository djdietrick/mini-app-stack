variable "project" { type = string }
variable "app" {
  description = "App name, e.g. \"crate\". Becomes the Hosting site id."
  type        = string
}
variable "env" {
  description = "staging | prod. Part of the site id so both can exist in one org."
  type        = string
}

/**
 * Per-app cloud footprint: one Firebase Hosting site and one service account
 * that this app's function runs as.
 *
 * Per-app service accounts rather than the shared default compute SA, so
 * pantry's function cannot read crate's secrets. Cheap to do now, painful to
 * retrofit once every function is running as one identity.
 *
 * Hosting *content and rewrites* are not here — they are in firebase.json,
 * deployed by the Firebase CLI.
 */
resource "google_firebase_hosting_site" "this" {
  provider = google-beta
  project  = var.project
  site_id  = "${var.app}-${var.env}"
}

/**
 * The Firebase *web app* registration. Creating it is what produces the web
 * API key and auth domain the SPA needs, so those values come out of
 * `terraform output` rather than being copied by hand out of the console.
 *
 * The API key is public by design — it ships in every SPA bundle and only
 * identifies the project. It is not a credential; firestore.rules is deny-all
 * precisely so that this key grants no data access.
 */
resource "google_firebase_web_app" "this" {
  provider     = google-beta
  project      = var.project
  display_name = "${var.app} (${var.env})"

  # Keep the registration if the app is removed from the apps list; deleting it
  # would invalidate the API key baked into already-deployed bundles.
  deletion_policy = "ABANDON"
}

data "google_firebase_web_app_config" "this" {
  provider   = google-beta
  project    = var.project
  web_app_id = google_firebase_web_app.this.app_id
}

resource "google_service_account" "function" {
  project      = var.project
  account_id   = "fn-${var.app}-${var.env}"
  display_name = "${var.app} (${var.env}) function runtime"
}

# Read/write its own data, and nothing else. Firestore has no per-collection
# IAM, so isolation between apps comes from collection prefixes plus deny-all
# security rules — not from this binding. Documented so nobody assumes
# otherwise.
#
# Notably absent: an app function needs no Firebase Auth permission at all.
# verifySessionCookie validates a JWT against public certificates, so reading
# the caller's identity requires no IAM. Only the auth function, which *mints*
# cookies, needs anything more — see modules/environment.
resource "google_project_iam_member" "firestore" {
  project = var.project
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.function.email}"
}

output "site_id" {
  value = google_firebase_hosting_site.this.site_id
}

output "default_url" {
  value = google_firebase_hosting_site.this.default_url
}

output "service_account_email" {
  value = google_service_account.function.email
}

output "web_api_key" {
  description = "VITE_FIREBASE_API_KEY. Public by design; safe to expose."
  value       = data.google_firebase_web_app_config.this.api_key
}

output "web_auth_domain" {
  description = "VITE_FIREBASE_AUTH_DOMAIN."
  value       = data.google_firebase_web_app_config.this.auth_domain
}

output "service_account_member" {
  value = "serviceAccount:${google_service_account.function.email}"
}
