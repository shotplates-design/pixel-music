import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { prepareSoundCloudDownload } from "../js/soundcloud-client.js";

const SHARE = "https://soundcloud.com/playboicarti/fomdj-2?in=playboicarti/sets/music-sorry-4-da-wait&utm_source=clipboard&utm_medium=text&utm_campaign=social_sharing";
const CANONICAL = "https://soundcloud.com/playboicarti/fomdj-2";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer,
  };
}

function audioResponse(bytes, type = "audio/mpeg", disposition = 'attachment; filename="FOMDJ.mp3"') {
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        const key = name.toLowerCase();
        if (key === "content-type") return type;
        if (key === "content-disposition") return disposition;
        return "";
      },
    },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    json: async () => { throw new Error("not json"); },
  };
}

function route(handler) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", body: init.body || "", authorization: init.headers?.Authorization || "" });
    return handler(String(url), init, calls);
  };
  return { calls, fetchImpl };
}

test("the client never mentions stream endpoints", () => {
  const source = readFileSync(new URL("../js/soundcloud-client.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /stream_url|\/streams|api-v2|ffmpeg|AudioContext|MediaRecorder/);
});

test("share-sheet links are checked with the normalized URL and not downloaded when disabled", async () => {
  const { calls, fetchImpl } = route((url) => {
    if (url.startsWith("https://soundcloud.com/oembed")) {
      return jsonResponse({ title: "FOMDJ", author_name: "Playboi Carti", thumbnail_url: "https://i1.sndcdn.com/art.jpg", html: "<iframe>" });
    }
    if (url === "https://secure.soundcloud.com/oauth/token") return jsonResponse({ access_token: "TOKEN_VALUE_123", expires_in: 3600 });
    if (url.startsWith("https://api.soundcloud.com/resolve")) {
      return jsonResponse({
        kind: "track",
        title: "FOMDJ",
        metadata_artist: "Playboi Carti",
        permalink_url: CANONICAL,
        downloadable: false,
        download_url: "https://api.soundcloud.com/tracks/123/download",
        stream_url: "https://api.soundcloud.com/tracks/123/stream",
      });
    }
    throw new Error(`unexpected ${url}`);
  });
  const result = await prepareSoundCloudDownload({
    rawUrl: SHARE,
    credentials: { clientId: "id", clientSecret: "secret" },
    fetchImpl,
    now: 0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "not-downloadable");
  assert.match(result.message, /bought the song/i);
  assert.equal(result.normalizedUrl, CANONICAL);
  assert.equal(result.preview.title, "FOMDJ");
  assert.equal(result.message.includes("TOKEN_VALUE_123"), false);
  assert.equal(calls.some((call) => call.url.includes("/download") || call.url.includes("/stream")), false);
  const resolve = calls.find((call) => call.url.includes("/resolve"));
  assert.equal(new URL(resolve.url).searchParams.get("url"), CANONICAL);
  const oembed = calls.find((call) => call.url.includes("oembed"));
  assert.equal(oembed.authorization, "");
  assert.equal(new URL(oembed.url).searchParams.get("url"), CANONICAL);
});

test("official downloads save the original bytes and ignore cached calls when not needed", async () => {
  const mp3 = Uint8Array.of(0x49, 0x44, 0x33, 4, 5, 6, 7);
  const { calls, fetchImpl } = route((url) => {
    if (url.startsWith("https://soundcloud.com/oembed")) return jsonResponse({ title: "FOMDJ", author_name: "Playboi Carti" });
    if (url.startsWith("https://api.soundcloud.com/resolve")) {
      return jsonResponse({
        kind: "track",
        title: "FOMDJ",
        downloadable: true,
        permalink_url: `${CANONICAL}?utm_source=clipboard`,
        download_url: "https://api.soundcloud.com/tracks/123/download",
        stream_url: "https://api.soundcloud.com/tracks/123/stream",
        duration: 40000,
      });
    }
    if (url === "https://api.soundcloud.com/tracks/123/download") return audioResponse(mp3);
    throw new Error(`unexpected ${url}`);
  });
  const result = await prepareSoundCloudDownload({
    rawUrl: SHARE,
    credentials: { clientId: "id", clientSecret: "secret", token: { accessToken: "cached", refreshToken: "r", expiresAt: 9_000_000 } },
    fetchImpl,
    now: 1_000,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.audio.bytes, mp3);
  assert.equal(result.audio.byteSize, mp3.byteLength);
  assert.equal(result.filename, "FOMDJ.mp3");
  assert.equal(result.sourceUrl, CANONICAL);
  assert.equal(calls.some((call) => call.url.includes("oauth/token")), false);
  assert.equal(calls.filter((call) => call.url.includes("/download")).length, 1);
  assert.equal(calls.some((call) => call.url.includes("stream")), false);
  assert.equal(calls.find((call) => call.url.includes("/download")).authorization, "OAuth cached");
});

test("does not call the network again when the normalized link is already saved", async () => {
  let called = false;
  const result = await prepareSoundCloudDownload({
    rawUrl: SHARE,
    tracks: [{ id: "1", sourceUrl: CANONICAL }],
    fetchImpl: async () => { called = true; throw new Error("nope"); },
  });
  assert.equal(result.code, "already-saved");
  assert.equal(called, false);
});

test("a resolved short link is not downloaded twice and a stream response is discarded", async () => {
  const { calls, fetchImpl } = route((url) => {
    if (url.startsWith("https://soundcloud.com/oembed")) return jsonResponse({});
    if (url.startsWith("https://api.soundcloud.com/resolve")) {
      return jsonResponse({
        kind: "track",
        title: "FOMDJ",
        downloadable: true,
        permalink_url: CANONICAL,
        download_url: "https://api.soundcloud.com/tracks/123/download",
      });
    }
    if (url === "https://api.soundcloud.com/tracks/123/download") {
      return audioResponse(new TextEncoder().encode("#EXTM3U\n#EXTINF:1,\nhttp://cdn.example/a.m3u8"), "application/vnd.apple.mpegurl");
    }
    if (url.includes("oauth/token")) return jsonResponse({ access_token: "tok", expires_in: 3600 });
    throw new Error(`unexpected ${url}`);
  });
  const duplicate = await prepareSoundCloudDownload({
    rawUrl: "https://on.soundcloud.com/kKj8H7q1?utm_source=clipboard&utm_medium=text",
    tracks: [{ id: "saved", sourceUrl: CANONICAL }],
    credentials: { clientId: "id", clientSecret: "secret" },
    fetchImpl,
    now: 0,
  });
  assert.equal(duplicate.code, "already-saved");
  assert.equal(calls.some((call) => call.url.includes("/download")), false);

  const manifest = await prepareSoundCloudDownload({
    rawUrl: "https://on.soundcloud.com/kKj8H7q1?utm_campaign=social_sharing",
    credentials: { clientId: "id", clientSecret: "secret" },
    fetchImpl,
    now: 0,
  });
  assert.equal(manifest.code, "stream-manifest");
  assert.match(manifest.message, /bought the song/i);
  assert.equal(calls.some((call) => call.url.includes("/stream")), false);
});

test("missing credentials stop before a download", async () => {
  const { calls, fetchImpl } = route((url) => {
    if (url.includes("oembed")) return jsonResponse({ title: "FOMDJ", author_name: "Playboi Carti", thumbnail_url: "https://i1.sndcdn.com/a.jpg" });
    throw new Error(`unexpected ${url}`);
  });
  const result = await prepareSoundCloudDownload({ rawUrl: SHARE, credentials: {}, fetchImpl });
  assert.equal(result.code, "missing-credentials");
  assert.match(result.message, /client ID and secret/i);
  assert.equal(calls.length, 1);
});
