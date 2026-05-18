import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { AuthClient, type SessionUser } from "./index.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Populated by requireSession; undefined on unauthenticated routes. */
    user?: SessionUser;
  }
}

export interface RegisterOptions {
  client: AuthClient;
  /** Routes matching this predicate skip the auth check. Defaults to /health. */
  isPublic?: (req: FastifyRequest) => boolean;
}

/**
 * Adds a preHandler that resolves req.user from the session cookie. On a
 * missing/invalid session it replies 401 unless the route is public.
 */
export function registerAuth(app: FastifyInstance, opts: RegisterOptions): void {
  const { client } = opts;
  const isPublic = opts.isPublic ?? ((req) => req.url === "/health" || req.url === "/api/health");

  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    if (isPublic(req)) return;
    const token = client.extractToken(req.headers.cookie);
    if (!token) return reply.code(401).send({ error: "not signed in" });
    const user = await client.verify(token);
    if (!user) return reply.code(401).send({ error: "not signed in" });
    req.user = user;
  });
}
