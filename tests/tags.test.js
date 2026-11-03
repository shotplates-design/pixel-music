import assert from "node:assert/strict";
import test from "node:test";
import { readTags } from "../js/tags.js";

function concat(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function synchsafe(size) {
  return [(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f];
}

function textFrame(id, text) {
  const body = concat([Uint8Array.of(3), new TextEncoder().encode(text)]);
  const frame = new Uint8Array(10 + body.length);
  frame.set(new TextEncoder().encode(id));
  new DataView(frame.buffer).setUint32(4, body.length);
  frame.set(body, 10);
  return frame;
}

function atom(type, payload) {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(type, 4);
  out.set(payload, 8);
  return out;
}

test("reads ID3 title, artist, and artwork", () => {
  const apicBody = concat([
    Uint8Array.of(0),
    new TextEncoder().encode("image/jpeg"),
    Uint8Array.of(0, 3, 0),
    new TextEncoder().encode("COVER"),
  ]);
  const apic = new Uint8Array(10 + apicBody.length);
  apic.set(new TextEncoder().encode("APIC"));
  new DataView(apic.buffer).setUint32(4, apicBody.length);
  apic.set(apicBody, 10);
  const frames = concat([textFrame("TIT2", "FOMDJ"), textFrame("TPE1", "Playboi Carti"), apic]);
  const tag = concat([Uint8Array.of(0x49, 0x44, 0x33, 3, 0, 0, ...synchsafe(frames.length)), frames]);
  const tags = readTags(tag);
  assert.equal(tags.title, "FOMDJ");
  assert.equal(tags.artist, "Playboi Carti");
  assert.equal(tags.artwork.mime, "image/jpeg");
  assert.equal(new TextDecoder().decode(tags.artwork.data), "COVER");
});

test("reads MP4 name, artist, and cover without altering audio atoms", () => {
  const textData = (value) => {
    const bytes = new TextEncoder().encode(value);
    const payload = new Uint8Array(8 + bytes.length);
    new DataView(payload.buffer).setUint32(0, 1);
    payload.set(bytes, 8);
    return atom(new TextEncoder().encode("data"), payload);
  };
  const nam = atom(Uint8Array.of(0xa9, 0x6e, 0x61, 0x6d), textData("Night"));
  const art = atom(Uint8Array.of(0xa9, 0x41, 0x52, 0x54), textData("DJ"));
  const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9);
  const covrPayload = new Uint8Array(8 + jpeg.length);
  new DataView(covrPayload.buffer).setUint32(0, 13);
  covrPayload.set(jpeg, 8);
  const covr = atom(new TextEncoder().encode("covr"), atom(new TextEncoder().encode("data"), covrPayload));
  const ilst = atom(new TextEncoder().encode("ilst"), concat([nam, art, covr]));
  const meta = atom(new TextEncoder().encode("meta"), concat([new Uint8Array(4), ilst]));
  const file = atom(new TextEncoder().encode("moov"), atom(new TextEncoder().encode("udta"), meta));
  const tags = readTags(file);
  assert.equal(tags.title, "Night");
  assert.equal(tags.artist, "DJ");
  assert.deepEqual(tags.artwork.data, jpeg);
  assert.equal(tags.artwork.mime, "image/jpeg");
});
