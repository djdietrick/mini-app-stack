import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { Firestore } from "@google-cloud/firestore";
import Fastify from "fastify";
import { z } from "zod";
import { createPostgresClient } from "@stack/db-clients";
import { type SessionUser, runMigrations } from "@stack/service-kit";
import { toExpressApp } from "@stack/service-kit/express";
import { toFastifyPlugin } from "@stack/service-kit/fastify";
import { coinflip } from "../games/coinflip.testkit.js";
import type { Rng } from "../games/rng.js";
import { createFirestoreHighrollerRepo } from "../repo/firestore.js";
import { createPostgresHighrollerRepo, purgeSettledHands } from "../repo/postgres.js";
import type { HighrollerRepo } from "../repo/types.js";
import { STARTING_BALANCE } from "./economy.js";
import { isoWeek, xpForHand } from "./progress.js";
import { defineGame } from "./registry.js";
import { highrollerRoutes, resolveHighrollerScope } from "./routes.js";

/**
 * Highroller's HTTP contract, run end to end against each real backend
 * through each adapter. The assertions pin what apps/highroller/web/src/api.ts
 * depends on: status codes, error bodies, row shapes and ISO timestamps.
 *
 * Hands are played with the toy coinflip engine (src/games/coinflip.testkit.ts),
 * registered here only. The rng is rigged so a test decides who wins.
 *
 * Each backend runs only when it is reachable:
 *   Firestore  FIRESTORE_EMULATOR_HOST               (CI sets this)
 *   Postgres   HIGHROLLER_TEST_DATABASE_URL          connects as the `highroller` role
 *              HIGHROLLER_TEST_ADMIN_DATABASE_URL    seeds shared.users, which the
 *                                                    highroller role can't write
 */

const here = dirname(fileURLToPath(import.meta.url));

interface Backend {
  repo: HighrollerRepo;
  addUser(email: string): Promise<string>;
  /** Postgres only: the boot-time purge, run against this database. */
  purge?: (now: Date) => Promise<number>;
  stop(): Promise<void>;
}

