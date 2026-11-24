import assert from "node:assert/strict";
import { it } from "node:test";
import { hrefFor, parseRoute, type Route } from "./route";

it("routes a channel's page by its subscription id and back again", () => {
  const routes: Route[] = [
    { name: "feed" },
    { name: "channels" },
    { name: "channel", id: "0b7e5a9c-6d1f-4a51-9a3e-2f6c1d8e4b70" },
    { name: "watch", id: "dQw4w9WgXcQ" },
    { name: "rules" },
  ];
  for (const route of routes) assert.deepEqual(parseRoute(hrefFor(route)), route);
  assert.deepEqual(parseRoute("#/channels/"), { name: "channels" });
  assert.deepEqual(parseRoute(""), { name: "feed" });
});
