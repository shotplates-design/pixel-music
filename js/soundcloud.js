// Official SoundCloud downloads only. Stream URLs and unofficial hosts are rejected.

export const OEMBED_ENDPOINT = "https://soundcloud.com/oembed";
export const API_ORIGIN = "https://api.soundcloud.com";
export const TOKEN_ENDPOINT = "https://secure.soundcloud.com/oauth/token";

const NOT_A_SHORT_LINK = new Set([
  "sets",
  "likes",
  "followers",
  "following",
  "tracks",
  "albums",
  "reposts",
  "comments",
]);

const RESERVED_SECTIONS = new Set([
  "discover",
  "you",
  "search",
  "feed",
  "pages",
  "charts",
  "stations",
  "upload",
  "messages",
  "notifications",
  "settings",
  "popular",
  "tags",
  "groups",
  "stream",
  "premium",
  "pro",
  "download",
]);

export const MESSAGES = {
  empty: "Paste a SoundCloud track link.",
  invalid: "That doesn't look like a SoundCloud link.",
  "not-soundcloud": "Paste a soundcloud.com, m.soundcloud.com, or on.soundcloud.com link.",
  set: "That link is a playlist. Paste one track's share link, or import songs you own from Files.",
  "not-a-track": "That link isn't a single track. Paste a track share link, or import a file you own.",
  "not-downloadable": "This track isn't an official download. The uploader hasn't enabled downloads, and this app won't copy the stream. If you bought the song, import that file from Files.",
  "missing-download-url": "SoundCloud didn't provide an official download for this track, so nothing was saved. If you bought the song, import that file from Files.",
  "unofficial-download": "The link SoundCloud returned isn't its official download endpoint, so it was blocked. If you own the file, import it from Files.",
  "missing-credentials": "Add your SoundCloud API client ID and secret in Settings. They're stored only on this device and are used to check the official download flag.",
  "invalid-credentials": "The API client ID or secret doesn't look valid.",
  "bad-credentials": "SoundCloud rejected those API credentials. Check the client ID and secret in Settings.",
  "rate-limited": "SoundCloud rate-limited new API tokens. Wait a bit and try again. Saved tokens are reused so this stays rare.",
  "not-found": "SoundCloud couldn't find that track. Check the link, or import a file you own.",
  "already-saved": "That track is already in your library.",
  network: "Couldn't reach SoundCloud. Check your connection and try again.",
  "not-audio": "The official download wasn't an audio file, so it wasn't saved. If you bought the song, import that file from Files.",
  "stream-manifest": "SoundCloud returned a stream playlist instead of an official download. It was not saved. If you bought the song, import that file from Files.",
  "download-failed": "The official download didn't complete, so nothing was saved. If you bought the song, import that file from Files.",
  "token-rejected": "SoundCloud didn't return an access token. Check the API credentials in Settings.",
  aborted: "",
  unknown: "Something went wrong before any audio was saved.",
  saved: "Saved to your library.",
};

export function messageFor(code) {
  return MESSAGES[code] || MESSAGES.unknown;
}

function fail(code) {
  return { ok: false, code, message: messageFor(code) };
}

export function shouldStripParam(name) {
  const key = String(name || "").toLowerCase();
  return key === "in" || key.startsWith("utm_") || key === "si" || key === "ref" || key === "fbclid" || key === "gclid";
}

function decodePart(part) {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

function encodePath(parts) {
  return parts.map((part) => encodeURIComponent(part)).join("/");
}

function withParams(base, params) {
  if ([...params.keys()].length === 0) return base;
  const url = new URL(base);
  for (const [key, value] of params) url.searchParams.append(key, value);
  return url.href;
}

export function inspectSoundCloudUrl(input) {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return fail("empty");
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return fail("invalid");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return fail("invalid");
  if (url.username || url.password) return fail("invalid");

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const kept = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (!shouldStripParam(key)) kept.append(key, value);
  }
  const parts = url.pathname.split("/").filter(Boolean).map(decodePart);

  if (host === "on.soundcloud.com") {
    if (parts.length === 0) return fail("invalid");
    return { ok: true, kind: "short", url: withParams(`https://on.soundcloud.com/${encodePath(parts)}`, kept), message: "" };
  }

  if (host !== "soundcloud.com" && host !== "m.soundcloud.com") return fail("not-soundcloud");

  if (parts.length === 1 && host === "m.soundcloud.com" && !RESERVED_SECTIONS.has(parts[0].toLowerCase()) && !NOT_A_SHORT_LINK.has(parts[0].toLowerCase())) {
    return { ok: true, kind: "short", url: withParams(`https://m.soundcloud.com/${encodeURIComponent(parts[0])}`, kept), message: "" };
  }

  if (parts.length === 0 || RESERVED_SECTIONS.has(parts[0].toLowerCase())) return fail("not-a-track");
  if (parts.some((part) => part.toLowerCase() === "sets")) return fail("set");
  if (parts.length < 2) return fail("not-a-track");

  const path = [parts[0], parts[1]];
  if (parts[2]?.startsWith("s-")) path.push(parts[2]);
  return { ok: true, kind: "track", url: withParams(`https://soundcloud.com/${encodePath(path)}`, kept), message: "" };
}

