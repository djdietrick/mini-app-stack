import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AdapterOptions } from "./adapter.js";
import { consoleLogger } from "./adapter.js";
import { AppError, isAppError, unauthorized } from "./errors.js";
import { type AnyRoute, type Ctx, type SessionUser, parseInput } from "./route.js";

/**
 * Self-hosted transport. Registers a route table on a Fastify instance —
 * this is the path docker-compose runs.
 */
export function toFastifyPlugin<Repo, Scope>(
  routes: AnyRoute<Repo, Scope>[],
  opts: AdapterOptions<Repo, Scope>,
) {
  return async function plugin(app: FastifyInstance): Promise<void> {
    app.setErrorHandler((err, _req, reply) => {
      if (isAppError(err)) return reply.code(err.status).send(err.toBody());
      app.log.error(err);
      return reply.code(500).send({ error: "internal error" });
    });

    for (const route of routes) {
      const method = route.method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete";

      app[method](route.path, async (req: FastifyRequest, reply: FastifyReply) => {
        const ctx = await buildCtx(route, req, opts);
        const input = parseInput(route, {
          params: req.params,
          query: req.query,
          body: req.body,
        });

        const out = await route.handler(ctx, input);
        reply.code(route.status?.(out) ?? 200);
        return out;
      });
    }
  };
}

async function buildCtx<Repo, Scope>(
  route: AnyRoute<Repo, Scope>,
  req: FastifyRequest,
  opts: AdapterOptions<Repo, Scope>,
): Promise<Ctx<Repo, Scope>> {
  const log = opts.logger ?? consoleLogger;

  if (route.public) {
    return {
      repo: opts.repo,
      user: undefined as unknown as SessionUser,
      scope: undefined as Scope,
      log,
    };
  }

  const user = await opts.verify(req.headers as Record<string, string | string[] | undefined>);
  if (!user) throw unauthorized();

  const scope = opts.resolveScope
    ? await opts.resolveScope(user, opts.repo)
    : (undefined as Scope);

  return { repo: opts.repo, user, scope, log };
}

export { AppError };
