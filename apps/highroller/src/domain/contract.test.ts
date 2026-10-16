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
import { CATALOG, DEFAULT_EQUIPPED } from "./catalog.js";
import { STARTING_BALANCE, dayIn } from "./economy.js";
import { isoWeek, levelProgress, xpForHand } from "./progress.js";
import { ACHIEVEMENTS, type QuestPool, isoWeekOfDay } from "./quests.js";
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

/** The routes' clock: real time, shifted by `shift` ms when a test needs another day. */
const clock = { shift: 0, now: () => new Date(Date.now() + clock.shift) };
const DAY = 86_400_000;

const win = (s: { outcome: string }) => (s.outcome === "win" ? 1 : 0);
const reward = (chips: number, xp: number) => ({ chips, xp });

/**
 * Three quests a period, so every player gets all three: the tests know
 * which quests are live without reproducing the pick.
 */
const quests: QuestPool = {
  daily: [
    { id: "t-play-2", kind: "daily", text: "Play 2 hands", target: 2, reward: reward(500, 30), match: { count: () => 1 } },
    { id: "t-win", kind: "daily", text: "Win a hand", target: 1, reward: reward(300, 20), match: { count: win } },
    {
      id: "t-doubled",
      kind: "daily",
      game: "coinflip",
      text: "Win a doubled flip",
      target: 1,
      reward: reward(700, 40),
      match: { count: (s) => (s.facts.doubled === true ? win(s) : 0) },
    },
  ],
  weekly: [
    { id: "t-wager", kind: "weekly", text: "Wager 1,000", target: 1_000, reward: reward(2_000, 100), match: { count: (s) => s.wagered } },
    { id: "t-streak", kind: "weekly", text: "Win 2 in a row", target: 2, reward: reward(1_000, 50), match: { streak: (s) => s.outcome === "win" } },
    { id: "t-games", kind: "weekly", text: "Play 2 games", target: 2, reward: reward(1_000, 50), match: { distinct: (s) => s.game } },
  ],
  achievements: [
    {
      id: "t-hands",
      kind: "achievement",
      name: "Hands",
      text: (n) => `Play ${n} hands`,
      tiers: [
        { target: 2, reward: reward(1_000, 100) },
        { target: 4, reward: reward(4_000, 400) },
      ],
      match: { count: () => 1 },
    },
    ACHIEVEMENTS.find((a) => a.id === "a-collector")!,
  ],
};

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
        const routes = highrollerRoutes({ rng: rigged, games, quests, now: clock.now });

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

      // ---------- stats ----------

      it("reports per-game stats that agree with the ledger", async () => {
        const call = as(await newUser("Stat"));
        rigged.side = 1;
        await play(call, { variant: "instant", bets: { main: 100 } });
        await play(call, { variant: "instant", bets: { main: 300 } });
        rigged.side = 0;
        await play(call, { variant: "instant", bets: { main: 50 } });
        rigged.side = 1;

        const stats = await call("GET", "/stats");
        assert.equal(stats.status, 200);
        const ledger = await fullLedger(call);
        const sum = (kind: string) => ledger.filter((e) => e.kind === kind).reduce((n, e) => n + e.amount, 0);
        const me = await call("GET", "/me");
        const row = {
          hands: 3,
          wagered: -sum("bet"),
          returned: sum("payout"),
          net: me.body.balance - STARTING_BALANCE,
          wins: 2,
          losses: 1,
          pushes: 0,
          biggest_win: 300,
          expected_return: 450,
        };
        assert.deepEqual(stats.body.total, { game: "all", ...row });
        assert.deepEqual(stats.body.games, [{ game: "coinflip", ...row }]);
        assert.deepEqual((await as(await newUser("Nil"))("GET", "/stats")).body.games, []);
      });

      it("charts the end-of-day balance from the ledger", async () => {
        const call = as(await newUser("Chart"));
        rigged.side = 1;
        await play(call, { variant: "instant", bets: { main: 200 } }); // 10,200 today
        const today = await call("GET", `/stats/balance?range=7d&timeZone=${encodeURIComponent(TZ)}`);
        assert.equal(today.status, 200);
        assert.deepEqual(today.body, { range: "7d", points: [{ day: dayIn(new Date(), TZ), balance: 10_200 }] });

        // Two days on, a losing hand: the days between hold the balance as it was.
        clock.shift = 2 * DAY;
        try {
          rigged.side = 0;
          await play(call, { variant: "instant", bets: { main: 1_000 } });
          rigged.side = 1;
          const later = await call("GET", `/stats/balance?timeZone=${encodeURIComponent(TZ)}`);
          assert.equal(later.body.range, "30d");
          const days = [0, 1, 2].map((n) => dayIn(new Date(Date.now() + n * DAY), TZ));
          assert.deepEqual(later.body.points, [
            { day: days[0], balance: 10_200 },
            { day: days[1], balance: 10_200 },
            { day: days[2], balance: 9_200 },
          ]);
          const ledger = await fullLedger(call);
          assert.equal(later.body.points.at(-1).balance, ledger[0].balance_after);
        } finally {
          clock.shift = 0;
          rigged.side = 1;
        }
        assert.equal((await call("GET", "/stats/balance?range=1y")).status, 400);
      });

      it("returns the level with every hand", async () => {
        const call = as(await newUser("Lev"));
        rigged.side = 1;
        let res: Res | null = null;
        for (let i = 0; i < 6; i++) res = await play(call, { variant: "instant", bets: { main: 1_000 } });
        const xp = 6 * xpForHand(1_000);
        const lv = levelProgress(xp);
        assert.equal(res!.body.xp, xp);
        assert.deepEqual([res!.body.level, res!.body.level_xp, res!.body.level_xp_needed], [lv.level, lv.into, lv.needed]);
        assert.ok(lv.level >= 2, "the badge moves after a few hands");
      });

      // ---------- shop ----------

      it("lists the shop with the defaults owned and equipped", async () => {
        const call = as(await newUser("Shopper"));
        const shop = await call("GET", "/shop");
        assert.equal(shop.status, 200);
        assert.deepEqual(shop.body.equipped, DEFAULT_EQUIPPED);
        assert.equal(shop.body.items.length, CATALOG.length);
        for (const item of shop.body.items) {
          const isDefault = Object.values(DEFAULT_EQUIPPED).includes(item.id);
          assert.deepEqual([item.owned, item.equipped, item.is_default], [isDefault, isDefault, isDefault], item.name);
          assert.ok(item.params && item.price >= 0);
        }
        assert.deepEqual((await call("GET", "/me")).body.equipped, DEFAULT_EQUIPPED);
      });

      it("buys once, records the purchase, and equips only what is owned", async () => {
        const call = as(await newUser("Buyer"));
        const back = CATALOG.find((i) => i.kind === "card_back" && i.price === 5_000)!;
        const felt = CATALOG.find((i) => i.kind === "felt" && i.price > 0)!;

        const notOwned = await call("PUT", "/equipped", { kind: "felt", itemId: felt.id });
        assert.equal(notOwned.status, 403);
        assert.equal(notOwned.body.error, "NOT_OWNED");

        const bought = await call("POST", `/shop/${back.id}/buy`, { timeZone: TZ });
        assert.equal(bought.status, 200);
        assert.equal(bought.body.balance, STARTING_BALANCE - 5_000);
        assert.deepEqual([bought.body.item.id, bought.body.item.owned], [back.id, true]);
        assert.deepEqual(bought.body.completed.map((c: any) => c.text), ["Buy a cosmetic"]);
        const [entry] = (await call("GET", "/ledger")).body.entries;
        assert.deepEqual([entry.kind, entry.amount, entry.ref, entry.balance_after], ["purchase", -5_000, back.id, 5_000]);

        const again = await call("POST", `/shop/${back.id}/buy`, { timeZone: TZ });
        assert.equal(again.status, 409);
        assert.equal(again.body.error, "ALREADY_OWNED");
        const free = await call("POST", `/shop/${DEFAULT_EQUIPPED.felt}/buy`, { timeZone: TZ });
        assert.equal(free.body.error, "ALREADY_OWNED");
        const dear = await call("POST", `/shop/${CATALOG.find((i) => i.price === 1_000_000)!.id}/buy`, { timeZone: TZ });
        assert.equal(dear.status, 409);
        assert.equal(dear.body.error, "INSUFFICIENT_FUNDS");
        assert.equal((await call("POST", `/shop/${randomUUID()}/buy`, { timeZone: TZ })).status, 404);
        assert.equal((await call("GET", "/me")).body.balance, 5_000, "only the one purchase debited");

        const equip = await call("PUT", "/equipped", { kind: "card_back", itemId: back.id });
        assert.equal(equip.status, 200);
        assert.deepEqual(equip.body.equipped, { ...DEFAULT_EQUIPPED, card_back: back.id });
        assert.deepEqual((await call("GET", "/me")).body.equipped, { ...DEFAULT_EQUIPPED, card_back: back.id });
        const shop = await call("GET", "/shop");
        assert.deepEqual(
          shop.body.items.filter((i: any) => i.kind === "card_back" && (i.owned || i.equipped)).map((i: any) => [i.id, i.equipped]),
          [
            [DEFAULT_EQUIPPED.card_back, false],
            [back.id, true],
          ],
        );
        assert.equal((await call("PUT", "/equipped", { kind: "felt", itemId: back.id })).status, 400);
        assert.equal((await call("PUT", "/equipped", { kind: "card_back", itemId: randomUUID() })).status, 404);
        // Back to the default, which is always owned.
        assert.equal((await call("PUT", "/equipped", { kind: "card_back", itemId: DEFAULT_EQUIPPED.card_back })).status, 200);
        assert.deepEqual((await call("GET", "/me")).body.equipped, DEFAULT_EQUIPPED);
      });

      it("charges once when the same item is bought twice at once", async () => {
        const call = as(await newUser("Twice"));
        await call("GET", "/me");
        const chips = CATALOG.find((i) => i.kind === "chip_set" && i.price === 8_000)!;
        const both = await Promise.all([1, 2].map(() => call("POST", `/shop/${chips.id}/buy`, { timeZone: TZ })));
        assert.deepEqual(both.map((r) => r.status).sort(), [200, 409]);
        assert.equal((await call("GET", "/me")).body.balance, STARTING_BALANCE - 8_000);
      });

      // ---------- quests ----------

      it("moves quests with play, and pays each claim once", async () => {
        const call = as(await newUser("Quester"));
        const tz = encodeURIComponent(TZ);
        const today = dayIn(new Date(), TZ);
        const fresh = await call("GET", `/quests?timeZone=${tz}`);
        assert.equal(fresh.status, 200);
        assert.equal(fresh.body.daily.period, `d:${today}`);
        assert.equal(fresh.body.weekly.period, `w:${isoWeekOfDay(today)}`);
        assert.deepEqual(fresh.body.daily.quests.map((q: any) => q.id).sort(), ["t-doubled", "t-play-2", "t-win"]);
        assert.ok(fresh.body.daily.quests.every((q: any) => q.progress === 0 && !q.complete && !q.claimed));
        assert.ok(Date.parse(fresh.body.daily.resets_at) > Date.now());
        assert.ok(Date.parse(fresh.body.weekly.resets_at) >= Date.parse(fresh.body.daily.resets_at));
        assert.deepEqual(fresh.body.achievements.map((a: any) => a.id), ["t-hands", "a-collector"]);
        assert.equal(fresh.body.claimable, 0);

        // A doubled, winning flip: three quests complete as the hand settles.
        rigged.side = 1;
        const hand = await play(call, { bets: { main: 100 } });
        await call("POST", `/hands/${hand.body.hand.id}/actions`, { action: { type: "double" }, version: 0, timeZone: TZ });
        const won = await call("POST", `/hands/${hand.body.hand.id}/actions`, { action: { type: "heads" }, version: 1, timeZone: TZ });
        assert.equal(won.status, 200);
        assert.deepEqual(won.body.completed.map((c: any) => c.quest_id).sort(), ["t-doubled", "t-win"]);

        const notYet = await call("POST", "/quests/t-play-2/claim", { timeZone: TZ });
        assert.equal(notYet.status, 409);
        assert.equal(notYet.body.error, "NOT_COMPLETE");

        const before = (await call("GET", "/me")).body;
        const claimed = await call("POST", "/quests/t-win/claim", { timeZone: TZ });
        assert.equal(claimed.status, 200);
        assert.deepEqual(claimed.body.reward, { chips: 300, xp: 20 });
        assert.equal(claimed.body.balance, before.balance + 300);
        assert.equal(claimed.body.xp, before.xp + 20);
        const twice = await call("POST", "/quests/t-win/claim", { timeZone: TZ });
        assert.equal(twice.status, 409);
        assert.equal(twice.body.error, "ALREADY_CLAIMED");
        assert.equal((await call("POST", "/quests/nope/claim", { timeZone: TZ })).status, 404);
        const [entry] = (await call("GET", "/ledger")).body.entries;
        assert.deepEqual([entry.kind, entry.amount, entry.ref], ["quest_reward", 300, `t-win:d:${today}`]);

        // A second hand: "play 2" completes, and the first achievement tier.
        const second = await play(call, { variant: "instant", bets: { main: 100 } });
        assert.deepEqual(second.body.completed.map((c: any) => [c.quest_id, c.tier]).sort(), [
          ["t-hands", 1],
          ["t-play-2", null],
          ["t-streak", null],
        ]);
        const now = await call("GET", `/quests?timeZone=${tz}`);
        const byId = Object.fromEntries([...now.body.daily.quests, ...now.body.weekly.quests].map((q: any) => [q.id, q]));
        assert.deepEqual([byId["t-play-2"].progress, byId["t-play-2"].complete, byId["t-play-2"].claimed], [2, true, false]);
        assert.deepEqual([byId["t-win"].progress, byId["t-win"].claimed], [1, true]);
        assert.equal(byId["t-wager"].progress, 300);
        assert.equal(byId["t-games"].progress, 1);
        const hands = now.body.achievements.find((a: any) => a.id === "t-hands");
        assert.deepEqual(
          [hands.progress, hands.claimable, hands.tiers.map((t: any) => [t.complete, t.claimed])],
          [2, true, [[true, false], [false, false]]],
        );
        // t-doubled, t-play-2, t-streak and the achievement tier.
        assert.equal(now.body.claimable, 4);

        const tier = await call("POST", "/quests/t-hands/claim", { timeZone: TZ });
        assert.equal(tier.status, 200);
        assert.deepEqual(tier.body.reward, { chips: 1_000, xp: 100 });
        const [tierEntry] = (await call("GET", "/ledger")).body.entries;
        assert.deepEqual([tierEntry.kind, tierEntry.ref], ["achievement_reward", "t-hands:1"]);
        const tier2 = await call("POST", "/quests/t-hands/claim", { timeZone: TZ });
        assert.equal(tier2.body.error, "NOT_COMPLETE");
      });

      it("pays a quest once when claimed twice at once", async () => {
        const call = as(await newUser("Racer"));
        rigged.side = 1;
        await play(call, { variant: "instant", bets: { main: 10 } });
        const before = (await call("GET", "/me")).body.balance;
        const both = await Promise.all([1, 2].map(() => call("POST", "/quests/t-win/claim", { timeZone: TZ })));
        assert.deepEqual(both.map((r) => r.status).sort(), [200, 409]);
        assert.equal((await call("GET", "/me")).body.balance, before + 300);
      });

      it("brings new daily quests when the day rolls over in the player's zone", async () => {
        const call = as(await newUser("Tomorrow"));
        const tz = encodeURIComponent(TZ);
        rigged.side = 1;
        await play(call, { variant: "instant", bets: { main: 10 } });
        await play(call, { variant: "instant", bets: { main: 10 } });
        const today = (await call("GET", `/quests?timeZone=${tz}`)).body;
        assert.ok(today.daily.quests.find((q: any) => q.id === "t-play-2").complete);

        // The same instant is a different day on either side of the date line.
        const east = (await call("GET", "/quests?timeZone=Pacific%2FKiritimati")).body;
        const west = (await call("GET", "/quests?timeZone=Pacific%2FPago_Pago")).body;
        assert.notEqual(east.daily.period, west.daily.period);

        clock.shift = DAY;
        try {
          const tomorrow = (await call("GET", `/quests?timeZone=${tz}`)).body;
          const day = dayIn(clock.now(), TZ);
          assert.equal(tomorrow.daily.period, `d:${day}`);
          assert.ok(tomorrow.daily.quests.every((q: any) => q.progress === 0 && !q.complete));
          // Yesterday's completed quest went with the day.
          assert.equal((await call("POST", "/quests/t-play-2/claim", { timeZone: TZ })).body.error, "NOT_COMPLETE");
          // Achievements carry on; the week does too unless it turned over.
          assert.equal(tomorrow.achievements.find((a: any) => a.id === "t-hands").progress, 2);
          const sameWeek = isoWeekOfDay(day) === isoWeekOfDay(dayIn(new Date(), TZ));
          assert.equal(tomorrow.weekly.quests.find((q: any) => q.id === "t-wager").progress, sameWeek ? 20 : 0);
        } finally {
          clock.shift = 0;
        }
      });

      it("counts purchases toward the collector achievement", async () => {
        const call = as(await newUser("Collector"));
        const back = CATALOG.find((i) => i.kind === "card_back" && i.price === 5_000)!;
        await call("POST", `/shop/${back.id}/buy`, { timeZone: TZ });
        const q = (await call("GET", `/quests?timeZone=${encodeURIComponent(TZ)}`)).body;
        const collector = q.achievements.find((a: any) => a.id === "a-collector");
        assert.deepEqual([collector.progress, collector.claimable], [1, true]);
        const paid = await call("POST", "/quests/a-collector/claim", { timeZone: TZ });
        assert.equal(paid.status, 200);
        assert.equal(paid.body.balance, STARTING_BALANCE - 5_000 + collector.tiers[0].reward.chips);
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