const backends: Record<string, { skip: string | false; start: () => Promise<Backend> }> = {
  firestore: {
    skip: process.env.FIRESTORE_EMULATOR_HOST ? false : "FIRESTORE_EMULATOR_HOST not set",
    async start() {
      const db = new Firestore({ projectId: "demo-highroller" });
      // A fresh prefix per run, so repeat runs never see each other's documents.
      const prefix = `t${Date.now()}_${randomBytes(3).toString("hex")}_`;
      return {
        repo: createFirestoreHighrollerRepo(db, prefix),
        // Firebase uids are 28-char strings, not UUIDs.
        addUser: async () => randomBytes(21).toString("base64url").slice(0, 28),
        stop: () => db.terminate(),
      };
    },
  },
  postgres: {
    skip:
      process.env.HIGHROLLER_TEST_DATABASE_URL && process.env.HIGHROLLER_TEST_ADMIN_DATABASE_URL
        ? false
        : "HIGHROLLER_TEST_DATABASE_URL / HIGHROLLER_TEST_ADMIN_DATABASE_URL not set",
    async start() {
      const pg = createPostgresClient({ url: process.env.HIGHROLLER_TEST_DATABASE_URL!, schema: "highroller" });
      await runMigrations(pg, join(here, "..", "..", "migrations"));
      const admin = createPostgresClient({ url: process.env.HIGHROLLER_TEST_ADMIN_DATABASE_URL!, schema: "public" });
      return {
        repo: createPostgresHighrollerRepo(pg),
        async addUser(email) {
          const [u] = await admin.sql<{ id: string }[]>`
            INSERT INTO shared.users (email) VALUES (${email}) RETURNING id
          `;
          return u.id;
        },
        purge: (now) => purgeSettledHands(pg, now),
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

/** Every coin lands on `rigged.side`: 1 is heads, 0 tails. */
const rigged: Rng & { side: number } = { side: 1, int: (n) => rigged.side % n };

const games = {
  coinflip: defineGame({
    name: "Coin flip",
    engine: coinflip,
    bets: z.object({ main: z.number() }),
    action: z.object({ type: z.enum(["double", "heads", "tails"]) }),
    limits: { min: 10, max: 6000, step: 10 },
  }),
};

const TZ = "America/New_York";

for (const [backendName, backend] of Object.entries(backends)) {
  for (const adapter of ["fastify", "express"] as const) {
    describe(`highroller contract (${backendName}, ${adapter})`, { skip: backend.skip }, () => {
      let b: Backend;
      let stopServer: () => Promise<void>;
      let base: string;
      const sessions = new Map<string, SessionUser>();
      /** Every response body, to check private state never leaks. */
      const seen: string[] = [];

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
          seen.push(text);
          return { status: res.status, body: text ? JSON.parse(text) : null };
        };

      const verify = async (headers: Record<string, string | string[] | undefined>) => {
        const m = /stack_session=([^;]+)/.exec(String(headers["cookie"] ?? ""));
        return (m && sessions.get(m[1])) ?? null;
      };

      const newUser = async (name: string): Promise<SessionUser> => {
        const email = `${name.toLowerCase()}-${randomUUID()}@example.com`;
        const user = { userId: await b.addUser(email), email, displayName: name };
        sessions.set(randomUUID(), user);
        return user;
      };

      /** The whole ledger, newest first, through the paged route. */
      async function fullLedger(call: Call) {
        const all: any[] = [];
        let cursor: string | null = null;
        do {
          const res: Res = await call("GET", `/ledger?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
          assert.equal(res.status, 200);
          all.push(...res.body.entries);
          cursor = res.body.next_cursor;
        } while (cursor);
        return all;
      }

      const play = (call: Call, body: Record<string, unknown>) =>
        call("POST", "/hands", { id: randomUUID(), game: "coinflip", timeZone: TZ, ...body });

      before(async () => {
        b = await backend.start();
        const opts = { repo: b.repo, verify, resolveScope: resolveHighrollerScope };
        const routes = highrollerRoutes({ rng: rigged, games });

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
      });

      after(async () => {
        await stopServer?.();
        await b?.stop();
      });

      // ---------- wallet ----------

      it("serves health without a session, and nothing else", async () => {
        assert.equal((await as(null)("GET", "/health")).status, 200);
        assert.equal((await as(null)("GET", "/me")).status, 401);
      });

      it("lands a new player with the starting balance and one ledger entry", async () => {
        const call = as(await newUser("Pat"));
        const me = await call("GET", `/me?timeZone=${encodeURIComponent(TZ)}`);
        assert.equal(me.status, 200);
        assert.equal(me.body.balance, STARTING_BALANCE);
        assert.equal(me.body.display_name, "Pat");
        assert.equal(me.body.level, 1);
        assert.deepEqual(me.body.daily, { available: true, streak: 0, amount: 1000 });
        assert.deepEqual(me.body.bailout, { available: false, claimed_today: false, floor: 500, top_up_to: 2000 });
        assert.ok(!Number.isNaN(Date.parse(me.body.created_at)));

        const ledger = await call("GET", "/ledger");
        assert.equal(ledger.status, 200);
        assert.equal(ledger.body.next_cursor, null);
        assert.equal(ledger.body.entries.length, 1);
        const [entry] = ledger.body.entries;
        assert.deepEqual({ ...entry, created_at: undefined }, {
          seq: 1,
          kind: "initial_grant",
          amount: STARTING_BALANCE,
          balance_after: STARTING_BALANCE,
          hand_id: null,
          ref: null,
          created_at: undefined,
        });
        assert.match(entry.created_at, /^\d{4}-\d\d-\d\dT.*Z$/);
      });

      it("pays the daily bonus once a day and records it", async () => {
        const call = as(await newUser("Dee"));
        const first = await call("POST", "/daily-bonus", { timeZone: TZ });
        assert.equal(first.status, 200);
        assert.equal(first.body.amount, 1000);
        assert.equal(first.body.player.balance, 11_000);
        assert.deepEqual(first.body.player.daily, { available: false, streak: 1, amount: 1000 });

        const again = await call("POST", "/daily-bonus", { timeZone: TZ });
        assert.equal(again.status, 409);
        assert.equal(again.body.error, "ALREADY_CLAIMED");

        const ledger = await call("GET", "/ledger");
        assert.deepEqual(
          ledger.body.entries.map((e: any) => [e.seq, e.kind, e.amount, e.balance_after]),
          [
            [2, "daily_bonus", 1000, 11_000],
            [1, "initial_grant", 10_000, 10_000],
          ],
        );
        assert.match(ledger.body.entries[0].ref, /^\d{4}-\d\d-\d\d$/);
        assert.equal((await call("GET", "/me")).body.balance, 11_000);
      });

      it("pays a bonus claimed twice at once only once", async () => {
        const call = as(await newUser("Race"));
        await call("GET", "/me");
        const results = await Promise.all([1, 2, 3].map(() => call("POST", "/daily-bonus", { timeZone: TZ })));
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409]);
        assert.equal((await call("GET", "/me")).body.balance, 11_000);
      });

      it("validates the time zone", async () => {
        const call = as(await newUser("Zed"));
        assert.equal((await call("POST", "/daily-bonus", { timeZone: "Mars/Olympus" })).status, 400);
        assert.equal((await call("POST", "/daily-bonus", {})).status, 400);
        assert.equal((await call("GET", "/me?timeZone=Nowhere")).status, 400);
      });

      it("refreshes the display name from the session", async () => {
        const user = await newUser("Old");
        const call = as(user);
        await call("GET", "/me");
        user.displayName = "New";
        assert.equal((await call("GET", "/me")).body.display_name, "New");
      });

      it("refuses a bailout above the floor, and pays one below it", async () => {
        const call = as(await newUser("Broke"));
        const early = await call("POST", "/bailout", { timeZone: TZ });
        assert.equal(early.status, 409);
        assert.equal(early.body.error, "NOT_ELIGIBLE");

        rigged.side = 0; // tails: instant hands (always heads) lose
        for (const main of [6000, 3600, 300]) {
          assert.equal((await play(call, { variant: "instant", bets: { main } })).status, 200);
        }
        rigged.side = 1;
        const me = await call("GET", `/me?timeZone=${encodeURIComponent(TZ)}`);
        assert.equal(me.body.balance, 100);
        assert.equal(me.body.bailout.available, true);

        const paid = await call("POST", "/bailout", { timeZone: TZ });
        assert.equal(paid.status, 200);
        assert.equal(paid.body.amount, 1900);
        assert.equal(paid.body.player.balance, 2000);
        assert.equal(paid.body.player.bailout.claimed_today, true);
        assert.equal((await call("POST", "/bailout", { timeZone: TZ })).body.error, "ALREADY_CLAIMED");
      });

      // ---------- hands ----------

      it("validates the game, the variant and the bets", async () => {
        const call = as(await newUser("Val"));
        const cases: [Record<string, unknown>, string][] = [
          [{ game: "craps", bets: { main: 10 } }, "UNKNOWN_GAME"],
          [{ variant: "tripled", bets: { main: 10 } }, "UNKNOWN_VARIANT"],
          [{ bets: { main: 5 } }, "BAD_BETS"],
          [{ bets: { main: 15 } }, "BAD_BETS"],
          [{ bets: { main: 6010 } }, "BAD_BETS"],
          [{ bets: { side: 10 } }, "BAD_BETS"],
        ];
        for (const [body, code] of cases) {
          const res = await play(call, body);
          assert.equal(res.status, 400, JSON.stringify(body));
          assert.equal(res.body.error.code, code);
        }
        assert.equal((await play(call, { bets: { main: 10 }, id: "not-a-uuid" })).status, 400);
        assert.equal((await call("GET", "/me")).body.balance, STARTING_BALANCE, "nothing debited");
      });

      it("plays a hand end to end, and the ledger, balance and stats agree", async () => {
        const user = await newUser("Hal");
        const call = as(user);
        const id = randomUUID();
        rigged.side = 1;

        const started = await call("POST", "/hands", { id, game: "coinflip", bets: { main: 100 }, timeZone: TZ });
        assert.equal(started.status, 200);
        assert.equal(started.body.balance, 9_900);
        assert.deepEqual(started.body.hand, {
          id,
          game: "coinflip",
          variant: "call",
          status: "active",
          version: 0,
          wagered: 100,
          returned: 0,
          view: { stake: 100, doubled: false, call: null, landed: null },
          legal_actions: ["double", "heads", "tails"],
          results: null,
          created_at: started.body.hand.created_at,
          settled_at: null,
        });

        // The same id again (a retried request) is the same hand, debited once.
        const retried = await call("POST", "/hands", { id, game: "coinflip", bets: { main: 100 }, timeZone: TZ });
        assert.equal(retried.status, 200);
        assert.equal(retried.body.hand.id, id);
        assert.equal(retried.body.balance, 9_900);

        const blocked = await play(call, { bets: { main: 100 } });
        assert.equal(blocked.status, 409);
        assert.deepEqual(blocked.body.error, { code: "HAND_IN_PROGRESS", hand_id: id });

        const active = await call("GET", "/hands/active");
        assert.deepEqual(active.body.hands.map((h: any) => h.id), [id]);
        assert.equal((await call("GET", `/hands/${id}`)).body.version, 0);
        assert.equal((await as(await newUser("Nosy"))("GET", `/hands/${id}`)).status, 404);

        const stale = await call("POST", `/hands/${id}/actions`, { action: { type: "heads" }, version: 3 });
        assert.equal(stale.status, 409);
        assert.deepEqual(stale.body.error, { code: "STALE_HAND", version: 0 });

        const doubled = await call("POST", `/hands/${id}/actions`, { action: { type: "double" }, version: 0 });
        assert.equal(doubled.status, 200);
        assert.equal(doubled.body.balance, 9_800);
        assert.equal(doubled.body.hand.version, 1);
        assert.equal(doubled.body.hand.wagered, 200);
        assert.deepEqual(doubled.body.hand.legal_actions, ["heads", "tails"]);

        const illegal = await call("POST", `/hands/${id}/actions`, { action: { type: "double" }, version: 1 });
        assert.equal(illegal.status, 409);
        assert.equal(illegal.body.error, "ILLEGAL_ACTION");
        const malformed = await call("POST", `/hands/${id}/actions`, { action: { type: "split" }, version: 1 });
        assert.equal(malformed.status, 400);

        const won = await call("POST", `/hands/${id}/actions`, { action: { type: "heads" }, version: 1 });
        assert.equal(won.status, 200);
        assert.equal(won.body.balance, 10_200);
        assert.equal(won.body.xp, xpForHand(200));
        assert.equal(won.body.hand.status, "settled");
        assert.deepEqual(won.body.hand.view, { stake: 100, doubled: true, call: "H", landed: "H" });
        assert.deepEqual(won.body.hand.results, [{ spot: "main", stake: 200, returned: 400, outcome: "win" }]);
        assert.deepEqual(won.body.hand.legal_actions, []);
        assert.ok(!Number.isNaN(Date.parse(won.body.hand.settled_at)));
        assert.deepEqual((await call("GET", "/hands/active")).body.hands, []);

        // A settled hand takes no more actions, at any version.
        assert.equal((await call("POST", `/hands/${id}/actions`, { action: { type: "heads" }, version: 2 })).status, 409);

        const ledger = await fullLedger(call);
        assert.deepEqual(
          ledger.map((e) => [e.kind, e.amount, e.hand_id]),
          [
            ["payout", 400, id],
            ["bet", -100, id],
            ["bet", -100, id],
            ["initial_grant", 10_000, null],
          ],
        );
        const me = await call("GET", "/me");
        assert.equal(me.body.balance, ledger.reduce((s, e) => s + e.amount, 0));
        assert.equal(me.body.balance, ledger[0].balance_after);
        assert.equal(me.body.xp, xpForHand(200));

        assert.deepEqual(await b.repo.getGameStats(user.userId), [
          {
            userId: user.userId,
            game: "coinflip",
            hands: 1,
            wagered: 200,
            returned: 400,
            wins: 1,
            losses: 0,
            pushes: 0,
            biggestWin: 200,
            expectedReturn: 200,
          },
        ]);
        assert.deepEqual(await b.repo.getWeeklyStats(user.userId, isoWeek(new Date())), {
          week: isoWeek(new Date()),
          userId: user.userId,
          hands: 1,
          wagered: 200,
          net: 200,
          biggestWin: 200,
        });
      });

      it("settles a single-decision hand on start", async () => {
        const call = as(await newUser("Ivy"));
        rigged.side = 1;
        const res = await play(call, { variant: "instant", bets: { main: 50 } });
        assert.equal(res.status, 200);
        assert.equal(res.body.hand.status, "settled");
        assert.equal(res.body.hand.returned, 100);
        assert.equal(res.body.balance, 10_050);
        const ledger = await fullLedger(call);
        assert.deepEqual(ledger.map((e) => [e.seq, e.kind]), [
          [3, "payout"],
          [2, "bet"],
          [1, "initial_grant"],
        ]);
        // Another hand can start straight away: nothing is left active.
        assert.equal((await play(call, { bets: { main: 50 } })).status, 200);
      });

      it("refuses stakes the balance can't cover, at the start or on a double", async () => {
        const call = as(await newUser("Lo"));
        rigged.side = 0;
        await play(call, { variant: "instant", bets: { main: 6000 } }); // 4,000 left
        const big = await play(call, { bets: { main: 4010 } });
        assert.equal(big.status, 409);
        assert.equal(big.body.error, "INSUFFICIENT_FUNDS");

        const hand = await play(call, { bets: { main: 3000 } }); // 1,000 left
        const dbl = await call("POST", `/hands/${hand.body.hand.id}/actions`, { action: { type: "double" }, version: 0 });
        assert.equal(dbl.status, 409);
        assert.equal(dbl.body.error, "INSUFFICIENT_FUNDS");
        assert.equal((await call("GET", "/me")).body.balance, 1000);
        rigged.side = 1;
      });

      it("keeps one active hand per game when two starts race", async () => {
        const call = as(await newUser("Ann"));
        await call("GET", "/me");
        const [x, y] = await Promise.all([play(call, { bets: { main: 100 } }), play(call, { bets: { main: 100 } })]);
        assert.deepEqual([x.status, y.status].sort(), [200, 409]);
        assert.equal((await call("GET", "/me")).body.balance, 9_900);

        // The same id twice at once: one hand, one debit.
        const other = as(await newUser("Bo"));
        await other("GET", "/me");
        const id = randomUUID();
        const both = await Promise.all([1, 2].map(() => other("POST", "/hands", { id, game: "coinflip", bets: { main: 100 }, timeZone: TZ })));
        assert.deepEqual(both.map((r) => [r.status, r.body.hand.id]), [
          [200, id],
          [200, id],
        ]);
        assert.equal((await other("GET", "/me")).body.balance, 9_900);
        assert.equal((await fullLedger(other)).length, 2);
      });

      it("lists hands newest first, by game, a page at a time", async () => {
        const call = as(await newUser("Lister"));
        const ids: string[] = [];
        for (let i = 0; i < 3; i++) {
          const res = await play(call, { variant: "instant", bets: { main: 10 } });
          ids.push(res.body.hand.id);
        }
        const page1 = await call("GET", "/hands?limit=2");
        assert.equal(page1.status, 200);
        assert.deepEqual(page1.body.hands.map((h: any) => h.id), [ids[2], ids[1]]);
        const page2 = await call("GET", `/hands?limit=2&cursor=${page1.body.next_cursor}`);
        assert.deepEqual(page2.body.hands.map((h: any) => h.id), [ids[0]]);
        assert.equal(page2.body.next_cursor, null);
        assert.equal((await call("GET", "/hands?game=coinflip")).body.hands.length, 3);
        assert.equal((await call("GET", "/hands?game=roulette")).body.hands.length, 0);
        assert.equal((await call("GET", "/hands?cursor=nonsense")).status, 400);
      });

      if (backend.skip === false && backendName === "postgres") {
        it("purges settled hands past retention, and keeps their ledger rows", async () => {
          const call = as(await newUser("Old"));
          const hand = (await play(call, { variant: "instant", bets: { main: 10 } })).body.hand;
          await b.purge!(new Date(Date.now() + 89 * 86_400_000));
          assert.equal((await call("GET", `/hands/${hand.id}`)).status, 200);
          await b.purge!(new Date(Date.now() + 91 * 86_400_000));
          assert.equal((await call("GET", `/hands/${hand.id}`)).status, 404);
          assert.equal((await fullLedger(call)).filter((e) => e.hand_id === hand.id).length, 2);
        });
      }

      it("never sends a hand's private state", () => {
        assert.ok(seen.length > 20);
        for (const body of seen) {
          assert.ok(!body.includes("coins"), `private state in ${body}`);
          assert.ok(!body.includes('"state"'), `raw state in ${body}`);
        }
      });
    });
  }
}
