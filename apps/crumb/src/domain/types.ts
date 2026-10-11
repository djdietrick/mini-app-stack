import { z } from "zod";
import {
  type BakeStep,
  type Formula,
  type RecipeStep,
  STEP_KINDS,
} from "../fermentation/index.js";

/**
 * Crumb's wire and config types.
 *
 * Wire rows are snake_case, like every other app in the stack, and both repos
 * produce exactly these keys. Timestamps are ISO 8601 strings, temperatures
 * °F, weights grams. Recipe formulas and steps are stored as-is (JSONB or a
 * Firestore map), so a field added later must be optional or defaulted here.
 */

// ---------- starters ----------

export const LOCATIONS = ["counter", "fridge"] as const;
export const location = z.enum(LOCATIONS);
export type Location = z.infer<typeof location>;

const name = z.string().trim().min(1).max(80);
const notes = z.string().trim().max(2000);
const grams = z.number().min(0).max(100_000);
const tempF = z.number().min(32).max(120);
const iso = z.string().datetime({ offset: true });

export const starterInput = z.object({
  name,
  flour: z.string().trim().max(80).default(""),
  /** Water ÷ flour of its usual feed. */
  hydration: z.number().int().min(40).max(200).default(100),
  location: location.default("counter"),
  /** What stays in the jar after taking what a bake needs. */
  reserveGrams: z.number().int().min(0).max(1000).default(20),
  notes: notes.default(""),
});
export type StarterInput = z.infer<typeof starterInput>;

export const starterPatch = z
  .object({
    name,
    flour: z.string().trim().max(80),
    hydration: z.number().int().min(40).max(200),
    location,
    reserveGrams: z.number().int().min(0).max(1000),
    notes,
  })
  .partial();
export type StarterPatch = z.infer<typeof starterPatch>;

