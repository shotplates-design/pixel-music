import { deleteTrackData, getMedia, listPlaylists, listTracks, loadSettings, replacePlaylists, saveSettings, saveTrack } from "./db.js";
import { formatBytes, formatDuration } from "./format.js";
import { createId } from "./ids.js";
import {
  buildTrackRecord,
  classifyAudioFile,
  removeTrackEverywhere,
  safeFilename,
  sortTracks,
  titleFromFilename,
  totalBytes,
} from "./library.js";
import { addTrack, createPlaylist, deletePlaylist, moveTrack, removeTrackAt, renamePlaylist } from "./playlists.js";
import { nextIndex, previousAction } from "./queue.js";
import { isAllowedArtworkUrl, messageFor } from "./soundcloud.js";
import { prepareSoundCloudDownload } from "./soundcloud-client.js";
import { readTags } from "./tags.js";

const IMPORT_CODES = new Set([
  "not-downloadable",
  "missing-download-url",
  "unofficial-download",
  "stream-manifest",
  "not-audio",
  "download-failed",
  "set",
  "not-a-track",
]);

const audio = document.querySelector("#audio");
const view = document.querySelector("#view");
const fileInput = document.querySelector("#file");
const seek = document.querySelector("#seek");

const state = {
  tab: "library",
  tracks: [],
  playlists: [],
  settings: { clientId: "", clientSecret: "", token: null },
  storage: { used: 0, quota: null, usage: null, persisted: false },
  openPlaylistId: null,
  linkDraft: "",
  playlistName: "",
  renameDraft: "",
  download: { busy: false, message: "", code: "", preview: null, normalizedUrl: "" },
  queue: [],
  queueIndex: -1,
  currentId: null,
  sheetOpen: false,
  seeking: false,
  unlocked: false,
  modal: null,
};

const artUrls = new Map();
let renderToken = 0;
let toastTimer = 0;
let positionTimer = 0;

function el(tag, props = {}, kids = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = String(value);
    else if (key === "hidden") node.hidden = Boolean(value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const kid of [].concat(kids)) {
    if (kid == null || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

function toast(text) {
  const node = document.querySelector("#toast");
  node.textContent = text;
  node.hidden = !text;
  clearTimeout(toastTimer);
  if (text) toastTimer = setTimeout(() => { node.hidden = true; }, 3600);
}

function trackById(id) {
  return state.tracks.find((track) => track.id === id) || null;
}

function playlistById(id) {
  return state.playlists.find((playlist) => playlist.id === id) || null;
}

async function artworkUrlFor(id) {
  if (artUrls.has(id)) return artUrls.get(id);
  const media = await getMedia(id);
  if (!media?.artwork) {
    artUrls.set(id, "");
    return "";
  }
  const url = URL.createObjectURL(media.artwork);
  artUrls.set(id, url);
  return url;
}

function artNode(url, large = false) {
  if (!url) return el("span", { class: large ? "art art-empty lg" : "art art-empty" });
  return el("img", { class: large ? "art lg" : "art", src: url, alt: "" });
}

async function refreshStorage() {
  const used = totalBytes(state.tracks);
  let quota = null;
  let usage = null;
  let persisted = false;
  try {
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      quota = estimate.quota ?? null;
      usage = estimate.usage ?? null;
    }
    if (navigator.storage?.persisted) persisted = await navigator.storage.persisted();
  } catch {
    quota = null;
  }
  state.storage = { used, quota, usage, persisted };
  document.querySelector("#usage").textContent = formatBytes(used);
}

async function refresh() {
  state.tracks = sortTracks(await listTracks());
  state.playlists = await listPlaylists();
  await refreshStorage();
  await renderView();
  updatePlayerChrome();
}

function setTab(tab) {
  state.tab = tab;
  if (tab !== "playlists") state.openPlaylistId = null;
  renderView();
}

function readDuration(blob) {
  return new Promise((resolve) => {
    const probe = document.createElement("audio");
    probe.preload = "metadata";
    const url = URL.createObjectURL(blob);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      probe.removeAttribute("src");
      probe.load();
      resolve(value);
    };
    probe.onloadedmetadata = () => finish(Number.isFinite(probe.duration) ? probe.duration : null);
    probe.onerror = () => finish(null);
    setTimeout(() => finish(null), 4000);
    probe.src = url;
  });
}

async function importFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  let saved = 0;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const kind = classifyAudioFile(file);
    if (!kind.ok) {
      toast(`${file.name} isn't MP3, AAC/M4A, or Opus. Nothing was converted.`);
      continue;
    }
    toast(`Importing ${index + 1}/${files.length}`);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const tags = readTags(bytes);
      const blob = new Blob([buffer], { type: kind.mime });
      const artworkBlob = tags.artwork ? new Blob([tags.artwork.data], { type: tags.artwork.mime || "image/jpeg" }) : null;
      const duration = await readDuration(blob);
      const meta = buildTrackRecord({
        id: createId(),
        title: tags.title || titleFromFilename(file.name),
        artist: tags.artist || "Unknown artist",
        duration,
        mimeType: blob.type || kind.mime,
        byteSize: buffer.byteLength,
        artworkSize: artworkBlob?.size || 0,
        filename: file.name || safeFilename(tags.title, kind.ext),
        source: "file",
      });
      await saveTrack(meta, blob, artworkBlob);
      saved += 1;
    } catch {
      toast(`Couldn't store ${file.name}. Free some space and try again.`);
    }
  }
  fileInput.value = "";
  await refresh();
  if (saved) toast(saved === 1 ? "Saved to your library." : `Saved ${saved} tracks.`);
}

