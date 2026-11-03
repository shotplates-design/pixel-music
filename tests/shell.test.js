import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("the installable shell is static and precached files exist", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /manifest\.json/);
  assert.match(html, /playsinline/);
  assert.match(html, /viewport-fit=cover/);
  const worker = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  const assets = [...worker.matchAll(/"(\.\/[^"]+)"/g)].map((match) => match[1]);
  assert.ok(assets.length > 10);
  for (const asset of assets) {
    const file = new URL(`../${asset.slice(2)}`, import.meta.url);
    assert.equal(existsSync(file), true, asset);
  }
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  assert.match(app, /mediaSession/);
  assert.match(app, /navigator\.storage\.persist/);
  assert.doesNotMatch(app, /AudioContext|MediaRecorder|ffmpeg/);
  const workflow = readFileSync(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");
  assert.match(workflow, /deploy-pages/);
  assert.match(workflow, /node --test/);
});
