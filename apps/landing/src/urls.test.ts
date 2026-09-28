import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAppUrls } from "./urls.js";

const apps = [
  { id: "crate", localPort: 3101 },
  { id: "pantry", localPort: 3102 },
];
const rc = {
  targets: {
    "proj-prod": { hosting: { crate: ["crate-prod-abc"], pantry: ["pantry-prod-abc"] } },
  },
};

test("uses the Hosting site for the project being built", () => {
  assert.deepEqual(resolveAppUrls(apps, { VITE_FIREBASE_PROJECT_ID: "proj-prod" }, rc), {
    crate: "https://crate-prod-abc.web.app",
    pantry: "https://pantry-prod-abc.web.app",
  });
});

test("an explicit URL wins, trailing slash dropped", () => {
  const urls = resolveAppUrls(
    apps,
    { VITE_FIREBASE_PROJECT_ID: "proj-prod", VITE_APP_URL_CRATE: "https://crate.example.com/" },
    rc,
  );
  assert.equal(urls.crate, "https://crate.example.com");
  assert.equal(urls.pantry, "https://pantry-prod-abc.web.app");
});

test("falls back to the self-hosted port", () => {
  assert.deepEqual(resolveAppUrls(apps, {}, rc), {
    crate: "http://localhost:3101",
    pantry: "http://localhost:3102",
  });
  assert.equal(resolveAppUrls(apps, { VITE_FIREBASE_PROJECT_ID: "unknown" }, null).crate, "http://localhost:3101");
});

test("the real .firebaserc maps every catalog app in every project", async () => {
  const { readFile } = await import("node:fs/promises");
  const { catalog } = await import("./catalog.js");
  const real = JSON.parse(await readFile(new URL("../../../.firebaserc", import.meta.url), "utf8"));
  for (const project of Object.keys(real.targets)) {
    const urls = resolveAppUrls(catalog, { VITE_FIREBASE_PROJECT_ID: project }, real);
    for (const app of catalog) {
      assert.match(urls[app.id], /^https:\/\/.+\.web\.app$/, `${app.id} has no Hosting target in ${project}`);
    }
    assert.ok(real.targets[project].hosting.landing, `landing has no Hosting target in ${project}`);
  }
});
