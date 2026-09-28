import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, test } from "node:test";
import { createPostgresClient } from "@stack/db-clients";
import { createSession } from "./sessions.js";
import { upsertGoogleUser } from "./users.js";

/**
 * Runs against a real Postgres provisioned by infra/postgres/init, as the
 * auth_writer role, so the grants are exercised too. Skipped without
 * AUTH_TEST_DATABASE_URL; CI sets it.
 */
const url = process.env.AUTH_TEST_DATABASE_URL;

describe("upsertGoogleUser", { skip: !url && "AUTH_TEST_DATABASE_URL not set" }, () => {
  const pg = createPostgresClient({ url: url ?? "", schema: "shared", max: 2 });
  after(() => pg.close());
  const email = () => `g-${randomUUID()}@example.com`;

  test("creates a verified user with no password", async () => {
    const address = email();
    const { id } = await upsertGoogleUser(pg, address, "Grace");
    const [row] = await pg.sql<{ display_name: string; email_verified_at: string | null }[]>`
      SELECT display_name, email_verified_at FROM shared.users WHERE id = ${id}
    `;
    assert.equal(row.display_name, "Grace");
    assert.notEqual(row.email_verified_at, null);
    const creds = await pg.sql`SELECT 1 FROM shared.user_credentials WHERE user_id = ${id}`;
    assert.equal(creds.length, 0);
    assert.deepEqual(await upsertGoogleUser(pg, address, "Grace"), { id });
  });

  test("an unverified password account is taken over: password and sessions dropped", async () => {
    const address = email();
    const [user] = await pg.sql<{ id: string }[]>`
      INSERT INTO shared.users (email) VALUES (${address}) RETURNING id
    `;
    await pg.sql`INSERT INTO shared.user_credentials (user_id, password_hash) VALUES (${user.id}, 'x')`;
    await createSession(pg, user.id, 60);

    assert.deepEqual(await upsertGoogleUser(pg, address.toUpperCase(), null), { id: user.id });
    assert.equal((await pg.sql`SELECT 1 FROM shared.user_credentials WHERE user_id = ${user.id}`).length, 0);
    assert.equal((await pg.sql`SELECT 1 FROM shared.sessions WHERE user_id = ${user.id}`).length, 0);
  });

  test("a verified password account keeps its password", async () => {
    const address = email();
    const [user] = await pg.sql<{ id: string }[]>`
      INSERT INTO shared.users (email, email_verified_at) VALUES (${address}, now()) RETURNING id
    `;
    await pg.sql`INSERT INTO shared.user_credentials (user_id, password_hash) VALUES (${user.id}, 'x')`;

    assert.deepEqual(await upsertGoogleUser(pg, address, null), { id: user.id });
    assert.equal((await pg.sql`SELECT 1 FROM shared.user_credentials WHERE user_id = ${user.id}`).length, 1);
  });
});
