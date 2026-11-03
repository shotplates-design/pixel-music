import assert from "node:assert/strict";
import test from "node:test";
import { formatBytes, formatDuration } from "../js/format.js";

test("formats durations", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(5), "0:05");
  assert.equal(formatDuration(65), "1:05");
  assert.equal(formatDuration(3661), "1:01:01");
  assert.equal(formatDuration(Number.NaN), "?:??");
  assert.equal(formatDuration(-3), "?:??");
});

test("formats storage sizes", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(1048576), "1 MB");
  assert.equal(formatBytes(5.5 * 1024 * 1024), "5.5 MB");
});
