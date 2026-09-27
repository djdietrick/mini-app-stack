import { AuthClient, type SessionUser } from "./index.js";

export type HeaderMap = Record<string, string | string[] | undefined>;

/**
 * The identity seam. Both deployment targets resolve a caller from raw request
 * headers, so neither the domain layer nor the transport adapters need to know
 * which one is in play.
 *
 *   AUTH_MODE=stack     -> apps/auth + shared.sessions (self-hosted)
 *   AUTH_MODE=firebase  -> Firebase Auth session cookies (cloud)
 */
export interface SessionVerifier {
  verify(headers: HeaderMap): Promise<SessionUser | null>;
}

const header = (headers: HeaderMap, name: string): string | undefined => {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
};

/**
 * Self-hosted verifier: reads the opaque session cookie and calls
 * apps/auth POST /sessions/verify, with AuthClient's in-process cache in front.
 */
export function stackVerifier(client: AuthClient): SessionVerifier {
  return {
    async verify(headers) {
      const token = client.extractToken(header(headers, "cookie"));
      if (!token) return null;
      return client.verify(token);
    },
  };
}
