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
import { createFirestorePantryRepo } from "../repo/firestore.js";
import { createPostgresPantryRepo } from "../repo/postgres.js";
import type { PantryRepo } from "../repo/types.js";
import { pantryRoutes, resolvePantryScope } from "./routes.js";

/**
 * pantry's HTTP contract, run end to end against each real backend through
 * each adapter. The assertions pin what apps/pantry/web/src/api.ts depends
 * on: status codes, error bodies, and the snake_case row shapes. They also
 * pin the semantics the Firestore repo has to rebuild by hand, which Postgres
 * gets from constraints: case-insensitive uniqueness, cascades, SET NULL,
 * single-use invites, owner promotion.
 *
 * Each backend runs only when it is reachable:
 *   Firestore  FIRESTORE_EMULATOR_HOST             (CI sets this)
 *   Postgres   PANTRY_TEST_DATABASE_URL            connects as the `pantry` role
 *              PANTRY_TEST_ADMIN_DATABASE_URL      seeds shared.users, which
 *                                                  the pantry role can't write
 */

const here = dirname(fileURLToPath(import.meta.url));

interface Backend {
  repo: PantryRepo;
  /** Creates a user the backend's member/invite joins can resolve. */
  addUser(email: string, displayName: string | null): Promise<string>;
  stop(): Promise<void>;
}

