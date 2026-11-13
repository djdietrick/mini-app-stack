import assert from "node:assert/strict";
import { test } from "node:test";
import { type BettingState, clear, commit, double, place, rebet, undo } from "./betting.js";

const fresh = (over: Partial<BettingState> = {}): BettingState => ({ chip: 25, bets: {}, history: [], last: null, started: false, ...over });

test("undo takes off the last chip, then the one before", () => {
  let s = place(fresh(), "main", 1000);
  s = place({ ...s, chip: 5 }, "main", 1000);
  s = undo(s);
  assert.deepEqual(s.bets, { main: 25 });
  s = undo(s);
  assert.deepEqual(s.bets, {});
  assert.deepEqual(undo(s), s);
});

test("clear empties every spot", () => {
  let s = place(fresh(), "main", 1000);
  s = place(s, "side", 1000);
  s = clear(s);
  assert.deepEqual(s.bets, {});
  assert.deepEqual(s.history, []);
});

// Screens keep the last hand on the felt until `started`. If Undo or Clear
// dropped it, the scene got the last hand back and dealt it again.
test("undo and clear back to nothing keep the round started", () => {
  const after = commit(place(fresh(), "main", 1000));
  assert.equal(after.started, false);
  const placed = place(after, "main", 1000);
  assert.equal(placed.started, true);
  assert.equal(undo(placed).started, true);
  assert.equal(clear(placed).started, true);
  assert.equal(clear(rebet(after, 1000)).started, true);
});

test("a chip that doesn't fit doesn't start the round", () => {
  assert.equal(place(fresh(), "main", 0).started, false);
});

test("commit remembers the bets for rebet and starts over", () => {
  const s = commit(double(place(fresh(), "main", 1000), 1000));
  assert.deepEqual(s.last, { main: 50 });
  assert.deepEqual(s.bets, {});
  assert.deepEqual(rebet(s, 1000).bets, { main: 50 });
  assert.deepEqual(rebet(s, 40).bets, {});
});
