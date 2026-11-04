import {
  applyItemMetadata,
  buildDownloadUrl,
  buildMetadataUrl,
  isArchiveDownloadUrl,
  messageFor,
  metaText,
  mimeForExtension,
  parseArchiveUrl,
  selectArchiveTracks,
} from "./archive.js";

function headerValue(response, name) {
  const headers = response?.headers;
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  return headers[name] || headers[name.toLowerCase()] || "";
}

function failure(code, extra = {}) {
  return { ok: false, code, message: messageFor(code), ...extra };
}

export async function lookupArchiveItem({ rawUrl, fetchImpl = globalThis.fetch }) {
  const parsed = parseArchiveUrl(rawUrl);
  if (!parsed.ok) return failure(parsed.code);
  let response;
  try {
    response = await fetchImpl(buildMetadataUrl(parsed.identifier), { headers: { Accept: "application/json" } });
  } catch {
    return failure("network", { identifier: parsed.identifier });
  }
  if (response.status === 404) return failure("not-found", { identifier: parsed.identifier });
  if (!response.ok) return failure("not-found", { identifier: parsed.identifier });
  let body;
  try {
    body = await response.json();
  } catch {
    return failure("not-found", { identifier: parsed.identifier });
  }
  if (!body?.metadata || body.metadata.identifier == null) return failure("not-found", { identifier: parsed.identifier });
  const itemTitle = metaText(body.metadata.title) || parsed.identifier;
  let tracks = applyItemMetadata(selectArchiveTracks(body.files), body.metadata).map((track) => ({
    ...track,
    downloadUrl: buildDownloadUrl(parsed.identifier, track.name),
  }));
  if (!tracks.length) return failure("no-audio", { identifier: parsed.identifier, itemTitle });
  if (parsed.file) {
    const wanted = parsed.file;
    if (tracks.some((track) => track.name === wanted)) {
      tracks = tracks.map((track) => ({ ...track, selected: track.name === wanted }));
    }
  }
  return {
    ok: true,
    code: "ready",
    message: "",
    identifier: parsed.identifier,
    detailsUrl: parsed.detailsUrl,
    itemTitle,
    tracks,
  };
}

export async function downloadArchiveFile({ downloadUrl, fetchImpl = globalThis.fetch }) {
  if (!isArchiveDownloadUrl(downloadUrl)) return failure("invalid");
  let response;
  try {
    response = await fetchImpl(downloadUrl, { headers: { Accept: "audio/*,application/octet-stream;q=0.9" } });
  } catch {
    return failure("cors");
  }
  if (!response.ok) {
    return failure(response.status === 404 ? "not-found" : "download-failed");
  }
  const contentType = headerValue(response, "content-type").toLowerCase();
  if (contentType.includes("text/html") || contentType.includes("application/json") || contentType.startsWith("text/")) {
    return failure("download-failed");
  }
  let buffer;
  try {
    buffer = await response.arrayBuffer();
  } catch {
    return failure("cors");
  }
  const bytes = new Uint8Array(buffer);
  if (!bytes.byteLength) return failure("download-failed");
  return { ok: true, bytes, contentType, mime: "" , byteSize: bytes.byteLength };
}

export function mimeForTrack(track) {
  return mimeForExtension(track?.ext);
}
