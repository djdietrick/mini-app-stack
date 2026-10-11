import type { Logger } from "@stack/service-kit";
import type { CrumbRepo } from "../repo/types.js";
import type { DueReminder, PushSubscriptionRow } from "./types.js";

/**
 * Sending due reminders: Web Push to every device the user turned
 * notifications on for, and email as a fallback (or as well, per their
 * settings).
 *
 * The same `dispatchReminders` runs from a one-minute timer self-hosted
 * (src/scheduler.ts) and from an `onSchedule` function in the cloud. It needs
 * no lease: the repo claims reminders atomically, so overlapping runs (or
 * Cloud Scheduler's at-least-once retries) never send one twice. A reminder
 * is claimed before it is sent, so a send that fails is not retried; a missed
 * nudge is better than a duplicate one at 3am.
 */

export interface PushPayload {
  title: string;
  body: string;
  /** Hash route to open on tap. */
  url: string;
  /** Notifications with the same tag replace each other. */
  tag: string;
}

/** `gone`: the push service says the subscription no longer exists. */
export type PushResult = "sent" | "gone" | "failed";

/** The push port. src/webpush.ts implements it with VAPID over fetch. */
export interface PushSender {
  send(sub: PushSubscriptionRow, payload: PushPayload): Promise<PushResult>;
}

/** A PushSender that can also say which VAPID public key devices subscribe with. */
export interface PushService extends PushSender {
  publicKey(): Promise<string>;
}

/** The slice of @stack/mailer reminders need. */
export interface ReminderMailer {
  send(mail: { to: string; subject: string; html: string; text?: string }): Promise<void>;
}

export interface DispatchDeps {
  repo: CrumbRepo;
  push: PushSender | null;
  mailer: ReminderMailer | null;
  /** The app's origin, for links in emails. Without it emails carry no link. */
  appUrl?: string;
  log?: Logger;
}

/** A reminder this late (the dispatcher was down) is dropped, not sent. */
export const STALE_MS = 3 * 3_600_000;
const BATCH = 200;

export interface DispatchResult {
  claimed: number;
  pushed: number;
  emailed: number;
  stale: number;
}

export async function dispatchReminders(deps: DispatchDeps, now: Date = new Date()): Promise<DispatchResult> {
  const log = deps.log ?? console;
  const claimed = await deps.repo.claimDueReminders(now, BATCH);
  const fresh = claimed.filter((r) => now.getTime() - Date.parse(r.due_at) <= STALE_MS);
  const result: DispatchResult = { claimed: claimed.length, pushed: 0, emailed: 0, stale: claimed.length - fresh.length };

  const byUser = new Map<string, DueReminder[]>();
  for (const r of fresh) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);

  for (const [userId, reminders] of byUser) {
    try {
      const settings = await deps.repo.getSettings(userId);
      const subs = deps.push ? await deps.repo.listPushSubscriptions(userId) : [];
      let delivered = false;

      for (const sub of subs) {
        for (const r of reminders) {
          const res = await deps.push!.send(sub, payload(r));
          if (res === "gone") {
            await deps.repo.forgetPushSubscription(sub.endpoint);
            break;
          }
          if (res === "sent") {
            delivered = true;
            result.pushed++;
          }
        }
      }

      const email = reminders[0].email;
      const wanted =
        settings.email_reminders === "always" || (settings.email_reminders === "fallback" && !delivered);
      if (deps.mailer && wanted && email) {
        await deps.mailer.send({ to: email, ...renderReminderEmail(reminders, deps.appUrl) });
        result.emailed++;
      }
    } catch (err) {
      log.error(`[reminders] failed for user ${userId}:`, err);
    }
  }

  if (result.claimed) log.info(`[reminders] ${JSON.stringify(result)}`);
  return result;
}

/** Sends one notification to each of the user's devices; for "send a test". */
export async function sendTestPush(repo: CrumbRepo, push: PushSender, userId: string): Promise<number> {
  let sent = 0;
  for (const sub of await repo.listPushSubscriptions(userId)) {
    const res = await push.send(sub, {
      title: "Notifications are on",
      body: "Crumb will remind you here when it's time to feed, fold or bake.",
      url: "#/settings",
      tag: "test",
    });
    if (res === "gone") await repo.forgetPushSubscription(sub.endpoint);
    if (res === "sent") sent++;
  }
  return sent;
}

function payload(r: DueReminder): PushPayload {
  return { title: r.title, body: r.body, url: r.url, tag: r.key };
}

export function renderReminderEmail(
  reminders: readonly DueReminder[],
  appUrl?: string,
): { subject: string; html: string; text: string } {
  const subject =
    reminders.length === 1 ? reminders[0].title : `${reminders[0].title}, and ${reminders.length - 1} more`;
  const link = (r: DueReminder) => (appUrl ? `${appUrl.replace(/\/+$/, "")}/${r.url}` : null);

  const text = [
    ...reminders.flatMap((r) => [r.title, r.body, link(r) ?? "", ""]),
    "Sent by Crumb. Turn on notifications in the app to get these on your phone instead.",
  ].join("\n");

  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1e1c19;max-width:520px">
${reminders
  .map((r) => {
    const href = link(r);
    const title = href ? `<a href="${escapeHtml(href)}" style="color:#9a5a14">${escapeHtml(r.title)}</a>` : escapeHtml(r.title);
    return `<h2 style="font-size:18px;margin:16px 0 4px">${title}</h2><p style="margin:0 0 12px;color:#4a463f">${escapeHtml(r.body)}</p>`;
  })
  .join("\n")}
<p style="font-size:12px;color:#8a857b;margin-top:24px">Sent by Crumb. Turn on notifications in the app to get these on your phone instead.</p>
</body></html>`;

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
