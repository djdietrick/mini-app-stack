import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export type PostgresClient = ReturnType<typeof createPostgresClient>;

export interface PostgresClientOptions {
  /** Connection string, e.g. postgres://user:pass@host:5432/appstack */
  url: string;
  /** Schema this app owns. Sets search_path so unqualified tables resolve here. */
  schema: string;
  /** Max pool size. Microservices rarely need more than a handful. */
  max?: number;
}

export function createPostgresClient(opts: PostgresClientOptions) {
  const sql = postgres(opts.url, {
    max: opts.max ?? 10,
    connection: {
      search_path: `${opts.schema},public`,
    },
  });

  const db = drizzle(sql);

  return {
    sql,
    db,
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}
