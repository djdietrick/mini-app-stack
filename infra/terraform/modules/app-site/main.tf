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

resource "google_service_account" "function" {
  project      = var.project
  account_id   = "fn-${var.app}-${var.env}"
  display_name = "${var.app} (${var.env}) function runtime"
}

# Read/write its own data. Firestore has no per-collection IAM, so isolation
# between apps comes from collection prefixes plus deny-all security rules —
# not from this binding. Documented so nobody assumes otherwise.
resource "google_project_iam_member" "firestore" {
  project = var.project
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.function.email}"
}

# Mint and verify Firebase Auth session cookies.
resource "google_project_iam_member" "token_creator" {
  project = var.project
  role    = "roles/iam.serviceAccountTokenCreator"
  member  = "serviceAccount:${google_service_account.function.email}"
}

resource "google_project_iam_member" "firebase_auth" {
  project = var.project
  role    = "roles/firebaseauth.admin"
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

output "service_account_member" {
  value = "serviceAccount:${google_service_account.function.email}"
}
