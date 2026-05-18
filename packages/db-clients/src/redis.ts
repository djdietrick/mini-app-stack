import Redis, { type RedisOptions } from "ioredis";

export type RedisClient = Redis;

export interface CreateRedisClientOptions {
  /** redis://:password@host:6379 or full RedisOptions. */
  url?: string;
  /** Optional key prefix so apps sharing a logical DB don't collide. */
  keyPrefix?: string;
  /** Logical DB index (0-15 by default). */
  db?: number;
  /** Escape hatch for advanced ioredis options. */
  options?: RedisOptions;
}

export function createRedisClient(opts: CreateRedisClientOptions): RedisClient {
  const baseOptions: RedisOptions = {
    keyPrefix: opts.keyPrefix,
    db: opts.db,
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    ...opts.options,
  };

  return opts.url ? new Redis(opts.url, baseOptions) : new Redis(baseOptions);
}
