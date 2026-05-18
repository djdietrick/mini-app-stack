import { randomBytes, createHash } from "node:crypto";
import type { PostgresClient } from "@stack/db-clients";

export interface SessionUser {
  userId: string;
  email: string;
  displayName: string | null;
}

export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

export function generateToken(): string {
  // URL-safe, no padding. 32 bytes = 256 bits of entropy.
  return randomBytes(32).toString("base64url");
}

export async function createSession(
  pg: PostgresClient,
  userId: string,
  ttlSeconds: number,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await pg.sql`
    INSERT INTO shared.sessions (user_id, token_hash, expires_at)
    VALUES (${userId}, ${tokenHash}, ${expiresAt.toISOString()})
  `;

  return { token, expiresAt };
}

export async function lookupSession(
  pg: PostgresClient,
  token: string,
): Promise<SessionUser | null> {
  const tokenHash = hashToken(token);
  const rows = await pg.sql<
    { user_id: string; email: string; display_name: string | null; expires_at: Date | string }[]
  >`
    SELECT s.user_id, s.expires_at, u.email, u.display_name
    FROM shared.sessions s
    JOIN shared.users u ON u.id = s.user_id
    WHERE s.token_hash = ${tokenHash}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  const expiresMs =
    row.expires_at instanceof Date ? row.expires_at.getTime() : new Date(row.expires_at).getTime();
  if (expiresMs < Date.now()) {
    // Best-effort cleanup; ignore failure.
    await pg.sql`DELETE FROM shared.sessions WHERE token_hash = ${tokenHash}`.catch(() => {});
    return null;
  }
  // Sliding refresh: bump last_seen_at so we can prune idle sessions later.
  await pg.sql`
    UPDATE shared.sessions SET last_seen_at = now() WHERE token_hash = ${tokenHash}
  `.catch(() => {});
  return { userId: row.user_id, email: row.email, displayName: row.display_name };
}

export async function deleteSession(pg: PostgresClient, token: string): Promise<void> {
  const tokenHash = hashToken(token);
  await pg.sql`DELETE FROM shared.sessions WHERE token_hash = ${tokenHash}`;
}
