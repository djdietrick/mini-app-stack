export interface SessionUser {
  userId: string;
  email: string;
  displayName: string | null;
}

export interface AuthClientOptions {
  /** Base URL of apps/auth, e.g. http://auth:3000 (in compose) or http://localhost:3000 (dev). */
  authUrl: string;
  /** Cookie name used by apps/auth. Must match AUTH_COOKIE_NAME there. */
  cookieName?: string;
  /** Shared secret matching AUTH_VERIFY_SECRET on apps/auth. */
  verifySecret?: string;
  /** Cache successful verifications for this many ms in-process. 0 disables. */
  cacheMs?: number;
}

interface CacheEntry {
  user: SessionUser;
  expiresAt: number;
}

export class AuthClient {
  readonly cookieName: string;
  private readonly authUrl: string;
  private readonly verifySecret: string | undefined;
  private readonly cacheMs: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(opts: AuthClientOptions) {
    this.authUrl = opts.authUrl.replace(/\/$/, "");
    this.cookieName = opts.cookieName ?? "stack_session";
    this.verifySecret = opts.verifySecret;
    this.cacheMs = opts.cacheMs ?? 5_000;
  }

  /** Verify a raw session token against apps/auth. Returns null if invalid/expired. */
  async verify(token: string): Promise<SessionUser | null> {
    if (!token) return null;

    const cached = this.cache.get(token);
    if (cached && cached.expiresAt > Date.now()) return cached.user;

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.verifySecret) headers["x-auth-verify-secret"] = this.verifySecret;

    const res = await fetch(`${this.authUrl}/sessions/verify`, {
      method: "POST",
      headers,
      body: JSON.stringify({ token }),
    });
    if (res.status === 401) {
      this.cache.delete(token);
      return null;
    }
    if (!res.ok) throw new Error(`auth verify failed: ${res.status} ${await res.text()}`);
    const user = (await res.json()) as SessionUser;
    if (this.cacheMs > 0) {
      this.cache.set(token, { user, expiresAt: Date.now() + this.cacheMs });
    }
    return user;
  }

  /** Pull the session token out of a raw Cookie header string. */
  extractToken(cookieHeader: string | undefined): string | undefined {
    if (!cookieHeader) return undefined;
    for (const part of cookieHeader.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name === this.cookieName) return decodeURIComponent(rest.join("="));
    }
    return undefined;
  }
}
