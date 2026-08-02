import express from "express";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import { firebaseVerifier } from "@stack/auth-client/firebase";
import { firestoreCache } from "@stack/service-kit";
import { toExpressApp } from "@stack/service-kit/express";
import { crateRoutes } from "@stack/crate/domain";
import { createItunesGateway } from "@stack/crate/domain/itunes";
import { createFirestoreCrateRepo } from "@stack/crate/repo/firestore";
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

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME ?? "stack_session";
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // Firebase's maximum.

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
  mount(
    "/api",
    toExpressApp(crateRoutes({ itunes: createItunesGateway(firestoreCache(db)) }), {
      repo: createFirestoreCrateRepo(db),
      verify: verifier.verify,
    }),
  ),
);
