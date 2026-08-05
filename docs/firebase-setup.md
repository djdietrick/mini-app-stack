# Setting up the Firebase deployment

One-time setup to get `crate` deploying to staging and prod, and to verify a
staging deploy from a pull request before merging.

Budget about an hour, most of it waiting on GCP. You need a GCP billing account
and `gcloud` + `terraform` locally.

Nothing here affects the self-hosted Docker stack. Skip this entire document if
you only run on your own server.

## Why billing is required

Cloud Functions 2nd gen, Cloud Build and Artifact Registry all refuse to run on
the free Spark plan, so both projects must be on Blaze (pay-as-you-go). Actual
cost at this scale is effectively zero — Firestore and Functions both scale to
zero and sit inside the free tier — but a billing account must be attached.

Set a budget alert on both projects before the first deploy. `maxInstances` caps
concurrency, not spend.

---

## Step 1 — Create the projects and link billing

Project ids are globally unique, so `mini-app-stack-staging` is probably taken.
Pick your own; they are referred to below as `STAGING_ID` and `PROD_ID`.

```bash
gcloud auth login

gcloud projects create STAGING_ID --name="mini-app-stack staging"
gcloud projects create PROD_ID    --name="mini-app-stack prod"

gcloud billing accounts list                     # copy the ACCOUNT_ID
gcloud billing projects link STAGING_ID --billing-account=ACCOUNT_ID
gcloud billing projects link PROD_ID    --billing-account=ACCOUNT_ID
```

## Step 2 — Enable the two APIs Terraform needs in order to enable the rest

Terraform manages the other dozen APIs itself, but it cannot enable anything
until Service Usage and Resource Manager are on.

```bash
for p in STAGING_ID PROD_ID; do
  gcloud services enable \
    cloudresourcemanager.googleapis.com \
    serviceusage.googleapis.com \
    --project "$p"
done

gcloud auth application-default login    # credentials Terraform will use
```

## Step 3 — Put your project ids in the repo

Three files. The third is the one that is easy to get half-right:

| File | Change |
|---|---|
| `infra/terraform/envs/staging/terraform.tfvars` | `project = "STAGING_ID"` |
| `infra/terraform/envs/prod/terraform.tfvars` | `project = "PROD_ID"` |
| `.firebaserc` | the `projects` values **and** the `targets` object keys |

`.firebaserc`'s `targets` map is keyed by project id. If you rename only the
`projects` entries, `firebase hosting:channel:deploy` cannot resolve the `crate`
target and the preview step fails.

Hosting site ids (`crate-staging`, `crate-prod`) are globally unique too. If
either is taken, change `site_id` in `infra/terraform/modules/app-site/main.tf`
and the matching entry in `.firebaserc`.

## Step 4 — Bootstrap (once, by hand)

Creates the Terraform state bucket, the CI deployer service account, and the
Workload Identity Federation pool that lets GitHub Actions authenticate without
a service account key.

```bash
cd infra/terraform/bootstrap
terraform init
terraform apply \
  -var admin_project=PROD_ID \
  -var 'managed_projects=["STAGING_ID","PROD_ID"]' \
  -var github_repo=djdietrick/mini-app-stack \
  -var state_bucket=SOME-GLOBALLY-UNIQUE-BUCKET
```

This uses **local state** on purpose — it is what creates the remote backend, so
it cannot use it. Keep the resulting `terraform.tfstate`; you only need it again
if you change the bootstrap itself.

Record the three outputs.

## Step 5 — Apply both environments

```bash
cd ../envs/staging
terraform init -backend-config=bucket=SOME-GLOBALLY-UNIQUE-BUCKET
terraform apply

cd ../prod
terraform init -backend-config=bucket=SOME-GLOBALLY-UNIQUE-BUCKET
terraform apply
```

**Expect to run `apply` twice per environment.** Enabling a dozen APIs is
eventually-consistent, and `google_identity_platform_config` in particular
usually fails the first time, before the Identity Toolkit API has propagated.
Re-running clears it. This is normal, not a misconfiguration.

Two choices made here are irreversible:

- **Firestore's location.** `nam5` by default. Set `firestore_location` *before*
  the first apply if you want somewhere else; changing it later means a new
  database.
- **`google_firebase_project`.** A project cannot be un-Firebased. Note that
  enabling `firebase.googleapis.com` is *not* the same thing — this resource is
  what makes Hosting sites and Firebase Auth possible, and it has
  `prevent_destroy` set.

## Step 6 — Read the values CI needs

```bash
cd infra/terraform/envs/staging
terraform output -json web_config
terraform output -json function_service_accounts

cd ../prod
terraform output -json web_config
terraform output -json function_service_accounts
```

## Step 7 — GitHub repository variables

Settings → Secrets and variables → Actions → **Variables** tab.

**There are no GitHub secrets to add.** That is the whole point of Workload
Identity Federation: no service account JSON key exists, so there is nothing to
leak or rotate.

| Variable | Value |
|---|---|
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | bootstrap output `workload_identity_provider` |
| `GCP_DEPLOYER_SA` | bootstrap output `deployer_service_account` |
| `TF_STATE_BUCKET` | bootstrap output `state_bucket` |
| `STAGING_PROJECT_ID` | `STAGING_ID` |
| `PROD_PROJECT_ID` | `PROD_ID` |
| `STAGING_FIREBASE_API_KEY` | staging `web_config` → `crate.apiKey` |
| `STAGING_FIREBASE_AUTH_DOMAIN` | staging `web_config` → `crate.authDomain` |
| `STAGING_CRATE_FUNCTION_SA` | staging `function_service_accounts` → `crate` |
| `STAGING_AUTH_FUNCTION_SA` | staging `function_service_accounts` → `auth` |
| `PROD_FIREBASE_API_KEY` | prod `web_config` → `crate.apiKey` |
| `PROD_FIREBASE_AUTH_DOMAIN` | prod `web_config` → `crate.authDomain` |
| `PROD_CRATE_FUNCTION_SA` | prod `function_service_accounts` → `crate` |
| `PROD_AUTH_FUNCTION_SA` | prod `function_service_accounts` → `auth` |

