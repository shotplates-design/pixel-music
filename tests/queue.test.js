import assert from "node:assert/strict";
import test from "node:test";
import { nextIndex, previousAction } from "../js/queue.js";

test("next stays at the end", () => {
  assert.equal(nextIndex(0, 3), 1);
  assert.equal(nextIndex(2, 3), -1);
  assert.equal(nextIndex(0, 0), -1);
});

test("previous restarts the current track after a few seconds", () => {
  assert.deepEqual(previousAction(1, 3, 8), { type: "restart", index: 1 });
  assert.deepEqual(previousAction(1, 3, 1), { type: "goto", index: 0 });
  assert.deepEqual(previousAction(0, 3, 0), { type: "restart", index: 0 });
});
