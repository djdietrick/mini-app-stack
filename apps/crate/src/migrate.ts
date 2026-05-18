import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PostgresClient } from "@stack/db-clients";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export async function runMigrations(client: PostgresClient): Promise<void> {
  const { sql } = client;

  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

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
