// Builds the macOS app icon from the artwork in `build/icon-source.png`.
//
// The artwork is masked to the system's rounded rect and otherwise left alone:
// it fills the canvas edge to edge.
//
// The mask is here because older macOS draws exactly the pixels it is given —
// unlike iOS, it applies no shape of its own — so a bare square sits in the
// Dock as a hard-edged square next to every other app's squircle.
//
// The *inset* is deliberately not here, and this is the part that is easy to
// get wrong. A macOS icon is conventionally drawn at 824 of its 1024 points,
// with the margin left transparent. Recent macOS reshapes legacy icons itself
// and supplies that margin, so artwork that already carries one comes out
// visibly smaller than its neighbours and double-rounded. Full-bleed is the
// input both behaviours want: the system's mask lands on the same edge this
// one does, and where there is no system mask the shape is already correct.
//
// The mask is drawn here; the compositing and the resizing are ffmpeg and sips,
// which are already what the media tests use. Output is committed, so a normal
// build needs no image tooling — same rule as `make-tray-icons.mjs`.
//
// The source lives in `build/` rather than `resources/`: electron-builder
// treats `build/` as build resources and does not package it, and a 1024px
// master has no business shipping inside the app.
//
// Run via `pnpm app-icon`.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = resolve(ROOT, "build/icon-source.png");
const BUILD = resolve(ROOT, "build");

/** The canvas an icon is laid out on, and all of what the artwork occupies. */
const CANVAS = 1024;

/**
 * Corner radius as a fraction of the artwork.
 *
 * 0.2237 is the macOS icon shape. Paired with the superellipse exponent below
 * rather than a circular corner: a circular one meets the straight edges at a
 * visible seam, which is exactly the tell that an icon was not made for macOS.
 */
const RADIUS = 0.2237;

/** 4 is the squircle, matching the `squircle` utility the app's own UI uses. */
const EXPONENT = 4;

/** Supersampling per axis, to keep the curve smooth at full size. */
const SAMPLES = 4;

/** The sizes an `.icns` is expected to carry. */
const ICONSET = [16, 32, 128, 256, 512];

/** A superellipse-cornered rounded square, as an 8-bit coverage mask. */
function mask(size) {
  const pixels = new Uint8Array(size * size);
  const half = size / 2;
  const radius = size * RADIUS;
  const straight = half - radius;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          // Distance past the straight part of each edge. Inside it both are
          // zero and the point is trivially in.
          const dx = Math.max(Math.abs(x + (sx + 0.5) / SAMPLES - half) - straight, 0);
          const dy = Math.max(Math.abs(y + (sy + 0.5) / SAMPLES - half) - straight, 0);

          if ((dx / radius) ** EXPONENT + (dy / radius) ** EXPONENT <= 1) hits++;
        }
      }

      pixels[y * size + x] = Math.round((hits / (SAMPLES * SAMPLES)) * 255);
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

/**
 * Encodes a coverage map as a plain greyscale PNG.
 *
 * Greyscale rather than greyscale+alpha because `alphamerge` reads the *luma*
 * of its second input: white keeps a pixel, black drops it. An alpha channel
 * here would be ignored, and a black-with-alpha mask — which is what the tray
 * icons are — would silently erase the whole image.
 */
function encodePng(coverage, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // colour type: greyscale

  const raw = Buffer.alloc(size * (1 + size));
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0; // filter: none
    for (let x = 0; x < size; x++) raw[offset++] = coverage[y * size + x];
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(BUILD, { recursive: true });

const maskFile = resolve(BUILD, "icon-mask.png");
const iconPng = resolve(BUILD, "icon.png");
const iconset = resolve(BUILD, "icon.iconset");

writeFileSync(maskFile, encodePng(mask(CANVAS), CANVAS));

// Scaled to the canvas and masked to the shape. No padding step: the corners
// the mask cuts away are the only transparency in the result.
execFileSync("ffmpeg", [
  "-y",
  "-loglevel",
  "error",
  "-i",
  SOURCE,
  "-i",
  maskFile,
  "-filter_complex",
  `[0:v]scale=${CANVAS}:${CANVAS},format=rgba[art];[art][1:v]alphamerge,format=rgba[out]`,
  "-map",
  "[out]",
  "-frames:v",
  "1",
  iconPng,
]);

rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });

for (const size of ICONSET) {
  for (const [suffix, pixels] of [
    ["", size],
    ["@2x", size * 2],
  ]) {
    execFileSync("sips", [
      "-z",
      String(pixels),
      String(pixels),
      iconPng,
      "--out",
      resolve(iconset, `icon_${size}x${size}${suffix}.png`),
    ]);
  }
}

execFileSync("iconutil", ["-c", "icns", iconset, "-o", resolve(BUILD, "icon.icns")]);

// Intermediates. The `.icns` and the 1024 PNG are what ship; leaving a mask and
// an iconset behind would only invite someone to edit the wrong one.
rmSync(iconset, { recursive: true, force: true });
rmSync(maskFile, { force: true });

console.log(`wrote ${resolve(BUILD, "icon.icns")} and ${iconPng}`);
