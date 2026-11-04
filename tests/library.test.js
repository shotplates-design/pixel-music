import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTrackRecord,
  classifyAudioFile,
  findBySourceUrls,
  removeTrackEverywhere,
  safeFilename,
  sortTracks,
  titleFromFilename,
  totalBytes,
} from "../js/library.js";

test("accepts efficient audio and rejects everything else", () => {
  assert.equal(classifyAudioFile({ name: "song.mp3", type: "audio/mpeg" }).ok, true);
  assert.equal(classifyAudioFile({ name: "song.m4a", type: "" }).label, "AAC/M4A");
  assert.equal(classifyAudioFile({ name: "song.aac", type: "audio/aac" }).ok, true);
  assert.equal(classifyAudioFile({ name: "song.opus", type: "audio/ogg" }).label, "Opus");
  assert.equal(classifyAudioFile({ name: "song.webm", type: "audio/webm" }).ok, true);
  assert.equal(classifyAudioFile({ name: "song.wav", type: "audio/wav" }).ok, false);
  assert.equal(classifyAudioFile({ name: "clip.mp4", type: "video/mp4" }).ok, false);
  assert.equal(classifyAudioFile({ name: "clip.webm", type: "video/webm" }).ok, false);
  assert.equal(classifyAudioFile({ name: "notes.txt", type: "text/plain" }).code, "unsupported");
});

test("builds records without changing the byte size", () => {
  const track = buildTrackRecord({
    id: "a",
    title: "  FOMDJ ",
    artist: "",
    duration: 12.5,
    mimeType: "audio/mpeg",
    byteSize: 2048,
    artworkSize: 100,
    filename: "fomdj.mp3",
    addedAt: 5,
    source: "file",
  });
  assert.equal(track.title, "FOMDJ");
  assert.equal(track.artist, "Unknown artist");
  assert.equal(track.byteSize, 2048);
  assert.equal(track.duration, 12.5);
  assert.equal(totalBytes([track, { byteSize: 10, artworkSize: 5 }]), 2163);
});

test("sorts newest first and removes a track from every playlist", () => {
  const tracks = sortTracks([
    { id: "old", title: "A", addedAt: 1 },
    { id: "new", title: "B", addedAt: 2 },
  ]);
  assert.deepEqual(tracks.map((track) => track.id), ["new", "old"]);
  const next = removeTrackEverywhere(tracks, [{ id: "p", trackIds: ["new", "old", "new"] }], "new");
  assert.deepEqual(next.tracks.map((track) => track.id), ["old"]);
  assert.deepEqual(next.playlists[0].trackIds, ["old"]);
});

test("filenames and source lookup", () => {
  assert.equal(titleFromFilename("My_Song.mp3"), "My Song");
  assert.equal(safeFilename("A/B?.mp3", "mp3"), "AB.mp3");
  assert.equal(findBySourceUrls([{ sourceUrl: "file:night-drive.mp3", id: "1" }], ["file:night-drive.mp3"]).id, "1");
  assert.equal(findBySourceUrls([{ sourceUrl: "file:night-drive.mp3" }], ["file:other.mp3"]), null);
});
