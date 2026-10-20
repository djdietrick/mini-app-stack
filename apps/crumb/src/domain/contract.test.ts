import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { Firestore } from "@google-cloud/firestore";
import Fastify from "fastify";
import { createPostgresClient } from "@stack/db-clients";
import { type SessionUser, runMigrations } from "@stack/service-kit";
import { toExpressApp } from "@stack/service-kit/express";
import { toFastifyPlugin } from "@stack/service-kit/fastify";
import { createFirestoreCrumbRepo } from "../repo/firestore.js";
import { createPostgresCrumbRepo } from "../repo/postgres.js";
import type { CrumbRepo } from "../repo/types.js";
import { generateVapidKeys } from "../webpush.js";
import { BUILTIN_RECIPES } from "./catalog.js";
import { type PushPayload, type PushService, dispatchReminders } from "./reminders.js";
import { crumbRoutes } from "./routes.js";
import { type PushSubscriptionRow, recipeConfig } from "./types.js";

/**
 * Crumb's HTTP contract, run end to end against each real backend through
 * each adapter, plus the reminder dispatcher against each backend. The
 * assertions pin what apps/crumb/web/src/api.ts depends on: status codes,
 * error bodies, row shapes and ISO timestamps.
 *
 * Each backend runs only when it is reachable:
 *   Firestore  FIRESTORE_EMULATOR_HOST          (CI sets this)
 *   Postgres   CRUMB_TEST_DATABASE_URL          connects as the `crumb` role
 *              CRUMB_TEST_ADMIN_DATABASE_URL    seeds shared.users, which the
 *                                               crumb role can't write
 */

const here = dirname(fileURLToPath(import.meta.url));

interface Backend {
  repo: CrumbRepo;
  addUser(email: string): Promise<string>;
  stop(): Promise<void>;
}

const backends: Record<string, { skip: string | false; start: () => Promise<Backend> }> = {
  firestore: {
    skip: process.env.FIRESTORE_EMULATOR_HOST ? false : "FIRESTORE_EMULATOR_HOST not set",
    async start() {
      const db = new Firestore({ projectId: "demo-crumb" });
      // A fresh prefix per run, so repeat runs never see each other's documents.
      const prefix = `t${Date.now()}_${randomBytes(3).toString("hex")}_`;
      return {
        repo: createFirestoreCrumbRepo(db, prefix),
        // Firebase uids are 28-char strings, not UUIDs.
        addUser: async () => randomBytes(21).toString("base64url").slice(0, 28),
        stop: () => db.terminate(),
      };
    },
  },
  postgres: {
    skip:
      process.env.CRUMB_TEST_DATABASE_URL && process.env.CRUMB_TEST_ADMIN_DATABASE_URL
        ? false
        : "CRUMB_TEST_DATABASE_URL / CRUMB_TEST_ADMIN_DATABASE_URL not set",
    async start() {
      const pg = createPostgresClient({ url: process.env.CRUMB_TEST_DATABASE_URL!, schema: "crumb" });
      await runMigrations(pg, join(here, "..", "..", "migrations"));
      const admin = createPostgresClient({ url: process.env.CRUMB_TEST_ADMIN_DATABASE_URL!, schema: "public" });
      return {
        repo: createPostgresCrumbRepo(pg),
        async addUser(email) {
          const [u] = await admin.sql<{ id: string }[]>`
            INSERT INTO shared.users (email) VALUES (${email}) RETURNING id
          `;
          return u.id;
        },
        async stop() {
          await admin.close();
          await pg.close();
        },
      };
    },
  },
};

type Res = { status: number; body: any };
type Call = (method: string, path: string, body?: unknown) => Promise<Res>;

const silent = { info() {}, warn() {}, error() {} };
const H = 3_600_000;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const country = BUILTIN_RECIPES.find((r) => r.name === "Country loaf")!;

/** Records what would have been pushed; endpoints containing "gone" are expired. */
function fakePush(repo: () => CrumbRepo) {
  const sent: { endpoint: string; payload: PushPayload }[] = [];
  const service: PushService = {
    publicKey: async () => (await repo().vapidKeys(generateVapidKeys)).publicKey,
    async send(sub: PushSubscriptionRow, payload: PushPayload) {
      if (sub.endpoint.includes("gone")) return "gone";
      sent.push({ endpoint: sub.endpoint, payload });
      return "sent";
    },
  };
  return { service, sent };
}

