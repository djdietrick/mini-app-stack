import type { Auth } from "firebase-admin/auth";
import type { SessionUser } from "./index.js";
import type { HeaderMap, SessionVerifier } from "./verifier.js";

export interface FirebaseVerifierOptions {
  auth: Auth;
  /** Must match the cookie apps write. Defaults to the stack-wide name. */
  cookieName?: string;
  /**
   * Check the revocation list on every verify. Costs a lookup per request but
   * makes logout-everywhere and account disable take effect immediately.
   */
  checkRevoked?: boolean;
  /** Cache successful verifications in-process, mirroring AuthClient. 0 disables. */
  cacheMs?: number;
}

/**
 * Cloud verifier: Firebase Auth *session cookies*, not bearer ID tokens.
 *
 * Session cookies keep the existing model intact — httpOnly, first-party, sent
 * automatically with `credentials: "include"`. Bearer tokens would have forced
 * an Authorization header into every fetch in every SPA, and would have made
 * the SPA responsible for refresh. The cookie is minted by the authApi function
 * from an ID token at login and verified here on each request.
 */
export function firebaseVerifier(opts: FirebaseVerifierOptions): SessionVerifier {
  const cookieName = opts.cookieName ?? "stack_session";
  const cacheMs = opts.cacheMs ?? 5_000;
  const cache = new Map<string, { user: SessionUser; expiresAt: number }>();

  return {
    async verify(headers: HeaderMap): Promise<SessionUser | null> {
      const cookie = readCookie(headers, cookieName);
      if (!cookie) return null;

      const hit = cache.get(cookie);
      if (hit && hit.expiresAt > Date.now()) return hit.user;

      try {
        const claims = await opts.auth.verifySessionCookie(cookie, opts.checkRevoked ?? false);
        const user: SessionUser = {
          userId: claims.uid,
          email: claims.email ?? "",
          displayName: (claims.name as string | undefined) ?? null,
        };
        if (cacheMs > 0) cache.set(cookie, { user, expiresAt: Date.now() + cacheMs });
        return user;
      } catch {
        // Expired, revoked, or forged — all mean "not signed in".
        cache.delete(cookie);
        return null;
      }
    },
  };
}

function readCookie(headers: HeaderMap, name: string): string | undefined {
  const raw = headers["cookie"];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}
