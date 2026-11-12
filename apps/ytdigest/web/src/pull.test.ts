import { test } from "node:test";
import assert from "node:assert/strict";
import { PULL_DEAD_ZONE, PULL_MAX, PULL_THRESHOLD, pullOffset, pullReleases } from "./pull.js";

test("taps, jitter and upward moves are not a pull", () => {
  assert.equal(pullOffset(0, 0), 0);
  assert.equal(pullOffset(0, PULL_DEAD_ZONE), 0);
  assert.equal(pullOffset(0, -40), 0);
});

test("a sideways swipe is not a pull", () => {
  assert.equal(pullOffset(60, 40), 0);
  assert.equal(pullOffset(-60, 40), 0);
});

test("the indicator trails the finger and stops at the max", () => {
  assert.equal(pullOffset(0, PULL_DEAD_ZONE + 20), 10);
  assert.ok(pullOffset(10, 100) > 0);
  assert.equal(pullOffset(0, 10_000), PULL_MAX);
});

test("letting go refreshes only past the threshold", () => {
  assert.equal(pullReleases(PULL_THRESHOLD - 1), false);
  assert.equal(pullReleases(PULL_THRESHOLD), true);
  // A long enough pull reaches it.
  assert.equal(pullReleases(pullOffset(0, 400)), true);
  assert.equal(pullReleases(pullOffset(0, 60)), false);
});
