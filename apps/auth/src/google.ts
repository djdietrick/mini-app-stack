import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Google sign-in for the self-hosted stack: the OAuth 2.0 authorization-code
 * flow with PKCE, run entirely server-side so the browser only ever ends up
 * with the same opaque session cookie a password login produces.
 *
 *   GET /google/start?returnTo=<url>  → 302 to Google, flow state in a cookie
 *   GET /google/callback              → code exchange, session, 302 to returnTo
 *
 * Both are reached through each app's /auth/* proxy, so the redirect URI Google
 * sees is `<app origin>/auth/google/callback` and the cookies stay first-party
 * on the app's origin. Every origin that may start the flow must be listed in
 * GOOGLE_ALLOWED_ORIGINS *and* registered as a redirect URI on the OAuth client.
 *
 * This module is the pure part — URL building, validation, claim checks — so it
 * can be tested without Google or a database. index.ts wires it to routes.
 */

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  /** Origins allowed as returnTo, e.g. "https://crate.example.com". */
  allowedOrigins: string[];
  /** Where apps/auth is mounted on each app origin. "/auth" behind the proxies. */
  mountPath: string;
}

export interface FlowState {
  state: string;
  verifier: string;
  returnTo: string;
}

export const FLOW_COOKIE = "stack_google_flow";
export const FLOW_TTL_SECONDS = 10 * 60;

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

/**
 * returnTo becomes both a redirect target and the origin of the redirect URI,
 * so it is only accepted from an allow-listed origin. Anything else would be
 * an open redirect.
 */
export function parseReturnTo(raw: unknown, cfg: GoogleConfig): URL | null {
  if (typeof raw !== "string" || !raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return cfg.allowedOrigins.includes(url.origin) ? url : null;
}

export function redirectUri(returnTo: URL, cfg: GoogleConfig): string {
  return `${returnTo.origin}${cfg.mountPath}/google/callback`;
}

export function beginFlow(returnTo: URL, cfg: GoogleConfig): { flow: FlowState; location: string } {
  const flow: FlowState = {
    state: randomBytes(24).toString("base64url"),
    verifier: randomBytes(32).toString("base64url"),
    returnTo: returnTo.toString(),
  };
  const challenge = createHash("sha256").update(flow.verifier).digest("base64url");
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri(returnTo, cfg),
    response_type: "code",
    scope: "openid email profile",
    state: flow.state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return { flow, location: `${AUTHORIZE_URL}?${params}` };
}

export function encodeFlow(flow: FlowState): string {
  return Buffer.from(JSON.stringify(flow)).toString("base64url");
}

export function decodeFlow(raw: string | undefined): FlowState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<FlowState>;
    if (typeof value.state !== "string" || typeof value.verifier !== "string" || typeof value.returnTo !== "string") {
      return null;
    }
    return { state: value.state, verifier: value.verifier, returnTo: value.returnTo };
  } catch {
    return null;
  }
}

export function stateMatches(expected: string, actual: unknown): boolean {
  if (typeof actual !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface GoogleIdentity {
  email: string;
  name: string | null;
}

/**
 * Checks the ID token's claims. The signature is deliberately not verified:
 * the token comes straight from Google's token endpoint over TLS in exchange
 * for our client secret, which OpenID Connect Core §3.1.3.7 accepts in place
 * of signature validation. It never passes through the browser.
 */
export function identityFromIdToken(idToken: string, clientId: string, nowMs = Date.now()): GoogleIdentity {
  const payload = idToken.split(".")[1];
  if (!payload) throw new Error("malformed id token");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    iss?: string;
    aud?: string | string[];
    exp?: number;
    email?: string;
    email_verified?: boolean | string;
    name?: string;
  };
  if (!claims.iss || !ISSUERS.has(claims.iss)) throw new Error("unexpected issuer");
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(clientId)) throw new Error("unexpected audience");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < nowMs) throw new Error("expired id token");
  if (!claims.email) throw new Error("no email on Google account");
  // Accounts are matched on email, so an address Google has not verified
  // could be used to sign in as whoever registered it here.
  if (claims.email_verified !== true && claims.email_verified !== "true") {
    throw new Error("Google has not verified this email");
  }
  return { email: claims.email, name: claims.name ?? null };
}

/** Swaps the authorization code for tokens and returns the verified identity. */
export async function exchangeCode(
  code: string,
  flow: FlowState,
  cfg: GoogleConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleIdentity> {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: redirectUri(new URL(flow.returnTo), cfg),
      grant_type: "authorization_code",
      code_verifier: flow.verifier,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status})`);
  const body = (await res.json()) as { id_token?: string };
  if (!body.id_token) throw new Error("no id token in token response");
  return identityFromIdToken(body.id_token, cfg.clientId);
}

/** Sends the browser back to where it started, with an error for the forms to show. */
export function withAuthError(returnTo: string, message: string): string {
  const url = new URL(returnTo);
  url.searchParams.set("auth_error", message);
  return url.toString();
}
