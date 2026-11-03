function ascii(bytes, offset, length) {
  let text = "";
  for (let index = 0; index < length; index += 1) text += String.fromCharCode(bytes[offset + index]);
  return text;
}

function latin1(bytes) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

function decodeSynchsafe(view, offset) {
  return ((view.getUint8(offset) & 0x7f) << 21)
    | ((view.getUint8(offset + 1) & 0x7f) << 14)
    | ((view.getUint8(offset + 2) & 0x7f) << 7)
    | (view.getUint8(offset + 3) & 0x7f);
}

function decodeTextFrame(frame) {
  if (!frame.length) return "";
  const encoding = frame[0];
  const raw = frame.subarray(1);
  if (encoding === 0) return latin1(raw).replace(/\0+$/g, "").trim();
  if (encoding === 3) return new TextDecoder("utf-8").decode(raw).replace(/\0+$/g, "").trim();
  if (encoding === 1 || encoding === 2) {
    const decoder = new TextDecoder(encoding === 1 ? "utf-16" : "utf-16be");
    return decoder.decode(raw).replace(/\0+$/g, "").trim();
  }
  return "";
}

function decodeApic(frame) {
  if (frame.length < 4) return null;
  const encoding = frame[0];
  let cursor = 1;
  const mimeEnd = frame.indexOf(0, cursor);
  if (mimeEnd < 0) return null;
  const mime = latin1(frame.subarray(cursor, mimeEnd)) || "image/jpeg";
  cursor = mimeEnd + 1;
  if (cursor >= frame.length) return null;
  cursor += 1;
  if (encoding === 1 || encoding === 2) {
    while (cursor + 1 < frame.length && !(frame[cursor] === 0 && frame[cursor + 1] === 0)) cursor += 2;
    cursor += 2;
  } else {
    const descEnd = frame.indexOf(0, cursor);
    if (descEnd < 0) return null;
    cursor = descEnd + 1;
  }
  if (cursor >= frame.length) return null;
  return { mime, data: frame.subarray(cursor) };
}

function readId3(bytes) {
  if (bytes.length < 10) return null;
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null;
  const version = bytes[3];
  if (version < 2 || version > 4) return null;
  const flags = bytes[5];
  if (flags & 0x80) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tagSize = decodeSynchsafe(view, 6);
  let offset = 10;
  const end = Math.min(bytes.length, 10 + tagSize);
  if ((version === 3 || version === 4) && (flags & 0x40)) {
    if (offset + 4 > end) return null;
    const extended = version === 4 ? decodeSynchsafe(view, offset) : 4 + view.getUint32(offset);
    offset += extended;
  }
  let title = "";
  let artist = "";
  let artwork = null;
  if (version === 2) {
    while (offset + 6 <= end) {
      const id = ascii(bytes, offset, 3);
      if (!id || id.charCodeAt(0) === 0) break;
      const size = (bytes[offset + 3] << 16) | (bytes[offset + 4] << 8) | bytes[offset + 5];
      offset += 6;
      if (size < 0 || offset + size > end) break;
      const frame = bytes.subarray(offset, offset + size);
      if (id === "TT2" && !title) title = decodeTextFrame(frame);
      else if (id === "TP1" && !artist) artist = decodeTextFrame(frame);
      offset += size;
    }
  } else {
    while (offset + 10 <= end) {
      const id = ascii(bytes, offset, 4);
      if (!id || id === "\0\0\0\0") break;
      const size = version === 4 ? decodeSynchsafe(view, offset + 4) : view.getUint32(offset + 4);
      offset += 10;
      if (size <= 0 || offset + size > end) break;
      const frame = bytes.subarray(offset, offset + size);
      if (id === "TIT2" && !title) title = decodeTextFrame(frame);
      else if (id === "TPE1" && !artist) artist = decodeTextFrame(frame);
      else if (id === "APIC" && !artwork) artwork = decodeApic(frame);
      offset += size;
    }
  }
  if (!title && !artist && !artwork) return null;
  return { title, artist, artwork };
}

function readDataText(bytes, view, start, end) {
  if (start + 16 > end) return "";
  const size = view.getUint32(start);
  if (ascii(bytes, start + 4, 4) !== "data" || size < 16 || start + size > end) return "";
  return new TextDecoder("utf-8").decode(bytes.subarray(start + 16, start + size)).replace(/\0+$/g, "").trim();
}

function readCovr(bytes, view, start, end) {
  if (start + 16 > end) return null;
  const size = view.getUint32(start);
  if (ascii(bytes, start + 4, 4) !== "data" || size <= 16 || start + size > end) return null;
  const kind = view.getUint32(start + 8) & 0xff;
  const mime = kind === 14 ? "image/png" : "image/jpeg";
  const data = bytes.subarray(start + 16, start + size);
  if (!data.length) return null;
  return { mime, data };
}

function readMp4(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let title = "";
  let artist = "";
  let artwork = null;

  function walk(start, end, parent) {
    let cursor = parent === "meta" ? start + 4 : start;
    while (cursor + 8 <= end) {
      let size = view.getUint32(cursor);
      const type = ascii(bytes, cursor + 4, 4);
      let header = 8;
      if (size === 1 && cursor + 16 <= end) {
        const wide = view.getBigUint64(cursor + 8);
        if (wide > BigInt(Number.MAX_SAFE_INTEGER)) return;
        size = Number(wide);
        header = 16;
      } else if (size === 0) {
        size = end - cursor;
      }
      if (size < header || cursor + size > end) return;
      const childStart = cursor + header;
      const childEnd = cursor + size;
      if (type === "moov" || type === "udta" || type === "ilst" || type === "meta") {
        walk(childStart, childEnd, type);
      } else if (type === "\u00a9nam" && !title) {
        title = readDataText(bytes, view, childStart, childEnd);
      } else if (type === "\u00a9ART" && !artist) {
        artist = readDataText(bytes, view, childStart, childEnd);
      } else if (type === "covr" && !artwork) {
        artwork = readCovr(bytes, view, childStart, childEnd);
      }
      cursor += size;
    }
  }

  walk(0, bytes.length, "");
  if (!title && !artist && !artwork) return null;
  return { title, artist, artwork };
}

export function readTags(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  return readId3(bytes) || readMp4(bytes) || { title: "", artist: "", artwork: null };
}