async function onSoundCloudSubmit(event) {
  event.preventDefault();
  if (state.download.busy) return;
  state.download = { busy: true, message: "Checking the official download flag…", code: "", preview: state.download.preview, normalizedUrl: "" };
  await renderView();
  try {
    const result = await prepareSoundCloudDownload({
      rawUrl: state.linkDraft,
      credentials: state.settings,
      tracks: state.tracks,
    });
    if (result.token) {
      state.settings = { ...state.settings, token: result.token };
      await saveSettings(state.settings);
    }
    if (!result.ok) {
      state.download = {
        busy: false,
        message: result.message,
        code: result.code,
        preview: result.preview || null,
        normalizedUrl: result.normalizedUrl || "",
      };
      await renderView();
      return;
    }
    const artworkBlob = await fetchArtwork(result.preview?.artworkUrl);
    const mime = result.audio.mime || "application/octet-stream";
    const blob = new Blob([result.audio.bytes], { type: mime });
    const duration = (await readDuration(blob)) ?? (result.preview?.durationMs ? result.preview.durationMs / 1000 : null);
    const title = result.preview?.title || "Untitled";
    const meta = buildTrackRecord({
      id: createId(),
      title,
      artist: result.preview?.artist || "Unknown artist",
      duration,
      mimeType: mime,
      byteSize: result.audio.byteSize,
      artworkSize: artworkBlob?.size || 0,
      filename: result.filename || safeFilename(title, result.audio.ext),
      source: "soundcloud",
      sourceUrl: result.sourceUrl || result.normalizedUrl,
    });
    await saveTrack(meta, blob, artworkBlob);
    state.download = { busy: false, message: messageFor("saved"), code: "saved", preview: result.preview, normalizedUrl: result.normalizedUrl };
    await refresh();
  } catch {
    state.download = { busy: false, message: messageFor("network"), code: "network", preview: null, normalizedUrl: "" };
    await renderView();
  }
}

async function fetchArtwork(url) {
  if (!isAllowedArtworkUrl(url)) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const type = response.headers.get("content-type") || "";
    if (!type.startsWith("image/")) return null;
    return await response.blob();
  } catch {
    return null;
  }
}

function unlockAudio() {
  if (state.unlocked) return;
  state.unlocked = true;
  const previous = audio.src;
  if (!previous) audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
  audio.play().then(() => {
    if (!previous) audio.pause();
  }).catch(() => {});
}

async function playIds(ids, index) {
  unlockAudio();
  const playable = ids.filter((id) => trackById(id));
  const current = ids[index];
  const start = Math.max(0, playable.indexOf(current));
  state.queue = playable;
  state.queueIndex = start;
  await loadCurrent(true);
}

