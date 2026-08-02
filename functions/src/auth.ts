import express, { type Express, type Request, type Response } from "express";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

/**
 * Cloud replacement for the `/auth/*` reverse proxy that points at apps/auth
 * when self-hosted. Hosting rewrites /auth/** here, so the session cookie stays
 * first-party on the app's own origin exactly as it is today.
 *
 * The SPA authenticates with the Firebase JS SDK (which never touches this
 * function), then posts the resulting ID token to POST /session. We exchange it
 * for a Firebase *session cookie* — httpOnly, sent automatically — so no SPA
 * fetch has to carry an Authorization header and the browser is never trusted
 * with a long-lived credential in JS-readable storage.
 */
export interface AuthApiOptions {
  cookieName: string;
  cookieSecure: boolean;
  cookieDomain?: string;
  /** Firebase caps session cookies at 14 days. */
  sessionTtlMs: number;
}

export function createAuthApi(opts: AuthApiOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  const cookieOptions = {
    httpOnly: true,
    secure: opts.cookieSecure,
    sameSite: "lax" as const,
    path: "/",
    ...(opts.cookieDomain ? { domain: opts.cookieDomain } : {}),
  };

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/session", async (req: Request, res: Response) => {
    const idToken = (req.body as { idToken?: unknown })?.idToken;
    if (typeof idToken !== "string" || !idToken) {
      res.status(400).json({ error: "missing idToken" });
      return;
    }

    try {
      const auth = getAuth();
      // Verify before minting so a forged token cannot produce a cookie.
      const decoded = await auth.verifyIdToken(idToken, true);
      const cookie = await auth.createSessionCookie(idToken, { expiresIn: opts.sessionTtlMs });

      // Mirror doc. Firestore cannot join against the Auth user store, and
      // features like pantry's household member list need to show a name.
      await getFirestore()
        .collection("users")
        .doc(decoded.uid)
        .set(
          {
            email: decoded.email ?? null,
            displayName: decoded.name ?? null,
            updatedAt: new Date(),
          },
          { merge: true },
        );

      res.cookie(opts.cookieName, cookie, {
        ...cookieOptions,
        maxAge: opts.sessionTtlMs,
      });
      res.status(201).json({
        userId: decoded.uid,
        email: decoded.email ?? "",
        displayName: decoded.name ?? null,
      });
    } catch {
      res.status(401).json({ error: "invalid token" });
    }
  });

  app.get("/me", async (req: Request, res: Response) => {
    const cookie = readCookie(req.headers.cookie, opts.cookieName);
    if (!cookie) {
      res.status(401).json({ error: "not signed in" });
      return;
    }
    try {
      const claims = await getAuth().verifySessionCookie(cookie, true);
      const mirror = await getFirestore().collection("users").doc(claims.uid).get();
      const stored = mirror.data() as { displayName?: string | null } | undefined;
      res.json({
        userId: claims.uid,
        email: claims.email ?? "",
        displayName: stored?.displayName ?? (claims.name as string | undefined) ?? null,
      });
    } catch {
      // Clear the bad cookie so the SPA stops resending it, matching what
      // apps/auth GET /me does on an invalid session.
      res.clearCookie(opts.cookieName, cookieOptions);
      res.status(401).json({ error: "not signed in" });
    }
  });

  app.post("/logout", async (req: Request, res: Response) => {
    const cookie = readCookie(req.headers.cookie, opts.cookieName);
    if (cookie) {
      try {
        const claims = await getAuth().verifySessionCookie(cookie);
        // Session cookies cannot be individually revoked; revoking refresh
        // tokens is what makes checkRevoked reject this cookie everywhere.
        await getAuth().revokeRefreshTokens(claims.sub);
      } catch {
        // Already invalid — clearing the cookie is still the right response.
      }
    }
    res.clearCookie(opts.cookieName, cookieOptions);
    res.json({ ok: true });
  });

  return app;
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}
