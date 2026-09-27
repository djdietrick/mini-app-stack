variable "project" { type = string }
variable "authorized_domains" {
  description = "Domains allowed to complete sign-in. Hosting default domains plus any custom domain."
  type        = list(string)
}

/**
 * Firebase Auth (Identity Platform) config.
 *
 * Email/password only, matching what apps/auth offers today. Adding Google or
 * Apple sign-in later is a provider block here plus a button in @stack/auth-ui;
 * nothing in the apps changes, because they only ever see a verified session.
 */
resource "google_identity_platform_config" "this" {
  project = var.project

  sign_in {
    allow_duplicate_emails = false

    email {
      enabled = true
      # Verification is opt-in per user rather than blocking first sign-in,
      # matching shared.users.email_verified_at being nullable today.
      password_required = true
    }
  }

  authorized_domains = var.authorized_domains
}

output "config_name" {
  value = google_identity_platform_config.this.name
}
