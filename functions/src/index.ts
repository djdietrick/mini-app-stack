import express from "express";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { firebaseVerifier } from "@stack/auth-client/firebase";
import { createMailer } from "@stack/mailer";
import { firestoreCache, firestoreLease } from "@stack/service-kit";
import { toExpressApp } from "@stack/service-kit/express";
import { crateRoutes } from "@stack/crate/domain";
import { createItunesGateway } from "@stack/crate/domain/itunes";
import { createFirestoreCrateRepo } from "@stack/crate/repo/firestore";
import { fretworkRoutes } from "@stack/fretwork/domain";
import { createFirestoreFretworkRepo } from "@stack/fretwork/repo/firestore";
import { pantryRoutes, resolvePantryScope } from "@stack/pantry/domain";
import { createFirestorePantryRepo } from "@stack/pantry/repo/firestore";
import { ytdigestRoutes } from "@stack/ytdigest/domain";
import { type DigestMailer, type DigestOptions, runDailyDigest } from "@stack/ytdigest/domain/digest";
import { pollChannels } from "@stack/ytdigest/domain/poll";
import { createYouTubeClient, type YouTubeGateway } from "@stack/ytdigest/domain/youtube";
import { createFirestoreYtdigestRepo } from "@stack/ytdigest/repo/firestore";
import { createAuthApi } from "./auth.js";

/**
 * Cloud entrypoint. Mirrors apps/crate/src/index.ts: same route table, same
 * domain code, different implementations wired underneath — Firestore instead
 * of Postgres, Firebase Auth instead of apps/auth, Firestore-with-TTL instead
 * of Redis.
 *
 * One function per app rather than one per route: routes in an app share a
 * trust level so per-route IAM buys nothing, and a single function keeps one
 * warm instance serving the whole API instead of cold-starting each endpoint.
 */
initializeApp();

setGlobalOptions({
  region: process.env.FUNCTIONS_REGION ?? "us-central1",
  // Small and cheap; these are personal-scale apps. maxInstances caps the
  // damage a runaway loop can do to the bill.
  memory: "256MiB",
  maxInstances: 10,
  concurrency: 40,
});

// Must be `__session`: Firebase Hosting strips every other cookie from requests
// it rewrites to a function, so any other name reaches authApi and the app
// APIs as "not signed in". The Hosting emulator does not strip cookies, so
// this cannot be caught locally. Not configurable for the same reason.
const COOKIE_NAME = "__session";
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // Firebase's maximum.

/**
 * Per-function runtime identities, read at deploy time from the values
 * Terraform emits as `function_service_accounts`.
 *
 * Without these, functions run as the default compute service account, which
 * carries project Editor — so a bug in crate's API would have Firebase Auth
 * admin rights it has no use for. Undefined when unset, which is what the
 * emulator wants.
 */
const crateServiceAccount = process.env.CRATE_FUNCTION_SA || undefined;
const pantryServiceAccount = process.env.PANTRY_FUNCTION_SA || undefined;
const ytdigestServiceAccount = process.env.YTDIGEST_FUNCTION_SA || undefined;
const fretworkServiceAccount = process.env.FRETWORK_FUNCTION_SA || undefined;
const authServiceAccount = process.env.AUTH_FUNCTION_SA || undefined;

// Module scope on purpose: these are reused across warm invocations.
const db = getFirestore();
const verifier = firebaseVerifier({ auth: getAuth(), cookieName: COOKIE_NAME });

/**
 * Firebase Hosting forwards the ORIGINAL path to the rewritten function — a
 * request to /api/search arrives here as /api/search, not /search. So each
 * function mounts its route table under the same prefix Hosting rewrites,
 * exactly as the Fastify side does with `{ prefix: "/api" }`.
 */
function mount(prefix: string, handler: express.Express): express.Express {
  const outer = express();
  outer.disable("x-powered-by");
  outer.use(prefix, handler);
  return outer;
}

export const authApi = onRequest(
  { serviceAccount: authServiceAccount },
  mount(
    "/auth",
    createAuthApi({
      cookieName: COOKIE_NAME,
      // Hosting is always HTTPS, so unlike the local stack this is never false.
      cookieSecure: true,
      cookieDomain: process.env.AUTH_COOKIE_DOMAIN || undefined,
      sessionTtlMs: SESSION_TTL_MS,
    }),
  ),
);

export const crateApi = onRequest(
  { serviceAccount: crateServiceAccount },
  mount(
    "/api",
    toExpressApp(crateRoutes({ itunes: createItunesGateway(firestoreCache(db)) }), {
      repo: createFirestoreCrateRepo(db),
      verify: verifier.verify,
    }),
  ),
);

