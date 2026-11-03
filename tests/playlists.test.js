import assert from "node:assert/strict";
import test from "node:test";
import { addTrack, createPlaylist, deletePlaylist, moveTrack, removeTrackAt, renamePlaylist } from "../js/playlists.js";

test("creates, renames, and deletes playlists", () => {
  const created = createPlaylist([], "  night  drive ", { id: "p1", now: 10 });
  assert.equal(created.ok, true);
  assert.equal(created.playlist.name, "night drive");
  assert.equal(created.playlist.createdAt, 10);
  assert.equal(createPlaylist([], "   ").code, "empty-name");
  assert.equal(createPlaylist([], "x".repeat(41)).code, "name-too-long");
  const renamed = renamePlaylist(created.playlists, "p1", "Dawn", 20);
  assert.equal(renamed.playlist.name, "Dawn");
  assert.equal(renamed.playlist.updatedAt, 20);
  assert.deepEqual(deletePlaylist(renamed.playlists, "p1"), []);
  assert.equal(renamePlaylist(created.playlists, "missing", "Nope").code, "missing");
});

test("adds, removes, and reorders without duplicates or mutation", () => {
  const playlist = { id: "p", name: "Mix", trackIds: ["a", "b", "c"], updatedAt: 1 };
  const added = addTrack(playlist, "b", 2);
  assert.equal(added.code, "duplicate");
  assert.deepEqual(playlist.trackIds, ["a", "b", "c"]);
  const moved = moveTrack(playlist, 0, 2, 3);
  assert.deepEqual(moved.trackIds, ["b", "c", "a"]);
  assert.deepEqual(playlist.trackIds, ["a", "b", "c"]);
  assert.equal(moveTrack(playlist, 0, -1), playlist);
  assert.deepEqual(removeTrackAt(playlist, 1, 4).trackIds, ["a", "c"]);
  assert.equal(removeTrackAt(playlist, 9), playlist);
  const fresh = addTrack(playlist, "d", 5);
  assert.deepEqual(fresh.playlist.trackIds, ["a", "b", "c", "d"]);
});