export function buildOEmbedUrl(normalizedUrl) {
  const url = new URL(OEMBED_ENDPOINT);
  url.searchParams.set("format", "json");
  url.searchParams.set("url", normalizedUrl);
  return url.href;
}

export function buildResolveUrl(normalizedUrl) {
  const url = new URL("/resolve", API_ORIGIN);
  url.searchParams.set("url", normalizedUrl);
  return url.href;
}

export function mapOEmbed(payload) {
  if (!payload || typeof payload !== "object") return null;
  return {
    title: typeof payload.title === "string" ? payload.title : "",
    artist: typeof payload.author_name === "string" ? payload.author_name : "",
    artworkUrl: typeof payload.thumbnail_url === "string" ? payload.thumbnail_url : "",
  };
}

export function isAllowedArtworkUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /(^|\.)sndcdn\.com$|(^|\.)soundcloud\.com$/.test(url.hostname);
  } catch {
    return false;
  }
}

export function upgradeArtworkUrl(value) {
  if (!isAllowedArtworkUrl(value)) return "";
  return value.replace("-large.", "-t500x500.");
}

export function isOfficialDownloadUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  if (url.hostname !== "api.soundcloud.com") return false;
  if (!/^\/tracks\/[^/]+\/download$/.test(url.pathname)) return false;
  const haystack = `${url.pathname}${url.search}`.toLowerCase();
  if (haystack.includes("stream") || haystack.includes("m3u8") || haystack.includes("hls")) return false;
  return true;
}

export function assessTrackDownload(track) {
  if (!track || typeof track !== "object" || Array.isArray(track)) return { ok: false, code: "not-a-track" };
  if (track.kind === "playlist" || track.kind === "system-playlist") return { ok: false, code: "set" };
  if (track.kind && track.kind !== "track") return { ok: false, code: "not-a-track" };
  const looksLikeTrack = track.kind === "track" || Object.prototype.hasOwnProperty.call(track, "downloadable") || typeof track.title === "string";
  if (!looksLikeTrack) return { ok: false, code: "not-a-track" };
  if (track.downloadable !== true) return { ok: false, code: "not-downloadable" };
  if (typeof track.download_url !== "string" || track.download_url.length === 0) return { ok: false, code: "missing-download-url" };
  if (!isOfficialDownloadUrl(track.download_url)) return { ok: false, code: "unofficial-download" };
  return { ok: true, downloadUrl: new URL(track.download_url).href };
}

export function mapTrackPreview(track, oembed) {
  const artwork = [upgradeArtworkUrl(track?.artwork_url), upgradeArtworkUrl(oembed?.artworkUrl)].find(Boolean) || "";
  const duration = Number(track?.duration);
  return {
    title: track?.title || oembed?.title || "Untitled",
    artist: track?.metadata_artist || track?.user?.username || oembed?.artist || "Unknown artist",
    artworkUrl: artwork,
    durationMs: Number.isFinite(duration) ? duration : null,
    permalink: typeof track?.permalink_url === "string" ? track.permalink_url : "",
  };
}

export function candidateSourceUrls(normalizedUrl, permalink) {
  const urls = [];
  if (normalizedUrl) urls.push(normalizedUrl);
  if (permalink) {
    const inspected = inspectSoundCloudUrl(permalink);
    if (inspected.ok && !urls.includes(inspected.url)) urls.push(inspected.url);
  }
  return urls;
}

export function preferredSourceUrl(normalizedUrl, permalink) {
  const urls = candidateSourceUrls(normalizedUrl, permalink);
  return urls.find((url) => url.startsWith("https://soundcloud.com/")) || urls[0] || "";
}

export function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  if (typeof btoa === "function") return btoa(binary);
  return Buffer.from(bytes).toString("base64");
}

