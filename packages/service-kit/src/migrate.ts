import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PostgresClient } from "@stack/db-clients";

/**
 * Applies `<dir>/*.sql` in lexicographic order, once each, tracked in the
 * app's own `_migrations` table (search_path scopes it to the app schema).
 *
 * Hoisted out of apps/{crate,pantry,ytdigest}/src/migrate.ts, where it was
 * byte-identical three times. Postgres only — the Firestore backend is
 * schemaless and has nothing to migrate.
 */
export async function runMigrations(client: PostgresClient, migrationsDir: string): Promise<void> {
  const { sql } = client;

  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

  const applied = new Set(
    (await sql<{ name: string }[]>`SELECT name FROM _migrations`).map((r) => r.name),
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const body = await readFile(join(migrationsDir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO _migrations (name) VALUES (${file})`;
    });
    console.log(`[migrate] applied ${file}`);
  }
}
