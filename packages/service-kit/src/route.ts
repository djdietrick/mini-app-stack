import type { ZodError, ZodTypeAny, z } from "zod";
import { AppError, badRequest } from "./errors.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface Logger {
  info(msg: unknown, ...args: unknown[]): void;
  warn(msg: unknown, ...args: unknown[]): void;
  error(msg: unknown, ...args: unknown[]): void;
}

export interface SessionUser {
  userId: string;
  email: string;
  displayName: string | null;
}

/**
 * Everything a handler is allowed to touch. Deliberately has no request or
 * reply on it — that is what makes the same handler runnable under Fastify
 * (self-hosted) and under a Firebase Function (cloud).
 *
 * `scope` is per-app resolved state that used to live in a preHandler, e.g.
 * pantry's active household.
 */
export interface Ctx<Repo, Scope = undefined> {
  repo: Repo;
  /** Undefined only on routes marked `public`. */
  user: SessionUser;
  scope: Scope;
  log: Logger;
}

export interface InputSchemas {
  params?: ZodTypeAny;
  query?: ZodTypeAny;
  body?: ZodTypeAny;
}

export type InferInput<I extends InputSchemas | undefined> = {
  params: I extends { params: infer S extends ZodTypeAny } ? z.infer<S> : undefined;
  query: I extends { query: infer S extends ZodTypeAny } ? z.infer<S> : undefined;
  body: I extends { body: infer S extends ZodTypeAny } ? z.infer<S> : undefined;
};

export interface RouteDef<Repo, Scope, I extends InputSchemas, O> {
  method: HttpMethod;
  /** Adapter-neutral path with `:param` segments — Fastify and Express agree. */
  path: string;
  /** Skips session verification and scope resolution. */
  public?: boolean;
  input?: I;
  handler: (ctx: Ctx<Repo, Scope>, input: InferInput<I>) => Promise<O>;
  /** Defaults to 200. crate's POST /queue uses this for its 201-vs-200 split. */
  status?: (out: O) => number;
  /**
   * Turn a validation failure into an AppError. Defaults to a 400 carrying the
   * flattened zod error, which is what every current route returns; override
   * where a route already returns something else.
   */
  onInvalid?: (err: ZodError) => AppError;
}

/**
 * Erased form of RouteDef, so a heterogeneous array of routes has one type.
 * `any` on handler input and status output is deliberate: it is the existential
 * that lets differently-typed routes share an array. Widening to `unknown`
 * instead does not work — function parameters are contravariant, so a concrete
 * `(out: {ok: boolean}) => number` is not assignable to `(out: unknown) => number`.
 * Handlers stay fully typed at their definition site via createRouteBuilder.
 */
export interface AnyRoute<Repo, Scope = undefined> {
  method: HttpMethod;
  path: string;
  public?: boolean;
  input?: InputSchemas;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  handler: (ctx: Ctx<Repo, Scope>, input: any) => Promise<any>;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  status?: (out: any) => number;
  onInvalid?: (err: ZodError) => AppError;
}

/**
 * Binds the repo/scope types once per app so each route body gets full
 * inference from its zod schemas:
 *
 *   const route = createRouteBuilder<CrateRepo>();
 *   export const listQueue = route({ method: "GET", path: "/queue", ... });
 */
export function createRouteBuilder<Repo, Scope = undefined>() {
  return function route<I extends InputSchemas, O>(
    def: RouteDef<Repo, Scope, I, O>,
  ): RouteDef<Repo, Scope, I, O> {
    return def;
  };
}

export interface RawRequest {
  params: unknown;
  query: unknown;
  body: unknown;
}

export type ParsedInput = { params: unknown; query: unknown; body: unknown };

/**
 * Shared by both adapters so validation — and the 400 body it produces —
 * behaves identically on each. Takes only the fields it needs so it does not
 * have to name the route's generics.
 */
export function parseInput(
  route: { input?: InputSchemas; onInvalid?: (err: ZodError) => AppError },
  raw: RawRequest,
): ParsedInput {
  const out: ParsedInput = { params: undefined, query: undefined, body: undefined };
  if (!route.input) return out;

  for (const key of ["params", "query", "body"] as const) {
    const schema = route.input[key];
    if (!schema) continue;
    const parsed = schema.safeParse(raw[key]);
    if (!parsed.success) {
      throw route.onInvalid?.(parsed.error) ?? badRequest("bad request", parsed.error.flatten());
    }
    out[key] = parsed.data;
  }
  return out;
}
