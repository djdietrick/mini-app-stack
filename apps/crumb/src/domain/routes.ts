import {
  type AnyRoute,
  type Ctx,
  badRequest,
  conflict,
  createRouteBuilder,
  forbidden,
  notFound,
} from "@stack/service-kit";
import { z } from "zod";
import { completeStep, currentStep, logFold, shiftRemaining } from "../fermentation/index.js";
import type { BakeChanges, CrumbRepo } from "../repo/types.js";
import { bakeGroup, bakeReminders, planNewBake } from "./bakes.js";
import { BUILTIN_RECIPES, builtinRecipe } from "./catalog.js";
import { type PushService, sendTestPush } from "./reminders.js";
import { SPEED_WINDOW, starterGroup, starterReminders, summarizeStarter } from "./starters.js";
import {
  type BakeRow,
  type StarterRow,
  bakeInput,
  bakePatch,
  feedingInput,
  feedingPatch,
  pushSubscriptionInput,
  recipeInput,
  recipePatch,
  starterInput,
  starterPatch,
} from "./types.js";

/**
 * Every Crumb endpoint, transport-free. The same table is served by Fastify
 * self-hosted and by an Express-backed Firebase Function in the cloud.
 *
 * Reminders are derived state: whenever a starter's feeds or a bake's plan
 * change, the route recomputes that starter's or bake's reminders and
 * replaces its group (domain/starters.ts, domain/bakes.ts). The dispatcher
 * (domain/reminders.ts) sends them when they come due.
 */
const route = createRouteBuilder<CrumbRepo>();
type C = Ctx<CrumbRepo>;

export interface CrumbRouteDeps {
  /** Null turns notifications off: no key is served and nothing is sent. */
  push: PushService | null;
  /** Injectable clock for tests. */
  now?: () => Date;
}

const idParam = z.object({ id: z.string().uuid() });

async function loadStarter(ctx: C, id: string): Promise<StarterRow | null> {
  const record = await ctx.repo.getStarter(ctx.user.userId, id);
  if (!record) return null;
  return summarizeStarter(record, await ctx.repo.listFeedings(ctx.user.userId, id, SPEED_WINDOW));
}