async function loadCurrent(autoplay) {
  const id = state.queue[state.queueIndex];
  const track = trackById(id);
  if (!track) return;
  const media = await getMedia(id);
  if (!media?.audio) {
    toast("That audio file is missing from storage.");
    return;
  }
  if (audio._objectUrl) URL.revokeObjectURL(audio._objectUrl);
  audio._objectUrl = URL.createObjectURL(media.audio);
  audio.src = audio._objectUrl;
  state.currentId = id;
  await updateMediaSession(track);
  updatePlayerChrome();
  if (autoplay) {
    try {
      await audio.play();
    } catch {
      toast("Tap play once more to start audio.");
    }
  }
}

async function updateMediaSession(track) {
  if (!("mediaSession" in navigator) || !track) return;
  const artwork = [];
  const cover = await artworkUrlFor(track.id);
  if (cover) artwork.push({ src: cover, sizes: "512x512", type: "image/png" });
  artwork.push({ src: new URL("icons/icon-512.png", document.baseURI).href, sizes: "512x512", type: "image/png" });
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: "Pixel Music",
    artwork,
  });
  const actions = [
    ["play", () => audio.play()],
    ["pause", () => audio.pause()],
    ["previoustrack", () => { void step(-1); }],
    ["nexttrack", () => { void step(1); }],
    ["seekbackward", (details) => seekBy(-(details.seekOffset || 10))],
    ["seekforward", (details) => seekBy(details.seekOffset || 10)],
    ["seekto", (details) => {
      if (Number.isFinite(details.seekTime)) audio.currentTime = details.seekTime;
      publishPosition();
    }],
    ["stop", () => audio.pause()],
  ];
  for (const [name, handler] of actions) {
    try { navigator.mediaSession.setActionHandler(name, handler); } catch { /* unsupported action */ }
  }
}

function publishPosition() {
  if (!("mediaSession" in navigator) || !Number.isFinite(audio.duration)) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: audio.duration,
      playbackRate: audio.playbackRate || 1,
      position: Math.min(audio.currentTime || 0, audio.duration),
    });
  } catch { /* ignore invalid position */ }
}

function seekBy(delta) {
  if (!Number.isFinite(audio.duration)) return;
  audio.currentTime = Math.min(audio.duration, Math.max(0, (audio.currentTime || 0) + delta));
  publishPosition();
  updatePlayerChrome();
}

async function step(direction) {
  if (!state.queue.length) return;
  if (direction < 0) {
    const action = previousAction(state.queueIndex, state.queue.length, audio.currentTime || 0);
    if (action.type === "restart") {
      audio.currentTime = 0;
      publishPosition();
      return;
    }
    state.queueIndex = action.index;
  } else {
    const index = nextIndex(state.queueIndex, state.queue.length);
    if (index < 0) {
      audio.pause();
      return;
    }
    state.queueIndex = index;
  }
  await loadCurrent(true);
}

function updatePlayerChrome() {
  const track = trackById(state.currentId);
  document.querySelector("#player-title").textContent = track ? track.title : "No tape loaded";
  document.querySelector("#player-artist").textContent = track ? `${track.artist} · ${formatBytes(track.byteSize)}` : "Import a song to start";
  document.querySelector("#player-toggle").textContent = audio.paused ? "Play" : "Pause";
  document.querySelector("#player-toggle").setAttribute("aria-label", audio.paused ? "Play" : "Pause");
  document.querySelector("#time-now").textContent = formatDuration(audio.currentTime || 0);
  document.querySelector("#time-end").textContent = formatDuration(Number.isFinite(audio.duration) ? audio.duration : track?.duration);
  if (!state.seeking && Number.isFinite(audio.duration) && audio.duration > 0) {
    seek.disabled = false;
    seek.value = String(Math.round((audio.currentTime / audio.duration) * 1000));
  } else if (!track) {
    seek.disabled = true;
    seek.value = "0";
  }
  const art = document.querySelector("#player-art");
  const url = track ? artUrls.get(track.id) || "" : "";
  if (art) {
    if (url && art.tagName !== "IMG") {
      const next = artNode(url);
      next.id = "player-art";
      art.replaceWith(next);
    } else if (url && art.tagName === "IMG" && art.getAttribute("src") !== url) {
      art.src = url;
    } else if (!url && art.tagName === "IMG") {
      const empty = artNode("");
      empty.id = "player-art";
      art.replaceWith(empty);
    }
  }
  const sheetPlay = document.querySelector("#sheet-play");
  if (sheetPlay) sheetPlay.textContent = audio.paused ? "Play" : "Pause";
  const sheetSeek = document.querySelector("#sheet-seek");
  if (sheetSeek && !state.seeking && Number.isFinite(audio.duration) && audio.duration > 0) {
    sheetSeek.value = seek.value;
  }
  const sheetTimes = document.querySelectorAll("#sheet .time span");
  if (sheetTimes.length === 2) {
    sheetTimes[0].textContent = formatDuration(audio.currentTime || 0);
    sheetTimes[1].textContent = formatDuration(Number.isFinite(audio.duration) ? audio.duration : track?.duration);
  }
  document.querySelectorAll("[data-play]").forEach((button) => {
    const active = button.dataset.play === state.currentId && !audio.paused;
    button.textContent = active ? "Pause" : "Play";
  });
  document.title = track ? `${track.title} — Pixel Music` : "Pixel Music";
}