/** A starter as stored. */
export interface StarterRecord {
  id: string;
  name: string;
  flour: string;
  hydration: number;
  location: Location;
  location_since: string;
  reserve_grams: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

/** A starter as served: the record plus what Crumb works out from its feeds. */
export interface StarterRow extends StarterRecord {
  last_fed: FeedingRow | null;
  speed: { factor: number; samples: number };
  /** When the last feed should peak, if it hasn't been logged yet. */
  predicted_peak_at: string | null;
}

// ---------- feedings ----------

export const feedingInput = z.object({
  /** Defaults to now. */
  fedAt: iso.optional(),
  starterG: grams.refine((g) => g > 0, { message: "must be more than 0" }),
  flourG: grams,
  waterG: grams,
  tempF: tempF.nullable().default(null),
  notes: notes.default(""),
  /** Push a reminder when it should be peaking. */
  remindAtPeak: z.boolean().default(false),
});
export type FeedingInput = z.infer<typeof feedingInput>;

export const feedingPatch = z
  .object({
    peakAt: iso.nullable(),
    /** How much it rose at peak, e.g. 100 for doubled. */
    risePct: z.number().int().min(0).max(1000).nullable(),
    tempF: tempF.nullable(),
    notes,
  })
  .partial();
export type FeedingPatch = z.infer<typeof feedingPatch>;

export interface FeedingRow {
  id: string;
  starter_id: string;
  fed_at: string;
  starter_g: number;
  flour_g: number;
  water_g: number;
  temp_f: number | null;
  peak_at: string | null;
  rise_pct: number | null;
  notes: string;
  remind_at_peak: boolean;
  created_at: string;
}

// ---------- recipes ----------

export const RECIPE_KINDS = ["loaf", "sandwich", "focaccia", "pizza", "baguette", "bagel", "other"] as const;
export const recipeKind = z.enum(RECIPE_KINDS);
export type RecipeKind = z.infer<typeof recipeKind>;

const pct = z.number().min(0).max(1000);

export const formula = z
  .object({
    flours: z
      .array(z.object({ name, pct: z.number().min(0).max(100) }))
      .min(1)
      .max(8),
    hydrationPct: z.number().min(30).max(150),
    levainPct: z.number().min(1).max(100),
    levainHydrationPct: z.number().min(40).max(200).default(100),
    saltPct: z.number().min(0).max(5),
    extras: z.array(z.object({ name, pct })).max(12).default([]),
  })
  .refine((f) => Math.abs(f.flours.reduce((n, x) => n + x.pct, 0) - 100) < 0.01, {
    message: "flours must add up to 100%",
    path: ["flours"],
  });

const stepId = z.string().regex(/^[a-z0-9-]{1,40}$/, "lowercase letters, digits and dashes");

export const recipeStep = z
  .object({
    id: stepId,
    kind: z.enum(STEP_KINDS),
    label: name,
    minutes: z.number().int().min(1).max(7 * 24 * 60),
    temp: z.boolean().default(false),
    flex: z
      .object({ min: z.number().int().min(1), max: z.number().int().max(7 * 24 * 60) })
      .refine((f) => f.min <= f.max, { message: "min must not be above max" })
      .nullable()
      .default(null),
    folds: z
      .object({ count: z.number().int().min(1).max(12), every: z.number().int().min(5).max(240) })
      .nullable()
      .default(null),
    note: z.string().trim().max(500).nullable().default(null),
  })
  .refine((s) => !s.flex || (s.minutes >= s.flex.min && s.minutes <= s.flex.max), {
    message: "minutes must be inside the flex range",
    path: ["minutes"],
  })
  .refine((s) => s.kind !== "starter", {
    message: "the revival feed is added by the planner",
    path: ["kind"],
  });

const steps = z
  .array(recipeStep)
  .min(1)
  .max(30)
  .refine((s) => new Set(s.map((x) => x.id)).size === s.length, { message: "step ids must be unique" })
  .refine((s) => s.filter((x) => x.kind === "levain").length <= 1, { message: "at most one levain step" });

export const recipeConfig = z.object({
  formula,
  steps,
  pieces: z.number().int().min(1).max(100),
  pieceGrams: z.number().int().min(20).max(5000),
  /** Oven, pan or shaping notes shown with the recipe. */
  notes: z.string().trim().max(4000).default(""),
});
export type RecipeConfig = z.infer<typeof recipeConfig>;

export const recipeInput = z.object({ name, kind: recipeKind, config: recipeConfig });
export type RecipeInput = z.infer<typeof recipeInput>;

export const recipePatch = recipeInput.partial();
export type RecipePatch = z.infer<typeof recipePatch>;

export interface RecipeRow {
  id: string;
  name: string;
  kind: RecipeKind;
  config: RecipeConfig;
  builtin: boolean;
  created_at: string;
  updated_at: string;
}

// ---------- bakes ----------

export const BAKE_STATUSES = ["active", "done", "cancelled"] as const;
export const bakeStatus = z.enum(BAKE_STATUSES);
export type BakeStatus = z.infer<typeof bakeStatus>;

export const bakeInput = z.object({
  recipeId: z.string().uuid(),
  /** Out of the oven. */
  readyAt: iso,
  pieces: z.number().int().min(1).max(100).optional(),
  pieceGrams: z.number().int().min(20).max(5000).optional(),
  tempF: tempF.default(72),
  starterId: z.string().uuid().nullable().default(null),
  levainRatio: z.number().min(0.5).max(15).default(2),
  /** Minutes for the recipe's flex steps, by step id. */
  flex: z.record(z.number().int().min(1).max(7 * 24 * 60)).default({}),
});
export type BakeInput = z.infer<typeof bakeInput>;

export const bakePatch = z
  .object({
    status: bakeStatus,
    notes,
    rating: z.number().int().min(1).max(5).nullable(),
  })
  .partial();
export type BakePatch = z.infer<typeof bakePatch>;

export interface ScaledLine {
  name: string;
  grams: number;
  pct: number;
}

export interface BakeRow {
  id: string;
  recipe_id: string;
  /** Copied from the recipe when planned; later recipe edits don't change a bake. */
  recipe_name: string;
  kind: RecipeKind;
  starter_id: string | null;
  status: BakeStatus;
  ready_at: string;
  pieces: number;
  piece_grams: number;
  temp_f: number;
  levain: { grams: number; flour: number; water: number };
  mix: ScaledLine[];
  steps: BakeStep[];
  notes: string;
  rating: number | null;
  created_at: string;
  updated_at: string;
}

/** What the repo stores for a new bake; ids and timestamps are the repo's. */
export type NewBake = Omit<BakeRow, "id" | "created_at" | "updated_at">;

// ---------- reminders ----------

/**
 * A notification due at a time. Reminders are derived from state (a bake's
 * plan, a starter's last feed), stored in groups, and each group is replaced
 * whole whenever that state changes. The dispatcher claims due ones and sends
 * them.
 */
export interface ReminderInput {
  /** Unique within the user's reminders. */
  key: string;
  title: string;
  body: string;
  /** Hash route the notification opens, e.g. "#/bakes/<id>". */
  url: string;
  due_at: string;
}

export interface ReminderRow extends ReminderInput {
  id: string;
  group: string;
  sent_at: string | null;
}

/** As claimed by the dispatcher: who to send it to as well. */
export interface DueReminder extends ReminderRow {
  user_id: string;
  /** The user's email when the reminder was made, for the email fallback. */
  email: string;
}

// ---------- push and settings ----------

export const pushSubscriptionInput = z.object({
  endpoint: z.string().url().max(2000).refine((u) => u.startsWith("https://"), { message: "must be https" }),
  keys: z.object({
    p256dh: z.string().min(80).max(200),
    auth: z.string().min(16).max(64),
  }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInput>;

export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
}

export const EMAIL_MODES = ["never", "fallback", "always"] as const;
export const settingsInput = z.object({
  /**
   * `fallback`: email a reminder only when no device has notifications
   * turned on. `always`: email as well. `never`: devices only.
   */
  emailReminders: z.enum(EMAIL_MODES),
});
export type SettingsInput = z.infer<typeof settingsInput>;

export interface SettingsRow {
  email_reminders: (typeof EMAIL_MODES)[number];
}

export const DEFAULT_SETTINGS: SettingsRow = { email_reminders: "fallback" };

export interface VapidKeys {
  /** base64url, uncompressed P-256 point (65 bytes). */
  publicKey: string;
  /** base64url, 32-byte scalar. */
  privateKey: string;
}

// The fermentation module mirrors these without zod; keep them assignable.
type Assert<T extends true> = T;
export type _FormulaMatches = Assert<z.infer<typeof formula> extends Formula ? true : false>;
export type _StepMatches = Assert<z.infer<typeof recipeStep> extends RecipeStep ? true : false>;