The Firebase web API key is **public by design**. It ships in every SPA bundle
and only identifies the project — it is not a credential. `firestore.rules` is
deny-all precisely so that this key grants no data access.

The `*_FUNCTION_SA` variables make each function run as its own identity.
Without them the functions fall back to the default compute service account,
which carries project Editor.

**Set all of these before opening the pull request.** `terraform.yml` plans both
environments on any PR touching `infra/terraform/**` and fails without them.

## Step 8 — GitHub environments

Settings → Environments → create `staging` and `production`. Both are referenced
by the workflows. `production` is where you add a required reviewer if you want a
human gate before prod deploys.

## Step 9 — Open the pull request

Push the branch and open a PR against `main`. Three workflows fire:

- **`ci.yml`** — typecheck, build the SPAs and the functions bundle, run the
  test suite inside the Firestore emulator.
- **`terraform.yml`** — plans staging and prod, comments both on the PR.
- **`deploy-staging.yml`** — deploys Firestore rules and indexes, then the
  functions, then a `pr-<n>` Hosting preview channel, and comments the URL.

Terraform is never *applied* from a PR; a pull request must not be able to
mutate infrastructure. That is why step 5 is manual.

## Step 10 — Verify the preview

Work down this list on the preview URL. Each step exercises something the
emulator could not.

1. **Page loads, login screen renders.** Hosting is serving the SPA, built
   against Firebase Auth.
2. **`curl <preview-url>/api/health`** returns `{"ok":true}`. The `/api/**`
   rewrite reaches `crateApi`, and the function is mounting its routes under
   the prefix Hosting forwards.
3. **Sign up with a new email.** Confirms Firebase Auth, `POST /auth/session`,
   the httpOnly session cookie, and the `users/{uid}` mirror doc.
4. **Search an artist, queue an album.** Exercises the iTunes gateway through
   the Firestore-backed cache, and `addToQueue`'s transactional dedupe. Queue
   the same album twice — the second should be a no-op, not a duplicate row.
5. **Load the queue list.** This is the important one: it is the query that
   needs a composite index, so it is the check that Firestore indexes actually
   deployed.
6. **Rate, mark listened, requeue, delete.** The ownership-scoped transactional
   mutations.
7. **Reload the page.** Still signed in — cookie persistence.
8. **In the console:** Firestore shows `crate_queue`, `crate_albums` and `users`
   documents. Cloud Run shows `crateApi` running as `fn-crate-staging@…`, not
   the default compute account.

Then, before merging: check the prod `terraform plan` comment contains only
resources you expect, and close/reopen the PR once to confirm `pr-cleanup.yml`
deletes the preview channel.

## Step 11 — Secret values (only once ytdigest is ported)

Terraform creates the Secret Manager *secrets* but never their versions — a
value passed as a Terraform variable would be written to state in plaintext, and
CI can read the state bucket. Add versions out of band:

```bash
printf '%s' "$YOUTUBE_API_KEY" | \
  gcloud secrets versions add youtube-api-key --project STAGING_ID --data-file=-
printf '%s' "$MAIL_API_KEY" | \
  gcloud secrets versions add mail-api-key --project STAGING_ID --data-file=-
```

`crate` needs neither — the iTunes API is unauthenticated.

---

## Deploying by hand

Useful for a faster loop than pushing to a PR:

```bash
pnpm install
VITE_AUTH_MODE=firebase \
VITE_FIREBASE_API_KEY=... \
VITE_FIREBASE_AUTH_DOMAIN=... \
VITE_FIREBASE_PROJECT_ID=STAGING_ID \
  pnpm build:web
pnpm --filter @stack/functions build
CRATE_FUNCTION_SA=fn-crate-staging@STAGING_ID.iam.gserviceaccount.com \
AUTH_FUNCTION_SA=fn-auth-staging@STAGING_ID.iam.gserviceaccount.com \
  pnpm exec firebase deploy --project STAGING_ID
```

## Known limitations

- **Preview channels fork the frontend only.** Functions, Firestore data and
  Auth users are shared across the whole staging project. Two PRs that change
  the API incompatibly will break each other, and previews share data. Fine for
  frontend-only and additive changes; for an API-breaking PR, deploy its
  functions under a suffixed id and point that PR's rewrite at it.
- **Preview channel domains are not in Firebase Auth's authorized-domains
  list.** Harmless today because email/password sign-in does not check it. If
  you later add Google or Apple sign-in, preview URLs will fail to complete the
  OAuth redirect, because preview hostnames are generated per deploy and cannot
  be pre-authorized.
- **Custom domains** are attached in the Firebase console, then added to
  `extra_authorized_domains` in `envs/prod/terraform.tfvars` — otherwise
  Firebase Auth refuses sign-in from them.
- **No user migration.** By design the cloud starts empty and people
  re-register. If you change your mind, `firebase auth:import` accepts argon2
  hashes with a matching hash config, so `shared.user_credentials` is not a
  dead end.
- **`pantry` and `ytdigest` are not ported** and run self-hosted only.