const subscription = (tag: string) => ({
  endpoint: `https://push.example.com/${tag}/${randomUUID()}`,
  keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
});

describe("built-in catalog", () => {
  it("has unique ids and valid configs", () => {
    assert.equal(new Set(BUILTIN_RECIPES.map((r) => r.id)).size, BUILTIN_RECIPES.length);
    for (const r of BUILTIN_RECIPES) {
      const parsed = recipeConfig.safeParse(r.config);
      assert.ok(parsed.success, `${r.name}: ${JSON.stringify(parsed.error?.flatten())}`);
      assert.deepEqual(parsed.data, r.config, `${r.name} round-trips unchanged`);
    }
  });
});

for (const [backendName, backend] of Object.entries(backends)) {
  for (const adapter of ["fastify", "express"] as const) {
    describe(`crumb contract (${backendName}, ${adapter})`, { skip: backend.skip }, () => {
      let b: Backend;
      let stopServer: () => Promise<void>;
      let base: string;
      const sessions = new Map<string, SessionUser>();
      let baker: SessionUser;
      let outsider: SessionUser;
      const push = fakePush(() => b.repo);

      const as =
        (user: SessionUser | null): Call =>
        async (method, path, body) => {
          const token = user ? [...sessions].find(([, u]) => u === user)![0] : null;
          const res = await fetch(`${base}/api${path}`, {
            method,
            headers: {
              ...(body !== undefined ? { "content-type": "application/json" } : {}),
              ...(token ? { cookie: `stack_session=${token}` } : {}),
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
          });
          const text = await res.text();
          return { status: res.status, body: text ? JSON.parse(text) : null };
        };

      // The verifier is the seam that differs between deployments; here each
      // user gets a sentinel cookie so the tests exercise routes and repos.
      const verify = async (headers: Record<string, string | string[] | undefined>) => {
        const m = /stack_session=([^;]+)/.exec(String(headers["cookie"] ?? ""));
        return (m && sessions.get(m[1])) ?? null;
      };

      const newUser = async (name: string): Promise<SessionUser> => {
        const email = `${name}-${randomUUID()}@example.com`;
        const user = { userId: await b.addUser(email), email, displayName: name };
        sessions.set(randomUUID(), user);
        return user;
      };

      before(async () => {
        b = await backend.start();
        const opts = { repo: b.repo, verify };
        const routes = crumbRoutes({ push: push.service });

        if (adapter === "fastify") {
          const app = Fastify();
          await app.register(toFastifyPlugin(routes, opts), { prefix: "/api" });
          await app.listen({ port: 0, host: "127.0.0.1" });
          base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
          stopServer = () => app.close();
        } else {
          const outer = (await import("express")).default();
          outer.use("/api", toExpressApp(routes, { ...opts, logger: silent }));
          const server = outer.listen(0, "127.0.0.1");
          await new Promise((r) => server.once("listening", r));
          base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
          stopServer = () => new Promise<void>((r) => server.close(() => r()));
        }

        baker = await newUser("Bea");
        outsider = await newUser("Oz");
      });

      after(async () => {
        await stopServer?.();
        await b?.stop();
      });

      let starterId: string;
      let feedingId: string;

      it("serves /health publicly and 401s everything else without a session", async () => {
        assert.deepEqual(await as(null)("GET", "/health"), { status: 200, body: { ok: true } });
        for (const [method, path] of [
          ["GET", "/starters"],
          ["POST", "/starters"],
          ["GET", "/recipes"],
          ["GET", "/bakes"],
          ["POST", "/bakes"],
          ["GET", "/reminders"],
          ["GET", "/push/key"],
        ] as const) {
          assert.deepEqual(
            await as(null)(method, path),
            { status: 401, body: { error: "not signed in" } },
            `${method} ${path}`,
          );
        }
      });

      it("creates a starter with defaults, and a counter feed reminder", async () => {
        const bad = await as(baker)("POST", "/starters", { name: "" });
        assert.equal(bad.status, 400);
        assert.ok(bad.body.error.fieldErrors.name);

        const res = await as(baker)("POST", "/starters", { name: "Bertha", flour: "50/50 rye and AP" });
        assert.equal(res.status, 201);
        const s = res.body;
        starterId = s.id;
        assert.deepEqual(
          { ...s, id: undefined, location_since: undefined, created_at: undefined, updated_at: undefined },
          {
            id: undefined,
            name: "Bertha",
            flour: "50/50 rye and AP",
            hydration: 100,
            location: "counter",
            location_since: undefined,
            reserve_grams: 20,
            notes: "",
            created_at: undefined,
            updated_at: undefined,
            last_fed: null,
            speed: { factor: 1, samples: 0 },
            predicted_peak_at: null,
          },
        );
        assert.match(s.created_at, ISO);
        assert.match(s.location_since, ISO);

        const reminders = (await as(baker)("GET", "/reminders")).body;
        assert.deepEqual(
          reminders.map((r: any) => [r.key, r.title, r.url]),
          [[`starter:${starterId}:feed`, "Bertha is hungry", `#/starters/${starterId}`]],
        );
        assert.equal(Date.parse(reminders[0].due_at) - Date.parse(s.location_since), 24 * H);

        assert.deepEqual((await as(baker)("GET", "/starters")).body.map((x: any) => x.id), [starterId]);
        assert.deepEqual(await as(outsider)("GET", "/starters"), { status: 200, body: [] });
        assert.equal((await as(outsider)("GET", `/starters/${starterId}`)).status, 404);
        assert.equal((await as(outsider)("PATCH", `/starters/${starterId}`, { name: "Mine" })).status, 404);
        assert.equal((await as(outsider)("POST", `/starters/${starterId}/feedings`, { starterG: 10, flourG: 10, waterG: 10 })).status, 404);
      });

      it("logs a feed, predicts its peak and learns from the real one", async () => {
        const fedAt = new Date(Date.now() - 2 * H).toISOString();
        const res = await as(baker)("POST", `/starters/${starterId}/feedings`, {
          fedAt,
          starterG: 20,
          flourG: 40,
          waterG: 40,
          tempF: 75,
          remindAtPeak: true,
        });
        assert.equal(res.status, 201);
        feedingId = res.body.id;
        assert.deepEqual(
          { ...res.body, id: undefined, created_at: undefined },
          {
            id: undefined,
            starter_id: starterId,
            fed_at: fedAt,
            starter_g: 20,
            flour_g: 40,
            water_g: 40,
            temp_f: 75,
            peak_at: null,
            rise_pct: null,
            notes: "",
            remind_at_peak: true,
            created_at: undefined,
          },
        );

        const s = (await as(baker)("GET", `/starters/${starterId}`)).body;
        assert.equal(s.last_fed.id, feedingId);
        // 1:2:2 at 75°F: 4 + 1.3 × 2 = 6.6 h.
        assert.equal(Date.parse(s.predicted_peak_at) - Date.parse(fedAt), Math.round(6.6 * H));

        const keys = (await as(baker)("GET", "/reminders")).body.map((r: any) => r.key);
        assert.deepEqual(keys, [`starter:${starterId}:peak`, `starter:${starterId}:feed`]);

        assert.deepEqual(
          await as(baker)("PATCH", `/feedings/${feedingId}`, { peakAt: new Date(Date.parse(fedAt) - H).toISOString() }),
          { status: 400, body: { error: "PEAK_BEFORE_FEED" } },
        );
        const peakAt = new Date(Date.parse(fedAt) + 1.5 * 6.6 * H).toISOString();
        const patched = await as(baker)("PATCH", `/feedings/${feedingId}`, { peakAt, risePct: 120 });
        assert.equal(patched.status, 200);
        assert.equal(patched.body.peak_at, peakAt);
        assert.equal(patched.body.rise_pct, 120);
        assert.equal((await as(outsider)("PATCH", `/feedings/${feedingId}`, { risePct: 1 })).status, 404);

        const after = (await as(baker)("GET", `/starters/${starterId}`)).body;
        assert.equal(after.predicted_peak_at, null);
        assert.equal(after.speed.samples, 1);
        assert.ok(Math.abs(after.speed.factor - 1.5) < 0.01, String(after.speed.factor));
        assert.deepEqual(
          (await as(baker)("GET", "/reminders")).body.map((r: any) => r.key),
          [`starter:${starterId}:feed`],
          "logging the peak drops the peak reminder",
        );

        const list = await as(baker)("GET", `/starters/${starterId}/feedings?limit=5`);
        assert.deepEqual(list.body.map((f: any) => f.id), [feedingId]);
      });

      it("restarts location_since and the feed reminder when a starter moves to the fridge", async () => {
        const before = (await as(baker)("GET", `/starters/${starterId}`)).body;
        const res = await as(baker)("PATCH", `/starters/${starterId}`, { location: "fridge" });
        assert.equal(res.status, 200);
        assert.equal(res.body.location, "fridge");
        assert.ok(res.body.location_since > before.location_since);
        const [feed] = (await as(baker)("GET", "/reminders")).body;
        assert.equal(feed.title, "Weekly feed for Bertha");
        assert.equal(Date.parse(feed.due_at) - Date.parse(before.last_fed.fed_at), 7 * 24 * H);

        const same = await as(baker)("PATCH", `/starters/${starterId}`, { location: "fridge", notes: "back shelf" });
        assert.equal(same.body.location_since, res.body.location_since, "same place, same since");
        assert.equal(same.body.notes, "back shelf");
      });

      it("serves built-in recipes read-only and the user's own recipes", async () => {
        const all = await as(baker)("GET", "/recipes");
        assert.deepEqual(all.body, BUILTIN_RECIPES);
        assert.deepEqual(await as(baker)("GET", `/recipes/${country.id}`), { status: 200, body: country });
        assert.deepEqual(await as(baker)("PATCH", `/recipes/${country.id}`, { name: "Mine" }), {
          status: 403,
          body: { error: "BUILTIN_READ_ONLY" },
        });
        assert.deepEqual(await as(baker)("DELETE", `/recipes/${country.id}`), {
          status: 403,
          body: { error: "BUILTIN_READ_ONLY" },
        });

        const lopsided = structuredClone(country.config);
        lopsided.formula.flours[0].pct = 50;
        assert.equal((await as(baker)("POST", "/recipes", { name: "x", kind: "loaf", config: lopsided })).status, 400);

        const created = await as(baker)("POST", "/recipes", { name: "My loaf", kind: "loaf", config: country.config });
        assert.equal(created.status, 201);
        assert.equal(created.body.builtin, false);
        assert.deepEqual(created.body.config, country.config);

        const renamed = await as(baker)("PATCH", `/recipes/${created.body.id}`, { name: "Rye loaf" });
        assert.equal(renamed.body.name, "Rye loaf");
        assert.deepEqual(renamed.body.config, country.config);
        assert.equal((await as(outsider)("GET", `/recipes/${created.body.id}`)).status, 404);
        assert.deepEqual(
          (await as(baker)("GET", "/recipes")).body.map((r: any) => r.id),
          [...BUILTIN_RECIPES.map((r) => r.id), created.body.id],
        );
        assert.deepEqual(await as(baker)("DELETE", `/recipes/${created.body.id}`), { status: 200, body: { ok: true } });
        assert.equal((await as(baker)("GET", `/recipes/${created.body.id}`)).status, 404);
      });

      let bakeId: string;

      it("plans a bake backward from the oven, with the fridge revival first", async () => {
        const readyAt = new Date(Date.now() + 48 * H);
        readyAt.setUTCSeconds(0, 0);
        assert.equal((await as(baker)("POST", "/bakes", { recipeId: randomUUID(), readyAt: readyAt.toISOString() })).status, 404);
        assert.equal(
          (await as(outsider)("POST", "/bakes", { recipeId: country.id, readyAt: readyAt.toISOString(), starterId })).status,
          404,
          "someone else's starter",
        );

        const res = await as(baker)("POST", "/bakes", {
          recipeId: country.id,
          readyAt: readyAt.toISOString(),
          tempF: 72,
          starterId,
          flex: { retard: 720 },
        });
        assert.equal(res.status, 201);
        const bake = res.body;
        bakeId = bake.id;
        assert.equal(bake.recipe_name, "Country loaf");
        assert.equal(bake.status, "active");
        assert.equal(bake.ready_at, readyAt.toISOString());
        assert.equal(bake.pieces, 2);
        assert.equal(bake.piece_grams, 900);
        assert.deepEqual(bake.levain, { grams: 203, flour: 102, water: 102 });
        assert.equal(bake.steps[0].id, "starter-out");
        assert.equal(bake.steps.find((s: any) => s.id === "retard").minutes, 720);
        assert.equal(bake.steps.at(-1).end_at, readyAt.toISOString());
        for (const s of bake.steps) {
          assert.match(s.start_at, ISO);
          assert.equal(s.done_at, null);
        }

        assert.deepEqual((await as(baker)("GET", `/bakes/${bakeId}`)).body, bake);
        assert.equal((await as(outsider)("GET", `/bakes/${bakeId}`)).status, 404);
        assert.deepEqual((await as(baker)("GET", "/bakes")).body.map((x: any) => x.id), [bakeId]);

        const keys = (await as(baker)("GET", "/reminders")).body.filter((r: any) => r.key.startsWith(`bake:${bakeId}`));
        // A reminder per step, one per set of folds, and "out of the oven".
        assert.equal(keys.length, bake.steps.length + 4 + 1);
        assert.ok(keys.some((r: any) => r.title === "Stretch and fold (1 of 4)"));
        assert.ok(keys.some((r: any) => r.title === "Out of the oven" && r.due_at === readyAt.toISOString()));
      });

      it("moves the plan as steps finish, folds are logged and the baker runs late", async () => {
        const before = (await as(baker)("GET", `/bakes/${bakeId}`)).body;
        const at = new Date(Date.parse(before.steps[0].end_at) + 30 * 60_000).toISOString();
        const done = await as(baker)("POST", `/bakes/${bakeId}/steps/starter-out/done`, { at });
        assert.equal(done.status, 200);
        assert.equal(done.body.steps[0].done_at, at);
        assert.equal(done.body.steps[1].start_at, at);
        assert.equal(Date.parse(done.body.ready_at) - Date.parse(before.ready_at), 30 * 60_000);

        assert.equal((await as(baker)("POST", `/bakes/${bakeId}/steps/nope/done`, {})).status, 404);
        assert.deepEqual(await as(baker)("POST", `/bakes/${bakeId}/steps/mix/fold`, {}), {
          status: 400,
          body: { error: "this step has no folds" },
        });

        const fold = await as(baker)("POST", `/bakes/${bakeId}/steps/bulk/fold`, {});
        assert.equal(fold.body.steps.find((s: any) => s.id === "bulk").fold_times.length, 1);
        const folds = (await as(baker)("GET", "/reminders")).body.filter((r: any) => r.key.includes(":bulk:fold"));
        assert.deepEqual(folds.map((r: any) => r.title), [
          "Stretch and fold (2 of 4)",
          "Stretch and fold (3 of 4)",
          "Stretch and fold (4 of 4)",
        ]);

        const shifted = await as(baker)("POST", `/bakes/${bakeId}/shift`, { minutes: 45 });
        assert.equal(Date.parse(shifted.body.ready_at) - Date.parse(done.body.ready_at), 45 * 60_000);
        const ready = (await as(baker)("GET", "/reminders")).body.find((r: any) => r.key === `bake:${bakeId}:ready`);
        assert.equal(ready.due_at, shifted.body.ready_at);
        assert.equal((await as(outsider)("POST", `/bakes/${bakeId}/shift`, { minutes: 5 })).status, 404);
      });

      it("cancels a bake, clearing its reminders, and refuses to move it after", async () => {
        const res = await as(baker)("PATCH", `/bakes/${bakeId}`, { status: "cancelled", notes: "Too busy", rating: 3 });
        assert.equal(res.status, 200);
        assert.equal(res.body.status, "cancelled");
        assert.equal(res.body.notes, "Too busy");
        assert.equal(res.body.rating, 3);
        const left = (await as(baker)("GET", "/reminders")).body.filter((r: any) => r.key.startsWith("bake:"));
        assert.deepEqual(left, []);
        assert.deepEqual(await as(baker)("POST", `/bakes/${bakeId}/shift`, { minutes: 5 }), {
          status: 409,
          body: { error: "BAKE_NOT_ACTIVE" },
        });
        assert.deepEqual(await as(baker)("DELETE", `/bakes/${bakeId}`), { status: 200, body: { ok: true } });
        assert.equal((await as(baker)("GET", `/bakes/${bakeId}`)).status, 404);
      });

      it("serves the VAPID key, keeps it stable and manages subscriptions", async () => {
        const key = (await as(baker)("GET", "/push/key")).body.publicKey;
        assert.equal(Buffer.from(key, "base64url").length, 65);
        assert.equal((await as(outsider)("GET", "/push/key")).body.publicKey, key);

        const sub = subscription("bea");
        const saved = await as(baker)("POST", "/push/subscriptions", sub);
        assert.equal(saved.status, 201);
        assert.equal((await as(baker)("POST", "/push/subscriptions", sub)).status, 201, "re-subscribing is fine");
        assert.equal((await as(baker)("POST", "/push/subscriptions", { ...sub, endpoint: "http://insecure" })).status, 400);

        assert.deepEqual(await as(baker)("POST", "/push/test"), { status: 200, body: { sent: 1 } });
        assert.equal(push.sent.at(-1)!.endpoint, sub.endpoint);
        assert.deepEqual(await as(outsider)("POST", "/push/test"), { status: 200, body: { sent: 0 } });

        assert.deepEqual(await as(outsider)("POST", "/push/unsubscribe", { endpoint: sub.endpoint }), {
          status: 200,
          body: { ok: false },
        });
        assert.deepEqual(await as(baker)("POST", "/push/unsubscribe", { endpoint: sub.endpoint }), {
          status: 200,
          body: { ok: true },
        });
        assert.deepEqual(await as(baker)("POST", "/push/test"), { status: 200, body: { sent: 0 } });
      });

      it("dispatches due reminders once by push, stale ones dropped", async () => {
        // Bea: a device. Nell: no device, so nothing is sent. Ugo: a device
        // the push service has forgotten.
        const nell = await newUser("Nell");
        const ugo = await newUser("Ugo");
        await as(baker)("POST", "/push/subscriptions", subscription("bea"));
        await as(ugo)("POST", "/push/subscriptions", subscription("gone"));

        const due = new Date(Date.now() + 365 * 24 * H);
        const at = (h: number) => new Date(due.getTime() + h * H).toISOString();
        const r = (key: string, dueAt: string) => ({ key, title: key, body: "b", url: "#/", due_at: dueAt });
        await b.repo.replaceReminders(baker.userId, "t", [r("t:bea", at(0)), r("t:late", at(-5))]);
        await b.repo.replaceReminders(nell.userId, "t", [r("t:nell", at(0))]);
        await b.repo.replaceReminders(ugo.userId, "t", [r("t:ugo", at(0))]);

        const sentBefore = push.sent.length;
        const result = await dispatchReminders(
          { repo: b.repo, push: push.service, log: silent },
          new Date(due.getTime() + 60_000),
        );
        // Other suites' reminders may be due by then too; only ours are asserted.
        assert.ok(result.claimed >= 4);
        const ours = push.sent.slice(sentBefore).map((s) => s.payload.title);
        assert.ok(ours.includes("t:bea"));
        assert.ok(!ours.includes("t:late"), "five hours late is dropped");
        assert.ok(!ours.includes("t:nell") && !ours.includes("t:ugo"), "no device, nothing sent");
        assert.deepEqual(await b.repo.listPushSubscriptions(ugo.userId), [], "a gone device is forgotten");

        for (const u of [baker, nell, ugo]) {
          assert.ok(!(await b.repo.listReminders(u.userId)).some((x) => x.key.startsWith("t:")));
        }
        const again = await dispatchReminders(
          { repo: b.repo, push: push.service, log: silent },
          new Date(due.getTime() + 60_000),
        );
        assert.equal(again.claimed, 0, "claimed once");
      });

      it("deletes a feed and a starter with its feeds and reminders", async () => {
        assert.equal((await as(outsider)("DELETE", `/feedings/${feedingId}`)).status, 404);
        assert.deepEqual(await as(baker)("DELETE", `/feedings/${feedingId}`), { status: 200, body: { ok: true } });
        assert.equal((await as(baker)("GET", `/starters/${starterId}`)).body.last_fed, null);

        assert.equal((await as(outsider)("DELETE", `/starters/${starterId}`)).status, 404);
        assert.deepEqual(await as(baker)("DELETE", `/starters/${starterId}`), { status: 200, body: { ok: true } });
        assert.equal((await as(baker)("GET", `/starters/${starterId}`)).status, 404);
        assert.deepEqual(
          (await as(baker)("GET", "/reminders")).body.filter((r: any) => r.key.startsWith("starter:")),
          [],
        );
      });
    });
  }
}
