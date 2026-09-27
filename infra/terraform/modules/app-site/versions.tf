terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    # Firebase resources are only in the beta provider. Declared explicitly so
    # Terraform inherits the root's google-beta configuration rather than
    # guessing one from the provider name.
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
  }
}
