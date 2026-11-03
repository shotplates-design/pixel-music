import assert from "node:assert/strict";
import test from "node:test";
import {
  assessDownloadPayload,
  assessTrackDownload,
  buildClientCredentialsRequest,
  buildOEmbedUrl,
  buildRefreshRequest,
  buildResolveUrl,
  filenameFromDisposition,
  inspectSoundCloudUrl,
  isOfficialDownloadUrl,
  mapOEmbed,
  messageFor,
  parseTokenResponse,
  preferredSourceUrl,
  shouldStripParam,
  sniffContainer,
  tokenNeedsRefresh,
} from "../js/soundcloud.js";

const SHARE = "https://soundcloud.com/playboicarti/fomdj-2?in=playboicarti/sets/music-sorry-4-da-wait&utm_source=clipboard&utm_medium=text&utm_campaign=social_sharing";

test("normalizes an iOS share-sheet link to the track path", () => {
  const inspected = inspectSoundCloudUrl(SHARE);
  assert.deepEqual(inspected, {
    ok: true,
    kind: "track",
    url: "https://soundcloud.com/playboicarti/fomdj-2",
    message: "",
  });
  const resolve = new URL(buildResolveUrl(inspected.url));
  const oembed = new URL(buildOEmbedUrl(inspected.url));
  assert.equal(resolve.origin, "https://api.soundcloud.com");
  assert.equal(resolve.pathname, "/resolve");
  assert.equal(resolve.searchParams.get("url"), "https://soundcloud.com/playboicarti/fomdj-2");
  assert.equal(resolve.searchParams.get("in"), null);
  assert.equal(resolve.search.includes("utm_"), false);
  assert.equal(resolve.search.includes("sets"), false);
  assert.equal(oembed.searchParams.get("format"), "json");
  assert.equal(oembed.searchParams.get("url"), inspected.url);
});

test("strips in and utm params case-insensitively and keeps private tokens", () => {
  assert.equal(shouldStripParam("UTM_SOURCE"), true);
  assert.equal(shouldStripParam("In"), true);
  assert.equal(shouldStripParam("secret_token"), false);
  const inspected = inspectSoundCloudUrl("HTTP://WWW.SoundCloud.com/PlayboiCarti/fomdj-2/?UTM_MEDIUM=text&IN=playboicarti/sets/music&secret_token=abc#t=12");
  assert.equal(inspected.url, "https://soundcloud.com/PlayboiCarti/fomdj-2?secret_token=abc");
  const secretPath = inspectSoundCloudUrl("https://soundcloud.com/artist/track/s-AbCd?utm_source=clipboard");
  assert.equal(secretPath.url, "https://soundcloud.com/artist/track/s-AbCd");
});

test("accepts on.soundcloud.com and m.soundcloud.com short links and mobile permalinks", () => {
  assert.deepEqual(
    inspectSoundCloudUrl("https://on.soundcloud.com/kKj8H7q1?utm_source=clipboard&utm_medium=text&utm_campaign=social_sharing"),
    { ok: true, kind: "short", url: "https://on.soundcloud.com/kKj8H7q1", message: "" },
  );
  assert.deepEqual(
    inspectSoundCloudUrl("https://m.soundcloud.com/kKj8H7q1?utm_source=clipboard&in=user/sets/demo"),
    { ok: true, kind: "short", url: "https://m.soundcloud.com/kKj8H7q1", message: "" },
  );
  const mobile = inspectSoundCloudUrl("https://m.soundcloud.com/playboicarti/fomdj-2?in=playboicarti/sets/music-sorry-4-da-wait&utm_source=clipboard");
  assert.equal(mobile.kind, "track");
  assert.equal(mobile.url, "https://soundcloud.com/playboicarti/fomdj-2");
  assert.equal(inspectSoundCloudUrl("soundcloud.com/playboicarti/fomdj-2?utm_source=share").url, "https://soundcloud.com/playboicarti/fomdj-2");
});

test("rejects playlists, profiles, and non-SoundCloud links", () => {
  const set = inspectSoundCloudUrl("https://soundcloud.com/playboicarti/sets/music-sorry-4-da-wait?utm_source=clipboard");
  assert.equal(set.ok, false);
  assert.equal(set.code, "set");
  assert.match(set.message, /import/i);
  assert.equal(inspectSoundCloudUrl("https://soundcloud.com/playboicarti").code, "not-a-track");
  assert.equal(inspectSoundCloudUrl("https://example.com/playboicarti/fomdj-2").code, "not-soundcloud");
  assert.equal(inspectSoundCloudUrl("javascript:alert(1)").code, "invalid");
  assert.equal(inspectSoundCloudUrl("").code, "empty");
});

