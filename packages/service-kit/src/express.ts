import express, { type Express, type Request, type Response } from "express";
import type { AdapterOptions } from "./adapter.js";
import { consoleLogger } from "./adapter.js";
import { isAppError, unauthorized } from "./errors.js";
import { type AnyRoute, type Ctx, type SessionUser, parseInput } from "./route.js";

/**
 * Cloud transport. Firebase Functions' onRequest accepts an Express app
 * directly, so the same route table that Fastify serves self-hosted is served
 * by a Function in the cloud. Path syntax (`:param`) is identical between the
 * two frameworks, so routes need no translation.
 */
export function toExpressApp<Repo, Scope>(
  routes: AnyRoute<Repo, Scope>[],
  opts: AdapterOptions<Repo, Scope>,
): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  for (const route of routes) {
    const method = route.method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete";

    app[method](route.path, (req: Request, res: Response) => {
      void (async () => {
        try {
          const ctx = await buildCtx(route, req, opts);
          const input = parseInput(route, {
            params: req.params,
            query: req.query,
            body: req.body,
          });

          const out = await route.handler(ctx, input);
          res.status(route.status?.(out) ?? 200).json(out);
        } catch (err) {
          if (isAppError(err)) {
            res.status(err.status).json(err.toBody());
            return;
          }
          (opts.logger ?? consoleLogger).error(err);
          res.status(500).json({ error: "internal error" });
        }
      })();
    });
  }

  return app;
}

async function buildCtx<Repo, Scope>(
  route: AnyRoute<Repo, Scope>,
  req: Request,
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