function renderSheet() {
  const sheet = document.querySelector("#sheet");
  const track = trackById(state.currentId);
  if (!state.sheetOpen || !track) {
    sheet.hidden = true;
    sheet.replaceChildren();
    return;
  }
  const cover = artUrls.get(track.id) || "";
  sheet.hidden = false;
  sheet.replaceChildren(el("div", { class: "sheet-card", role: "dialog", "aria-label": "Player" }, [
    artNode(cover, true),
    el("h2", { text: track.title }),
    el("p", { class: "help", text: track.artist }),
    el("label", { class: "seek" }, [
      el("span", { class: "visually-hidden", text: "Seek" }),
      el("input", {
        id: "sheet-seek",
        type: "range",
        min: "0",
        max: "1000",
        value: seek.value,
        oninput: (event) => {
          state.seeking = true;
          const ratio = Number(event.target.value) / 1000;
          if (Number.isFinite(audio.duration)) audio.currentTime = ratio * audio.duration;
          publishPosition();
          updatePlayerChrome();
        },
        onchange: () => { state.seeking = false; },
      }),
    ]),
    el("p", { class: "time" }, [
      el("span", { text: formatDuration(audio.currentTime || 0) }),
      el("span", { text: formatDuration(Number.isFinite(audio.duration) ? audio.duration : track.duration) }),
    ]),
    el("div", { class: "stack" }, [
      el("button", { class: "btn ghost", type: "button", text: "Prev", onclick: () => { void step(-1); } }),
      el("button", { id: "sheet-play", class: "btn", type: "button", text: audio.paused ? "Play" : "Pause", onclick: () => { unlockAudio(); audio.paused ? audio.play() : audio.pause(); } }),
      el("button", { class: "btn ghost", type: "button", text: "Next", onclick: () => { void step(1); } }),
    ]),
    el("button", { class: "btn ghost", type: "button", text: "Close", onclick: () => { state.sheetOpen = false; renderSheet(); } }),
  ]));
}

async function renderView() {
  const token = ++renderToken;
  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.setAttribute("aria-current", button.dataset.tab === state.tab ? "page" : "false");
  });
  view.replaceChildren();
  if (state.tab === "library") await renderLibrary(token);
  else if (state.tab === "playlists") await renderPlaylists(token);
  else if (state.tab === "download") renderDownload();
  else renderSettings();
  if (token !== renderToken) return;
  mountInstallHint();
  renderModal();
}

