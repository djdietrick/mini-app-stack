import type { PostgresClient } from "@stack/db-clients";

/**
 * Finds or creates the user for a Google-verified email. Accounts are shared
 * by email, so someone who signed up with a password and later uses Google
 * lands in the same account with the same data.
 *
 * If that password account's email was never verified, its password and
 * sessions are dropped. Otherwise anyone could pre-register a victim's address
 * and keep a working password after the real owner arrives through Google.
 * This matches what Firebase Auth does in the cloud when Google takes over an
 * unverified email/password account.
 */
export async function upsertGoogleUser(
  pg: PostgresClient,
  email: string,
  name: string | null,
): Promise<{ id: string }> {
  return pg.sql.begin(async (tx) => {
    const [existing] = await tx<{ id: string; email_verified_at: string | null }[]>`
      SELECT id, email_verified_at FROM shared.users WHERE email = ${email} FOR UPDATE
    `;
    if (existing) {
      if (existing.email_verified_at === null) {
        await tx`DELETE FROM shared.user_credentials WHERE user_id = ${existing.id}`;
        await tx`DELETE FROM shared.sessions WHERE user_id = ${existing.id}`;
        await tx`UPDATE shared.users SET email_verified_at = now() WHERE id = ${existing.id}`;
      }
      return { id: existing.id };
    }
    // ON CONFLICT covers a concurrent first sign-in for the same address.
    const [created] = await tx<{ id: string }[]>`
      INSERT INTO shared.users (email, display_name, email_verified_at)
      VALUES (${email}, ${name}, now())
      ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
      RETURNING id
    `;
    return { id: created.id };
  });
}