export function crumbRoutes(deps: CrumbRouteDeps): AnyRoute<CrumbRepo>[] {
  const now = deps.now ?? (() => new Date());

  /** Recomputes a starter's reminders from its current state. */
  async function syncStarter(ctx: C, starter: StarterRow): Promise<void> {
    await ctx.repo.replaceReminders(ctx.user.userId, starterGroup(starter.id), starterReminders(starter, now()));
  }

  async function syncBake(ctx: C, bake: BakeRow): Promise<void> {
    await ctx.repo.replaceReminders(ctx.user.userId, bakeGroup(bake.id), bakeReminders(bake, now()));
  }

  async function starterOr404(ctx: C, id: string): Promise<StarterRow> {
    const s = await loadStarter(ctx, id);
    if (!s) throw notFound();
    return s;
  }

  /** Applies a change to an active bake's steps, then re-syncs its reminders. */
  async function changeSteps(ctx: C, id: string, change: (bake: BakeRow) => BakeRow["steps"]): Promise<BakeRow> {
    let inactive = false;
    const updated = await ctx.repo.updateBake(ctx.user.userId, id, (bake): BakeChanges | null => {
      inactive = bake.status !== "active";
      if (inactive) return null;
      const steps = change(bake);
      return {
        steps,
        ready_at: steps.at(-1)!.end_at,
        status: currentStep(steps) ? "active" : "done",
      };
    });
    if (!updated) throw notFound();
    if (inactive) throw conflict("BAKE_NOT_ACTIVE");
    await syncBake(ctx, updated);
    return updated;
  }

  const stepParams = z.object({ id: z.string().uuid(), stepId: z.string().min(1).max(40) });
  const atBody = z.object({ at: z.string().datetime({ offset: true }).optional() }).default({});

  return [
    route({
      method: "GET",
      path: "/health",
      public: true,
      handler: async () => ({ ok: true }),
    }),

    // ---------- starters ----------

    route({
      method: "GET",
      path: "/starters",
      handler: async (ctx) => {
        const records = await ctx.repo.listStarters(ctx.user.userId);
        return Promise.all(
          records.map(async (s) =>
            summarizeStarter(s, await ctx.repo.listFeedings(ctx.user.userId, s.id, SPEED_WINDOW)),
          ),
        );
      },
    }),

    route({
      method: "GET",
      path: "/starters/:id",
      input: { params: idParam },
      handler: async (ctx, { params }) => starterOr404(ctx, params.id),
    }),

    route({
      method: "POST",
      path: "/starters",
      input: { body: starterInput },
      status: () => 201,
      handler: async (ctx, { body }) => {
        const record = await ctx.repo.createStarter(ctx.user.userId, body);
        const starter = summarizeStarter(record, []);
        await syncStarter(ctx, starter);
        return starter;
      },
    }),

    route({
      method: "PATCH",
      path: "/starters/:id",
      input: { params: idParam, body: starterPatch },
      handler: async (ctx, { params, body }) => {
        const record = await ctx.repo.updateStarter(ctx.user.userId, params.id, body);
        if (!record) throw notFound();
        const starter = summarizeStarter(record, await ctx.repo.listFeedings(ctx.user.userId, params.id, SPEED_WINDOW));
        await syncStarter(ctx, starter);
        return starter;
      },
    }),

    route({
      method: "DELETE",
      path: "/starters/:id",
      input: { params: idParam },
      handler: async (ctx, { params }) => {
        if (!(await ctx.repo.deleteStarter(ctx.user.userId, params.id))) throw notFound();
        await ctx.repo.replaceReminders(ctx.user.userId, starterGroup(params.id), []);
        return { ok: true };
      },
    }),

    // ---------- feedings ----------

    route({
      method: "GET",
      path: "/starters/:id/feedings",
      input: {
        params: idParam,
        query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(30) }),
      },
      handler: async (ctx, { params, query }) => {
        if (!(await ctx.repo.getStarter(ctx.user.userId, params.id))) throw notFound();
        return ctx.repo.listFeedings(ctx.user.userId, params.id, query.limit);
      },
    }),

    route({
      method: "POST",
      path: "/starters/:id/feedings",
      input: { params: idParam, body: feedingInput },
      status: () => 201,
      handler: async (ctx, { params, body }) => {
        if (!(await ctx.repo.getStarter(ctx.user.userId, params.id))) throw notFound();
        const fedAt = body.fedAt ?? now().toISOString();
        const feeding = await ctx.repo.createFeeding(ctx.user.userId, params.id, { ...body, fedAt });
        await syncStarter(ctx, await starterOr404(ctx, params.id));
        return feeding;
      },
    }),

    route({
      method: "PATCH",
      path: "/feedings/:id",
      input: { params: idParam, body: feedingPatch },
      handler: async (ctx, { params, body }) => {
        const before = await ctx.repo.getFeeding(ctx.user.userId, params.id);
        if (!before) throw notFound();
        if (body.peakAt && Date.parse(body.peakAt) <= Date.parse(before.fed_at)) {
          throw badRequest("PEAK_BEFORE_FEED");
        }
        const feeding = await ctx.repo.updateFeeding(ctx.user.userId, params.id, body);
        if (!feeding) throw notFound();
        const starter = await loadStarter(ctx, feeding.starter_id);
        if (starter) await syncStarter(ctx, starter);
        return feeding;
      },
    }),

    route({
      method: "DELETE",
      path: "/feedings/:id",
      input: { params: idParam },
      handler: async (ctx, { params }) => {
        const feeding = await ctx.repo.getFeeding(ctx.user.userId, params.id);
        if (!feeding || !(await ctx.repo.deleteFeeding(ctx.user.userId, params.id))) throw notFound();
        const starter = await loadStarter(ctx, feeding.starter_id);
        if (starter) await syncStarter(ctx, starter);
        return { ok: true };
      },
    }),

    // ---------- recipes ----------

    route({
      method: "GET",
      path: "/recipes",
      // Built-ins first, in catalog order, then the user's own, newest first.
      handler: async (ctx) => [...BUILTIN_RECIPES, ...(await ctx.repo.listRecipes(ctx.user.userId))],
    }),

    route({
      method: "GET",
      path: "/recipes/:id",
      input: { params: idParam },
      handler: async (ctx, { params }) => {
        const found = builtinRecipe(params.id) ?? (await ctx.repo.getRecipe(ctx.user.userId, params.id));
        if (!found) throw notFound();
        return found;
      },
    }),

    route({
      method: "POST",
      path: "/recipes",
      input: { body: recipeInput },
      status: () => 201,
      handler: async (ctx, { body }) => ctx.repo.createRecipe(ctx.user.userId, body),
    }),

    route({
      method: "PATCH",
      path: "/recipes/:id",
      input: { params: idParam, body: recipePatch },
      handler: async (ctx, { params, body }) => {
        if (builtinRecipe(params.id)) throw forbidden("BUILTIN_READ_ONLY");
        const updated = await ctx.repo.updateRecipe(ctx.user.userId, params.id, body);
        if (!updated) throw notFound();
        return updated;
      },
    }),

    route({
      method: "DELETE",
      path: "/recipes/:id",
      input: { params: idParam },
      handler: async (ctx, { params }) => {
        if (builtinRecipe(params.id)) throw forbidden("BUILTIN_READ_ONLY");
        if (!(await ctx.repo.deleteRecipe(ctx.user.userId, params.id))) throw notFound();
        return { ok: true };
      },
    }),

    // ---------- bakes ----------

    route({
      method: "GET",
      path: "/bakes",
      input: { query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }) },
      handler: async (ctx, { query }) => ctx.repo.listBakes(ctx.user.userId, query.limit),
    }),

    route({
      method: "GET",
      path: "/bakes/:id",
      input: { params: idParam },
      handler: async (ctx, { params }) => {
        const bake = await ctx.repo.getBake(ctx.user.userId, params.id);
        if (!bake) throw notFound();
        return bake;
      },
    }),

    route({
      method: "POST",
      path: "/bakes",
      input: { body: bakeInput },
      status: () => 201,
      handler: async (ctx, { body }) => {
        const recipe = builtinRecipe(body.recipeId) ?? (await ctx.repo.getRecipe(ctx.user.userId, body.recipeId));
        if (!recipe) throw notFound("recipe not found");
        let starter: StarterRow | null = null;
        if (body.starterId) {
          starter = await loadStarter(ctx, body.starterId);
          if (!starter) throw notFound("starter not found");
        }
        const bake = await ctx.repo.createBake(ctx.user.userId, planNewBake(recipe, body, starter));
        await syncBake(ctx, bake);
        return bake;
      },
    }),

    route({
      method: "PATCH",
      path: "/bakes/:id",
      input: { params: idParam, body: bakePatch },
      handler: async (ctx, { params, body }) => {
        const updated = await ctx.repo.updateBake(ctx.user.userId, params.id, () => body);
        if (!updated) throw notFound();
        await syncBake(ctx, updated);
        return updated;
      },
    }),

    route({
      method: "DELETE",
      path: "/bakes/:id",
      input: { params: idParam },
      handler: async (ctx, { params }) => {
        if (!(await ctx.repo.deleteBake(ctx.user.userId, params.id))) throw notFound();
        await ctx.repo.replaceReminders(ctx.user.userId, bakeGroup(params.id), []);
        return { ok: true };
      },
    }),

    route({
      method: "POST",
      path: "/bakes/:id/steps/:stepId/done",
      input: { params: stepParams, body: atBody },
      handler: async (ctx, { params, body }) => {
        const at = body.at ? new Date(body.at) : now();
        return changeSteps(ctx, params.id, (bake) => {
          if (!bake.steps.some((s) => s.id === params.stepId)) throw notFound("step not found");
          return completeStep(bake.steps, params.stepId, at);
        });
      },
    }),

    route({
      method: "POST",
      path: "/bakes/:id/steps/:stepId/fold",
      input: { params: stepParams, body: atBody },
      handler: async (ctx, { params, body }) => {
        const at = body.at ? new Date(body.at) : now();
        return changeSteps(ctx, params.id, (bake) => {
          const step = bake.steps.find((s) => s.id === params.stepId);
          if (!step) throw notFound("step not found");
          if (!step.folds) throw badRequest("this step has no folds");
          return logFold(bake.steps, params.stepId, at);
        });
      },
    }),

    route({
      method: "POST",
      path: "/bakes/:id/shift",
      input: { params: idParam, body: z.object({ minutes: z.number().int().min(-720).max(720) }) },
      handler: async (ctx, { params, body }) =>
        changeSteps(ctx, params.id, (bake) => shiftRemaining(bake.steps, body.minutes, now())),
    }),

    // ---------- reminders, push ----------

    route({
      method: "GET",
      path: "/reminders",
      handler: async (ctx) => ctx.repo.listReminders(ctx.user.userId),
    }),

    route({
      method: "GET",
      path: "/push/key",
      handler: async () => ({ publicKey: deps.push ? await deps.push.publicKey() : null }),
    }),

    route({
      method: "POST",
      path: "/push/subscriptions",
      input: { body: pushSubscriptionInput },
      status: () => 201,
      handler: async (ctx, { body }) => {
        const row = await ctx.repo.savePushSubscription(ctx.user.userId, body);
        return { id: row.id, created_at: row.created_at };
      },
    }),

    route({
      method: "POST",
      path: "/push/unsubscribe",
      input: { body: z.object({ endpoint: z.string().url() }) },
      handler: async (ctx, { body }) => ({ ok: await ctx.repo.deletePushSubscription(ctx.user.userId, body.endpoint) }),
    }),

    route({
      method: "POST",
      path: "/push/test",
      handler: async (ctx) => {
        if (!deps.push) throw conflict("PUSH_DISABLED");
        return { sent: await sendTestPush(ctx.repo, deps.push, ctx.user.userId) };
      },
    }),
  ];
}
