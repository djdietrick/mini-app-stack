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
import { createFirestoreFretworkRepo } from "../repo/firestore.js";
import { createPostgresFretworkRepo } from "../repo/postgres.js";
import type { FretworkRepo } from "../repo/types.js";
import { BUILTIN_EXERCISES } from "./catalog.js";
import { fretworkRoutes } from "./routes.js";
import { exerciseConfig } from "./types.js";

/**
 * fretwork's HTTP contract, run end to end against each real backend through
 * each adapter. The assertions pin what apps/fretwork/web/src/api.ts depends
 * on: status codes, error bodies, row shapes and ISO timestamps.
 *
 * Each backend runs only when it is reachable:
 *   Firestore  FIRESTORE_EMULATOR_HOST             (CI sets this)
 *   Postgres   FRETWORK_TEST_DATABASE_URL          connects as the `fretwork` role
 *              FRETWORK_TEST_ADMIN_DATABASE_URL    seeds shared.users, which the
 *                                                  fretwork role can't write
 */

const here = dirname(fileURLToPath(import.meta.url));

interface Backend {
  repo: FretworkRepo;
  addUser(email: string): Promise<string>;
  stop(): Promise<void>;
}

const backends: Record<string, { skip: string | false; start: () => Promise<Backend> }> = {
  firestore: {
    skip: process.env.FIRESTORE_EMULATOR_HOST ? false : "FIRESTORE_EMULATOR_HOST not set",
    async start() {
      const db = new Firestore({ projectId: "demo-fretwork" });
      // A fresh prefix per run, so repeat runs never see each other's documents.
      const prefix = `t${Date.now()}_${randomBytes(3).toString("hex")}_`;
      return {
        repo: createFirestoreFretworkRepo(db, prefix),
        // Firebase uids are 28-char strings, not UUIDs.
        addUser: async () => randomBytes(21).toString("base64url").slice(0, 28),
        stop: () => db.terminate(),
      };
    },
  },
  postgres: {
    skip:
      process.env.FRETWORK_TEST_DATABASE_URL && process.env.FRETWORK_TEST_ADMIN_DATABASE_URL
        ? false
        : "FRETWORK_TEST_DATABASE_URL / FRETWORK_TEST_ADMIN_DATABASE_URL not set",
    async start() {
      const pg = createPostgresClient({
        url: process.env.FRETWORK_TEST_DATABASE_URL!,
        schema: "fretwork",
      });
      await runMigrations(pg, join(here, "..", "..", "migrations"));
      const admin = createPostgresClient({
        url: process.env.FRETWORK_TEST_ADMIN_DATABASE_URL!,
        schema: "public",
      });
      return {
        repo: createPostgresFretworkRepo(pg),
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

const pentatonic = {
  engine: "sequence",
  source: { kind: "scale", root: 4, formula: "minor-pentatonic" },
  frets: { lo: 0, hi: 3 },
  strings: [1, 2, 3, 4, 5, 6],
  pattern: "up",
  grading: "exact",
  tempo: { start: 70, step: 4, cleanRunsToAdvance: 3 },
};

const hunt = {
  engine: "find",
  target: { kind: "pitch-class", pc: 7 },
  order: "any",
  frets: { lo: 0, hi: 12 },
  strings: [6, 5],
  grading: "pitch-class",
  timeLimitSec: 60,
};

const run = (exerciseId: string, startedAt: string, extra: Record<string, unknown> = {}) => ({
  exerciseId,
  startedAt,
  durationMs: 42_000,
  tempo: 70,
  notesTotal: 2,
  notesClean: 1,
  clean: false,
  notes: [
    { midi: 40, ok: true, ms: 800, string: 6, fret: 0 },
    { midi: 43, ok: false, ms: 2100, string: 6, fret: 3 },
  ],
  ...extra,
});

describe("built-in catalog", () => {
  it("has unique ids and valid configs", () => {
    assert.equal(new Set(BUILTIN_EXERCISES.map((e) => e.id)).size, BUILTIN_EXERCISES.length);
    for (const e of BUILTIN_EXERCISES) {
      assert.ok(exerciseConfig.safeParse(e.config).success, e.name);
      assert.equal(e.engine, e.config.engine);
    }
  });
});

for (const [backendName, backend] of Object.entries(backends)) {
  for (const adapter of ["fastify", "express"] as const) {
    describe(`fretwork contract (${backendName}, ${adapter})`, { skip: backend.skip }, () => {
      let b: Backend;
      let stopServer: () => Promise<void>;
      let base: string;
      const sessions = new Map<string, SessionUser>();
      let player: SessionUser;
      let outsider: SessionUser;

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
        const routes = fretworkRoutes();

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

        player = await newUser("Pat");
        outsider = await newUser("Oz");
      });

      after(async () => {
        await stopServer?.();
        await b?.stop();
      });

      const builtin = BUILTIN_EXERCISES[0];
      let mine: string;

      it("serves /health publicly and 401s everything else without a session", async () => {
        assert.deepEqual(await as(null)("GET", "/health"), { status: 200, body: { ok: true } });
        for (const [method, path] of [
          ["GET", "/exercises"],
          ["POST", "/exercises"],
          ["GET", "/runs"],
          ["POST", "/runs"],
          ["GET", "/progress"],
          ["GET", "/stats/positions"],
          ["GET", "/stats/week"],
          ["GET", "/sessions/suggested"],
          ["GET", "/routines"],
          ["POST", "/routines"],
        ] as const) {
          assert.deepEqual(
            await as(null)(method, path),
            { status: 401, body: { error: "not signed in" } },
            `${method} ${path}`,
          );
        }
      });

      it("lists the built-ins for a new user, and keeps them read-only", async () => {
        const res = await as(player)("GET", "/exercises");
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, BUILTIN_EXERCISES);

        assert.deepEqual(await as(player)("GET", `/exercises/${builtin.id}`), {
          status: 200,
          body: builtin,
        });
        assert.deepEqual(
          await as(player)("PATCH", `/exercises/${builtin.id}`, { name: "Mine now" }),
          { status: 403, body: { error: "BUILTIN_READ_ONLY" } },
        );
        assert.deepEqual(await as(player)("DELETE", `/exercises/${builtin.id}`), {
          status: 403,
          body: { error: "BUILTIN_READ_ONLY" },
        });
      });

      it("validates exercise configs", async () => {
        const missing = await as(player)("POST", "/exercises", { name: "x" });
        assert.equal(missing.status, 400);
        assert.ok(missing.body.error.fieldErrors.category, "flattened zod error");

        for (const config of [
          { ...pentatonic, source: { ...pentatonic.source, formula: "major-triad" } },
          { ...pentatonic, frets: { lo: 7, hi: 5 } },
          { ...pentatonic, strings: [1, 1] },
          { ...hunt, engine: "tapping" },
        ]) {
          const res = await as(player)("POST", "/exercises", { name: "Bad", category: "scales", config });
          assert.equal(res.status, 400, JSON.stringify(config));
        }
      });

      it("creates an exercise and lists it after the built-ins", async () => {
        const res = await as(player)("POST", "/exercises", {
          name: "  E minor pentatonic, open  ",
          category: "scales",
          config: pentatonic,
        });
        assert.equal(res.status, 201);
        mine = res.body.id;
        assert.deepEqual(Object.keys(res.body).sort(), [
          "builtin",
          "category",
          "config",
          "created_at",
          "engine",
          "id",
          "name",
          "updated_at",
        ]);
        assert.equal(res.body.name, "E minor pentatonic, open", "trimmed");
        assert.equal(res.body.engine, "sequence");
        assert.equal(res.body.builtin, false);
        assert.deepEqual(res.body.config, pentatonic);
        assert.equal(res.body.created_at, new Date(res.body.created_at).toISOString(), "ISO 8601");

        const list = (await as(player)("GET", "/exercises")).body;
        assert.equal(list.length, BUILTIN_EXERCISES.length + 1);
        assert.deepEqual(list.at(-1), res.body);
        assert.deepEqual((await as(player)("GET", `/exercises/${mine}`)).body, res.body);
      });

      it("hides one user's exercises from another", async () => {
        assert.equal((await as(outsider)("GET", "/exercises")).body.length, BUILTIN_EXERCISES.length);
        assert.deepEqual(await as(outsider)("GET", `/exercises/${mine}`), {
          status: 404,
          body: { error: "not found" },
        });
        assert.equal((await as(outsider)("PATCH", `/exercises/${mine}`, { name: "Stolen" })).status, 404);
        assert.equal((await as(outsider)("DELETE", `/exercises/${mine}`)).status, 404);
        assert.equal((await as(player)("GET", `/exercises/${mine}`)).body.name, "E minor pentatonic, open");
        assert.equal((await as(player)("GET", `/exercises/${randomUUID()}`)).status, 404);
      });

      it("patches only the fields sent", async () => {
        assert.equal((await as(player)("PATCH", `/exercises/${mine}`, {})).status, 400);

        const renamed = await as(player)("PATCH", `/exercises/${mine}`, { name: "Open E box" });
        assert.equal(renamed.status, 200);
        assert.equal(renamed.body.name, "Open E box");
        assert.deepEqual(renamed.body.config, pentatonic, "config untouched");
        assert.ok(renamed.body.updated_at >= renamed.body.created_at);

        const swapped = await as(player)("PATCH", `/exercises/${mine}`, {
          category: "notes",
          config: hunt,
        });
        assert.equal(swapped.status, 200);
        assert.equal(swapped.body.name, "Open E box", "name untouched");
        assert.equal(swapped.body.engine, "find");
        assert.deepEqual(swapped.body.config, hunt);
      });

      it("records runs against built-ins and own exercises only", async () => {
        const a = await as(player)("POST", "/runs", run(builtin.id, "2026-09-01T10:00:00.000Z"));
        assert.equal(a.status, 201);
        assert.deepEqual(Object.keys(a.body).sort(), [
          "clean",
          "created_at",
          "duration_ms",
          "exercise_id",
          "id",
          "notes_clean",
          "notes_total",
          "started_at",
          "tempo",
        ]);
        assert.equal(a.body.started_at, "2026-09-01T10:00:00.000Z");
        assert.equal(a.body.exercise_id, builtin.id);
        assert.equal(a.body.duration_ms, 42_000);

        const b2 = await as(player)(
          "POST",
          "/runs",
          run(mine, "2026-09-02T10:00:00.000+02:00", { tempo: null, clean: true, notesClean: 2 }),
        );
        assert.equal(b2.status, 201);
        assert.equal(b2.body.started_at, "2026-09-02T08:00:00.000Z", "normalised to UTC");
        assert.equal(b2.body.tempo, null);

        assert.deepEqual(await as(player)("POST", "/runs", run(randomUUID(), "2026-09-03T10:00:00Z")), {
          status: 404,
          body: { error: "exercise not found" },
        });
        assert.equal((await as(outsider)("POST", "/runs", run(mine, "2026-09-03T10:00:00Z"))).status, 404);
        assert.equal(
          (await as(player)("POST", "/runs", run(mine, "2026-09-03T10:00:00Z", { notesClean: 3 }))).status,
          400,
        );
        assert.equal((await as(player)("POST", "/runs", run(mine, "yesterday"))).status, 400);
      });

      it("lists runs newest first, per exercise, and per user", async () => {
        await as(player)("POST", "/runs", run(builtin.id, "2026-09-03T10:00:00.000Z"));

        const all = (await as(player)("GET", "/runs")).body;
        assert.deepEqual(
          all.map((r: { started_at: string }) => r.started_at),
          ["2026-09-03T10:00:00.000Z", "2026-09-02T08:00:00.000Z", "2026-09-01T10:00:00.000Z"],
        );

        const forBuiltin = (await as(player)("GET", `/runs?exerciseId=${builtin.id}`)).body;
        assert.equal(forBuiltin.length, 2);
        assert.ok(forBuiltin.every((r: { exercise_id: string }) => r.exercise_id === builtin.id));

        assert.equal((await as(player)("GET", "/runs?limit=1")).body.length, 1);
        assert.equal((await as(player)("GET", "/runs?limit=0")).status, 400);
        assert.deepEqual((await as(outsider)("GET", "/runs")).body, []);
      });

      it("deletes an exercise but keeps its history", async () => {
        assert.deepEqual(await as(player)("DELETE", `/exercises/${mine}`), {
          status: 200,
          body: { ok: true },
        });
        assert.equal((await as(player)("GET", `/exercises/${mine}`)).status, 404);
        assert.equal((await as(player)("DELETE", `/exercises/${mine}`)).status, 404);
        assert.equal((await as(player)("GET", `/runs?exerciseId=${mine}`)).body.length, 1);
        assert.equal((await as(player)("POST", "/runs", run(mine, "2026-09-04T10:00:00Z"))).status, 404);
      });

      it("keeps the tempo ladder per exercise as runs are recorded", async () => {
        const lee = await newUser("Lee");
        const seq = BUILTIN_EXERCISES.find((e) => e.config.engine === "sequence")!;
        const { start, step, cleanRunsToAdvance } = (seq.config as { tempo: Record<string, number> }).tempo;
        const at = (i: number) => new Date(Date.UTC(2026, 8, 10, 9, i)).toISOString();
        const post = async (i: number, clean: boolean, tempo: number | null, id = seq.id) =>
          assert.equal(
            (await as(lee)("POST", "/runs", run(id, at(i), { clean, tempo, notesClean: clean ? 2 : 1 }))).status,
            201,
          );

        assert.deepEqual(await as(lee)("GET", "/progress"), { status: 200, body: [] });

        for (let i = 0; i < cleanRunsToAdvance; i++) await post(i, true, start);
        let [row] = (await as(lee)("GET", "/progress")).body;
        assert.deepEqual(row, {
          exercise_id: seq.id,
          tempo: start + step,
          clean_streak: 0,
          best_tempo: start,
          runs: cleanRunsToAdvance,
          last_practiced_at: at(cleanRunsToAdvance - 1),
        });

        await post(10, true, start + step);
        [row] = (await as(lee)("GET", "/progress")).body;
        assert.equal(row.clean_streak, 1);
        await post(11, false, start + step);
        [row] = (await as(lee)("GET", "/progress")).body;
        assert.deepEqual(
          { tempo: row.tempo, clean_streak: row.clean_streak, best_tempo: row.best_tempo },
          { tempo: start + step, clean_streak: 0, best_tempo: start + step },
          "an unclean run resets the streak",
        );

        // A run posted late does not move last_practiced_at back.
        await post(-30, true, start + step);
        [row] = (await as(lee)("GET", "/progress")).body;
        assert.equal(row.last_practiced_at, at(11));

        // A find exercise has no ladder; the most recently practiced lists first.
        await post(20, true, null, builtin.id);
        const rows = (await as(lee)("GET", "/progress")).body;
        assert.deepEqual(
          rows.map((r: { exercise_id: string }) => r.exercise_id),
          [builtin.id, seq.id],
        );
        assert.deepEqual(rows[0], {
          exercise_id: builtin.id,
          tempo: null,
          clean_streak: 1,
          best_tempo: null,
          runs: 1,
          last_practiced_at: at(20),
        });
        assert.deepEqual((await as(outsider)("GET", "/progress")).body, []);
      });

      it("folds runs recorded at the same time one after the other", async () => {
        const sam = await newUser("Sam");
        await Promise.all(
          Array.from({ length: 5 }, (_, i) =>
            as(sam)("POST", "/runs", run(builtin.id, new Date(Date.UTC(2026, 8, 11, 9, i)).toISOString())),
          ),
        );
        const [row] = (await as(sam)("GET", "/progress")).body;
        assert.equal(row.runs, 5);
        const cells = (await as(sam)("GET", "/stats/positions")).body;
        assert.equal(cells.find((c: { fret: number }) => c.fret === 0).attempts, 5);
      });

      it("maps positions from find and respond runs, but not sequence runs", async () => {
        const kim = await newUser("Kim");
        assert.deepEqual(await as(kim)("GET", "/stats/positions"), { status: 200, body: [] });

        const respond = BUILTIN_EXERCISES.find((e) => e.config.engine === "respond")!;
        const seq = BUILTIN_EXERCISES.find((e) => e.config.engine === "sequence")!;
        await as(kim)("POST", "/runs", run(builtin.id, "2026-09-12T10:00:00Z"));
        await as(kim)(
          "POST",
          "/runs",
          run(respond.id, "2026-09-12T10:05:00Z", {
            tempo: null,
            notes: [
              { midi: 40, ok: true, ms: 1200, string: 6, fret: 0 },
              { midi: 57, ok: false, ms: 9000, string: null, fret: null },
            ],
          }),
        );
        await as(kim)(
          "POST",
          "/runs",
          run(seq.id, "2026-09-12T10:10:00Z", { notes: [{ midi: 45, ok: true, ms: 500, string: 5, fret: 0 }] }),
        );

        assert.deepEqual((await as(kim)("GET", "/stats/positions")).body, [
          { string: 6, fret: 0, attempts: 2, hits: 2, total_ms: 2000 },
          { string: 6, fret: 3, attempts: 1, hits: 0, total_ms: 0 },
        ]);
        assert.deepEqual((await as(outsider)("GET", "/stats/positions")).body, []);
      });

      it("keeps routines per user, in order, on every write", async () => {
        const rae = await newUser("Rae");
        const [a, b] = [BUILTIN_EXERCISES[0].id, BUILTIN_EXERCISES[3].id];
        assert.deepEqual(await as(rae)("GET", "/routines"), { status: 200, body: [] });

        const created = await as(rae)("POST", "/routines", {
          name: "  Warm-up  ",
          items: [
            { exerciseId: b, minutes: 5 },
            { exerciseId: a, minutes: 10 },
          ],
        });
        assert.equal(created.status, 201);
        assert.deepEqual(Object.keys(created.body).sort(), ["created_at", "id", "items", "name", "updated_at"]);
        assert.equal(created.body.name, "Warm-up", "trimmed");
        assert.deepEqual(created.body.items, [
          { exercise_id: b, minutes: 5 },
          { exercise_id: a, minutes: 10 },
        ]);
        assert.equal(created.body.created_at, new Date(created.body.created_at).toISOString(), "ISO 8601");
        const id = created.body.id;
        assert.deepEqual((await as(rae)("GET", `/routines/${id}`)).body, created.body);

        const second = (await as(rae)("POST", "/routines", { name: "Scales", items: [{ exerciseId: b, minutes: 15 }] })).body;
        assert.deepEqual(
          (await as(rae)("GET", "/routines")).body.map((r: { id: string }) => r.id),
          [second.id, id],
          "newest first",
        );

        const renamed = await as(rae)("PATCH", `/routines/${id}`, { name: "Morning" });
        assert.equal(renamed.status, 200);
        assert.equal(renamed.body.name, "Morning");
        assert.deepEqual(renamed.body.items, created.body.items, "items untouched");
        assert.ok(renamed.body.updated_at >= created.body.updated_at);

        const reordered = await as(rae)("PATCH", `/routines/${id}`, {
          items: [
            { exerciseId: a, minutes: 3 },
            { exerciseId: b, minutes: 4 },
            { exerciseId: a, minutes: 2 },
          ],
        });
        assert.equal(reordered.body.name, "Morning", "name untouched");
        assert.deepEqual(
          reordered.body.items.map((i: { minutes: number }) => i.minutes),
          [3, 4, 2],
        );

        // Someone else's routine is not found, whatever the method.
        assert.equal((await as(outsider)("GET", `/routines/${id}`)).status, 404);
        assert.equal((await as(outsider)("PATCH", `/routines/${id}`, { name: "Mine" })).status, 404);
        assert.equal((await as(outsider)("DELETE", `/routines/${id}`)).status, 404);
        assert.deepEqual((await as(outsider)("GET", "/routines")).body, []);

        assert.deepEqual(await as(rae)("DELETE", `/routines/${id}`), { status: 200, body: { ok: true } });
        assert.equal((await as(rae)("GET", `/routines/${id}`)).status, 404);
        assert.equal((await as(rae)("DELETE", `/routines/${id}`)).status, 404);
        assert.equal((await as(rae)("GET", "/routines")).body.length, 1);
      });

      it("validates routines, and only takes exercises the user can see", async () => {
        const ray = await newUser("Ray");
        const item = { exerciseId: BUILTIN_EXERCISES[0].id, minutes: 5 };
        for (const body of [
          { name: "x" },
          { name: "", items: [item] },
          { name: "x", items: [] },
          { name: "x", items: [{ ...item, minutes: 0 }] },
          { name: "x", items: [{ ...item, exerciseId: "nope" }] },
        ]) {
          const res = await as(ray)("POST", "/routines", body);
          assert.equal(res.status, 400, JSON.stringify(body));
        }
        assert.ok((await as(ray)("POST", "/routines", { name: "x" })).body.error.fieldErrors.items);

        assert.deepEqual(
          await as(ray)("POST", "/routines", { name: "x", items: [{ ...item, exerciseId: randomUUID() }] }),
          { status: 404, body: { error: "exercise not found" } },
        );
        const theirs = (await as(outsider)("POST", "/exercises", { name: "Oz's", category: "scales", config: pentatonic })).body;
        assert.equal(
          (await as(ray)("POST", "/routines", { name: "x", items: [{ ...item, exerciseId: theirs.id }] })).status,
          404,
        );
        const mineEx = (await as(ray)("POST", "/exercises", { name: "Ray's", category: "scales", config: pentatonic })).body;
        const ok = await as(ray)("POST", "/routines", { name: "x", items: [item, { exerciseId: mineEx.id, minutes: 7 }] });
        assert.equal(ok.status, 201);
        assert.equal((await as(ray)("PATCH", `/routines/${ok.body.id}`, {})).status, 400);
        assert.equal(
          (await as(ray)("PATCH", `/routines/${ok.body.id}`, { items: [{ ...item, exerciseId: theirs.id }] })).status,
          404,
        );
      });

      it("suggests a session from the user's progress", async () => {
        const sky = await newUser("Sky");
        const first = await as(sky)("GET", "/sessions/suggested");
        assert.equal(first.status, 200);
        assert.deepEqual(Object.keys(first.body).sort(), ["items", "minutes"]);
        assert.deepEqual(
          first.body.items.map((i: { slot: string }) => i.slot),
          ["weak-spot", "tempo", "revisit"],
        );
        assert.deepEqual(Object.keys(first.body.items[0]).sort(), ["exercise_id", "minutes", "reason", "slot"]);
        assert.equal(first.body.minutes, 15);

        // Two clean runs of a sequence put it one run from a tempo bump.
        const box1 = BUILTIN_EXERCISES.find((e) => e.name === "A minor pentatonic · box 1")!;
        const { start, cleanRunsToAdvance } = (box1.config as { tempo: Record<string, number> }).tempo;
        for (let i = 0; i < cleanRunsToAdvance - 1; i++) {
          await as(sky)("POST", "/runs", run(box1.id, new Date(Date.now() - (i + 1) * 60_000).toISOString(), { clean: true, notesClean: 2, tempo: start }));
        }
        const next = (await as(sky)("GET", "/sessions/suggested")).body;
        assert.equal(next.items[1].exercise_id, box1.id);
        assert.match(next.items[1].reason, /^One clean run from \d+ bpm$/);
      });

      it("totals practice per local day", async () => {
        const ash = await newUser("Ash");
        const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
        await as(ash)("POST", "/runs", run(builtin.id, ago(60_000), { durationMs: 90_000 }));
        await as(ash)("POST", "/runs", run(builtin.id, ago(2 * 86_400_000), { durationMs: 30_000 }));
        await as(ash)("POST", "/runs", run(builtin.id, ago(30 * 86_400_000), { durationMs: 45_000 }));

        const res = await as(ash)("GET", "/stats/week?tz=UTC");
        assert.equal(res.status, 200);
        assert.equal(res.body.length, 7);
        assert.deepEqual(Object.keys(res.body[0]).sort(), ["date", "duration_ms", "runs"]);
        const day = (iso: string) => res.body.find((d: { date: string }) => d.date === iso.slice(0, 10));
        assert.deepEqual(day(ago(60_000)), { date: ago(60_000).slice(0, 10), runs: 1, duration_ms: 90_000 });
        assert.equal(day(ago(2 * 86_400_000)).runs, 1);
        assert.equal(
          res.body.reduce((n: number, d: { runs: number }) => n + d.runs, 0),
          2,
          "the run a month ago is outside the week",
        );

        assert.equal((await as(ash)("GET", "/stats/week?days=31&tz=Asia/Tokyo")).body.length, 31);
        assert.equal((await as(ash)("GET", "/stats/week?tz=Nowhere/Special")).status, 400);
        assert.equal((await as(ash)("GET", "/stats/week?days=0")).status, 400);
        assert.equal(
          (await as(outsider)("GET", "/stats/week")).body.reduce((n: number, d: { runs: number }) => n + d.runs, 0),
          0,
        );
      });
    });
  }
}