async function renderLibrary(token) {
  if (!state.tracks.length) {
    view.append(
      el("section", { class: "panel" }, [
        el("h2", { text: "Library" }),
        el("p", { class: "help", text: "No tracks yet. Import files you own, or save an official SoundCloud download, from the Get tab." }),
        el("button", { class: "btn", type: "button", text: "Import from Files", onclick: () => fileInput.click() }),
      ]),
    );
    return;
  }
  view.append(el("h2", { text: "Library" }));
  for (const track of state.tracks) {
    if (token !== renderToken) return;
    const cover = await artworkUrlFor(track.id);
    if (token !== renderToken) return;
    view.append(el("article", { class: "card" }, [
      artNode(cover),
      el("div", { class: "body" }, [
        el("p", { class: "track-title", text: track.title }),
        el("p", { class: "meta", text: `${track.artist} · ${formatDuration(track.duration)} · ${formatBytes(track.byteSize + track.artworkSize)}` }),
      ]),
      el("div", { class: "row-actions" }, [
        el("button", {
          class: "btn",
          type: "button",
          "data-play": track.id,
          text: state.currentId === track.id && !audio.paused ? "Pause" : "Play",
          onclick: () => {
            if (state.currentId === track.id) {
              unlockAudio();
              audio.paused ? audio.play() : audio.pause();
              return;
            }
            void playIds(state.tracks.map((item) => item.id), state.tracks.indexOf(track));
          },
        }),
        el("button", { class: "btn cyan", type: "button", text: "Add", onclick: () => openAdd(track.id) }),
        el("button", { class: "btn danger", type: "button", text: "Del", onclick: () => confirmDeleteTrack(track) }),
      ]),
    ]));
  }
}

async function renderPlaylists(token) {
  if (state.openPlaylistId) {
    await renderPlaylistDetail(token);
    return;
  }
  view.append(el("section", { class: "panel" }, [
    el("h2", { text: "Playlists" }),
    el("form", { class: "form", onsubmit: onCreatePlaylist }, [
      el("label", { class: "visually-hidden", for: "playlist-name", text: "Playlist name" }),
      el("input", {
        id: "playlist-name",
        value: state.playlistName,
        maxlength: "40",
        placeholder: "New playlist",
        oninput: (event) => { state.playlistName = event.target.value; },
      }),
      el("button", { class: "btn", type: "submit", text: "Make" }),
    ]),
  ]));
  if (!state.playlists.length) {
    view.append(el("p", { class: "help", text: "No playlists yet." }));
    return;
  }
  for (const playlist of state.playlists) {
    view.append(el("button", {
      class: "panel",
      type: "button",
      onclick: () => {
        state.openPlaylistId = playlist.id;
        state.renameDraft = playlist.name;
        renderView();
      },
    }, [
      el("strong", { class: "track-title", text: playlist.name }),
      el("span", { class: "meta", text: `${playlist.trackIds.length} tracks` }),
    ]));
  }
}

async function renderPlaylistDetail(token) {
  const playlist = playlistById(state.openPlaylistId);
  if (!playlist) {
    state.openPlaylistId = null;
    await renderPlaylists(token);
    return;
  }
  view.append(el("section", { class: "panel" }, [
    el("button", { class: "btn ghost", type: "button", text: "Back", onclick: () => { state.openPlaylistId = null; renderView(); } }),
    el("form", { class: "form", onsubmit: (event) => onRename(event, playlist.id) }, [
      el("label", { class: "visually-hidden", for: "rename", text: "Rename playlist" }),
      el("input", {
        id: "rename",
        value: state.renameDraft,
        maxlength: "40",
        oninput: (event) => { state.renameDraft = event.target.value; },
      }),
      el("button", { class: "btn", type: "submit", text: "Rename" }),
    ]),
    el("button", { class: "btn danger", type: "button", text: "Delete playlist", onclick: () => confirmDeletePlaylist(playlist) }),
  ]));
  if (!playlist.trackIds.length) {
    view.append(el("p", { class: "help", text: "This playlist is empty. Add tracks from the library." }));
    return;
  }
  playlist.trackIds.forEach((id, index) => {
    const track = trackById(id);
    view.append(el("article", { class: "card" }, [
      el("div", { class: "body" }, [
        el("p", { class: "track-title", text: track ? track.title : "Missing track" }),
        el("p", { class: "meta", text: track ? `${track.artist} · ${formatDuration(track.duration)}` : "Removed from the library" }),
      ]),
      el("div", { class: "row-actions" }, [
        el("button", { class: "btn", type: "button", text: "Play", disabled: !track, onclick: () => { void playIds(playlist.trackIds, index); } }),
        el("button", { class: "btn ghost", type: "button", text: "Up", disabled: index === 0, onclick: () => shift(playlist, index, -1) }),
        el("button", { class: "btn ghost", type: "button", text: "Down", disabled: index === playlist.trackIds.length - 1, onclick: () => shift(playlist, index, 1) }),
        el("button", { class: "btn danger", type: "button", text: "Remove", onclick: () => dropFromPlaylist(playlist, index) }),
      ]),
    ]));
  });
}

