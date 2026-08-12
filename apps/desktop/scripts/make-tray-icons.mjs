// Generates the menu-bar tray icons.
//
// macOS template images must be black-with-alpha only: the system inverts them
// for light/dark menu bars and for the highlighted state. Any colour here would
// break that, so the icons are drawn as pure alpha masks.
//
// Run via `pnpm icons`; output is committed so a normal build needs no
// image tooling.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../resources");

/** Anti-aliased filled circle, as an 8-bit alpha coverage map. */
function recordDot(size) {
  const pixels = new Uint8Array(size * size);
  const centre = (size - 1) / 2;
  const radius = size * 0.34;
  const samples = 4;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = x + (sx + 0.5) / samples - 0.5;
          const py = y + (sy + 0.5) / samples - 0.5;
          if (Math.hypot(px - centre, py - centre) <= radius) hits++;
        }
      }
      pixels[y * size + x] = Math.round((hits / (samples * samples)) * 255);
    }
  }
  return pixels;
}

/** Circle outline — used for the idle state, so recording reads as "filled". */
function recordRing(size) {
  const pixels = new Uint8Array(size * size);
  const centre = (size - 1) / 2;
  const outer = size * 0.36;
  const inner = outer - Math.max(1.2, size * 0.09);
  const samples = 4;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = x + (sx + 0.5) / samples - 0.5;
          const py = y + (sy + 0.5) / samples - 0.5;
          const d = Math.hypot(px - centre, py - centre);
          if (d <= outer && d >= inner) hits++;
        }
      }
      pixels[y * size + x] = Math.round((hits / (samples * samples)) * 255);
    }
  }
  return pixels;
}

function crc32(buf) {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Encodes an alpha map as a greyscale+alpha PNG with every pixel black. */
function encodePng(alpha, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 4; // colour type: greyscale + alpha

  // One filter byte per scanline (0 = none), then grey/alpha pairs.
  const raw = Buffer.alloc(size * (1 + size * 2));
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < size; x++) {
      raw[offset++] = 0; // black
      raw[offset++] = alpha[y * size + x];
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });

// The `Template` suffix is what tells macOS to treat these as template images.
for (const [name, draw] of [
  ["idleTemplate", recordRing],
  ["recordingTemplate", recordDot],
]) {
  for (const [suffix, size] of [
    ["", 16],
    ["@2x", 32],
  ]) {
    const file = resolve(OUT_DIR, `${name}${suffix}.png`);
    writeFileSync(file, encodePng(draw(size), size));
    console.log(`wrote ${file}`);
  }
}
