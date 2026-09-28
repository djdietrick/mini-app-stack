variable "project" { type = string }
variable "authorized_domains" {
  description = "Domains allowed to complete sign-in. Hosting default domains plus any custom domain."
  type        = list(string)
}

/**
 * Firebase Auth (Identity Platform) config.
 *
 * Email/password here. Google sign-in is also on, but enabled by hand in the
 * Firebase console rather than managed from this module: its resource
 * (google_identity_platform_default_supported_idp_config) needs the OAuth
 * client secret as an argument, which would put it in Terraform state. The
 * console-created provider does not conflict with anything below. Nothing in
 * the apps depends on which providers exist, because they only ever see a
 * verified session.
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