function renderDownload() {
  const result = state.download;
  view.append(el("section", { class: "panel" }, [
    el("h2", { text: "Get music" }),
    el("p", { class: "help", text: "Import MP3, AAC/M4A, or Opus files you own. They're stored unchanged — nothing is re-encoded." }),
    el("button", { class: "btn", type: "button", text: "Import from Files", onclick: () => fileInput.click() }),
  ]));
  const linkPanel = el("section", { class: "panel" }, [
    el("h2", { text: "SoundCloud" }),
    el("p", { class: "help", text: "Paste a track link from the share sheet. Extras like ?in= and &utm_ are ignored, including on.soundcloud.com and m.soundcloud.com short links. A file is saved only when the uploader enabled official downloads." }),
    el("form", { class: "form", onsubmit: onSoundCloudSubmit }, [
      el("label", { class: "visually-hidden", for: "sc-link", text: "SoundCloud link" }),
      el("input", {
        id: "sc-link",
        value: state.linkDraft,
        placeholder: "https://soundcloud.com/artist/track",
        autocomplete: "off",
        spellcheck: "false",
        oninput: (event) => { state.linkDraft = event.target.value; },
      }),
      el("button", { class: "btn cyan", type: "submit", text: result.busy ? "Wait" : "Check", disabled: result.busy }),
    ]),
    el("button", { class: "btn ghost", type: "button", text: "Paste", onclick: pasteLink }),
  ]);
  view.append(linkPanel);
  if (result.preview || result.message) {
    const notice = el("section", { class: result.code === "saved" ? "notice ok" : "notice" });
    if (result.preview?.artworkUrl && isAllowedArtworkUrl(result.preview.artworkUrl)) {
      notice.append(el("img", { class: "art lg", src: result.preview.artworkUrl, alt: "" }));
    }
    if (result.preview) {
      notice.append(el("p", { class: "track-title", text: result.preview.title || "Untitled" }));
      notice.append(el("p", { class: "meta", text: result.preview.artist || "" }));
    }
    if (result.normalizedUrl) notice.append(el("p", { class: "fine", text: result.normalizedUrl }));
    if (result.message) notice.append(el("p", { class: "help", text: result.message }));
    if (IMPORT_CODES.has(result.code)) {
      notice.append(el("button", { class: "btn", type: "button", text: "Import from Files", onclick: () => fileInput.click() }));
    }
    view.append(notice);
  }
}

function renderSettings() {
  const storage = state.storage;
  const quota = storage.quota ? `${formatBytes(storage.usage || 0)} of about ${formatBytes(storage.quota)} used by this site` : "Browser quota unavailable";
  view.append(el("section", { class: "panel" }, [
    el("h2", { text: "Storage" }),
    el("p", { class: "help", text: `${formatBytes(storage.used)} in your library, counting audio and artwork.` }),
    el("p", { class: "help", text: quota }),
    el("p", { class: "help", text: storage.persisted ? "Persistent storage is on." : "Persistent storage is off. Safari may delete data if space runs low." }),
    el("button", { class: "btn", type: "button", text: "Keep on this iPhone", onclick: onPersist }),
  ]));
  view.append(el("section", { class: "panel" }, [
    el("h2", { text: "SoundCloud API" }),
    el("p", { class: "help", text: "Official downloads need your own SoundCloud app credentials. They're saved in this device's library database and are never included in the app." }),
    el("form", { class: "stack", onsubmit: onSaveSettings }, [
      el("label", { class: "field", text: "Client ID" }, [
        el("input", {
          id: "client-id",
          value: state.settings.clientId,
          autocomplete: "off",
          spellcheck: "false",
          oninput: (event) => { state.settings.clientId = event.target.value; },
        }),
      ]),
      el("label", { class: "field", text: "Client secret" }, [
        el("input", {
          id: "client-secret",
          type: "password",
          value: state.settings.clientSecret,
          autocomplete: "off",
          oninput: (event) => { state.settings.clientSecret = event.target.value; },
        }),
      ]),
      el("div", { class: "inline" }, [
        el("button", { class: "btn", type: "submit", text: "Save" }),
        el("button", { class: "btn danger", type: "button", text: "Clear", onclick: clearSettings }),
      ]),
    ]),
  ]));
}

