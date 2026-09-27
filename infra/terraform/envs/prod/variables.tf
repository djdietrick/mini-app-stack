variable "project" {
  description = "Production GCP project id."
  type        = string
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "extra_authorized_domains" {
  description = "Custom domains serving the apps, beyond the Hosting defaults."
  type        = list(string)
  default     = []
}
