import type { Firestore } from "@google-cloud/firestore";
import type { RedisClient } from "@stack/db-clients";

/**
 * Single-holder lease with a TTL, so a scheduled job never runs twice
 * concurrently. Self-hosted this is a Redis SET NX PX; in the cloud Cloud
 * Scheduler delivers at-least-once, so the lease is still required even though
 * onSchedule looks like it fires exactly once.
 */
export interface Lease {
  /** Returns false when someone else already holds the lease. */
  acquire(name: string, ttlMs: number): Promise<boolean>;
  release(name: string): Promise<void>;
}

export function redisLease(redis: RedisClient): Lease {
  return {
    async acquire(name, ttlMs) {
      const ok = await redis.set(name, "1", "PX", ttlMs, "NX");
      return ok === "OK";
    },
    async release(name) {
      await redis.del(name);
    },
  };
}

/**
 * Firestore equivalent. The transaction gives us the same compare-and-set that
 * SET NX does; the expiresAt check is what makes a crashed holder recoverable
 * rather than deadlocking the job forever.
 */
export function firestoreLease(db: Firestore, collection = "_locks"): Lease {
  const col = db.collection(collection);
  return {
    async acquire(name, ttlMs) {
      const ref = col.doc(encodeURIComponent(name));
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const held = snap.exists
          ? (snap.data() as { expiresAt?: { toMillis(): number } }).expiresAt
          : undefined;
        if (held && held.toMillis() > Date.now()) return false;
        tx.set(ref, { expiresAt: new Date(Date.now() + ttlMs) });
        return true;
      });
    },
    async release(name) {
      await col.doc(encodeURIComponent(name)).delete();
    },
  };
}