test("downloads only the official download endpoint when the uploader enabled it", () => {
  const official = "https://api.soundcloud.com/tracks/soundcloud:tracks:123/download";
  assert.equal(isOfficialDownloadUrl(official), true);
  assert.equal(isOfficialDownloadUrl("https://api-v2.soundcloud.com/tracks/123/download"), false);
  assert.equal(isOfficialDownloadUrl("http://api.soundcloud.com/tracks/123/download"), false);
  assert.equal(isOfficialDownloadUrl("https://api.soundcloud.com/tracks/123/streams"), false);
  assert.equal(isOfficialDownloadUrl("https://api.soundcloud.com/tracks/123/stream"), false);
  assert.equal(isOfficialDownloadUrl("https://user:pw@api.soundcloud.com/tracks/123/download"), false);

  const blocked = assessTrackDownload({
    kind: "track",
    title: "FOMDJ",
    downloadable: false,
    download_url: "https://api.soundcloud.com/tracks/123/download",
    stream_url: "https://api.soundcloud.com/tracks/123/stream",
  });
  assert.equal(blocked.code, "not-downloadable");
  assert.match(messageFor(blocked.code), /bought the song/i);
  assert.match(messageFor(blocked.code), /won't copy the stream/i);

  const missing = assessTrackDownload({
    kind: "track",
    downloadable: true,
    stream_url: "https://api.soundcloud.com/tracks/1/stream",
  });
  assert.equal(missing.code, "missing-download-url");
  assert.match(messageFor(missing.code), /import that file/i);

  const sneaky = assessTrackDownload({
    kind: "track",
    downloadable: true,
    download_url: "https://api.soundcloud.com/tracks/1/streams",
  });
  assert.equal(sneaky.code, "unofficial-download");

  const allowed = assessTrackDownload({
    kind: "track",
    downloadable: true,
    stream_url: "https://api.soundcloud.com/tracks/1/stream",
    download_url: official,
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.downloadUrl, official);
  assert.equal(assessTrackDownload({ kind: "playlist", downloadable: true }).code, "set");
});

test("oEmbed mapping drops the embed player", () => {
  const mapped = mapOEmbed({
    title: "Flickermood by Forss",
    author_name: "Forss",
    thumbnail_url: "https://i1.sndcdn.com/art.jpg",
    html: "<iframe src=\"https://w.soundcloud.com/player/\"></iframe>",
  });
  assert.deepEqual(mapped, {
    title: "Flickermood by Forss",
    artist: "Forss",
    artworkUrl: "https://i1.sndcdn.com/art.jpg",
  });
  assert.equal("html" in mapped, false);
});

test("client-credentials request keeps the secret out of the URL and body", () => {
  const request = buildClientCredentialsRequest({ clientId: "my_id", clientSecret: "my_secret" });
  assert.equal(request.url, "https://secure.soundcloud.com/oauth/token");
  assert.equal(request.url.includes("my_secret"), false);
  assert.equal(request.body, "grant_type=client_credentials");
  assert.equal(request.body.includes("my_secret"), false);
  assert.equal(Buffer.from(request.headers.Authorization.slice(6), "base64").toString(), "my_id:my_secret");
  assert.equal(buildClientCredentialsRequest({ clientId: "bad\nid", clientSecret: "x" }).ok, false);
  const refresh = buildRefreshRequest({ clientId: "my_id", clientSecret: "my_secret", refreshToken: "ref" });
  assert.equal(refresh.url.includes("my_secret"), false);
  assert.match(refresh.body, /grant_type=refresh_token/);
  assert.match(refresh.body, /client_secret=my_secret/);
});

test("reuses tokens until they are near expiry", () => {
  assert.equal(tokenNeedsRefresh({ accessToken: "a", expiresAt: 3_600_000 }, 1_000), false);
  assert.equal(tokenNeedsRefresh({ accessToken: "a", expiresAt: 3_600_000 }, 3_550_000), true);
  const parsed = parseTokenResponse({ access_token: "tok", refresh_token: "ref", expires_in: 60 }, 1_000);
  assert.equal(parsed.token.expiresAt, 61_000);
  assert.equal(preferredSourceUrl("https://on.soundcloud.com/abc", "https://soundcloud.com/artist/track?utm_source=x"), "https://soundcloud.com/artist/track");
});

test("rejects stream manifests and keeps official audio bytes identifiable", () => {
  assert.equal(assessDownloadPayload({ contentType: "application/vnd.apple.mpegurl", bytes: new Uint8Array([1]) }).code, "stream-manifest");
  assert.equal(assessDownloadPayload({ contentType: "application/octet-stream", bytes: new TextEncoder().encode("#EXTM3U\n") }).code, "stream-manifest");
  const mp3 = Uint8Array.of(0x49, 0x44, 0x33, 0x03, 0, 0, 0, 0, 0, 0);
  assert.deepEqual(sniffContainer(mp3), { mime: "audio/mpeg", ext: "mp3" });
  assert.equal(assessDownloadPayload({ contentType: "audio/mpeg", bytes: mp3 }).ok, true);
  const m4a = new Uint8Array(12);
  m4a.set(new TextEncoder().encode("ftyp"), 4);
  assert.equal(sniffContainer(m4a).ext, "m4a");
  assert.equal(filenameFromDisposition('attachment; filename="FOMDJ.mp3"'), "FOMDJ.mp3");
});
