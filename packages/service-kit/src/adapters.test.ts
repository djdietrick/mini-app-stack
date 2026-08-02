import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import express from "express";
import Fastify from "fastify";
import { z } from "zod";
import { toExpressApp } from "./express.js";
import { toFastifyPlugin } from "./fastify.js";
import { badRequest, conflict, notFound } from "./errors.js";
import { type AnyRoute, createRouteBuilder } from "./route.js";

// The whole point of service-kit is that one route table produces identical
// HTTP behavior under Fastify (self-hosted) and Express (Firebase Functions).
// These tests run the same assertions through both adapters.

interface FakeRepo {
  items: Map<string, { id: string; owner: string }>;
}

type Scope = { tenant: string };

const route = createRouteBuilder<FakeRepo, Scope>();

const routes: AnyRoute<FakeRepo, Scope>[] = [
  route({
    method: "GET",
    path: "/health",
    public: true,
    handler: async () => ({ ok: true }),
  }),
  route({
    method: "GET",
    path: "/whoami",
    handler: async (ctx) => ({ userId: ctx.user.userId, tenant: ctx.scope.tenant }),
  }),
  route({
    method: "GET",
    path: "/items/:id",
    input: { params: z.object({ id: z.string().uuid() }) },
    handler: async (ctx, { params }) => {
      const found = ctx.repo.items.get(params.id);
      if (!found) throw notFound();
      return found;
    },
  }),
  route({
    method: "POST",
    path: "/items",
    input: { body: z.object({ name: z.string().min(1) }) },
    // Mirrors crate's POST /queue: 201 when created, 200 when it already existed.
    status: (out) => (out.created ? 201 : 200),
    handler: async (ctx, { body }) => {
      const created = !ctx.repo.items.has(body.name);
      ctx.repo.items.set(body.name, { id: body.name, owner: ctx.user.userId });
      return { created };
    },
  }),
  route({
    method: "GET",
    path: "/search",
    input: { query: z.object({ q: z.string().min(1) }) },
    // Mirrors crate's /api/search, which returns a bare message not a zod dump.
    onInvalid: () => badRequest("missing q"),
    handler: async (_ctx, { query }) => ({ q: query.q }),
  }),
  route({
    method: "POST",
    path: "/needs-scope",
    handler: async (ctx) => {
      if (ctx.scope.tenant !== "acme") throw conflict("WRONG_TENANT");
      return { ok: true };
    },
  }),
];

const adapterOpts = {
  repo: { items: new Map() } as FakeRepo,
  verify: async (headers: Record<string, string | string[] | undefined>) =>
    headers["x-test-user"]
      ? { userId: String(headers["x-test-user"]), email: "u@example.com", displayName: null }
      : null,
  resolveScope: async () => ({ tenant: "acme" }),
};

/** Uniform request helper so both adapters are exercised over real HTTP. */
type Call = (
  method: string,
  path: string,
  opts?: { headers?: Record<string, string>; body?: unknown },
) => Promise<{ status: number; body: unknown }>;

async function startFastify(): Promise<{ call: Call; stop: () => Promise<void> }> {
  const app = Fastify();
  await app.register(toFastifyPlugin(routes, adapterOpts));
  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address() as { port: number };
  return {
    call: makeCall(`http://127.0.0.1:${port}`),
    stop: () => app.close(),
  };
}

async function startExpress(): Promise<{ call: Call; stop: () => Promise<void> }> {
  const app: express.Express = toExpressApp(routes, adapterOpts);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as { port: number };
  return {
    call: makeCall(`http://127.0.0.1:${port}`),
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function makeCall(base: string): Call {
  return async (method, path, opts = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

const AUTHED = { headers: { "x-test-user": "user-1" } };
const UUID = "11111111-1111-4111-8111-111111111111";

for (const [name, start] of [
  ["fastify", startFastify],
  ["express", startExpress],
] as const) {
  describe(`${name} adapter`, () => {
    let call: Call;
    let stop: () => Promise<void>;

    it("boots", async () => {
      ({ call, stop } = await start());
    });

    after(async () => {
      adapterOpts.repo.items.clear();
      await stop?.();
    });

    it("serves public routes without a session", async () => {
      assert.deepEqual(await call("GET", "/health"), { status: 200, body: { ok: true } });
    });

    it("401s a protected route with no session", async () => {
      const res = await call("GET", "/whoami");
      assert.equal(res.status, 401);
      assert.deepEqual(res.body, { error: "not signed in" });
    });

    it("exposes user and resolved scope on ctx", async () => {
      const res = await call("GET", "/whoami", AUTHED);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { userId: "user-1", tenant: "acme" });
    });

    it("returns a flattened zod error by default", async () => {
      const res = await call("GET", "/items/not-a-uuid", AUTHED);
      assert.equal(res.status, 400);
      assert.ok(
        (res.body as { error: { fieldErrors: Record<string, string[]> } }).error.fieldErrors.id,
      );
    });

    it("honors a per-route onInvalid override", async () => {
      const res = await call("GET", "/search", AUTHED);
      assert.equal(res.status, 400);
      assert.deepEqual(res.body, { error: "missing q" });
    });

    it("maps AppError status and code", async () => {
      const missing = await call("GET", `/items/${UUID}`, AUTHED);
      assert.equal(missing.status, 404);
      assert.deepEqual(missing.body, { error: "not found" });

      const wrongTenant = await call("POST", "/needs-scope", AUTHED);
      assert.equal(wrongTenant.status, 200);
    });

    it("applies the per-route status function", async () => {
      const first = await call("POST", "/items", { ...AUTHED, body: { name: "widget" } });
      assert.equal(first.status, 201);
      assert.deepEqual(first.body, { created: true });

      const second = await call("POST", "/items", { ...AUTHED, body: { name: "widget" } });
      assert.equal(second.status, 200);
      assert.deepEqual(second.body, { created: false });
    });
  });
}
