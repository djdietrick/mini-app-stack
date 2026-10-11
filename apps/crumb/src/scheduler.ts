import { type DispatchDeps, dispatchReminders } from "./domain/reminders.js";

/**
 * Self-hosted scheduling: send due reminders on an in-process timer. The
 * cloud runs the same function from Cloud Scheduler (functions/src/index.ts).
 *
 * A run never overlaps the previous one in this process; across processes
 * the repo's atomic claim keeps two runs from sending the same reminder, so
 * no lease is needed.
 */
export function startReminderDispatch(deps: DispatchDeps, everySeconds: number): () => void {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    dispatchReminders(deps)
      .catch((err) => console.error("[reminders] dispatch failed:", err))
      .finally(() => {
        running = false;
      });
  };
  tick();
  const timer = setInterval(tick, everySeconds * 1000);
  return () => clearInterval(timer);
}
