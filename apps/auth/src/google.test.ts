import assert from "node:assert/strict";
import { test } from "node:test";
import {
  beginFlow,
  decodeFlow,
  encodeFlow,
  exchangeCode,
  identityFromIdToken,
  parseReturnTo,
  redirectUri,
  stateMatches,
  withAuthError,
  type GoogleConfig,
} from "./google.js";

const cfg: GoogleConfig = {
  clientId: "client-123.apps.googleusercontent.com",
  clientSecret: "shh",
  allowedOrigins: ["https://crate.example.com", "http://localhost:3102"],
  mountPath: "/auth",
};

function idToken(claims: Record<string, unknown>): string {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${enc({ alg: "RS256" })}.${enc(claims)}.sig`;
}

const good = {
  iss: "https://accounts.google.com",
  aud: cfg.clientId,
  exp: Math.floor(Date.now() / 1000) + 600,
  email: "ada@example.com",
  email_verified: true,
  name: "Ada",
};

test("returnTo is accepted only from an allowed origin", () => {
  assert.equal(parseReturnTo("https://crate.example.com/queue?x=1", cfg)?.pathname, "/queue");
  assert.ok(parseReturnTo("http://localhost:3102/", cfg));
  assert.equal(parseReturnTo("https://evil.example.com/", cfg), null);
  assert.equal(parseReturnTo("https://crate.example.com.evil.com/", cfg), null);
  assert.equal(parseReturnTo("javascript:alert(1)", cfg), null);
  assert.equal(parseReturnTo("/relative", cfg), null);
  assert.equal(parseReturnTo(undefined, cfg), null);
});

test("the redirect URI is the callback on the app's own origin", () => {
  const url = parseReturnTo("https://crate.example.com/deep/link", cfg)!;
  assert.equal(redirectUri(url, cfg), "https://crate.example.com/auth/google/callback");
});

test("beginFlow sends PKCE, state and the app-origin redirect URI", () => {
  const { flow, location } = beginFlow(new URL("https://crate.example.com/x"), cfg);
  const params = new URL(location).searchParams;
  assert.equal(params.get("client_id"), cfg.clientId);
  assert.equal(params.get("state"), flow.state);
  assert.equal(params.get("code_challenge_method"), "S256");
  assert.notEqual(params.get("code_challenge"), flow.verifier);
  assert.equal(params.get("redirect_uri"), "https://crate.example.com/auth/google/callback");
  assert.deepEqual(decodeFlow(encodeFlow(flow)), flow);
});

test("decodeFlow rejects garbage", () => {
  assert.equal(decodeFlow(undefined), null);
  assert.equal(decodeFlow("not-base64-json"), null);
  assert.equal(decodeFlow(Buffer.from('{"state":1}').toString("base64url")), null);
});

test("state comparison", () => {
  assert.ok(stateMatches("abc", "abc"));
  assert.ok(!stateMatches("abc", "abd"));
  assert.ok(!stateMatches("abc", "ab"));
  assert.ok(!stateMatches("abc", undefined));
});

test("identityFromIdToken checks issuer, audience, expiry and verified email", () => {
  assert.deepEqual(identityFromIdToken(idToken(good), cfg.clientId), { email: "ada@example.com", name: "Ada" });
  assert.throws(() => identityFromIdToken(idToken({ ...good, iss: "https://evil" }), cfg.clientId));
  assert.throws(() => identityFromIdToken(idToken({ ...good, aud: "other" }), cfg.clientId));
  assert.throws(() => identityFromIdToken(idToken({ ...good, exp: 1 }), cfg.clientId));
  assert.throws(() => identityFromIdToken(idToken({ ...good, email_verified: false }), cfg.clientId));
  assert.throws(() => identityFromIdToken(idToken({ ...good, email: undefined }), cfg.clientId));
  assert.throws(() => identityFromIdToken("nope", cfg.clientId));
});

test("exchangeCode posts the verifier and redirect URI, and reads the id token", async () => {
  const { flow } = beginFlow(new URL("https://crate.example.com/"), cfg);
  let sent: URLSearchParams | undefined;
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    sent = init.body as URLSearchParams;
    return new Response(JSON.stringify({ id_token: idToken(good) }), { status: 200 });
  }) as typeof fetch;

  const identity = await exchangeCode("the-code", flow, cfg, fakeFetch);
  assert.equal(identity.email, "ada@example.com");
  assert.equal(sent?.get("code_verifier"), flow.verifier);
  assert.equal(sent?.get("redirect_uri"), "https://crate.example.com/auth/google/callback");

  const failing = (async () => new Response("nope", { status: 400 })) as typeof fetch;
  await assert.rejects(exchangeCode("x", flow, cfg, failing));
});

test("withAuthError keeps the rest of the URL", () => {
  assert.equal(
    withAuthError("https://crate.example.com/a?b=1", "Google sign-in failed"),
    "https://crate.example.com/a?b=1&auth_error=Google+sign-in+failed",
  );
});
