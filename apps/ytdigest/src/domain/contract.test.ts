import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { Firestore } from "@google-cloud/firestore";
import Fastify from "fastify";
import { createPostgresClient } from "@stack/db-clients";
import { type Lease, type SessionUser, runMigrations } from "@stack/service-kit";
import { toExpressApp } from "@stack/service-kit/express";
import { toFastifyPlugin } from "@stack/service-kit/fastify";
import { createFirestoreYtdigestRepo } from "../repo/firestore.js";
import { createPostgresYtdigestRepo } from "../repo/postgres.js";
import type { YtdigestRepo } from "../repo/types.js";
import { type DigestMailer, runDailyDigest } from "./digest.js";
import { pollChannels } from "./poll.js";
import { ytdigestRoutes } from "./routes.js";
import type { ResolvedChannel, UploadListItem, VideoStats } from "./types.js";
import type { YouTubeGateway } from "./youtube.js";

/**
 * ytdigest end to end against each real backend through each adapter: the
 * HTTP contract apps/ytdigest/web/src/api.ts depends on, and the two jobs
 * (poll, digest) the schedulers drive. YouTube and SMTP are fakes; the
 * storage is not.
 *
 * Each backend runs only when it is reachable:
 *   Firestore  FIRESTORE_EMULATOR_HOST
 *   Postgres   YTDIGEST_TEST_DATABASE_URL        as the `ytdigest` role
 *              YTDIGEST_TEST_ADMIN_DATABASE_URL  seeds shared.users
 */

const here = dirname(fileURLToPath(import.meta.url));

interface Backend {
  repo: YtdigestRepo;
  addUser(email: string): Promise<string>;
  stop(): Promise<void>;
}

