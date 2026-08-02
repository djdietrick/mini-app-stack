# Setting up the Firebase deployment

One-time setup to get `crate` deploying to staging and prod. Roughly an hour,
most of it waiting on GCP.

Nothing here affects the self-hosted Docker stack. Skip this entire document if
you only run on your own server.

## 0. Prerequisites

- **Two GCP projects**, one per environment. Project ids are globally unique,
  so `mini-app-stack-staging` / `mini-app-stack-prod` are probably taken —
  pick your own and put them in the tfvars files (step 2).
- **Billing enabled on both** — the Blaze pay-as-you-go plan. This is not
  optional: Cloud Functions 2nd gen, Artifact Registry and Cloud Build all
  refuse to run on the free Spark plan. Idle cost for these apps is close to
  zero (Firestore and Functions both scale to zero and have free tiers), but a
  billing account must be attached.
- `gcloud` and `terraform` locally, and owner on both projects for the
  bootstrap step.

The apps' own domains cost nothing extra: Hosting gives you
`crate-staging.web.app` and `crate-prod.web.app` out of the box.

## 1. Bootstrap (once, by hand)

Creates the Terraform state bucket, the CI deployer service account, and the
Workload Identity Federation pool that lets GitHub Actions authenticate
without a service account key.

```bash
cd infra/terraform/bootstrap
terraform init
terraform apply \
  -var admin_project=YOUR-PROD-PROJECT \
  -var 'managed_projects=["YOUR-STAGING-PROJECT","YOUR-PROD-PROJECT"]' \
  -var github_repo=djdietrick/mini-app-stack \
  -var state_bucket=YOUR-UNIQUE-TFSTATE-BUCKET
```

This uses **local state** — it is what creates the remote backend, so it cannot
use it. Keep the resulting `terraform.tfstate` somewhere safe; it is small and
you will only need it if you ever change the bootstrap.

Note the three outputs; they become GitHub variables in step 4.

## 2. Point the config at your projects

```
infra/terraform/envs/staging/terraform.tfvars   project = "YOUR-STAGING-PROJECT"
infra/terraform/envs/prod/terraform.tfvars      project = "YOUR-PROD-PROJECT"
.firebaserc                                     both project ids
```

`.firebaserc` also maps Hosting targets to site ids (`crate-staging`,
`crate-prod`). Site ids are globally unique too, so if those are taken, change
them in `.firebaserc` **and** in `modules/app-site` (`site_id`).

## 3. Apply the environments

```bash
cd infra/terraform/envs/staging
terraform init -backend-config=bucket=YOUR-UNIQUE-TFSTATE-BUCKET
terraform apply
```

Then the same for `envs/prod`.

Expect this to take a few minutes and to need one retry — enabling a dozen APIs
is eventually-consistent, and the first apply sometimes races its own
`google_project_service` resources. Re-running `apply` clears it.

Two things worth knowing about what this creates:

- **`google_firebase_project`** turns the GCP project into a Firebase project.
  Enabling `firebase.googleapis.com` is not the same thing, and every
  `google_firebase_*` resource fails until this exists. It is irreversible,
  hence `prevent_destroy`.
- **Firestore's location is immutable.** `nam5` is the default; if you want
  somewhere else, set `firestore_location` *before* the first apply, because
  changing it later means a new database.

## 4. GitHub repository variables

Settings → Secrets and variables → Actions → **Variables** (not Secrets — none
of these are secret).

| Variable | Where it comes from |
|---|---|
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | bootstrap output `workload_identity_provider` |
| `GCP_DEPLOYER_SA` | bootstrap output `deployer_service_account` |
| `TF_STATE_BUCKET` | bootstrap output `state_bucket` |
| `STAGING_PROJECT_ID` | your staging project id |
| `PROD_PROJECT_ID` | your prod project id |
| `STAGING_FIREBASE_API_KEY` | `terraform output -json web_config` in envs/staging → `crate.apiKey` |
| `STAGING_FIREBASE_AUTH_DOMAIN` | same → `crate.authDomain` |
| `PROD_FIREBASE_API_KEY` | same, from envs/prod |
| `PROD_FIREBASE_AUTH_DOMAIN` | same, from envs/prod |

```bash
cd infra/terraform/envs/staging && terraform output -json web_config
```

The Firebase web API key is **public by design** — it ships in every SPA bundle
and only identifies the project. It is not a credential. `firestore.rules` is
deny-all precisely so this key grants no data access.

There are no GitHub **secrets** to set. That is the point of Workload Identity
Federation: no service account JSON key exists to leak.

## 5. GitHub environments

Settings → Environments → create `staging` and `production`. The workflows
reference them, and it is where you add a required reviewer on `production` if
you want a human gate before prod deploys.

## 6. Deploy

Push to `main` and `deploy-prod.yml` will apply both environments' Terraform,
build the SPAs against Firebase Auth, and deploy Firestore rules, functions and
hosting. Open a PR and `deploy-staging.yml` will comment a preview URL.

To deploy by hand first:

```bash
pnpm install
VITE_AUTH_MODE=firebase \
VITE_FIREBASE_API_KEY=... \
VITE_FIREBASE_AUTH_DOMAIN=... \
VITE_FIREBASE_PROJECT_ID=YOUR-STAGING-PROJECT \
  pnpm build:web
pnpm --filter @stack/functions build
pnpm exec firebase deploy --project YOUR-STAGING-PROJECT
```

## 7. Secret values (only when ytdigest is ported)

Terraform creates the Secret Manager *secrets* but never their versions — a
value passed as a Terraform variable would be written to state in plaintext,
and CI can read the state bucket. Add versions out of band:

```bash
printf '%s' "$YOUTUBE_API_KEY" | \
  gcloud secrets versions add youtube-api-key --project YOUR-PROJECT --data-file=-
printf '%s' "$MAIL_API_KEY" | \
  gcloud secrets versions add mail-api-key --project YOUR-PROJECT --data-file=-
```

`crate` needs neither — the iTunes API is unauthenticated.

## What is not automated

- **Custom domains.** Attach in the Firebase console, then add the domain to
  `extra_authorized_domains` in `envs/prod/terraform.tfvars`, or Firebase Auth
  will refuse sign-in from it.
- **Existing users.** Nothing migrates from `shared.users` into Firebase Auth;
  by your call, the cloud starts empty and people re-register. If you change
  your mind, `firebase auth:import` can take argon2 hashes with a matching hash
  config, so the passwords in `shared.user_credentials` are not a dead end.
- **Budget alerts.** Worth setting on both projects before the first deploy.
  Nothing here can run away, but `maxInstances` is a cap on concurrency, not
  on spend.
