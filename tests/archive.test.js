import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDownloadUrl,
  buildMetadataUrl,
  decodeEntities,
  parseArchiveUrl,
  selectArchiveTracks,
} from "../js/archive.js";

const DETAILS = "https://archive.org/details/example_item/page/2?start=12&utm_source=share#playback";

test("reads an identifier from a details link and ignores the extra path and query", () => {
  const parsed = parseArchiveUrl(DETAILS);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.identifier, "example_item");
  assert.equal(parsed.file, "");
  assert.equal(parsed.detailsUrl, "https://archive.org/details/example_item");
  assert.equal(buildMetadataUrl(parsed.identifier), "https://archive.org/metadata/example_item");
  const www = parseArchiveUrl("http://www.archive.org/details/example_item/");
  assert.equal(www.identifier, "example_item");
});

test("reads an identifier and file from a download link", () => {
  const parsed = parseArchiveUrl("https://archive.org/download/example_item/My%20Song.flac?cnt=0");
  assert.equal(parsed.identifier, "example_item");
  assert.equal(parsed.file, "My Song.flac");
  assert.equal(buildDownloadUrl(parsed.identifier, parsed.file), "https://archive.org/download/example_item/My%20Song.flac");
});

test("rejects links that are not Internet Archive items", () => {
  assert.equal(parseArchiveUrl("").code, "empty");
  assert.equal(parseArchiveUrl("https://example.com/details/example_item").code, "not-archive");
  assert.equal(parseArchiveUrl("https://web.archive.org/web/2020/https://archive.org/details/example_item").code, "not-archive");
  assert.equal(parseArchiveUrl("https://archive.org/search.php?query=hello").code, "not-item");
  assert.equal(parseArchiveUrl("javascript:alert(1)").code, "invalid");
});

test("keeps the best original and skips derivative copies", () => {
  const tracks = selectArchiveTracks([
    { name: "song.flac", source: "original", format: "Flac", size: "5000", title: "Song", creator: "Band", album: "LP", track: "2" },
    { name: "song.mp3", source: "derivative", format: "VBR MP3", original: "song.flac", size: "800" },
    { name: "song.ogg", source: "derivative", format: "Ogg Vorbis", original: "song.flac", size: "700" },
    { name: "song_spectrogram.png", source: "derivative", format: "Spectrogram", original: "song.flac", size: "100" },
    { name: "cover.jpg", source: "original", format: "JPEG", size: "20" },
    { name: "talk.mp3", source: "original", format: "VBR MP3", size: "900", title: "Talk", track: "1" },
    { name: "talk.ogg", source: "derivative", format: "Ogg Vorbis", original: "talk.mp3", size: "600" },
    { name: "only.mp3", source: "derivative", format: "128Kbps MP3", original: "missing.wav", size: "400", title: "Only" },
  ]);
  assert.deepEqual(tracks.map((track) => track.name).sort(), ["only.mp3", "song.flac", "talk.mp3"]);
  assert.deepEqual(tracks.filter((track) => track.track).map((track) => track.name), ["talk.mp3", "song.flac"]);
  assert.equal(tracks.find((track) => track.name === "song.flac").title, "Song");
  assert.equal(tracks.find((track) => track.name === "song.flac").creator, "Band");
  assert.equal(tracks.find((track) => track.name === "song.flac").album, "LP");
  assert.equal(tracks.some((track) => track.name.endsWith(".ogg") || track.name.endsWith(".png")), false);
});

test("prefers FLAC when two originals belong to the same track", () => {
  const tracks = selectArchiveTracks([
    { name: "piece.mp3", source: "original", format: "VBR MP3", original: "piece.flac", size: "10" },
    { name: "piece.flac", source: "original", format: "24bit Flac", size: "40" },
  ]);
  assert.deepEqual(tracks.map((track) => track.name), ["piece.flac"]);
});

test("decodes metadata text", () => {
  assert.equal(decodeEntities("The Money Pit&#39;s Calls &amp; Answers"), "The Money Pit's Calls & Answers");
});
