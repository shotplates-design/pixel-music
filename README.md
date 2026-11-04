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
6. Import songs on **Import**. The first visit needs a network so the shell can cache. After that, saved tracks play offline.

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

## Import

**Import** adds audio you already have. Choose **Import from Files**, then pick MP3, AAC/M4A, or Opus files. The original bytes are saved in IndexedDB. Nothing is re-encoded.

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

The tests cover playlist editing, storage math, and ID3/MP4 tag reads.

## GitHub Pages

`.github/workflows/pages.yml` runs the tests on every push and pull request. Pushes to `main` upload the static site and deploy it with GitHub's Pages actions.

In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**. The site is served from the project path (`https://<user>.github.io/<repo>/`). Icons, the manifest, and the service worker use relative URLs so that path works. The workflow does not deploy pull requests.

## Fonts

- [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) by CodeMan38, SIL Open Font License. See `fonts/OFL-PressStart2P.txt`.
- [Silkscreen](https://fonts.google.com/specimen/Silkscreen) by Jason Kottke, SIL Open Font License. See `fonts/OFL-Silkscreen.txt`.
