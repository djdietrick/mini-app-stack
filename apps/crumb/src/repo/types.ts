import type { Closable } from "@stack/service-kit";
import type {
  BakeRow,
  DueReminder,
  FeedingInput,
  FeedingPatch,
  FeedingRow,
  NewBake,
  PushSubscriptionInput,
  PushSubscriptionRow,
  RecipeInput,
  RecipePatch,
  RecipeRow,
  ReminderInput,
  ReminderRow,
  SettingsInput,
  SettingsRow,
  StarterInput,
  StarterPatch,
  StarterRecord,
  VapidKeys,
} from "../domain/types.js";

/** The fields a bake update may change. */
export type BakeChanges = Partial<Pick<BakeRow, "status" | "notes" | "rating" | "steps" | "ready_at">>;

/**
 * Crumb's data port. Implemented by postgres.ts (self-hosted) and
 * firestore.ts (cloud); src/domain depends only on this.
 *
 * Every per-user method takes userId so ownership is enforced in the query
 * itself; someone else's row is "not found". Mutations report "did it match"
 * (null / false) and the route decides the 404. Built-in recipes live in
 * domain/catalog.ts and never reach the repo.
 */
export interface CrumbRepo extends Closable {
  // ---------- starters ----------

  /** Oldest first, so a baker's first starter stays first. */
  listStarters(userId: string): Promise<StarterRecord[]>;
  getStarter(userId: string, id: string): Promise<StarterRecord | null>;
  createStarter(userId: string, input: StarterInput): Promise<StarterRecord>;
  /** A change of location also restarts `location_since`. */
  updateStarter(userId: string, id: string, patch: StarterPatch): Promise<StarterRecord | null>;
  /** Also deletes its feedings. */
  deleteStarter(userId: string, id: string): Promise<boolean>;

  // ---------- feedings ----------

  /** Newest first by fed_at. */
  listFeedings(userId: string, starterId: string, limit: number): Promise<FeedingRow[]>;
  getFeeding(userId: string, id: string): Promise<FeedingRow | null>;
  createFeeding(
    userId: string,
    starterId: string,
    input: Omit<FeedingInput, "fedAt"> & { fedAt: string },
  ): Promise<FeedingRow>;
  updateFeeding(userId: string, id: string, patch: FeedingPatch): Promise<FeedingRow | null>;
  deleteFeeding(userId: string, id: string): Promise<boolean>;

  // ---------- recipes (the user's own) ----------

  /** Newest first. */
  listRecipes(userId: string): Promise<RecipeRow[]>;
  getRecipe(userId: string, id: string): Promise<RecipeRow | null>;
  createRecipe(userId: string, input: RecipeInput): Promise<RecipeRow>;
  updateRecipe(userId: string, id: string, patch: RecipePatch): Promise<RecipeRow | null>;
  deleteRecipe(userId: string, id: string): Promise<boolean>;

  // ---------- bakes ----------

  /** Newest first by created_at. */
  listBakes(userId: string, limit: number): Promise<BakeRow[]>;
  getBake(userId: string, id: string): Promise<BakeRow | null>;
  createBake(userId: string, bake: NewBake): Promise<BakeRow>;
  /**
   * Reads the bake and writes back what `change` returns, in one transaction
   * (null leaves it as it is). `change` may run more than once on Firestore,
   * so it must be pure.
   */
  updateBake(userId: string, id: string, change: (bake: BakeRow) => BakeChanges | null): Promise<BakeRow | null>;
  deleteBake(userId: string, id: string): Promise<boolean>;

  // ---------- reminders ----------

  /**
   * Replaces every reminder in `group` (sent or not) with `reminders`, in one
   * transaction. An empty list clears the group. `email` is where the email
   * fallback will go.
   */
  replaceReminders(userId: string, email: string, group: string, reminders: ReminderInput[]): Promise<void>;
  /** Not yet sent, soonest first. */
  listReminders(userId: string): Promise<ReminderRow[]>;
  /**
   * Marks up to `limit` unsent reminders due at or before `now` as sent and
   * returns them, atomically, so two dispatchers never both send one.
   */
  claimDueReminders(now: Date, limit: number): Promise<DueReminder[]>;

  // ---------- push ----------

  /**
   * The app's VAPID key pair, created with `generate` the first time and
   * stable after that: every push subscription is tied to the public key.
   */
  vapidKeys(generate: () => VapidKeys): Promise<VapidKeys>;
  /** By endpoint: a device re-subscribing replaces its old row, whoever owned it. */
  savePushSubscription(userId: string, sub: PushSubscriptionInput): Promise<PushSubscriptionRow>;
  deletePushSubscription(userId: string, endpoint: string): Promise<boolean>;
  listPushSubscriptions(userId: string): Promise<PushSubscriptionRow[]>;
  /** For the dispatcher, when the push service says a subscription is gone. */
  forgetPushSubscription(endpoint: string): Promise<void>;

  // ---------- settings ----------

  /** DEFAULT_SETTINGS until saved. */
  getSettings(userId: string): Promise<SettingsRow>;
  saveSettings(userId: string, input: SettingsInput): Promise<SettingsRow>;
}