function renderModal() {
  const root = document.querySelector("#modal");
  if (!state.modal) {
    root.hidden = true;
    root.replaceChildren();
    return;
  }
  const modal = state.modal;
  root.hidden = false;
  root.replaceChildren(el("div", { class: "modal-card", role: "dialog", "aria-modal": "true" }, [
    el("h2", { text: modal.title }),
    el("p", { class: "help", text: modal.body }),
    modal.extra || null,
    el("div", { class: "inline" }, [
      el("button", { class: "btn ghost", type: "button", text: "Cancel", onclick: () => { state.modal = null; renderModal(); } }),
      el("button", { class: "btn danger", type: "button", text: modal.confirmLabel, onclick: () => { const run = modal.onConfirm; state.modal = null; renderModal(); run(); } }),
    ]),
  ]));
}

function confirmDeleteTrack(track) {
  state.modal = {
    title: "Delete track",
    body: `Remove “${track.title}” and its audio from this device?`,
    confirmLabel: "Delete",
    onConfirm: () => { void deleteTrack(track.id); },
  };
  renderModal();
}

function confirmDeletePlaylist(playlist) {
  state.modal = {
    title: "Delete playlist",
    body: `Delete “${playlist.name}”? The songs stay in your library.`,
    confirmLabel: "Delete",
    onConfirm: () => { void removePlaylist(playlist.id); },
  };
  renderModal();
}

function openAdd(trackId) {
  const buttons = state.playlists.length
    ? el("div", { class: "stack" }, state.playlists.map((playlist) => el("button", {
      class: "btn cyan",
      type: "button",
      text: playlist.name,
      onclick: () => { void addToPlaylist(playlist.id, trackId); },
    })))
    : el("p", { class: "help", text: "Make a playlist on the Lists tab first." });
  state.modal = {
    title: "Add to playlist",
    body: "Choose a playlist.",
    confirmLabel: "Close",
    extra: buttons,
    onConfirm: () => {},
  };
  renderModal();
}

async function onCreatePlaylist(event) {
  event.preventDefault();
  const result = createPlaylist(state.playlists, state.playlistName);
  if (!result.ok) {
    toast(result.code === "name-too-long" ? "That name is too long." : "Enter a playlist name.");
    return;
  }
  state.playlists = result.playlists;
  state.playlistName = "";
  await replacePlaylists(state.playlists);
  toast("Playlist created.");
  await renderView();
}

async function onRename(event, id) {
  event.preventDefault();
  const result = renamePlaylist(state.playlists, id, state.renameDraft);
  if (!result.ok) {
    toast(result.code === "name-too-long" ? "That name is too long." : "Enter a playlist name.");
    return;
  }
  state.playlists = result.playlists;
  await replacePlaylists(state.playlists);
  toast("Renamed.");
  await renderView();
}

async function shift(playlist, index, delta) {
  const next = moveTrack(playlist, index, delta);
  state.playlists = state.playlists.map((item) => (item.id === playlist.id ? next : item));
  await replacePlaylists(state.playlists);
  await renderView();
}

async function dropFromPlaylist(playlist, index) {
  const next = removeTrackAt(playlist, index);
  state.playlists = state.playlists.map((item) => (item.id === playlist.id ? next : item));
  await replacePlaylists(state.playlists);
  await renderView();
}

async function addToPlaylist(playlistId, trackId) {
  const playlist = playlistById(playlistId);
  const result = addTrack(playlist, trackId);
  state.modal = null;
  if (!result.ok) {
    toast(result.code === "duplicate" ? "Already in that playlist." : "Couldn't add that track.");
    renderModal();
    return;
  }
  state.playlists = state.playlists.map((item) => (item.id === playlistId ? result.playlist : item));
  await replacePlaylists(state.playlists);
  renderModal();
  toast("Added to playlist.");
}

async function removePlaylist(id) {
  state.playlists = deletePlaylist(state.playlists, id);
  state.openPlaylistId = null;
  await replacePlaylists(state.playlists);
  toast("Playlist deleted.");
  await renderView();
}