export const pantryApi = onRequest(
  { serviceAccount: pantryServiceAccount },
  mount(
    "/api",
    toExpressApp(pantryRoutes(), {
      repo: createFirestorePantryRepo(db),
      verify: verifier.verify,
      // Resolves the caller's active household, as the Fastify side does.
      resolveScope: resolvePantryScope,
    }),
  ),
);

// Grading runs in the browser; this only stores exercises and results.
export const fretworkApi = onRequest(
  { serviceAccount: fretworkServiceAccount },
  mount(
    "/api",
    toExpressApp(fretworkRoutes(), {
      repo: createFirestoreFretworkRepo(db),
      verify: verifier.verify,
    }),
  ),
);

// ---------- ytdigest ----------

/**
 * Secret Manager secrets, created by Terraform (modules/environment) and given
 * values out of band. Bound per function below, so only the functions that
 * list a secret can read it.
 */
const YOUTUBE_API_KEY = defineSecret("YOUTUBE_API_KEY");
const SMTP_PASSWORD = defineSecret("SMTP_PASSWORD");

/**
 * The daily send and the weekly-digest weekday follow this zone. Cloud
 * Functions run in UTC; self-hosted, the server's own zone applies unless
 * DIGEST_TIME_ZONE is set.
 */
const DIGEST_TIME_ZONE = "America/New_York";
const digestOptions: DigestOptions = { timeZone: DIGEST_TIME_ZONE };

/**
 * Secret values exist only while a function is handling a call, not at
 * module load (which is also when the CLI inspects this file during deploy).
 * So the YouTube client and the SMTP transport are built on first use.
 */
let youtubeClient: YouTubeGateway | undefined;
const youtube: YouTubeGateway = {
  resolveChannel: (q) => (youtubeClient ??= createYouTubeClient(YOUTUBE_API_KEY.value())).resolveChannel(q),
  listNewUploads: (...a) =>
    (youtubeClient ??= createYouTubeClient(YOUTUBE_API_KEY.value())).listNewUploads(...a),
  batchGetVideoStats: (ids) =>
    (youtubeClient ??= createYouTubeClient(YOUTUBE_API_KEY.value())).batchGetVideoStats(ids),
};

let smtp: ReturnType<typeof createMailer> | undefined;
const mailer: DigestMailer = {
  send: (mail) =>
    (smtp ??= createMailer({
      // Non-secret settings, written to functions/.env by the deploy workflow
      // from repository variables.
      host: requiredEnv("SMTP_HOST"),
      port: Number(process.env.SMTP_PORT || 587),
      user: requiredEnv("SMTP_USER"),
      password: SMTP_PASSWORD.value(),
      from: requiredEnv("MAIL_FROM"),
    })).send(mail),
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; see docs/firebase-setup.md`);
  return value;
}

const ytdigestRepo = createFirestoreYtdigestRepo(db);

export const ytdigestApi = onRequest(
  // run-now sends mail, and subscribing resolves the channel on YouTube.
  { serviceAccount: ytdigestServiceAccount, secrets: [YOUTUBE_API_KEY, SMTP_PASSWORD] },
  mount(
    "/api",
    toExpressApp(ytdigestRoutes({ youtube, mailer, digest: digestOptions }), {
      repo: ytdigestRepo,
      verify: verifier.verify,
    }),
  ),
);

/**
 * The self-hosted poll timer, as a Cloud Scheduler job. The Firestore lease
 * still matters: Scheduler delivers at least once, so a retried trigger must
 * not start a second poll over the first.
 */
export const ytdigestPoll = onSchedule(
  {
    schedule: "every 180 minutes",
    timeZone: DIGEST_TIME_ZONE,
    serviceAccount: ytdigestServiceAccount,
    secrets: [YOUTUBE_API_KEY],
    timeoutSeconds: 540,
  },
  async () => {
    await pollChannels({ repo: ytdigestRepo, youtube, lease: firestoreLease(db) });
  },
);

/** The self-hosted `DIGEST_SEND_CRON`, at 08:00 New York time. */
export const ytdigestDigest = onSchedule(
  {
    schedule: "0 8 * * *",
    timeZone: DIGEST_TIME_ZONE,
    serviceAccount: ytdigestServiceAccount,
    secrets: [SMTP_PASSWORD],
    timeoutSeconds: 540,
  },
  async () => {
    await runDailyDigest(ytdigestRepo, mailer, new Date(), digestOptions);
  },
);
