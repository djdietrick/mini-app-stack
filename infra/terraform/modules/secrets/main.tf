variable "project" { type = string }
variable "names" {
  description = "Secret ids to create. Values are added out of band, never by Terraform."
  type        = list(string)
}
variable "accessor_members" {
  description = "IAM members granted secretAccessor on every secret (the function runtime SAs)."
  type        = list(string)
  default     = []
}

/**
 * Creates Secret Manager secrets but deliberately not their versions. Putting
 * a value in a terraform variable would write it to state in plaintext; state
 * lives in a GCS bucket that CI can read. Add versions once per environment:
 *
 *   printf '%s' "$VALUE" | gcloud secrets versions add <name> \
 *     --project <project> --data-file=-
 */
resource "google_secret_manager_secret" "this" {
  for_each  = toset(var.names)
  project   = var.project
  secret_id = each.key

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_iam_member" "accessors" {
  for_each = {
    for pair in setproduct(var.names, var.accessor_members) :
    "${pair[0]}|${pair[1]}" => { secret = pair[0], member = pair[1] }
  }

  project   = var.project
  secret_id = google_secret_manager_secret.this[each.value.secret].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = each.value.member
}

output "secret_ids" {
  value = [for s in google_secret_manager_secret.this : s.secret_id]
}
