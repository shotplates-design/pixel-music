import { findBySourceUrls } from "./library.js";
import {
  assessDownloadPayload,
  assessTrackDownload,
  buildClientCredentialsRequest,
  buildOEmbedUrl,
  buildRefreshRequest,
  buildResolveUrl,
  candidateSourceUrls,
  filenameFromDisposition,
  inspectSoundCloudUrl,
  isOfficialDownloadUrl,
  mapOEmbed,
  mapTrackPreview,
  messageFor,
  parseTokenResponse,
  preferredSourceUrl,
  tokenNeedsRefresh,
} from "./soundcloud.js";

function headerValue(response, name) {
  const headers = response?.headers;
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  return headers[name] || headers[name.toLowerCase()] || "";
}

function hostOf(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

async function requestToken(request, fetchImpl, now) {
  let response;
  try {
    response = await fetchImpl(request.url, { method: request.method, headers: request.headers, body: request.body });
  } catch {
    return { ok: false, code: "network", message: messageFor("network") };
  }
  if (response.status === 429) return { ok: false, code: "rate-limited", message: messageFor("rate-limited") };
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403 ? "bad-credentials" : "token-rejected";
    return { ok: false, code, message: messageFor(code) };
  }
  let body;
  try {
    body = await response.json();
  } catch {
    return { ok: false, code: "token-rejected", message: messageFor("token-rejected") };
  }
  const parsed = parseTokenResponse(body, now);
  if (!parsed.ok) return { ok: false, code: parsed.code, message: messageFor(parsed.code) };
  return { ok: true, token: parsed.token };
}

export async function ensureAccessToken({ credentials, fetchImpl, now }) {
  const current = credentials || {};
  if (!tokenNeedsRefresh(current.token, now)) return { ok: true, token: current.token, fromCache: true };
  if (current.token?.refreshToken) {
    const refresh = buildRefreshRequest({
      clientId: current.clientId,
      clientSecret: current.clientSecret,
      refreshToken: current.token.refreshToken,
    });
    if (refresh.ok) {
      const refreshed = await requestToken(refresh, fetchImpl, now);
      if (refreshed.ok || refreshed.code === "rate-limited" || refreshed.code === "network") return refreshed;
    }
  }
  const initial = buildClientCredentialsRequest({ clientId: current.clientId, clientSecret: current.clientSecret });
  if (!initial.ok) return initial;
  return requestToken(initial, fetchImpl, now);
}

async function readOEmbed(normalizedUrl, fetchImpl) {
  try {
    const response = await guardedFetch(fetchImpl, buildOEmbedUrl(normalizedUrl), { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    return mapOEmbed(await response.json());
  } catch {
    return null;
  }
}

function guardedFetch(fetchImpl, url, init = {}) {
  const host = hostOf(url);
  const headers = init.headers || {};
  const authorization = headers.Authorization || headers.authorization || "";
  if (authorization && host !== "api.soundcloud.com" && host !== "secure.soundcloud.com") {
    return Promise.reject(new Error("credentials are only sent to SoundCloud's official API"));
  }
  return fetchImpl(url, init);
}

function failure(code, extra = {}) {
  return { ok: false, code, message: messageFor(code), ...extra };
}

export async function prepareSoundCloudDownload({
  rawUrl,
  credentials,
  tracks = [],
  fetchImpl = globalThis.fetch,
  now = Date.now(),
}) {
  const inspected = inspectSoundCloudUrl(rawUrl);
  if (!inspected.ok) return failure(inspected.code);
  const early = findBySourceUrls(tracks, [inspected.url]);
  if (early) return failure("already-saved", { normalizedUrl: inspected.url, existingId: early.id });

  const previewFromOembed = await readOEmbed(inspected.url, fetchImpl);
  const tokenResult = await ensureAccessToken({ credentials, fetchImpl, now });
  if (!tokenResult.ok) {
    return {
      ok: false,
      code: tokenResult.code,
      message: tokenResult.message || messageFor(tokenResult.code),
      preview: previewFromOembed ? mapTrackPreview(null, previewFromOembed) : null,
      normalizedUrl: inspected.url,
      token: tokenResult.token || null,
    };
  }

  let response;
  try {
    response = await guardedFetch(fetchImpl, buildResolveUrl(inspected.url), {
      headers: {
        Accept: "application/json; charset=utf-8",
        Authorization: `OAuth ${tokenResult.token.accessToken}`,
      },
    });
  } catch {
    return failure("network", { preview: mapTrackPreview(null, previewFromOembed), normalizedUrl: inspected.url, token: tokenResult.token });
  }

  if (!response.ok) {
    const code = response.status === 401 ? "bad-credentials" : response.status === 429 ? "rate-limited" : "not-found";
    return failure(code, { preview: mapTrackPreview(null, previewFromOembed), normalizedUrl: inspected.url, token: tokenResult.token });
  }

  let track;
  try {
    track = await response.json();
  } catch {
    return failure("not-a-track", { preview: mapTrackPreview(null, previewFromOembed), normalizedUrl: inspected.url, token: tokenResult.token });
  }

  const preview = mapTrackPreview(track, previewFromOembed);
  const sourceKeys = candidateSourceUrls(inspected.url, preview.permalink);
  const existing = findBySourceUrls(tracks, sourceKeys);
  if (existing) {
    return failure("already-saved", { normalizedUrl: inspected.url, preview, token: tokenResult.token, existingId: existing.id, sourceUrl: preferredSourceUrl(inspected.url, preview.permalink) });
  }

  const decision = assessTrackDownload(track);
  if (!decision.ok) {
    return failure(decision.code, { preview, normalizedUrl: inspected.url, token: tokenResult.token, sourceUrl: preferredSourceUrl(inspected.url, preview.permalink) });
  }
  if (!isOfficialDownloadUrl(decision.downloadUrl)) {
    return failure("unofficial-download", { preview, normalizedUrl: inspected.url, token: tokenResult.token });
  }

  let download;
  try {
    download = await guardedFetch(fetchImpl, decision.downloadUrl, {
      headers: {
        Accept: "audio/*,application/octet-stream;q=0.9",
        Authorization: `OAuth ${tokenResult.token.accessToken}`,
      },
    });
  } catch {
    return failure("download-failed", { preview, normalizedUrl: inspected.url, token: tokenResult.token });
  }
  if (!download.ok) {
    const code = download.status === 401 ? "bad-credentials" : "not-downloadable";
    return failure(code, { preview, normalizedUrl: inspected.url, token: tokenResult.token });
  }

  let buffer;
  try {
    buffer = await download.arrayBuffer();
  } catch {
    return failure("download-failed", { preview, normalizedUrl: inspected.url, token: tokenResult.token });
  }
  const bytes = new Uint8Array(buffer);
  const payload = assessDownloadPayload({ contentType: headerValue(download, "content-type"), bytes });
  if (!payload.ok) return failure(payload.code, { preview, normalizedUrl: inspected.url, token: tokenResult.token });

  const named = filenameFromDisposition(headerValue(download, "content-disposition"));
  return {
    ok: true,
    code: "saved",
    message: messageFor("saved"),
    preview,
    normalizedUrl: inspected.url,
    sourceUrl: preferredSourceUrl(inspected.url, preview.permalink),
    token: tokenResult.token,
    filename: named,
    audio: { bytes, mime: payload.mime, ext: payload.ext, byteSize: bytes.byteLength },
  };
}