async function deleteTrack(id) {
  const removed = artUrls.get(id);
  if (removed) URL.revokeObjectURL(removed);
  artUrls.delete(id);
  const next = removeTrackEverywhere(state.tracks, state.playlists, id);
  try {
    await deleteTrackData(id);
    await replacePlaylists(next.playlists);
  } catch {
    toast("Couldn't delete that track.");
    return;
  }
  if (state.currentId === id) {
    audio.pause();
    audio.removeAttribute("src");
    state.currentId = null;
    state.queue = state.queue.filter((item) => item !== id);
  }
  await refresh();
  toast("Track deleted.");
}

async function onSaveSettings(event) {
  event.preventDefault();
  const previous = await loadSettings();
  const changed = previous.clientId !== state.settings.clientId.trim() || previous.clientSecret !== state.settings.clientSecret.trim();
  state.settings = {
    clientId: state.settings.clientId.trim(),
    clientSecret: state.settings.clientSecret.trim(),
    token: changed ? null : state.settings.token,
  };
  await saveSettings(state.settings);
  toast("API credentials saved on this device.");
}

async function clearSettings() {
  state.settings = { clientId: "", clientSecret: "", token: null };
  await saveSettings(state.settings);
  await renderView();
  toast("API credentials cleared.");
}

async function onPersist() {
  if (!navigator.storage?.persist) {
    toast("This browser doesn't support storage persistence.");
    return;
  }
  const granted = await navigator.storage.persist();
  await refreshStorage();
  await renderView();
  toast(granted ? "Safari will try to keep your music on this device." : "Safari didn't grant persistent storage. Opening from the Home Screen helps.");
}

async function pasteLink() {
  try {
    const text = await navigator.clipboard.readText();
    state.linkDraft = text.trim();
    await renderView();
  } catch {
    toast("Clipboard is blocked. Long-press the field and paste.");
  }
}

function mountInstallHint() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  let dismissed = false;
  try { dismissed = localStorage.getItem("pixel-music-hint") === "1"; } catch { dismissed = false; }
  if (!ios || standalone || dismissed) return;
  const hint = el("div", { id: "hint", class: "hint" }, [
    el("p", { class: "help", text: "Install from Safari: Share, then Add to Home Screen. Open Pixel Music from the icon for offline playback and lock-screen controls." }),
    el("button", {
      class: "btn ghost",
      type: "button",
      text: "Hide",
      onclick: () => {
        try { localStorage.setItem("pixel-music-hint", "1"); } catch { /* private mode */ }
        hint.remove();
      },
    }),
  ]);
  view.prepend(hint);
}

function bindChrome() {
  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.addEventListener("click", () => setTab(button.dataset.tab));
  });
  fileInput.addEventListener("change", () => { void importFiles(fileInput.files); });
  document.querySelector("#player-toggle").addEventListener("click", () => {
    unlockAudio();
    if (!state.currentId) {
      if (state.tracks[0]) void playIds(state.tracks.map((track) => track.id), 0);
      return;
    }
    audio.paused ? audio.play() : audio.pause();
  });
  document.querySelector("#player-open").addEventListener("click", () => {
    if (!state.currentId) return;
    state.sheetOpen = true;
    renderSheet();
  });
  seek.addEventListener("input", () => {
    state.seeking = true;
    if (Number.isFinite(audio.duration)) audio.currentTime = (Number(seek.value) / 1000) * audio.duration;
    publishPosition();
    updatePlayerChrome();
  });
  seek.addEventListener("change", () => { state.seeking = false; });
  audio.addEventListener("play", () => {
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
    updatePlayerChrome();
  });
  audio.addEventListener("pause", () => {
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
    updatePlayerChrome();
  });
  audio.addEventListener("ended", () => { void step(1); });
  audio.addEventListener("timeupdate", () => {
    const now = Date.now();
    updatePlayerChrome();
    if (now - positionTimer > 1000) {
      positionTimer = now;
      publishPosition();
    }
  });
  audio.addEventListener("loadedmetadata", publishPosition);
}

async function init() {
  bindChrome();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch { /* persistence is optional */ }
  state.settings = await loadSettings();
  await refresh();
}

init().catch(() => {
  view.textContent = "This browser can't open the on-device music library.";
});
