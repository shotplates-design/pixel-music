export const MESSAGES = {
  empty: "Paste an archive.org item link.",
  invalid: "That doesn't look like an archive.org link.",
  "not-archive": "Paste a link from archive.org, like https://archive.org/details/identifier.",
  "not-item": "That archive.org link isn't an item. Use a /details/ or /download/ link.",
  "not-found": "Internet Archive couldn't find that item.",
  "no-audio": "This Internet Archive item has no audio files to save.",
  network: "Couldn't reach Internet Archive. Check your connection and try again.",
  cors: "The browser couldn't read the audio. Internet Archive sends the file from ia*.us.archive.org, and that server didn't allow this site to save it. Nothing new was stored.",
  "download-failed": "Internet Archive didn't return that audio file, so it wasn't saved.",
  saved: "Saved to your library.",
  "none-selected": "Choose at least one track to save.",
  "already-saved": "Those tracks are already in your library.",
};

export function messageFor(code) {
  return MESSAGES[code] || "Something went wrong before the audio was saved.";
}

const AUDIO_EXTENSIONS = new Set([
  "flac", "mp3", "ogg", "oga", "opus", "m4a", "aac", "wav", "aiff", "aif", "wv", "ape", "shn", "wma",
]);

const RANK = [
  ["flac", "alac"],
  ["wav", "aiff", "aif"],
  ["wv", "ape", "shn"],
  ["opus"],
  ["ogg", "oga"],
  ["mp3"],
  ["m4a", "aac"],
  ["wma"],
];

function fail(code) {
  return { ok: false, code, message: messageFor(code) };
}

function decodePart(part) {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

export function encodeArchivePath(value) {
  return String(value).split("/").map((part) => encodeURIComponent(part)).join("/");
}

export function extensionOf(name) {
  const base = String(name || "").split("/").pop();
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, digits) => String.fromCodePoint(parseInt(digits, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;|&#39;/g, "'");
}

export function metaText(value) {
  if (Array.isArray(value)) return decodeEntities(value.filter(Boolean).join(", "));
  if (value == null) return "";
  return decodeEntities(value);
}

export function parseArchiveUrl(input) {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return fail("empty");
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return fail("invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return fail("invalid");
  if (url.username || url.password) return fail("invalid");
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "archive.org") return fail("not-archive");
  const parts = url.pathname.split("/").filter(Boolean).map(decodePart);
  const marker = parts.findIndex((part) => part === "details" || part === "download");
  const identifier = marker >= 0 ? parts[marker + 1] : "";
  if (!identifier || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(identifier)) return fail("not-item");
  const file = parts[marker] === "download" ? parts.slice(marker + 2).join("/") : "";
  return {
    ok: true,
    identifier,
    file,
    detailsUrl: `https://archive.org/details/${encodeArchivePath(identifier)}`,
    message: "",
  };
}

export function buildMetadataUrl(identifier) {
  return `https://archive.org/metadata/${encodeArchivePath(identifier)}`;
}

export function buildDownloadUrl(identifier, filename) {
  return `https://archive.org/download/${encodeArchivePath(identifier)}/${encodeArchivePath(filename)}`;
}

export function isArchiveDownloadUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "archive.org" && url.pathname.startsWith("/download/") && !url.username;
  } catch {
    return false;
  }
}

function formatText(file) {
  return String(file?.format || "").toLowerCase();
}

export function isArchiveAudioFile(file) {
  if (!file || typeof file.name !== "string" || !file.name || file.name.includes("..")) return false;
  const ext = extensionOf(file.name);
  const format = formatText(file);
  if (["png", "jpg", "jpeg", "gif", "pdf", "xml", "sqlite", "torrent", "txt", "zip", "gz"].includes(ext)) return false;
  if (/spectrogram|peaks|metadata|item tile|thumb|checksum|torrent|fingerprint/.test(format)) return false;
  if (AUDIO_EXTENSIONS.has(ext)) return true;
  return /mp3|flac|vorbis|opus|wave|aiff|lossless|audio coding|shorten|\bogg\b/.test(format);
}

function derivative(file) {
  return String(file.source || "").toLowerCase() === "derivative" || Boolean(file.original);
}

function groupKey(file) {
  return file.original || file.name;
}

function rankKeys(file) {
  const keys = new Set([extensionOf(file.name)]);
  const format = formatText(file);
  if (format.includes("flac")) keys.add("flac");
  if (format.includes("alac") || format.includes("apple lossless")) keys.add("alac");
  if (format.includes("vorbis") || format.includes("ogg")) keys.add("ogg");
  if (format.includes("opus")) keys.add("opus");
  if (format.includes("mp3")) keys.add("mp3");
  if (format.includes("wave")) keys.add("wav");
  if (format.includes("aiff")) keys.add("aiff");
  if (format.includes("aac") || format.includes("advanced audio")) keys.add("aac");
  return keys;
}

function rank(file) {
  const keys = rankKeys(file);
  for (let index = 0; index < RANK.length; index += 1) {
    if (RANK[index].some((key) => keys.has(key))) return index;
  }
  return RANK.length;
}

export function selectArchiveTracks(files) {
  const groups = new Map();
  for (const file of files || []) {
    if (!isArchiveAudioFile(file)) continue;
    const key = groupKey(file);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(file);
  }
  const tracks = [];
  for (const group of groups.values()) {
    const originals = group.filter((file) => !derivative(file));
    const pool = originals.length ? originals : group;
    const best = pool.slice().sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name)))[0];
    const length = Number(best.length);
    tracks.push({
      name: best.name,
      format: best.format || extensionOf(best.name).toUpperCase(),
      ext: extensionOf(best.name),
      byteSize: Math.max(0, Math.trunc(Number(best.size) || 0)),
      duration: Number.isFinite(length) && length > 0 ? length : null,
      title: metaText(best.title),
      creator: metaText(best.creator || best.artist),
      album: metaText(best.album),
      track: best.track == null ? "" : String(best.track),
      original: !derivative(best),
    });
  }
  const trackNumber = (value) => {
    const match = /^(\d+)/.exec(String(value || "").trim());
    return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
  };
  tracks.sort((a, b) => trackNumber(a.track) - trackNumber(b.track) || a.name.localeCompare(b.name));
  return tracks;
}

export function mimeForExtension(ext) {
  switch (String(ext || "").toLowerCase()) {
    case "mp3": return "audio/mpeg";
    case "flac": return "audio/flac";
    case "ogg":
    case "oga": return "audio/ogg";
    case "opus": return "audio/opus";
    case "m4a":
    case "aac": return "audio/mp4";
    case "wav": return "audio/wav";
    case "aif":
    case "aiff": return "audio/aiff";
    default: return "application/octet-stream";
  }
}

export function applyItemMetadata(tracks, metadata) {
  const artist = metaText(metadata?.creator);
  const album = metaText(metadata?.album) || metaText(metadata?.title);
  return tracks.map((track) => ({
    ...track,
    title: track.title || titleFromArchiveName(track.name),
    artist: track.creator || artist || "Unknown artist",
    album: track.album || album || "",
    selected: true,
    downloadUrl: "",
  }));
}

export function titleFromArchiveName(name) {
  const base = String(name || "").split("/").pop().replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
  return base || "Untitled";
}
