import assert from "node:assert/strict";
import test from "node:test";
import { downloadArchiveFile, lookupArchiveItem } from "../js/archive-client.js";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer,
  };
}

function audioResponse(bytes, type = "audio/flac") {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? type : "") },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

test("lookup uses the metadata API and does not download audio yet", async () => {
  const calls = [];
  const result = await lookupArchiveItem({
    rawUrl: "https://archive.org/details/example_item/page/2?start=3",
    fetchImpl: async (url) => {
      calls.push(String(url));
      return jsonResponse({
        metadata: { identifier: "example_item", title: "Example &amp; Show", creator: ["Band"] },
        files: [
          { name: "song.flac", source: "original", format: "Flac", size: "1200", title: "Song", album: "Example &amp; Show" },
          { name: "song.mp3", source: "derivative", format: "VBR MP3", original: "song.flac", size: "400" },
        ],
      });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.identifier, "example_item");
  assert.deepEqual(calls, ["https://archive.org/metadata/example_item"]);
  assert.deepEqual(result.tracks.map((track) => track.name), ["song.flac"]);
  assert.equal(result.tracks[0].selected, true);
  assert.equal(result.tracks[0].album, "Example & Show");
  assert.equal(result.tracks[0].artist, "Band");
  assert.equal(result.tracks[0].downloadUrl, "https://archive.org/download/example_item/song.flac");
});

test("an item with no audio is reported and not downloaded", async () => {
  const calls = [];
  const result = await lookupArchiveItem({
    rawUrl: "https://archive.org/details/posters",
    fetchImpl: async (url) => {
      calls.push(String(url));
      return jsonResponse({ metadata: { identifier: "posters", title: "Posters" }, files: [{ name: "cover.jpg", source: "original", format: "JPEG" }] });
    },
  });
  assert.equal(result.code, "no-audio");
  assert.match(result.message, /no audio/i);
  assert.equal(calls.length, 1);
});

test("download saves the original bytes from the archive.org download URL", async () => {
  const flac = Uint8Array.of(0x66, 0x4c, 0x61, 0x43, 1, 2, 3);
  const calls = [];
  const result = await downloadArchiveFile({
    downloadUrl: "https://archive.org/download/example_item/song.flac",
    fetchImpl: async (url) => {
      calls.push(String(url));
      return audioResponse(flac);
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.bytes, flac);
  assert.deepEqual(calls, ["https://archive.org/download/example_item/song.flac"]);
});

test("a blocked file host becomes a clear error", async () => {
  const result = await downloadArchiveFile({
    downloadUrl: "https://archive.org/download/example_item/song.flac",
    fetchImpl: async () => {
      throw new TypeError("Failed to fetch");
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "cors");
  assert.match(result.message, /ia\*\.us\.archive\.org/);
});
