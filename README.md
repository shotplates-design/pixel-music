# Pixel Music

Pixel Music is a personal, installable music player. It is a static site: HTML, CSS, and JavaScript, with no build step. Audio you import stays on the device in IndexedDB. The app shell is cached by a service worker so the player still opens offline.

The interface is a chunky pixel-art UI (Press Start 2P and Silkscreen, hard borders, a dark retro palette) laid out for a phone.

## Install on iPhone

Add to Home Screen only works from Safari. Chrome on iOS cannot install this as a standalone app.

1. Open the GitHub Pages URL in **Safari** (after the Pages workflow has deployed `main`).
2. Tap the **Share** button.
3. Tap **Add to Home Screen**, then **Add**.
4. Open **Pixel Music** from the new home-screen icon. It runs full screen, can play with the screen locked, and uses the Media Session API for lock-screen play, pause, next, previous, and seek.
5. In the app, open **Set** and tap **Keep on this iPhone**. Safari may still decline; installing to the Home Screen makes it more likely to keep the library.
6. Import songs on **Get**, or paste a SoundCloud track link. The first visit needs a network so the shell can cache. After that, saved tracks play offline.

On a computer, any current browser can use the same site. Playback controls sit at the bottom of the phone-sized column.

## Library

The library lists every saved track with artwork, title, artist, duration, and the bytes stored for that track (audio plus artwork). The header shows the library total. **Play** starts that track; the bottom bar seeks, pauses, and moves to the next or previous track. Opening the bar shows a larger player. **Del** removes the audio from this device and from any playlists.

Accepted imports, stored byte-for-byte with no re-encoding:

- MP3
- AAC / M4A (including `.aac`)
- Opus (`.opus`, `.ogg`, or `audio/webm`)

Other files are refused. Opus may not play on older iOS versions; the original file is still kept.

## Playlists

**Lists** creates, renames, and deletes playlists. Open one to add tracks from the library, remove them, or move them up and down.

## SoundCloud

Paste a track link on **Get**. Links from the iOS share sheet are normalized before anything is requested:

`https://soundcloud.com/playboicarti/fomdj-2?in=playboicarti/sets/music-sorry-4-da-wait&utm_source=clipboard&utm_medium=text&utm_campaign=social_sharing`

becomes `https://soundcloud.com/playboicarti/fomdj-2`. The `in` parameter is only the playlist the share sheet was sitting in. `utm_*` parameters are campaign tags. Neither one changes which track is checked. `m.soundcloud.com` track links are rewritten to `soundcloud.com`. One-segment `on.soundcloud.com` and `m.soundcloud.com` short links are kept and resolved by the official API. A real `/sets/` link is treated as a playlist, not a track.

A file is saved only when SoundCloud says the uploader turned downloads on:

1. [oEmbed](https://developers.soundcloud.com/docs/oembed) supplies a title, artist, and thumbnail. The embed HTML is ignored, so the widget player is never injected.
2. Your API credentials mint an OAuth client-credentials token (`POST https://secure.soundcloud.com/oauth/token`). The secret is sent only to that host, in the `Authorization: Basic` header, not in the URL. Tokens are reused until they are close to expiry because SoundCloud rate-limits new tokens.
3. `GET https://api.soundcloud.com/resolve` loads the track.
4. The track is saved only when `downloadable` is `true` and `download_url` is `https://api.soundcloud.com/tracks/{id}/download`. The response body is stored as-is.

If the uploader has not enabled downloads, the app does not request a stream, `/streams`, or `api-v2.soundcloud.com`. It shows a message and an **Import from Files** button so you can add a file you bought. The same happens if the official endpoint returns a stream playlist instead of an audio file.

### API credentials

SoundCloud's public API needs a client ID and client secret from an app you register. Artist Pro is currently required to create one. See [Get an API key](https://developers.soundcloud.com/docs/api/register-app).

Enter both values under **Set**. They are stored in IndexedDB on this device only. Do not put them in the repository, in GitHub Actions, or in a committed `.env` file. There is no secret in this project. Clearing the fields deletes them from the device.

If the file host that serves an official download does not allow this site to read the response, nothing is saved and the app asks you to import the purchased file instead. It will not fall back to a stream.

## Storage

Audio and artwork live in IndexedDB. On launch the app calls `navigator.storage.persist()` and the settings screen can ask again. Each track row shows its own size; the header and settings screen show the total, plus the browser's estimate of site usage and quota when that API exists.

## Develop

Serve the folder over HTTP so the service worker can register:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

Run the unit tests (Node 22, no dependencies):

```bash
node --test
```

The tests cover share-link normalization, the official-download gate, playlist editing, storage math, and ID3/MP4 tag reads. They do not call SoundCloud.

## GitHub Pages

`.github/workflows/pages.yml` runs the tests on every push and pull request. Pushes to `main` upload the static site and deploy it with GitHub's Pages actions.

In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**. The site is served from the project path (`https://<user>.github.io/<repo>/`). Icons, the manifest, and the service worker use relative URLs so that path works. The workflow does not deploy pull requests.

## Fonts

- [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) by CodeMan38, SIL Open Font License. See `fonts/OFL-PressStart2P.txt`.
- [Silkscreen](https://fonts.google.com/specimen/Silkscreen) by Jason Kottke, SIL Open Font License. See `fonts/OFL-Silkscreen.txt`.
