import type { PostgresClient } from "@stack/db-clients";
import type { BakeStep } from "../fermentation/index.js";
import {
  type BakeRow,
  DEFAULT_SETTINGS,
  type DueReminder,
  type FeedingRow,
  type RecipeConfig,
  type RecipeInput,
  type RecipeRow,
  type ReminderRow,
  type SettingsRow,
  type StarterRecord,
} from "../domain/types.js";
import type { CrumbRepo } from "./types.js";

/**
 * Self-hosted implementation. Unqualified table names resolve into the
 * `crumb` schema via search_path.
 *
 * Timestamps come back from the Drizzle-wrapped client as Postgres text
 * ("2026-09-27 16:40:17.324+00") and are converted to ISO 8601 here, so both
 * backends return the same format; going in, they are ISO strings cast with
 * ::timestamptz, never Date objects. Numbers from `real` columns are passed
 * through Number() in case the driver hands back text. JSONB is written as a
 * JSON string and cast.
 */
export function createPostgresCrumbRepo(pg: PostgresClient): CrumbRepo {
  const { sql } = pg;

  // ---------- row mapping ----------

  interface StarterDb extends Omit<StarterRecord, "location_since" | "created_at" | "updated_at"> {
    location_since: string;
    created_at: string;
    updated_at: string;
  }
  const STARTER_COLS = sql`id, name, flour, hydration, location, location_since, reserve_grams, notes, created_at, updated_at`;
  const toStarter = (r: StarterDb): StarterRecord => ({
    id: r.id,
    name: r.name,
    flour: r.flour,
    hydration: r.hydration,
    location: r.location,
    location_since: iso(r.location_since),
    reserve_grams: r.reserve_grams,
    notes: r.notes,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  });

  interface FeedingDb {
    id: string;
    starter_id: string;
    fed_at: string;
    starter_g: number | string;
    flour_g: number | string;
    water_g: number | string;
    temp_f: number | string | null;
    peak_at: string | null;
    rise_pct: number | null;
    notes: string;
    remind_at_peak: boolean;
    created_at: string;
  }
  const FEEDING_COLS = sql`id, starter_id, fed_at, starter_g, flour_g, water_g, temp_f, peak_at, rise_pct, notes, remind_at_peak, created_at`;
  const toFeeding = (r: FeedingDb): FeedingRow => ({
    id: r.id,
    starter_id: r.starter_id,
    fed_at: iso(r.fed_at),
    starter_g: Number(r.starter_g),
    flour_g: Number(r.flour_g),
    water_g: Number(r.water_g),
    temp_f: r.temp_f === null ? null : Number(r.temp_f),
    peak_at: r.peak_at === null ? null : iso(r.peak_at),
    rise_pct: r.rise_pct,
    notes: r.notes,
    remind_at_peak: r.remind_at_peak,
    created_at: iso(r.created_at),
  });

  interface RecipeDb {
    id: string;
    name: string;
    kind: RecipeRow["kind"];
    config: RecipeConfig;
    created_at: string;
    updated_at: string;
  }
  const toRecipe = (r: RecipeDb): RecipeRow => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    config: r.config,
    builtin: false,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  });

  interface BakeDb extends Omit<BakeRow, "ready_at" | "created_at" | "updated_at" | "temp_f"> {
    ready_at: string;
    temp_f: number | string;
    created_at: string;
    updated_at: string;
  }
  const BAKE_COLS = sql`id, recipe_id, recipe_name, kind, starter_id, status, ready_at, pieces, piece_grams,
    temp_f, levain, mix, steps, notes, rating, created_at, updated_at`;
  const toBake = (r: BakeDb): BakeRow => ({
    id: r.id,
    recipe_id: r.recipe_id,
    recipe_name: r.recipe_name,
    kind: r.kind,
    starter_id: r.starter_id,
    status: r.status,
    ready_at: iso(r.ready_at),
    pieces: r.pieces,
    piece_grams: r.piece_grams,
    temp_f: Number(r.temp_f),
    levain: r.levain,
    mix: r.mix,
    steps: r.steps,
    notes: r.notes,
    rating: r.rating,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  });

  interface ReminderDb {
    id: string;
    user_id: string;
    grp: string;
    key: string;
    title: string;
    body: string;
    url: string;
    email: string;
    due_at: string;
    sent_at: string | null;
  }
  const toReminder = (r: ReminderDb): ReminderRow => ({
    id: r.id,
    group: r.grp,
    key: r.key,
    title: r.title,
    body: r.body,
    url: r.url,
    due_at: iso(r.due_at),
    sent_at: r.sent_at === null ? null : iso(r.sent_at),
  });

  const recipeConfigJson = (input: Pick<RecipeInput, "config">) => JSON.stringify(input.config);

  return {
    // ---------- starters ----------

    async listStarters(userId) {
      const rows = await sql<StarterDb[]>`
        SELECT ${STARTER_COLS} FROM starters WHERE user_id = ${userId} ORDER BY created_at, id
      `;
      return rows.map(toStarter);
    },

    async getStarter(userId, id) {
      const rows = await sql<StarterDb[]>`
        SELECT ${STARTER_COLS} FROM starters WHERE id = ${id} AND user_id = ${userId}
      `;
      return rows[0] ? toStarter(rows[0]) : null;
    },

    async createStarter(userId, input) {
      const [row] = await sql<StarterDb[]>`
        INSERT INTO starters (user_id, name, flour, hydration, location, reserve_grams, notes)
        VALUES (${userId}, ${input.name}, ${input.flour}, ${input.hydration}, ${input.location},
                ${input.reserveGrams}, ${input.notes})
        RETURNING ${STARTER_COLS}
      `;
      return toStarter(row);
    },

    async updateStarter(userId, id, patch) {
      const rows = await sql<StarterDb[]>`
        UPDATE starters SET
          name           = COALESCE(${patch.name ?? null}, name),
          flour          = COALESCE(${patch.flour ?? null}, flour),
          hydration      = COALESCE(${patch.hydration ?? null}, hydration),
          location_since = CASE WHEN ${patch.location ?? null}::text IS NOT NULL
                                 AND ${patch.location ?? null}::text <> location
                            THEN now() ELSE location_since END,
          location       = COALESCE(${patch.location ?? null}, location),
          reserve_grams  = COALESCE(${patch.reserveGrams ?? null}, reserve_grams),
          notes          = COALESCE(${patch.notes ?? null}, notes),
          updated_at     = now()
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING ${STARTER_COLS}
      `;
      return rows[0] ? toStarter(rows[0]) : null;
    },

    async deleteStarter(userId, id) {
      const rows = await sql`DELETE FROM starters WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
      return rows.length > 0;
    },

    // ---------- feedings ----------

    async listFeedings(userId, starterId, limit) {
      const rows = await sql<FeedingDb[]>`
        SELECT ${FEEDING_COLS} FROM feedings
        WHERE starter_id = ${starterId} AND user_id = ${userId}
        ORDER BY fed_at DESC, created_at DESC
        LIMIT ${limit}
      `;
      return rows.map(toFeeding);
    },

    async getFeeding(userId, id) {
      const rows = await sql<FeedingDb[]>`
        SELECT ${FEEDING_COLS} FROM feedings WHERE id = ${id} AND user_id = ${userId}
      `;
      return rows[0] ? toFeeding(rows[0]) : null;
    },

    async createFeeding(userId, starterId, input) {
      const [row] = await sql<FeedingDb[]>`
        INSERT INTO feedings (user_id, starter_id, fed_at, starter_g, flour_g, water_g, temp_f, notes, remind_at_peak)
        VALUES (${userId}, ${starterId}, ${input.fedAt}::timestamptz, ${input.starterG}, ${input.flourG},
                ${input.waterG}, ${input.tempF}, ${input.notes}, ${input.remindAtPeak})
        RETURNING ${FEEDING_COLS}
      `;
      return toFeeding(row);
    },

    async updateFeeding(userId, id, patch) {
      // `undefined` leaves a column alone; `null` clears it.
      const has = (k: keyof typeof patch) => patch[k] !== undefined;
      const rows = await sql<FeedingDb[]>`
        UPDATE feedings SET
          peak_at  = CASE WHEN ${has("peakAt")} THEN ${patch.peakAt ?? null}::timestamptz ELSE peak_at END,
          rise_pct = CASE WHEN ${has("risePct")} THEN ${patch.risePct ?? null}::int ELSE rise_pct END,
          temp_f   = CASE WHEN ${has("tempF")} THEN ${patch.tempF ?? null}::real ELSE temp_f END,
          notes    = COALESCE(${patch.notes ?? null}, notes)
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING ${FEEDING_COLS}
      `;
      return rows[0] ? toFeeding(rows[0]) : null;
    },

    async deleteFeeding(userId, id) {
      const rows = await sql`DELETE FROM feedings WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
      return rows.length > 0;
    },

    // ---------- recipes ----------

    async listRecipes(userId) {
      const rows = await sql<RecipeDb[]>`
        SELECT id, name, kind, config, created_at, updated_at
        FROM recipes WHERE user_id = ${userId}
        ORDER BY created_at DESC
      `;
      return rows.map(toRecipe);
    },

    async getRecipe(userId, id) {
      const rows = await sql<RecipeDb[]>`
        SELECT id, name, kind, config, created_at, updated_at
        FROM recipes WHERE id = ${id} AND user_id = ${userId}
      `;
      return rows[0] ? toRecipe(rows[0]) : null;
    },

    async createRecipe(userId, input) {
      const [row] = await sql<RecipeDb[]>`
        INSERT INTO recipes (user_id, name, kind, config)
        VALUES (${userId}, ${input.name}, ${input.kind}, ${recipeConfigJson(input)}::jsonb)
        RETURNING id, name, kind, config, created_at, updated_at
      `;
      return toRecipe(row);
    },

    async updateRecipe(userId, id, patch) {
      const rows = await sql<RecipeDb[]>`
        UPDATE recipes SET
          name       = COALESCE(${patch.name ?? null}, name),
          kind       = COALESCE(${patch.kind ?? null}, kind),
          config     = COALESCE(${patch.config ? JSON.stringify(patch.config) : null}::jsonb, config),
          updated_at = now()
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING id, name, kind, config, created_at, updated_at
      `;
      return rows[0] ? toRecipe(rows[0]) : null;
    },

    async deleteRecipe(userId, id) {
      const rows = await sql`DELETE FROM recipes WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
      return rows.length > 0;
    },

    // ---------- bakes ----------

    async listBakes(userId, limit) {
      const rows = await sql<BakeDb[]>`
        SELECT ${BAKE_COLS} FROM bakes WHERE user_id = ${userId}
        ORDER BY created_at DESC, id
        LIMIT ${limit}
      `;
      return rows.map(toBake);
    },

    async getBake(userId, id) {
      const rows = await sql<BakeDb[]>`SELECT ${BAKE_COLS} FROM bakes WHERE id = ${id} AND user_id = ${userId}`;
      return rows[0] ? toBake(rows[0]) : null;
    },

    async createBake(userId, b) {
      const [row] = await sql<BakeDb[]>`
        INSERT INTO bakes (user_id, recipe_id, recipe_name, kind, starter_id, status, ready_at, pieces,
                           piece_grams, temp_f, levain, mix, steps, notes, rating)
        VALUES (${userId}, ${b.recipe_id}, ${b.recipe_name}, ${b.kind}, ${b.starter_id}, ${b.status},
                ${b.ready_at}::timestamptz, ${b.pieces}, ${b.piece_grams}, ${b.temp_f},
                ${JSON.stringify(b.levain)}::jsonb, ${JSON.stringify(b.mix)}::jsonb,
                ${JSON.stringify(b.steps)}::jsonb, ${b.notes}, ${b.rating})
        RETURNING ${BAKE_COLS}
      `;
      return toBake(row);
    },

    async updateBake(userId, id, change) {
      return sql.begin(async (tx) => {
        const rows = await tx<BakeDb[]>`
          SELECT ${BAKE_COLS} FROM bakes WHERE id = ${id} AND user_id = ${userId} FOR UPDATE
        `;
        if (!rows[0]) return null;
        const current = toBake(rows[0]);
        const c = change(current);
        if (!c) return current;
        const next = { ...current, ...c };
        const [row] = await tx<BakeDb[]>`
          UPDATE bakes SET
            status     = ${next.status},
            notes      = ${next.notes},
            rating     = ${next.rating},
            ready_at   = ${next.ready_at}::timestamptz,
            steps      = ${JSON.stringify(next.steps satisfies BakeStep[])}::jsonb,
            updated_at = now()
          WHERE id = ${id}
          RETURNING ${BAKE_COLS}
        `;
        return toBake(row);
      });
    },

    async deleteBake(userId, id) {
      const rows = await sql`DELETE FROM bakes WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
      return rows.length > 0;
    },

    // ---------- reminders ----------

    async replaceReminders(userId, email, group, reminders) {
      await sql.begin(async (tx) => {
        await tx`DELETE FROM reminders WHERE user_id = ${userId} AND grp = ${group}`;
        if (reminders.length === 0) return;
        const rows = reminders.map((r) => ({
          user_id: userId,
          grp: group,
          key: r.key,
          title: r.title,
          body: r.body,
          url: r.url,
          email,
          due_at: r.due_at,
        }));
        await tx`
          INSERT INTO reminders ${tx(rows, "user_id", "grp", "key", "title", "body", "url", "email", "due_at")}
          ON CONFLICT (user_id, key) DO UPDATE SET
            grp = EXCLUDED.grp, title = EXCLUDED.title, body = EXCLUDED.body, url = EXCLUDED.url,
            email = EXCLUDED.email, due_at = EXCLUDED.due_at, sent_at = NULL
        `;
      });
    },

    async listReminders(userId) {
      const rows = await sql<ReminderDb[]>`
        SELECT id, user_id, grp, key, title, body, url, email, due_at, sent_at
        FROM reminders WHERE user_id = ${userId} AND sent_at IS NULL
        ORDER BY due_at, key
      `;
      return rows.map(toReminder);
    },

    async claimDueReminders(now, limit) {
      // SKIP LOCKED: a second dispatcher running at the same moment takes
      // different rows instead of waiting for, then re-sending, these.
      const rows = await sql<ReminderDb[]>`
        UPDATE reminders SET sent_at = ${now.toISOString()}::timestamptz
        WHERE id IN (
          SELECT id FROM reminders
          WHERE sent_at IS NULL AND due_at <= ${now.toISOString()}::timestamptz
          ORDER BY due_at
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, user_id, grp, key, title, body, url, email, due_at, sent_at
      `;
      return rows
        .map((r): DueReminder => ({ ...toReminder(r), user_id: r.user_id, email: r.email }))
        .sort((a, b) => a.due_at.localeCompare(b.due_at));
    },

    // ---------- push ----------

    async vapidKeys(generate) {
      const existing = await sql<{ public_key: string; private_key: string }[]>`
        SELECT public_key, private_key FROM vapid_keys WHERE id = 1
      `;
      if (!existing[0]) {
        const keys = generate();
        // Two processes racing here both generate; the first insert wins and
        // both read it back.
        await sql`
          INSERT INTO vapid_keys (id, public_key, private_key)
          VALUES (1, ${keys.publicKey}, ${keys.privateKey})
          ON CONFLICT (id) DO NOTHING
        `;
      }
      const [row] = await sql<{ public_key: string; private_key: string }[]>`
        SELECT public_key, private_key FROM vapid_keys WHERE id = 1
      `;
      return { publicKey: row.public_key, privateKey: row.private_key };
    },

    async savePushSubscription(userId, s) {
      const [row] = await sql<{ id: string; endpoint: string; p256dh: string; auth: string; created_at: string }[]>`
        INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
        VALUES (${userId}, ${s.endpoint}, ${s.keys.p256dh}, ${s.keys.auth})
        ON CONFLICT (endpoint) DO UPDATE SET
          user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
        RETURNING id, endpoint, p256dh, auth, created_at
      `;
      return { ...row, created_at: iso(row.created_at) };
    },

    async deletePushSubscription(userId, endpoint) {
      const rows = await sql`
        DELETE FROM push_subscriptions WHERE endpoint = ${endpoint} AND user_id = ${userId} RETURNING id
      `;
      return rows.length > 0;
    },

    async listPushSubscriptions(userId) {
      const rows = await sql<{ id: string; endpoint: string; p256dh: string; auth: string; created_at: string }[]>`
        SELECT id, endpoint, p256dh, auth, created_at FROM push_subscriptions
        WHERE user_id = ${userId}
        ORDER BY created_at
      `;
      return rows.map((r) => ({ ...r, created_at: iso(r.created_at) }));
    },

    async forgetPushSubscription(endpoint) {
      await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`;
    },

    // ---------- settings ----------

    async getSettings(userId) {
      const rows = await sql<SettingsRow[]>`SELECT email_reminders FROM user_settings WHERE user_id = ${userId}`;
      return rows[0] ? { email_reminders: rows[0].email_reminders } : { ...DEFAULT_SETTINGS };
    },

    async saveSettings(userId, input) {
      const [row] = await sql<SettingsRow[]>`
        INSERT INTO user_settings (user_id, email_reminders)
        VALUES (${userId}, ${input.emailReminders})
        ON CONFLICT (user_id) DO UPDATE SET email_reminders = EXCLUDED.email_reminders, updated_at = now()
        RETURNING email_reminders
      `;
      return { email_reminders: row.email_reminders };
    },

    close: () => pg.close(),
  };
}

function iso(ts: string | Date): string {
  return new Date(ts).toISOString();
}
