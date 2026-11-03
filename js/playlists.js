import { createId } from "./ids.js";

const NAME_LIMIT = 40;

function cleanName(name) {
  return String(name ?? "").trim().replace(/\s+/g, " ");
}

export function createPlaylist(playlists, name, { id = createId(), now = Date.now() } = {}) {
  const trimmed = cleanName(name);
  if (!trimmed) return { ok: false, code: "empty-name" };
  if (trimmed.length > NAME_LIMIT) return { ok: false, code: "name-too-long" };
  const playlist = { id, name: trimmed, trackIds: [], createdAt: now, updatedAt: now };
  return { ok: true, playlist, playlists: [...playlists, playlist] };
}

export function renamePlaylist(playlists, id, name, now = Date.now()) {
  const trimmed = cleanName(name);
  if (!trimmed) return { ok: false, code: "empty-name", playlists };
  if (trimmed.length > NAME_LIMIT) return { ok: false, code: "name-too-long", playlists };
  const current = playlists.find((playlist) => playlist.id === id);
  if (!current) return { ok: false, code: "missing", playlists };
  const playlist = { ...current, name: trimmed, updatedAt: now };
  return { ok: true, playlist, playlists: playlists.map((item) => (item.id === id ? playlist : item)) };
}

export function deletePlaylist(playlists, id) {
  return playlists.filter((playlist) => playlist.id !== id);
}

export function addTrack(playlist, trackId, now = Date.now()) {
  if (!trackId) return { ok: false, code: "missing-track", playlist };
  if (playlist.trackIds.includes(trackId)) return { ok: false, code: "duplicate", playlist };
  return {
    ok: true,
    playlist: { ...playlist, trackIds: [...playlist.trackIds, trackId], updatedAt: now },
  };
}

export function removeTrackAt(playlist, index, now = Date.now()) {
  if (!Number.isInteger(index) || index < 0 || index >= playlist.trackIds.length) return playlist;
  return {
    ...playlist,
    trackIds: playlist.trackIds.filter((_, itemIndex) => itemIndex !== index),
    updatedAt: now,
  };
}

export function moveTrack(playlist, index, delta, now = Date.now()) {
  const next = index + delta;
  if (!Number.isInteger(index) || index < 0 || index >= playlist.trackIds.length || next < 0 || next >= playlist.trackIds.length) {
    return playlist;
  }
  const trackIds = playlist.trackIds.slice();
  const [item] = trackIds.splice(index, 1);
  trackIds.splice(next, 0, item);
  return { ...playlist, trackIds, updatedAt: now };
}
