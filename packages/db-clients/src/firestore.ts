import { Firestore, type Settings } from "@google-cloud/firestore";

export interface FirestoreClient {
  db: Firestore;
  /**
   * Root collection with the configured prefix applied. Mirrors the way
   * createPostgresClient scopes an app to its own schema: every app shares one
   * Firestore database and namespaces via a collection prefix.
   */
  collection(name: string): FirebaseFirestore.CollectionReference;
  close(): Promise<void>;
}

export interface FirestoreClientOptions {
  /** GCP project id. Defaults to GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT. */
  projectId?: string;
  /**
   * Named Firestore database. Omit for "(default)". Used to give staging a
   * separate database inside the same project when that's cheaper than a
   * separate project.
   */
  databaseId?: string;
  /**
   * Prefix applied by collection(). Use "crate_" so apps sharing one database
   * don't collide, matching the Postgres one-schema-per-app convention.
   */
  collectionPrefix?: string;
  /** Escape hatch for advanced Firestore settings. */
  settings?: Settings;
}

/**
 * The emulator is picked up automatically by the SDK when FIRESTORE_EMULATOR_HOST
 * is set, so there is no emulator-specific branch here — docker-compose sets the
 * env var and the same code path runs locally and in the cloud.
 */
export function createFirestoreClient(opts: FirestoreClientOptions = {}): FirestoreClient {
  const db = new Firestore({
    projectId: opts.projectId,
    databaseId: opts.databaseId,
    ignoreUndefinedProperties: true,
    ...opts.settings,
  });

  const prefix = opts.collectionPrefix ?? "";

  return {
    db,
    collection(name: string) {
      return db.collection(`${prefix}${name}`);
    },
    async close() {
      await db.terminate();
    },
  };
}
