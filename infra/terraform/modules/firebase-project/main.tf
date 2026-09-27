terraform {
  required_providers {
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
  }
}

variable "project" { type = string }

/**
 * Turns a plain GCP project into a Firebase project.
 *
 * This is not the same thing as enabling firebase.googleapis.com. A GCP
 * project with the API on is still not a Firebase project, and every
 * google_firebase_* resource — Hosting sites included — fails against one
 * until this exists. It is the first thing that must be created in a new
 * environment.
 *
 * Irreversible: a project cannot be un-Firebased, which is why destroy is
 * blocked rather than silently no-oping.
 */
resource "google_firebase_project" "this" {
  provider = google-beta
  project  = var.project

  lifecycle {
    prevent_destroy = true
  }
}

output "project" {
  value = google_firebase_project.this.project
}
