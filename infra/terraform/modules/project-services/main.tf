variable "project" { type = string }

/**
 * Every API the cloud target needs. Firebase in particular fails with opaque
 * errors when one of these is missing, so they are all declared explicitly
 * rather than being enabled ad hoc by the Firebase CLI.
 */
resource "google_project_service" "this" {
  for_each = toset([
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
    "firebase.googleapis.com",
    "firebasehosting.googleapis.com",
    "firebaserules.googleapis.com",
    "identitytoolkit.googleapis.com",
    "firestore.googleapis.com",
    "cloudfunctions.googleapis.com",
    "cloudbuild.googleapis.com",
    "run.googleapis.com",
    "eventarc.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudscheduler.googleapis.com",
    "secretmanager.googleapis.com",
    "iam.googleapis.com",
    "logging.googleapis.com",
  ])

  project = var.project
  service = each.key

  # Turning an API off can break resources that outlive this config.
  disable_on_destroy = false
}

output "enabled" {
  value = [for s in google_project_service.this : s.service]
}
