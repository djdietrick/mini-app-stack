import { MongoClient, type Collection, type Db, type Document } from "mongodb";

export interface MongoClientOptions {
  /** Connection string, e.g. mongodb://appstack:pw@host:27017/appstack?authSource=appstack */
  url: string;
  /** Database name. Defaults to `appstack` (the shared db). */
  database?: string;
  /**
   * Prefix automatically applied when calling `collection(name)`.
   * Example: prefix `"notes_"` + name `"items"` => collection `notes_items`.
   * Lets apps share one Mongo db without colliding on collection names.
   */
  collectionPrefix?: string;
}

export interface MongoClientHandle {
  client: MongoClient;
  db: Db;
  /** Returns a collection, applying `collectionPrefix` if set. */
  collection: <T extends Document = Document>(name: string) => Collection<T>;
  close: () => Promise<void>;
}

export async function createMongoClient(opts: MongoClientOptions): Promise<MongoClientHandle> {
  const client = new MongoClient(opts.url);
  await client.connect();
  const db = client.db(opts.database ?? "appstack");
  const prefix = opts.collectionPrefix ?? "";

  return {
    client,
    db,
    collection<T extends Document = Document>(name: string) {
      return db.collection<T>(`${prefix}${name}`);
    },
    async close() {
      await client.close();
    },
  };
}