const backends: Record<string, { skip: string | false; start: () => Promise<Backend> }> = {
  firestore: {
    skip: process.env.FIRESTORE_EMULATOR_HOST ? false : "FIRESTORE_EMULATOR_HOST not set",
    async start() {
      const db = new Firestore({ projectId: "demo-ytdigest", ignoreUndefinedProperties: true });
      const prefix = `t${Date.now()}_${randomBytes(3).toString("hex")}_`;
      const usersCollection = `${prefix}users`;
      return {
        repo: createFirestoreYtdigestRepo(db, { prefix, usersCollection }),
        async addUser(email) {
          const uid = randomBytes(21).toString("base64url").slice(0, 28);
          await db.collection(usersCollection).doc(uid).set({ email, displayName: null });
          return uid;
        },
        stop: () => db.terminate(),
      };
    },
  },
  postgres: {
    skip:
      process.env.YTDIGEST_TEST_DATABASE_URL && process.env.YTDIGEST_TEST_ADMIN_DATABASE_URL
        ? false
        : "YTDIGEST_TEST_DATABASE_URL / YTDIGEST_TEST_ADMIN_DATABASE_URL not set",
    async start() {
      const pg = createPostgresClient({
        url: process.env.YTDIGEST_TEST_DATABASE_URL!,
        schema: "ytdigest",
      });
      await runMigrations(pg, join(here, "..", "..", "migrations"));
      const admin = createPostgresClient({
        url: process.env.YTDIGEST_TEST_ADMIN_DATABASE_URL!,
        schema: "public",
      });
      return {
        repo: createPostgresYtdigestRepo(pg),
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

/**
 * A scriptable YouTube. Channel and video ids are unique per suite run, since
 * channels and videos are a catalog shared by every user and every run on
 * the same database.
 */
function fakeYouTube(run: string) {
  const channels = new Map<string, ResolvedChannel>();
  const uploads = new Map<string, UploadListItem[]>(); // playlist -> newest first
  const stats = new Map<string, VideoStats>();

  const addChannel = (handle: string, title: string) => {
    const c: ResolvedChannel = {
      youtubeChannelId: `UC${run}${handle}`,
      title,
      thumbnailUrl: `https://img/${handle}.jpg`,
      uploadsPlaylistId: `UU${run}${handle}`,
    };
    channels.set(`@${handle}`, c);
    uploads.set(c.uploadsPlaylistId, []);
    return c;
  };

  const upload = (c: ResolvedChannel, key: string, title: string, hoursAgo: number) => {
    const id = `${run}${key}`;
    uploads.get(c.uploadsPlaylistId)!.unshift({
      youtubeVideoId: id,
      title,
      description: `about ${title}`,
      publishedAt: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
      thumbnailUrl: `https://img/${key}.jpg`,
    });
    stats.set(id, {
      youtubeVideoId: id,
      viewCount: 12_345,
      likeCount: 678,
      commentCount: 9,
      durationSeconds: 600,
    });
    return id;
  };

  const gateway: YouTubeGateway = {
    async resolveChannel(q) {
      return channels.get(q.trim()) ?? null;
    },
    async listNewUploads(playlistId, sinceVideoId) {
      const out: UploadListItem[] = [];
      for (const u of uploads.get(playlistId) ?? []) {
        if (u.youtubeVideoId === sinceVideoId) break;
        out.push(u);
      }
      return out;
    },
    async batchGetVideoStats(ids) {
      return ids.flatMap((id) => (stats.has(id) ? [stats.get(id)!] : []));
    },
  };

  return { gateway, addChannel, upload };
}

function memoryLease(): Lease {
  const held = new Set<string>();
  return {
    async acquire(name) {
      if (held.has(name)) return false;
      held.add(name);
      return true;
    },
    async release(name) {
      held.delete(name);
    },
  };
}

type Res = { status: number; body: any };
type Call = (method: string, path: string, body?: unknown) => Promise<Res>;
const silent = { info() {}, warn() {}, error() {} };

for (const [backendName, backend] of Object.entries(backends)) {
  for (const adapter of ["fastify", "express"] as const) {
    describe(`ytdigest contract (${backendName}, ${adapter})`, { skip: backend.skip }, () => {
      let b: Backend;
      let stopServer: () => Promise<void>;
      let base: string;
      const sessions = new Map<string, SessionUser>();
      const outbox: { to: string; subject: string; html: string; text?: string }[] = [];
      const mailer: DigestMailer = { send: async (m) => void outbox.push(m) };
      const yt = fakeYouTube(randomBytes(4).toString("hex"));
      const lease = memoryLease();

      let alice: SessionUser;
      let bob: SessionUser;

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

      const verify = async (headers: Record<string, string | string[] | undefined>) => {
        const m = /stack_session=([^;]+)/.exec(String(headers["cookie"] ?? ""));
        return (m && sessions.get(m[1])) ?? null;
      };

      const newUser = async (name: string): Promise<SessionUser> => {
        const email = `${name}-${randomUUID()}@example.com`;
        const user = { userId: await b.addUser(email), email, displayName: null };
        sessions.set(randomUUID(), user);
        return user;
      };

      const poll = () => pollChannels({ repo: b.repo, youtube: yt.gateway, lease, log: silent });

      before(async () => {
        b = await backend.start();
        const routes = ytdigestRoutes({ youtube: yt.gateway, mailer });
        const opts = { repo: b.repo, verify };

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

        alice = await newUser("alice");
        bob = await newUser("bob");
      });

      after(async () => {
        await stopServer?.();
        await b?.stop();
      });

      // Built up as the story goes.
      const science = yt.addChannel("science", "Science Channel");
      const kitchen = yt.addChannel("kitchen", "Kitchen Channel");
      let scienceSub: string;
      let kitchenSub: string;
      let scienceChannelId: string;
      let globalRule: string;
      let digestId: string;
      const videos: Record<string, string> = {};

      it("serves /health publicly and 401s everything else without a session", async () => {
        assert.deepEqual(await as(null)("GET", "/health"), { status: 200, body: { ok: true } });
        for (const [method, path] of [
          ["GET", "/channels"],
          ["GET", "/subscriptions"],
          ["POST", "/digests/run-now"],
        ] as const) {
          assert.deepEqual(
            await as(null)(method, path),
            { status: 401, body: { error: "not signed in" } },
            `${method} ${path}`,
          );
        }
      });

      it("resolves channels through the YouTube gateway", async () => {
        const res = await as(alice)("POST", "/channels/resolve", { query: "@science" });
        assert.deepEqual(res, { status: 200, body: science });
        assert.deepEqual(await as(alice)("POST", "/channels/resolve", { query: "@nobody" }), {
          status: 404,
          body: { error: "channel not found" },
        });
        assert.equal((await as(alice)("POST", "/channels/resolve", {})).status, 400);
      });

      it("subscribes once per channel and validates weekly cadence", async () => {
        const weeklyNoDay = await as(alice)("POST", "/subscriptions", {
          query: "@science",
          cadence: "weekly",
        });
        assert.equal(weeklyNoDay.status, 400);
        assert.ok(weeklyNoDay.body.error.fieldErrors.digestDayOfWeek);

        const s = await as(alice)("POST", "/subscriptions", {
          query: "@science",
          cadence: "daily",
          notifyMode: "all",
        });
        assert.equal(s.status, 201);
        assert.deepEqual(Object.keys(s.body).sort(), ["channelId", "id"]);
        scienceSub = s.body.id;
        scienceChannelId = s.body.channelId;

        assert.deepEqual(
          await as(alice)("POST", "/subscriptions", { query: "@science", cadence: "daily" }),
          { status: 409, body: { error: "already subscribed" } },
        );
        assert.deepEqual(
          await as(alice)("POST", "/subscriptions", { query: "@nobody", cadence: "daily" }),
          { status: 404, body: { error: "channel not found" } },
        );

        const k = await as(alice)("POST", "/subscriptions", { query: "@kitchen", cadence: "daily" });
        assert.equal(k.status, 201);
        kitchenSub = k.body.id;

        const subs = (await as(alice)("GET", "/subscriptions")).body;
        assert.deepEqual(
          subs.map((x: any) => [x.channel_title, x.notify_mode]),
          [
            ["Kitchen Channel", "rules"],
            ["Science Channel", "all"],
          ],
          "ORDER BY title; notifyMode defaults to rules",
        );
        assert.deepEqual(Object.keys(subs[0]).sort(), [
          "cadence",
          "channel_id",
          "channel_title",
          "created_at",
          "digest_day_of_week",
          "id",
          "last_digested_at",
          "notify_mode",
          "thumbnail_url",
        ]);
      });

      it("lists the channel catalog with each user's own subscription id", async () => {
        const mine = (await as(alice)("GET", "/channels")).body.filter((c: any) =>
          [science.youtubeChannelId, kitchen.youtubeChannelId].includes(c.youtube_channel_id),
        );
        assert.deepEqual(Object.keys(mine[0]).sort(), [
          "id",
          "last_polled_at",
          "subscription_id",
          "thumbnail_url",
          "title",
          "youtube_channel_id",
        ]);
        assert.deepEqual(
          mine.map((c: any) => c.subscription_id).sort(),
          [kitchenSub, scienceSub].sort(),
        );
        const theirs = (await as(bob)("GET", "/channels")).body.find(
          (c: any) => c.youtube_channel_id === science.youtubeChannelId,
        );
        assert.equal(theirs.subscription_id, null, "someone else's subscription isn't shown");
      });

      it("patches and scopes subscriptions to their owner", async () => {
        assert.deepEqual(await as(alice)("PATCH", `/subscriptions/${randomUUID()}`, {}), {
          status: 200,
          body: { ok: true },
        });
        assert.deepEqual(
          await as(bob)("PATCH", `/subscriptions/${scienceSub}`, { cadence: "weekly" }),
          { status: 404, body: { error: "not found" } },
        );
        assert.deepEqual(
          await as(alice)("PATCH", `/subscriptions/${kitchenSub}`, {
            cadence: "weekly",
            digestDayOfWeek: 3,
          }),
          { status: 200, body: { ok: true } },
        );
        const k = (await as(alice)("GET", "/subscriptions")).body.find(
          (x: any) => x.id === kitchenSub,
        );
        assert.deepEqual([k.cadence, k.digest_day_of_week], ["weekly", 3]);
        await as(alice)("PATCH", `/subscriptions/${kitchenSub}`, { cadence: "daily" });
      });

      it("creates rules, checking a subscription-scoped rule's subscription", async () => {
        const created = await as(alice)("POST", "/rules", {
          scope: "global",
          name: "Physics",
          ruleJson: {
            op: "OR",
            conditions: [{ type: "keyword", field: "title", match: "any", terms: ["physics"] }],
          },
        });
        assert.equal(created.status, 201);
        globalRule = created.body.id;

        assert.equal(
          (
            await as(alice)("POST", "/rules", {
              scope: "subscription",
              name: "x",
              ruleJson: { op: "AND", conditions: [{ type: "duration", min: 1 }] },
            })
          ).status,
          400,
          "scope=subscription needs a subscriptionId",
        );
        assert.equal(
          (
            await as(alice)("POST", "/rules", {
              scope: "global",
              name: "x",
              ruleJson: { op: "AND", conditions: [] },
            })
          ).status,
          400,
          "a group needs at least one condition",
        );

        // Was a 500 (FK violation) for an unknown id, and a 201 for someone
        // else's subscription. Now a 404 for both.
        for (const subscriptionId of [randomUUID(), scienceSub]) {
          assert.deepEqual(
            await as(bob)("POST", "/rules", {
              scope: "subscription",
              subscriptionId,
              name: "x",
              ruleJson: { op: "AND", conditions: [{ type: "duration", min: 1 }] },
            }),
            { status: 404, body: { error: "subscription not found" } },
          );
        }

        // Scoped to kitchen: a performance rule. Its channel has no history,
        // so it can't match, but evaluating it must not throw. (It did on
        // Postgres, which returns timestamps as strings.)
        assert.equal(
          (
            await as(alice)("POST", "/rules", {
              scope: "subscription",
              subscriptionId: kitchenSub,
              name: "Breakout",
              ruleJson: {
                op: "AND",
                conditions: [
                  {
                    type: "performance",
                    metric: "views_per_hour",
                    comparedTo: "channel_baseline",
                    threshold: 1.5,
                  },
                ],
              },
            })
          ).status,
          201,
        );
        // One for science too, to check deleting the subscription removes it.
        await as(alice)("POST", "/rules", {
          scope: "subscription",
          subscriptionId: scienceSub,
          name: "Science only",
          ruleJson: { op: "AND", conditions: [{ type: "duration", min: 1 }] },
        });

        const rules = (await as(alice)("GET", "/rules")).body;
        assert.equal(rules.length, 3);
        assert.deepEqual(Object.keys(rules[0]).sort(), [
          "created_at",
          "enabled",
          "id",
          "name",
          "rule_json",
          "scope",
          "subscription_id",
        ]);
        assert.equal(rules[2].name, "Physics", "ORDER BY created_at DESC");
        assert.equal(rules[2].rule_json.conditions[0].terms[0], "physics", "rule_json round-trips");

        assert.deepEqual(await as(bob)("PATCH", `/rules/${globalRule}`, { enabled: false }), {
          status: 404,
          body: { error: "not found" },
        });
        assert.deepEqual(await as(alice)("DELETE", `/rules/${randomUUID()}`), {
          status: 404,
          body: { error: "not found" },
        });
      });

      it("polls subscribed channels for uploads and stats", async () => {
        videos.s1 = yt.upload(science, "s1", "Physics of flight", 30);
        videos.s2 = yt.upload(science, "s2", "Chemistry basics", 20);
        videos.k1 = yt.upload(kitchen, "k1", "Kitchen physics", 10);
        videos.k2 = yt.upload(kitchen, "k2", "Bread", 5);

        await poll();

        const polled = (await as(alice)("GET", "/channels")).body.filter(
          (c: any) => c.id === scienceChannelId,
        )[0];
        assert.ok(!Number.isNaN(Date.parse(polled.last_polled_at)), "last_polled_at set");

        // Snapshots come back as real Dates on both backends.
        const latest = await b.repo.latestSnapshot(await videoId(b.repo, scienceChannelId, videos.s1));
        assert.ok(latest && latest.capturedAt instanceof Date);
        assert.equal(latest!.viewCount, 12_345, "a number, not a bigint string");
      });

      it("feeds the uploads that pass each subscription's filters, newest first", async () => {
        // science is notify=all; kitchen is notify=rules, where the global
        // "physics" rule lets k1 through and nothing lets k2 through.
        const feed = await as(alice)("GET", "/feed");
        assert.equal(feed.status, 200);
        assert.equal(feed.body.next, null);
        assert.deepEqual(
          feed.body.items.map((i: any) => i.youtube_video_id),
          [videos.k1, videos.s2, videos.s1],
        );
        const [k1] = feed.body.items;
        assert.deepEqual(Object.keys(k1).sort(), [
          "channel_id",
          "channel_thumbnail_url",
          "channel_title",
          "duration_seconds",
          "matched_rule_id",
          "published_at",
          "reasons",
          "thumbnail_url",
          "title",
          "video_id",
          "view_count",
          "youtube_video_id",
        ]);
        assert.equal(k1.channel_title, "Kitchen Channel");
        assert.equal(k1.matched_rule_id, globalRule);
        assert.ok(k1.reasons[0].includes("physics"));
        assert.equal(k1.view_count, 12_345, "a number on both backends");
        assert.equal(k1.duration_seconds, 600);
        assert.ok(k1.published_at.endsWith("Z"), "ISO 8601 on both backends");

        assert.deepEqual((await as(bob)("GET", "/feed")).body, { items: [], next: null });
      });

      it("pages the feed with a cursor, and follows rule changes at once", async () => {
        const seen: string[] = [];
        let before: string | null = null;
        for (let page = 0; page < 5; page++) {
          const q: string = before ? `?limit=1&before=${encodeURIComponent(before)}` : "?limit=1";
          const res = await as(alice)("GET", `/feed${q}`);
          seen.push(...res.body.items.map((i: any) => i.youtube_video_id));
          before = res.body.next;
          if (!before) break;
        }
        assert.deepEqual(seen, [videos.k1, videos.s2, videos.s1]);
        assert.equal(before, null, "the last page says so");

        assert.equal((await as(alice)("GET", "/feed?before=nonsense")).status, 400);
        assert.equal((await as(alice)("GET", "/feed?limit=0")).status, 400);

        // Nothing is stored for the feed: disable the rule and k1 drops out.
        await as(alice)("PATCH", `/rules/${globalRule}`, { enabled: false });
        assert.deepEqual(
          (await as(alice)("GET", "/feed")).body.items.map((i: any) => i.youtube_video_id),
          [videos.s2, videos.s1],
        );
        await as(alice)("PATCH", `/rules/${globalRule}`, { enabled: true });
      });

      it("serves one video for the player, only from the user's own channels", async () => {
        const res = await as(alice)("GET", `/videos/${videos.k1}`);
        assert.equal(res.status, 200);
        assert.equal(res.body.youtube_video_id, videos.k1);
        assert.equal(res.body.description, "about Kitchen physics");
        assert.equal(res.body.matched, true);

        const k2 = await as(alice)("GET", `/videos/${videos.k2}`);
        assert.equal(k2.status, 200, "a filtered-out video still opens by link");
        assert.deepEqual([k2.body.matched, k2.body.reasons], [false, []]);

        assert.deepEqual(await as(bob)("GET", `/videos/${videos.k1}`), {
          status: 404,
          body: { error: "not found" },
        });
        assert.equal((await as(alice)("GET", "/videos/nope")).status, 404);
        assert.equal((await as(alice)("GET", "/videos/not%20an%20id")).status, 400);
      });

      it("run-now digests matching uploads and links them by YouTube id", async () => {
        const res = await as(alice)("POST", "/digests/run-now");
        // science is notify=all (s1, s2); kitchen is notify=rules, where the
        // global "physics" rule matches k1 and nothing matches k2.
        assert.deepEqual(res, { status: 200, body: { sent: true, itemCount: 3 } });

        assert.equal(outbox.length, 1);
        const [mail] = outbox;
        assert.equal(mail.to, alice.email);
        assert.match(mail.subject, /3 new videos/);
        for (const key of ["s1", "s2", "k1"]) {
          assert.ok(
            mail.html.includes(`watch?v=${videos[key]}`),
            `${key} is linked by its YouTube id`,
          );
        }
        assert.ok(!mail.html.includes(videos.k2));
        assert.match(mail.text!, /12,345 views/, "view counts are numbers, formatted");

        const runs = (await as(alice)("GET", "/digests")).body;
        assert.equal(runs.length, 1);
        assert.deepEqual(Object.keys(runs[0]).sort(), [
          "cadence",
          "id",
          "item_count",
          "run_date",
          "sent_at",
        ]);
        assert.equal(runs[0].item_count, 3);
        digestId = runs[0].id;

        const detail = (await as(alice)("GET", `/digests/${digestId}`)).body;
        assert.deepEqual(
          detail.items.map((i: any) => [i.channel_title, i.youtube_video_id]).sort(),
          [
            ["Kitchen Channel", videos.k1],
            ["Science Channel", videos.s1],
            ["Science Channel", videos.s2],
          ].sort(),
        );
        assert.equal(detail.items[0].channel_title, "Kitchen Channel", "ORDER BY channel title");
        const k1 = detail.items.find((i: any) => i.youtube_video_id === videos.k1);
        assert.equal(k1.matched_rule_id, globalRule);
        assert.ok(k1.reason_json[0].includes("physics"));
        assert.deepEqual(Object.keys(k1).sort(), [
          "channel_title",
          "matched_rule_id",
          "reason_json",
          "thumbnail_url",
          "title",
          "video_id",
          "youtube_video_id",
        ]);

        assert.deepEqual(await as(bob)("GET", `/digests/${digestId}`), {
          status: 404,
          body: { error: "not found" },
        });
      });

      it("never sends the same video twice", async () => {
        assert.deepEqual(await as(alice)("POST", "/digests/run-now"), {
          status: 200,
          body: { sent: false, itemCount: 0 },
        });
        videos.s3 = yt.upload(science, "s3", "Astronomy", 1);
        await poll();
        assert.deepEqual(await as(alice)("POST", "/digests/run-now"), {
          status: 200,
          body: { sent: true, itemCount: 1 },
        });
        assert.ok(outbox.at(-1)!.html.includes(videos.s3));
      });

      it("deleting a subscription removes its rules and its lines in past digests", async () => {
        assert.deepEqual(await as(alice)("DELETE", `/subscriptions/${scienceSub}`), {
          status: 200,
          body: { ok: true },
        });
        assert.equal((await as(alice)("DELETE", `/subscriptions/${scienceSub}`)).status, 404);

        const rules = (await as(alice)("GET", "/rules")).body.map((r: any) => r.name);
        assert.deepEqual(rules.sort(), ["Breakout", "Physics"]);

        const detail = (await as(alice)("GET", `/digests/${digestId}`)).body;
        assert.deepEqual(
          detail.items.map((i: any) => i.youtube_video_id),
          [videos.k1],
        );
        const [latestRun] = (await as(alice)("GET", "/digests")).body;
        assert.equal(latestRun.item_count, 0, "the s3-only digest is now empty");
      });

      it("the daily job mails everyone due, and weekly days follow the configured zone", async () => {
        // Bob: weekly on Sundays.
        const sub = await as(bob)("POST", "/subscriptions", {
          query: "@science",
          cadence: "weekly",
          digestDayOfWeek: 0,
          notifyMode: "all",
        });
        assert.equal(sub.status, 201);
        const before = outbox.length;

        // 02:00 UTC on Monday 2026-09-28 is 22:00 on Sunday in New York.
        const runDate = new Date("2026-09-28T02:00:00Z");

        await runDailyDigest(b.repo, mailer, runDate, { timeZone: "UTC" }, silent);
        assert.equal(
          outbox.slice(before).filter((m) => m.to === bob.email).length,
          0,
          "Monday in UTC: Bob's Sunday digest isn't due",
        );

        await runDailyDigest(b.repo, mailer, runDate, { timeZone: "America/New_York" }, silent);
        const bobs = outbox.slice(before).filter((m) => m.to === bob.email);
        assert.equal(bobs.length, 1, "Sunday in New York: it is");
        assert.match(bobs[0].subject, /Sunday, September 27/, "the email is dated in that zone too");

        const [run] = (await as(bob)("GET", "/digests")).body;
        assert.equal(String(run.run_date).slice(0, 10), "2026-09-27", "run_date is the local date");
        assert.equal(run.cadence, "weekly");
      });
    });
  }
}

/** The repo's id for a YouTube video: its own UUID on Postgres, the YouTube id on Firestore. */
async function videoId(repo: YtdigestRepo, channelId: string, youtubeVideoId: string) {
  const tracked = await repo.trackedVideos(channelId, 50);
  return tracked.find((v) => v.youtubeVideoId === youtubeVideoId)!.id;
}
