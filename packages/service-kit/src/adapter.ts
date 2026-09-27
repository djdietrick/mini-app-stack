import type { Logger, SessionUser } from "./route.js";

/**
 * What both adapters need from the outside world. Auth is expressed as a plain
 * function rather than an AuthClient so service-kit does not depend on
 * @stack/auth-client — the stack verifier (apps/auth) and the Firebase
 * verifier (session cookies) both fit this shape.
 */
export interface AdapterOptions<Repo, Scope = undefined> {
  repo: Repo;
  /** Resolve the caller from raw headers. Return null for "not signed in". */
  verify: (headers: Record<string, string | string[] | undefined>) => Promise<SessionUser | null>;
  /**
   * Per-app state that used to be computed in a preHandler — pantry's active
   * household, for example. Runs once per authenticated request.
   */
  resolveScope?: (user: SessionUser, repo: Repo) => Promise<Scope>;
  logger?: Logger;
}

export const consoleLogger: Logger = {
  info: (...args) => console.log(...(args as [unknown])),
  warn: (...args) => console.warn(...(args as [unknown])),
  error: (...args) => console.error(...(args as [unknown])),
};
