variable "project" { type = string }
variable "location" {
  description = "Firestore location. Immutable once the database exists."
  type        = string
  default     = "nam5"
}
variable "deletion_protection" {
  type    = bool
  default = true
}

/**
 * One native-mode Firestore database per environment.
 *
 * Composite indexes and security rules are NOT here — they live in
 * firestore.indexes.json / firestore.rules and are deployed by the Firebase
 * CLI, which is where they are actually readable and reviewable.
 */
resource "google_firestore_database" "this" {
  project     = var.project
  name        = "(default)"
  location_id = var.location
  type        = "FIRESTORE_NATIVE"

  # Guards against an accidental `terraform destroy` taking the data with it.
  # Staging sets this false so the environment can be torn down cheaply.
  deletion_policy = var.deletion_protection ? "DELETE_PROTECTION_ENABLED" : "DELETE"
}

/**
 * TTL policies backing service-kit's CacheStore and Lease.
 *
 * Firestore's TTL is a per-collection policy on a timestamp field, not a
 * per-key expiry, and deletion is asynchronous — it can lag by hours. The
 * application still compares expiresAt on read; these policies exist to
 * reclaim storage, not to enforce correctness.
 */
resource "google_firestore_field" "cache_ttl" {
  project    = var.project
  database   = google_firestore_database.this.name
  collection = "_cache"
  field      = "expiresAt"

  ttl_config {}

  # A TTL field should never be indexed for querying; we only ever read by id.
  index_config {}
}

resource "google_firestore_field" "lock_ttl" {
  project    = var.project
  database   = google_firestore_database.this.name
  collection = "_locks"
  field      = "expiresAt"

  ttl_config {}
  index_config {}
}

output "database_name" {
  value = google_firestore_database.this.name
}
