export const AUDIO_FORMATS = [
  { label: "MP3", exts: ["mp3"], mimes: ["audio/mpeg", "audio/mp3"] },
  { label: "AAC/M4A", exts: ["m4a", "aac"], mimes: ["audio/mp4", "audio/aac", "audio/x-m4a", "audio/m4a"] },
  { label: "Opus", exts: ["opus", "ogg"], mimes: ["audio/ogg", "audio/opus"] },
  { label: "WebM Opus", exts: ["webm"], mimes: ["audio/webm"] },
];

const EXT_OF = /\.([a-z0-9]+)$/i;

function extensionOf(name) {
  const match = EXT_OF.exec(String(name || ""));
  return match ? match[1].toLowerCase() : "";
}

export function classifyAudioFile({ name = "", type = "" } = {}) {
  const ext = extensionOf(name);
  const mime = String(type || "").toLowerCase().split(";")[0].trim();
  if (ext === "mp4" && mime !== "audio/mp4") return { ok: false, code: "unsupported" };
  if (ext === "webm" && mime && mime !== "audio/webm") return { ok: false, code: "unsupported" };
  const byExt = AUDIO_FORMATS.find((format) => format.exts.includes(ext));
  const byMime = AUDIO_FORMATS.find((format) => format.mimes.includes(mime));
  if (!byExt && !byMime) return { ok: false, code: "unsupported" };
  const chosen = byExt || byMime;
  return {
    ok: true,
    label: chosen.label,
    ext: byExt ? ext : chosen.exts[0],
    mime: chosen.mimes.includes(mime) ? mime : chosen.mimes[0],
  };
}

export function titleFromFilename(name) {
  const base = String(name || "")
    .split(/[/\\]/)
    .pop()
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .trim();
  return base || "Untitled";
}

export function safeFilename(name, ext) {
  const cleaned = String(name || "track")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "track";
  const cleanExt = String(ext || "audio").replace(/[^\w]+/g, "") || "audio";
  return `${cleaned}.${cleanExt}`;
}

export function buildTrackRecord({
  id,
  title,
  artist,
  duration,
  mimeType,
  byteSize,
  artworkSize = 0,
  filename,
  addedAt,
  source,
  sourceUrl = "",
}) {
  const seconds = Number(duration);
  return {
    id,
    title: String(title || "").trim() || "Untitled",
    artist: String(artist || "").trim() || "Unknown artist",
    duration: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
    mimeType: mimeType || "application/octet-stream",
    byteSize: Math.max(0, Math.trunc(Number(byteSize) || 0)),
    artworkSize: Math.max(0, Math.trunc(Number(artworkSize) || 0)),
    filename: filename || "audio",
    addedAt: addedAt ?? Date.now(),
    source: source || "file",
    sourceUrl: sourceUrl || "",
  };
}

export function sortTracks(tracks) {
  return tracks.slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0) || String(a.title).localeCompare(String(b.title)));
}

export function totalBytes(tracks) {
  return (tracks || []).reduce((sum, track) => sum + (Number(track.byteSize) || 0) + (Number(track.artworkSize) || 0), 0);
}

export function removeTrackEverywhere(tracks, playlists, id) {
  return {
    tracks: (tracks || []).filter((track) => track.id !== id),
    playlists: (playlists || []).map((playlist) => ({
      ...playlist,
      trackIds: playlist.trackIds.filter((trackId) => trackId !== id),
    })),
  };
}

export function findBySourceUrls(tracks, urls) {
  const wanted = new Set(urls || []);
  return (tracks || []).find((track) => track?.sourceUrl && wanted.has(track.sourceUrl)) || null;
}