export function encodeForm(fields) {
  return Object.entries(fields).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
}

function cleanCredential(value) {
  return String(value ?? "").trim();
}

export function buildClientCredentialsRequest({ clientId, clientSecret }) {
  const id = cleanCredential(clientId);
  const secret = cleanCredential(clientSecret);
  if (!id || !secret) return { ok: false, code: "missing-credentials", message: messageFor("missing-credentials") };
  if (/[\r\n:]/.test(id) || /[\r\n]/.test(secret)) {
    return { ok: false, code: "invalid-credentials", message: messageFor("invalid-credentials") };
  }
  return {
    ok: true,
    url: TOKEN_ENDPOINT,
    method: "POST",
    headers: {
      Accept: "application/json; charset=utf-8",
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${encodeBase64Utf8(`${id}:${secret}`)}`,
    },
    body: "grant_type=client_credentials",
  };
}

export function buildRefreshRequest({ clientId, clientSecret, refreshToken }) {
  const id = cleanCredential(clientId);
  const secret = cleanCredential(clientSecret);
  const refresh = cleanCredential(refreshToken);
  if (!id || !secret || !refresh) return { ok: false, code: "missing-credentials", message: messageFor("missing-credentials") };
  if (/[\r\n]/.test(id) || /[\r\n]/.test(secret) || /[\r\n]/.test(refresh)) {
    return { ok: false, code: "invalid-credentials", message: messageFor("invalid-credentials") };
  }
  return {
    ok: true,
    url: TOKEN_ENDPOINT,
    method: "POST",
    headers: {
      Accept: "application/json; charset=utf-8",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: encodeForm({
      grant_type: "refresh_token",
      client_id: id,
      client_secret: secret,
      refresh_token: refresh,
    }),
  };
}

export function tokenNeedsRefresh(token, now, skewMs = 60_000) {
  if (!token?.accessToken || !Number.isFinite(token.expiresAt)) return true;
  return now >= token.expiresAt - skewMs;
}

export function parseTokenResponse(body, now) {
  if (!body || typeof body.access_token !== "string" || !body.access_token) return { ok: false, code: "token-rejected" };
  const expiresIn = Number(body.expires_in);
  const ttl = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 3_600_000;
  return {
    ok: true,
    token: {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : "",
      expiresAt: now + ttl,
    },
  };
}

function ascii(bytes, offset, length) {
  let text = "";
  for (let index = 0; index < length; index += 1) text += String.fromCharCode(bytes[offset + index]);
  return text;
}

export function sniffContainer(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return { mime: "audio/mpeg", ext: "mp3" };
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return { mime: "audio/mpeg", ext: "mp3" };
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") return { mime: "audio/mp4", ext: "m4a" };
  if (bytes.length >= 4 && ascii(bytes, 0, 4) === "OggS") return { mime: "audio/ogg", ext: "ogg" };
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { mime: "audio/webm", ext: "webm" };
  }
  return null;
}

const STREAM_TYPES = new Set([
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "application/dash+xml",
]);

export function assessDownloadPayload({ contentType = "", bytes }) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const type = String(contentType).split(";")[0].trim().toLowerCase();
  if (STREAM_TYPES.has(type)) return { ok: false, code: "stream-manifest" };
  const head = new TextDecoder().decode(data.subarray(0, 16));
  if (head.startsWith("#EXTM3U") || head.startsWith("#EXT")) return { ok: false, code: "stream-manifest" };
  if (!data.length || type === "application/json" || type.startsWith("text/")) return { ok: false, code: "not-audio" };
  const sniffed = sniffContainer(data.subarray(0, 64));
  if (sniffed) return { ok: true, ...sniffed };
  if (type.startsWith("audio/") || type === "video/mp4" || type === "application/octet-stream") {
    let ext = "audio";
    if (type.includes("mp4")) ext = "m4a";
    else if (type.includes("ogg") || type.includes("opus")) ext = "ogg";
    else if (type.includes("webm")) ext = "webm";
    else if (type.includes("mpeg") || type.includes("mp3") || type.includes("aac")) ext = type.includes("aac") ? "aac" : "mp3";
    return { ok: true, mime: type === "application/octet-stream" ? "application/octet-stream" : type, ext };
  }
  return { ok: false, code: "not-audio" };
}

export function filenameFromDisposition(header) {
  if (!header) return "";
  const encoded = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim().replace(/^"|"$/g, ""));
    } catch {
      return encoded[1].trim().replace(/^"|"$/g, "");
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1] : "";
}
