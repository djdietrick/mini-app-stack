import type { Firestore } from "@google-cloud/firestore";
import type { RedisClient } from "@stack/db-clients";

/**
 * Small JSON cache port. Redis backs it self-hosted; in Cloud Functions there
 * is no Redis (Memorystore needs a VPC connector and a always-on paid instance)
 * so Firestore documents with a TTL policy play the same role.
 */
export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

export function redisCache(redis: RedisClient): CacheStore {
  return {
    async get<T>(key: string): Promise<T | null> {
      const hit = await redis.get(key);
      return hit ? (JSON.parse(hit) as T) : null;
    },
    async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
      await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
    },
  };
}

/**
 * Firestore has no per-key TTL command; it has a per-collection TTL *policy*
 * on a timestamp field, applied by Terraform to `expiresAt`. Deletion is
 * asynchronous and can lag by hours, so we still compare expiresAt on read —
 * the policy is there to reclaim storage, not to enforce correctness.
 */
export function firestoreCache(db: Firestore, collection = "_cache"): CacheStore {
  const col = db.collection(collection);
  return {
    async get<T>(key: string): Promise<T | null> {
      const snap = await col.doc(encodeKey(key)).get();
      if (!snap.exists) return null;
      const data = snap.data() as { value: T; expiresAt?: { toMillis(): number } } | undefined;
      if (!data) return null;
      if (data.expiresAt && data.expiresAt.toMillis() <= Date.now()) return null;
      return data.value;
    },
    async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
      await col.doc(encodeKey(key)).set({
        value,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      });
    },
  };
}

/** Firestore document ids cannot contain "/" and are capped at 1500 bytes. */
function encodeKey(key: string): string {
  return encodeURIComponent(key).slice(0, 1500);
}