const backends: Record<string, { skip: string | false; start: () => Promise<Backend> }> = {
  firestore: {
    skip: process.env.FIRESTORE_EMULATOR_HOST ? false : "FIRESTORE_EMULATOR_HOST not set",
    async start() {
      const db = new Firestore({ projectId: "demo-pantry", ignoreUndefinedProperties: true });
      // A fresh prefix per run, so repeat runs never see each other's documents.
      const prefix = `t${Date.now()}_${randomBytes(3).toString("hex")}_`;
      const usersCollection = `${prefix}users`;
      return {
        repo: createFirestorePantryRepo(db, { prefix, usersCollection }),
        async addUser(email, displayName) {
          // Firebase uids are 28-char strings, not UUIDs. Using that shape
          // here is what exercises the relaxed :userId param on this backend.
          const uid = randomBytes(21).toString("base64url").slice(0, 28);
          await db.collection(usersCollection).doc(uid).set({ email, displayName });
          return uid;
        },
        stop: () => db.terminate(),
      };
    },
  },
  postgres: {
    skip:
      process.env.PANTRY_TEST_DATABASE_URL && process.env.PANTRY_TEST_ADMIN_DATABASE_URL
        ? false
        : "PANTRY_TEST_DATABASE_URL / PANTRY_TEST_ADMIN_DATABASE_URL not set",
    async start() {
      const pg = createPostgresClient({
        url: process.env.PANTRY_TEST_DATABASE_URL!,
        schema: "pantry",
      });
      await runMigrations(pg, join(here, "..", "..", "migrations"));
      const admin = createPostgresClient({
        url: process.env.PANTRY_TEST_ADMIN_DATABASE_URL!,
        schema: "public",
      });
      return {
        repo: createPostgresPantryRepo(pg),
        async addUser(email, displayName) {
          const [u] = await admin.sql<{ id: string }[]>`
            INSERT INTO shared.users (email, display_name) VALUES (${email}, ${displayName})
            RETURNING id
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

for (const [backendName, backend] of Object.entries(backends)) {
  for (const adapter of ["fastify", "express"] as const) {
    describe(`pantry contract (${backendName}, ${adapter})`, { skip: backend.skip }, () => {
      let b: Backend;
      let stopServer: () => Promise<void>;
      let base: string;
      const sessions = new Map<string, SessionUser>();

      // One user per role in the story. `as` is who the request comes from.
      let owner: SessionUser;
      let member: SessionUser;
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
        const user = { userId: await b.addUser(email, name), email, displayName: name };
        sessions.set(randomUUID(), user);
        return user;
      };

      before(async () => {
        b = await backend.start();
        const opts = { repo: b.repo, verify, resolveScope: resolvePantryScope };
        const routes = pantryRoutes();

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

        owner = await newUser("Olive");
        member = await newUser("Mo");
        outsider = await newUser("Oscar");
      });

      after(async () => {
        await stopServer?.();
        await b?.stop();
      });

      // State the story builds up as it goes.
      let home: string;
      let produce: string;
      let costco: string;
      let milk: string;
      let eggs: string;
      let list: string;

      it("serves /health publicly and 401s everything else without a session", async () => {
        assert.deepEqual(await as(null)("GET", "/health"), { status: 200, body: { ok: true } });
        for (const [method, path] of [
          ["GET", "/items"],
          ["GET", "/households"],
          ["POST", "/lists"],
          ["GET", "/invites/abc"],
        ] as const) {
          assert.deepEqual(
            await as(null)(method, path),
            { status: 401, body: { error: "not signed in" } },
            `${method} ${path}`,
          );
        }
      });

      it("409s NO_HOUSEHOLD on data routes until a household exists", async () => {
        assert.deepEqual(await as(owner)("GET", "/me/household"), {
          status: 200,
          body: { household: null },
        });
        for (const path of ["/items", "/tags", "/lists"]) {
          assert.deepEqual(
            await as(owner)("GET", path),
            { status: 409, body: { error: "NO_HOUSEHOLD" } },
            path,
          );
        }
      });

      it("creates a household, makes the creator owner, and activates it", async () => {
        const bad = await as(owner)("POST", "/households", {});
        assert.equal(bad.status, 400);
        assert.ok(bad.body.error.fieldErrors.name, "flattened zod error, as before");

        const res = await as(owner)("POST", "/households", { name: "Home" });
        assert.equal(res.status, 201);
        home = res.body.id;

        assert.deepEqual((await as(owner)("GET", "/me/household")).body, {
          household: { id: home, name: "Home", role: "owner" },
        });

        const [row] = (await as(owner)("GET", "/households")).body;
        assert.deepEqual(Object.keys(row).sort(), [
          "active",
          "id",
          "joined_at",
          "member_count",
          "name",
          "role",
        ]);
        assert.equal(row.id, home);
        assert.equal(row.member_count, 1);
        assert.equal(row.active, true);
        assert.ok(!Number.isNaN(Date.parse(row.joined_at)));
      });

      it("enforces case-insensitive tag uniqueness per kind", async () => {
        const first = await as(owner)("POST", "/tags", { name: "Produce", kind: "section" });
        assert.equal(first.status, 201);
        produce = first.body.id;

        assert.deepEqual(await as(owner)("POST", "/tags", { name: "PRODUCE", kind: "section" }), {
          status: 409,
          body: { error: "duplicate tag" },
        });
        // Same name, different kind, is a different tag.
        assert.equal(
          (await as(owner)("POST", "/tags", { name: "Produce", kind: "store" })).status,
          201,
        );
        costco = (await as(owner)("POST", "/tags", { name: "Costco", kind: "store" })).body.id;

        // Renaming onto an existing name was a 500; it is now the same 409 as create.
        assert.deepEqual(
          await as(owner)("PATCH", `/tags/${costco}`, { name: "produce" }),
          { status: 409, body: { error: "duplicate tag" } },
        );
        assert.deepEqual(await as(owner)("PATCH", `/tags/${costco}`, { color: "red" }), {
          status: 200,
          body: { ok: true },
        });
        // An empty patch is a no-op success even for an unknown id, as before.
        assert.deepEqual(await as(owner)("PATCH", `/tags/${randomUUID()}`, {}), {
          status: 200,
          body: { ok: true },
        });
        assert.equal(
          (await as(owner)("PATCH", `/tags/${randomUUID()}`, { color: "x" })).status,
          404,
        );

        const tags = (await as(owner)("GET", "/tags")).body;
        assert.deepEqual(
          tags.map((t: any) => [t.kind, t.name]),
          [
            ["section", "Produce"],
            ["store", "Costco"],
            ["store", "Produce"],
          ],
          "ORDER BY kind, name",
        );
        assert.deepEqual(Object.keys(tags[0]).sort(), ["color", "id", "kind", "name"]);
      });

      it("enforces case-insensitive item uniqueness and keeps only this household's tags", async () => {
        const res = await as(owner)("POST", "/items", {
          name: "Milk",
          // A duplicate and an id that names no tag: both dropped, as the
          // INSERT ... SELECT FROM tags did.
          tagIds: [produce, randomUUID(), produce],
        });
        assert.equal(res.status, 201);
        milk = res.body.id;

        assert.deepEqual(await as(owner)("POST", "/items", { name: "milk" }), {
          status: 409,
          body: { error: "duplicate name" },
        });

        eggs = (await as(owner)("POST", "/items", { name: "Eggs", status: "low" })).body.id;

        const items = (await as(owner)("GET", "/items")).body;
        assert.deepEqual(
          items.map((i: any) => i.name),
          ["Eggs", "Milk"],
          "ORDER BY name",
        );
        const m = items.find((i: any) => i.id === milk);
        assert.deepEqual(Object.keys(m).sort(), [
          "id",
          "name",
          "notes",
          "quantity",
          "size",
          "status",
          "tag_ids",
          "updated_at",
        ]);
        assert.deepEqual(m.tag_ids, [produce]);
        assert.equal(m.quantity, 1);
        assert.equal(m.status, "stocked");
        assert.equal(m.size, null);
      });

      it("patches items, allowing a case-only rename and rejecting a clash", async () => {
        assert.deepEqual(await as(owner)("PATCH", `/items/${milk}`, { name: "MILK" }), {
          status: 200,
          body: { ok: true },
        });
        assert.deepEqual(await as(owner)("PATCH", `/items/${eggs}`, { name: "milk" }), {
          status: 409,
          body: { error: "duplicate name" },
        });
        assert.deepEqual(await as(owner)("PATCH", `/items/${randomUUID()}`, { quantity: 2 }), {
          status: 404,
          body: { error: "not found" },
        });
        assert.equal((await as(owner)("PATCH", "/items/not-a-uuid", {})).status, 400);

        assert.deepEqual(
          await as(owner)("PATCH", `/items/${milk}`, { tagIds: [produce, costco] }),
          { status: 200, body: { ok: true } },
        );
        const m = (await as(owner)("GET", "/items")).body.find((i: any) => i.id === milk);
        assert.equal(m.name, "MILK");
        assert.deepEqual([...m.tag_ids].sort(), [produce, costco].sort());

        assert.deepEqual(await as(owner)("POST", `/items/${eggs}/status`, { status: "out" }), {
          status: 200,
          body: { ok: true },
        });
        assert.equal(
          (await as(owner)("POST", `/items/${eggs}/status`, { status: "gone" })).status,
          400,
        );
      });

      it("builds a list from items plus ad-hoc extras and joins in live item state", async () => {
        const res = await as(owner)("POST", "/lists", {
          itemIds: [milk, eggs, randomUUID()],
          extras: [{ name: "Bread" }],
        });
        assert.equal(res.status, 201);
        list = res.body.id;

        const detail = (await as(owner)("GET", `/lists/${list}`)).body;
        assert.deepEqual(Object.keys(detail).sort(), [
          "completed_at",
          "created_at",
          "id",
          "items",
          "name",
          "status",
        ]);
        assert.match(detail.name, /^\d{4}-\d{2}-\d{2} list$/, "default name");
        assert.equal(detail.status, "active");
        assert.equal(detail.items.length, 3, "the unknown item id is skipped");

        const byName = (n: string) => detail.items.find((i: any) => i.name_snapshot === n);
        assert.deepEqual(Object.keys(byName("MILK")).sort(), [
          "checked_off",
          "id",
          "item_id",
          "item_status",
          "name_snapshot",
          "quantity",
          "sections",
          "stores",
        ]);
        assert.deepEqual(byName("MILK").sections, ["Produce"]);
        assert.deepEqual(byName("MILK").stores, ["Costco"]);
        assert.equal(byName("Eggs").item_status, "out");
        assert.equal(byName("Bread").item_id, null);
        assert.equal(byName("Bread").item_status, null);
        assert.deepEqual(byName("Bread").sections, []);
      });

      it("adds, checks off and removes list entries", async () => {
        assert.equal(
          (await as(owner)("POST", `/lists/${list}/items`, { itemId: milk })).status,
          201,
        );
        const butter = await as(owner)("POST", `/lists/${list}/items`, {
          name: "Butter",
          quantity: 2,
        });
        assert.equal(butter.status, 201);

        assert.deepEqual(await as(owner)("POST", `/lists/${list}/items`, {}), {
          status: 400,
          body: { error: "name required for ad-hoc item" },
        });
        assert.deepEqual(
          await as(owner)("POST", `/lists/${list}/items`, { itemId: randomUUID() }),
          { status: 404, body: { error: "item not found" } },
        );
        assert.deepEqual(
          await as(owner)("POST", `/lists/${randomUUID()}/items`, { name: "x" }),
          { status: 404, body: { error: "not found" } },
        );

        const entries = (await as(owner)("GET", `/lists/${list}`)).body.items;
        assert.equal(entries.length, 5);
        const milkEntry = entries.find((e: any) => e.name_snapshot === "MILK").id;
        const eggsEntry = entries.find((e: any) => e.name_snapshot === "Eggs").id;

        for (const lid of [milkEntry, eggsEntry]) {
          assert.deepEqual(
            await as(owner)("PATCH", `/lists/${list}/items/${lid}`, { checkedOff: true }),
            { status: 200, body: { ok: true } },
          );
        }
        assert.deepEqual(
          await as(owner)("PATCH", `/lists/${list}/items/${randomUUID()}`, { checkedOff: true }),
          { status: 404, body: { error: "not found" } },
        );

        assert.deepEqual(
          await as(owner)("DELETE", `/lists/${list}/items/${butter.body.id}`),
          { status: 200, body: { ok: true } },
        );
        assert.equal(
          (await as(owner)("DELETE", `/lists/${list}/items/${butter.body.id}`)).status,
          404,
        );

        const [summary] = (await as(owner)("GET", "/lists")).body;
        assert.deepEqual(Object.keys(summary).sort(), [
          "checked_count",
          "completed_at",
          "created_at",
          "id",
          "item_count",
          "name",
          "status",
        ]);
        assert.equal(summary.item_count, 4);
        assert.equal(summary.checked_count, 2);
      });

      it("finish restocks checked, linked items and completes the list", async () => {
        const entries = (await as(owner)("GET", `/lists/${list}`)).body.items;
        const milkEntry = entries.find(
          (e: any) => e.name_snapshot === "MILK" && e.checked_off,
        ).id;

        assert.deepEqual(
          await as(owner)("POST", `/lists/${list}/finish`, {
            updates: [{ listItemId: milkEntry, quantity: 3 }],
          }),
          { status: 200, body: { ok: true } },
        );

        const items = (await as(owner)("GET", "/items")).body;
        const m = items.find((i: any) => i.id === milk);
        const e = items.find((i: any) => i.id === eggs);
        assert.deepEqual([m.quantity, m.status], [3, "stocked"], "explicit quantity");
        assert.deepEqual([e.quantity, e.status], [1, "stocked"], "defaults to 1");

        const detail = (await as(owner)("GET", `/lists/${list}`)).body;
        assert.equal(detail.status, "completed");
        assert.ok(!Number.isNaN(Date.parse(detail.completed_at)));
        const unchecked = detail.items.find((i: any) => i.name_snapshot === "Bread");
        assert.equal(unchecked.quantity, 1, "unchecked entries are left alone");

        // Was a 500 (an Error thrown inside the transaction); now a 404.
        assert.deepEqual(await as(owner)("POST", `/lists/${randomUUID()}/finish`, {}), {
          status: 404,
          body: { error: "not found" },
        });
      });

      it("unlinks list entries from a deleted item, and strips a deleted tag from items", async () => {
        assert.deepEqual(await as(owner)("DELETE", `/items/${eggs}`), {
          status: 200,
          body: { ok: true },
        });
        assert.equal((await as(owner)("DELETE", `/items/${eggs}`)).status, 404);

        const detail = (await as(owner)("GET", `/lists/${list}`)).body;
        const e = detail.items.find((i: any) => i.name_snapshot === "Eggs");
        assert.equal(e.item_id, null, "ON DELETE SET NULL");
        assert.equal(e.item_status, null);

        assert.deepEqual(await as(owner)("DELETE", `/tags/${produce}`), {
          status: 200,
          body: { ok: true },
        });
        const m = (await as(owner)("GET", "/items")).body.find((i: any) => i.id === milk);
        assert.deepEqual(m.tag_ids, [costco], "item_tags cascade");
      });

      it("invites are owner-only, previewable, and single-use", async () => {
        const created = await as(owner)("POST", `/households/${home}/invites`);
        assert.equal(created.status, 201);
        assert.deepEqual(Object.keys(created.body).sort(), ["expiresAt", "id", "token"]);
        const { token } = created.body;

        assert.deepEqual(await as(member)("POST", `/households/${home}/invites`), {
          status: 403,
          body: { error: "owner only" },
        });

        const pending = (await as(owner)("GET", `/households/${home}/invites`)).body;
        assert.deepEqual(
          pending.map((i: any) => i.id),
          [created.body.id],
        );
        assert.deepEqual(Object.keys(pending[0]).sort(), ["created_at", "expires_at", "id"]);

        assert.deepEqual(await as(member)("GET", `/invites/${token}`), {
          status: 200,
          body: { householdName: "Home", inviterName: "Olive", expiresAt: created.body.expiresAt },
        });
        assert.deepEqual(await as(member)("GET", "/invites/not-a-real-token"), {
          status: 404,
          body: { error: "invalid invite" },
        });

        assert.deepEqual(await as(member)("POST", `/invites/${token}/accept`), {
          status: 200,
          body: { householdId: home },
        });
        assert.deepEqual(await as(outsider)("POST", `/invites/${token}/accept`), {
          status: 410,
          body: { error: "already used" },
        });
        assert.deepEqual(await as(member)("GET", `/invites/${token}`), {
          status: 410,
          body: { error: "already used" },
        });
        assert.deepEqual(
          (await as(owner)("GET", `/households/${home}/invites`)).body,
          [],
          "accepted invites drop out of the pending list",
        );

        // Accepting made it the member's active household.
        assert.deepEqual((await as(member)("GET", "/me/household")).body, {
          household: { id: home, name: "Home", role: "member" },
        });
        const shared = (await as(member)("GET", "/items")).body.map((i: any) => i.id);
        assert.deepEqual(shared, [milk], "members see the household's data");

        // A revoked invite can't be used.
        const revoked = (await as(owner)("POST", `/households/${home}/invites`)).body;
        assert.deepEqual(
          await as(owner)("DELETE", `/households/${home}/invites/${revoked.id}`),
          { status: 200, body: { ok: true } },
        );
        assert.equal((await as(outsider)("POST", `/invites/${revoked.token}/accept`)).status, 404);
      });

      it("lists members with their user details, oldest first", async () => {
        const members = (await as(member)("GET", `/households/${home}/members`)).body;
        assert.deepEqual(
          members.map((m: any) => [m.user_id, m.role, m.display_name]),
          [
            [owner.userId, "owner", "Olive"],
            [member.userId, "member", "Mo"],
          ],
        );
        assert.deepEqual(Object.keys(members[0]).sort(), [
          "display_name",
          "email",
          "joined_at",
          "role",
          "user_id",
        ]);
        assert.equal(members[0].email, owner.email);

        const households = (await as(owner)("GET", "/households")).body;
        assert.equal(households[0].member_count, 2);
      });

      it("keeps outsiders and non-owners out of household management", async () => {
        assert.deepEqual(await as(outsider)("GET", `/households/${home}/members`), {
          status: 404,
          body: { error: "not a member" },
        });
        assert.deepEqual(await as(outsider)("PATCH", `/households/${home}`, { name: "Mine" }), {
          status: 403,
          body: { error: "owner only" },
        });
        assert.deepEqual(await as(outsider)("POST", `/households/${home}/activate`), {
          status: 404,
          body: { error: "not a member" },
        });
        assert.deepEqual(
          await as(member)("DELETE", `/households/${home}/members/${owner.userId}`),
          { status: 403, body: { error: "owner only" } },
        );
        assert.deepEqual(
          await as(owner)("DELETE", `/households/${home}/members/${outsider.userId}`),
          { status: 404, body: { error: "not a member" } },
        );
        // Neither a UUID nor anyone's id: a clean 404 on both backends, not a
        // 400 (the param is no longer .uuid()) and not a Postgres cast error.
        assert.deepEqual(
          await as(owner)("DELETE", `/households/${home}/members/nobody`),
          { status: 404, body: { error: "not a member" } },
        );
        assert.deepEqual(await as(owner)("PATCH", `/households/${home}`, { name: "Home Sweet" }), {
          status: 200,
          body: { ok: true },
        });
      });

      it("promotes the longest-standing member when the owner leaves", async () => {
        assert.deepEqual(
          await as(owner)("DELETE", `/households/${home}/members/${owner.userId}`),
          { status: 200, body: { ok: true } },
        );
        assert.deepEqual((await as(member)("GET", "/me/household")).body, {
          household: { id: home, name: "Home Sweet", role: "owner" },
        });
        assert.deepEqual(
          (await as(owner)("GET", "/me/household")).body,
          { household: null },
          "the leaver's active household is cleared",
        );
      });

      it("deleting a household cascades to its data and clears active pointers", async () => {
        const cabin = (await as(member)("POST", "/households", { name: "Cabin" })).body.id;
        // Switch back so the deleted household is the active one.
        assert.deepEqual(await as(member)("POST", `/households/${home}/activate`), {
          status: 200,
          body: { ok: true },
        });

        assert.deepEqual(await as(member)("DELETE", `/households/${home}`), {
          status: 200,
          body: { ok: true },
        });
        assert.deepEqual((await as(member)("GET", "/me/household")).body, { household: null });
        assert.deepEqual(
          (await as(member)("GET", "/households")).body.map((h: any) => h.name),
          ["Cabin"],
        );

        await as(member)("POST", `/households/${cabin}/activate`);
        assert.equal((await as(member)("GET", `/lists/${list}`)).status, 404);
        assert.equal((await as(member)("PATCH", `/items/${milk}`, { quantity: 9 })).status, 404);
        assert.deepEqual((await as(member)("GET", "/items")).body, []);
      });

      it("the last member leaving removes the household", async () => {
        const [cabin] = (await as(member)("GET", "/households")).body;
        assert.deepEqual(
          await as(member)("DELETE", `/households/${cabin.id}/members/${member.userId}`),
          { status: 200, body: { ok: true } },
        );
        assert.deepEqual((await as(member)("GET", "/households")).body, []);
        assert.deepEqual((await as(member)("GET", "/me/household")).body, { household: null });
      });
    });
  }
}

const silent = { info() {}, warn() {}, error() {} };
