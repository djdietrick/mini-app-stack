// One shared Mongo database for the whole stack. Apps namespace their
// collections via prefixes (e.g. `notes_items`, `timer_sessions`) so a single
// app user can join across collections when needed.
//
// We create an `appstack` user with readWrite on the `appstack` database;
// every app connects with the same credentials.

const DB_NAME = "appstack";
const APP_USER = "appstack";
const APP_PASSWORD = process.env.APP_MONGO_PASSWORD || "appstack";

const appstack = db.getSiblingDB(DB_NAME);

appstack.createUser({
  user: APP_USER,
  pwd: APP_PASSWORD,
  roles: [{ role: "readWrite", db: DB_NAME }],
});

print(`-> provisioned shared mongo db '${DB_NAME}' with user '${APP_USER}'`);
