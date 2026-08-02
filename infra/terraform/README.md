# Terraform

GCP/Firebase infrastructure for the cloud deployment target. The self-hosted
Docker stack does not use any of this.

```
bootstrap/        run ONCE, by hand, with local state
modules/
  project-services/   APIs to enable
  firebase-project/   turns the GCP project into a Firebase project
  firestore/          database + TTL policies
  identity/           Firebase Auth (Identity Platform) config
  app-site/           per-app Hosting site + function service account + IAM
  secrets/            Secret Manager entries (values set out of band)
envs/
  staging/        one GCP project
  prod/           another GCP project
```

## Division of labour

Terraform owns **GCP resources**: enabled APIs, the Firestore database, Identity
Platform config, Hosting *sites*, service accounts, IAM bindings, Secret Manager
entries.

`firebase.json` / `.firebaserc` / `firestore.rules` / `firestore.indexes.json` own
**Firebase config**: Hosting rewrites and headers, security rules, composite
indexes. These are deployed by the Firebase CLI in CI, not by Terraform.

Two things deliberately live outside Terraform:

- **Cloud Scheduler jobs.** `onSchedule` functions create their own scheduler
  jobs at deploy time. Declaring them here as well produces permanent phantom
  diffs on every plan.
- **Function source and config.** `firebase deploy --only functions` owns those.
  Terraform only creates the service account the functions run as and grants it
  access to secrets.

## Environments

Separate directories, not workspaces. Each targets its own GCP project, so a
mistake in staging cannot reach prod, and `terraform plan` output for one env is
readable on its own in a PR comment.

## First-time setup

Full walkthrough in [docs/firebase-setup.md](../../docs/firebase-setup.md).

## Bootstrapping

`bootstrap/` is the chicken-and-egg resolver: it creates the GCS bucket that
holds remote state, the Workload Identity Federation pool that lets GitHub
Actions authenticate without a service account key, and the deployer service
account itself. It uses **local state**, is applied once by a human with owner
permissions, and its state file is not committed.

```bash
cd bootstrap
terraform init
terraform apply \
  -var billing_account=XXXXXX-XXXXXX-XXXXXX \
  -var github_repo=djdietrick/mini-app-stack
```

It outputs the values to paste into GitHub repository variables:
`GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOYER_SA`, `TF_STATE_BUCKET`.

After that, every env is `terraform init && terraform apply` with remote state,
run by CI.

## Secret values

Terraform creates Secret Manager *secrets* but never their *versions* — no
secret values live in this repo or in state. Add them once per environment:

```bash
printf '%s' "$YOUTUBE_API_KEY" | \
  gcloud secrets versions add youtube-api-key --project mini-app-stack-staging --data-file=-
```
