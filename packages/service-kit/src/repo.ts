/**
 * The unit-of-work port. Postgres backs it with `sql.begin()`, Firestore with
 * `runTransaction()`. Domain code only sees `transaction()`.
 *
 * The two implementations are not equivalent and callers must stay inside the
 * intersection of what both guarantee:
 *
 *  - Firestore requires every read in a transaction to happen before the first
 *    write. Order reads first even where Postgres would not care.
 *  - Firestore caps a transaction at 500 writes.
 *  - Firestore retries the callback on contention, so the callback must be
 *    idempotent — no side effects outside the transaction (no HTTP calls, no
 *    cache writes, no counters in closure variables).
 */
export interface Transactional<Tx> {
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

/** Every app repo exposes a close() so index.ts shutdown stays uniform. */
export interface Closable {
  close(): Promise<void>;
}
