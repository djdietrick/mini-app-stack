/**
 * Thin client for /api. The wire types come straight from the server's domain
 * module (type-only, so nothing server-side lands in the bundle), which keeps
 * the SPA and both backends on one definition.
 */
import type {
  BakeInput,
  BakePatch,
  BakeRow,
  FeedingInput,
  FeedingPatch,
  FeedingRow,
  RecipeConfig,
  RecipeInput,
  RecipeKind,
  RecipePatch,
  RecipeRow,
  ReminderRow,
  StarterInput,
  StarterPatch,
  StarterRow,
} from "../../src/domain/types.js";

export type {
  BakeInput,
  BakeRow,
  FeedingRow,
  RecipeConfig,
  RecipeInput,
  RecipeKind,
  RecipeRow,
  ReminderRow,
  StarterRow,
};

/** Inputs as the client sends them: zod defaults are optional on the wire. */
type In<T> = Partial<T>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(typeof body === "object" && body && "error" in body ? describe((body as { error: unknown }).error) : `HTTP ${status}`);
  }
}

/** What the server's error codes mean to a baker. */
const MESSAGES: Record<string, string> = {
  PEAK_BEFORE_FEED: "The peak has to be after the feed.",
  BAKE_NOT_ACTIVE: "This bake is finished or cancelled, so its plan can't change.",
  BUILTIN_READ_ONLY: "Built-in recipes can't be changed. Copy it to make your own.",
  PUSH_DISABLED: "Notifications are turned off on the server.",
  "not signed in": "You've been signed out. Reload to sign in again.",
};

/** A 400's flattened zod error as one readable line, or the error code. */
function describe(error: unknown): string {
  if (typeof error === "string") return MESSAGES[error] ?? error;
  if (error && typeof error === "object") {
    const e = error as { formErrors?: string[]; fieldErrors?: Record<string, string[]> };
    const parts = [
      ...(e.formErrors ?? []),
      ...Object.entries(e.fieldErrors ?? {}).map(([k, v]) => `${k}: ${v.join(", ")}`),
    ];
    if (parts.length) return parts.join("; ");
  }
  return "Something went wrong";
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, json);
  return json as T;
}

export const api = {
  listStarters: () => call<StarterRow[]>("GET", "/starters"),
  getStarter: (id: string) => call<StarterRow>("GET", `/starters/${id}`),
  createStarter: (input: In<StarterInput> & { name: string }) => call<StarterRow>("POST", "/starters", input),
  updateStarter: (id: string, patch: StarterPatch) => call<StarterRow>("PATCH", `/starters/${id}`, patch),
  deleteStarter: (id: string) => call<{ ok: true }>("DELETE", `/starters/${id}`),

  listFeedings: (starterId: string, limit = 30) =>
    call<FeedingRow[]>("GET", `/starters/${starterId}/feedings?limit=${limit}`),
  logFeeding: (starterId: string, input: In<FeedingInput> & Pick<FeedingInput, "starterG" | "flourG" | "waterG">) =>
    call<FeedingRow>("POST", `/starters/${starterId}/feedings`, input),
  updateFeeding: (id: string, patch: FeedingPatch) => call<FeedingRow>("PATCH", `/feedings/${id}`, patch),
  deleteFeeding: (id: string) => call<{ ok: true }>("DELETE", `/feedings/${id}`),

  listRecipes: () => call<RecipeRow[]>("GET", "/recipes"),
  getRecipe: (id: string) => call<RecipeRow>("GET", `/recipes/${id}`),
  createRecipe: (input: RecipeInput) => call<RecipeRow>("POST", "/recipes", input),
  updateRecipe: (id: string, patch: RecipePatch) => call<RecipeRow>("PATCH", `/recipes/${id}`, patch),
  deleteRecipe: (id: string) => call<{ ok: true }>("DELETE", `/recipes/${id}`),

  listBakes: () => call<BakeRow[]>("GET", "/bakes"),
  getBake: (id: string) => call<BakeRow>("GET", `/bakes/${id}`),
  planBake: (input: In<BakeInput> & Pick<BakeInput, "recipeId" | "readyAt">) => call<BakeRow>("POST", "/bakes", input),
  updateBake: (id: string, patch: BakePatch) => call<BakeRow>("PATCH", `/bakes/${id}`, patch),
  deleteBake: (id: string) => call<{ ok: true }>("DELETE", `/bakes/${id}`),
  stepDone: (id: string, stepId: string) => call<BakeRow>("POST", `/bakes/${id}/steps/${stepId}/done`, {}),
  logFold: (id: string, stepId: string) => call<BakeRow>("POST", `/bakes/${id}/steps/${stepId}/fold`, {}),
  shiftBake: (id: string, minutes: number) => call<BakeRow>("POST", `/bakes/${id}/shift`, { minutes }),

  listReminders: () => call<ReminderRow[]>("GET", "/reminders"),

  pushKey: () => call<{ publicKey: string | null }>("GET", "/push/key"),
  subscribe: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    call<{ id: string }>("POST", "/push/subscriptions", sub),
  unsubscribe: (endpoint: string) => call<{ ok: boolean }>("POST", "/push/unsubscribe", { endpoint }),
  testPush: () => call<{ sent: number }>("POST", "/push/test"),
};
