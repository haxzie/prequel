// Generates the pointer drawn into recordings.
//
// Recordings are captured with the system cursor switched off, so the pointer
// is composited afterwards from the positions sampled during capture. That
// needs an image, and it has to be one both rasterisers can load: the canvas
// preview and the Rust exporter each read it as an ordinary PNG.
//
// Drawn here rather than taken from macOS: `NSCursor`'s image is not reachable
// from the capture crate, and a bitmap lifted at 32px would be soft at any
// sensible size in a 4K frame. This is a vector arrow rasterised large.
//
// Run via `pnpm cursor`; output is committed so a normal build needs no image
// tooling. Same reasoning, and the same PNG writer, as `make-tray-icons.mjs`.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../resources");

/** Drawn at this size, then scaled down at use. Large enough for a 4K frame. */
const SIZE = 128;

/** Black outline, in image pixels. What keeps a white arrow visible on white. */
const OUTLINE = SIZE * 0.055;

/** Supersampling per axis. 16 samples a pixel is enough to hide the stairs. */
const SAMPLES = 4;

/**
 * The macOS arrow, as fractions of its own bounding box, tip at the origin.
 *
 * Wound as one closed loop: straight down the left edge, out to the notch, down
 * the tail, and back up to the tip.
 */
const ARROW = [
  [0, 0],
  [0, 0.75],
  [0.19, 0.58],
  [0.3, 0.86],
  [0.43, 0.81],
  [0.32, 0.53],
  [0.56, 0.53],
];

/** Ratio of the arrow's own width to its height. */
const ASPECT = 0.56 / 0.86;

/** Arrow scaled into the image, leaving room for the outline on every side. */
function polygon() {
  const height = SIZE - OUTLINE * 2;
  const width = height * ASPECT;

  return ARROW.map(([x, y]) => [OUTLINE + (x / 0.56) * width, OUTLINE + (y / 0.86) * height]);
}

/** Even-odd ray cast. The arrow is simple, so this needs no winding rule. */
function inside(points, px, py) {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Shortest distance from a point to the polygon's boundary. */
function distance(points, px, py) {
  let best = Infinity;

  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const dx = xj - xi;
    const dy = yj - yi;
    const len = dx * dx + dy * dy;
    // A degenerate edge collapses to its endpoint rather than dividing by zero.
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - xi) * dx + (py - yi) * dy) / len));
    best = Math.min(best, Math.hypot(px - (xi + t * dx), py - (yi + t * dy)));
  }

  return best;
}

/**
 * White fill inside the outline, black within it, transparent beyond.
 *
 * Accumulated per subsample rather than composited in two passes: a black shape
 * with a white one drawn over it leaves a grey seam wherever the two edges
 * antialias against each other.
 */
function draw() {
  const points = polygon();
  const rgba = new Uint8Array(SIZE * SIZE * 4);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let white = 0;
      let black = 0;

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = x + (sx + 0.5) / SAMPLES;
          const py = y + (sy + 0.5) / SAMPLES;
          const within = inside(points, px, py);
          const d = distance(points, px, py);

          if (within) white++;
          else if (d <= OUTLINE) black++;
        }
      }

      const total = SAMPLES * SAMPLES;
      const covered = white + black;
      const at = (y * SIZE + x) * 4;

      // Colour is the average of the samples that landed on something, so an
      // edge pixel is a blend of white and black rather than of white and
      // nothing — which would read as a gap in the outline.
      const shade = covered === 0 ? 0 : Math.round((white / covered) * 255);
      rgba[at] = shade;
      rgba[at + 1] = shade;
      rgba[at + 2] = shade;
      rgba[at + 3] = Math.round((covered / total) * 255);
    }
  }

  return rgba;
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

function encodePng(rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour + alpha

  const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
  let offset = 0;
  for (let y = 0; y < SIZE; y++) {
    raw[offset++] = 0; // filter: none
    for (let x = 0; x < SIZE * 4; x++) raw[offset++] = rgba[y * SIZE * 4 + x];
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });

const file = resolve(OUT_DIR, "cursor.png");
writeFileSync(file, encodePng(draw()));

// The hotspot is the tip, which sits one outline in from the top-left corner.
// Whatever draws this has to subtract it, or the pointer lands down and to the
// right of everything it is pointing at.
console.log(`wrote ${file} (${SIZE}px, hotspot ${(OUTLINE / SIZE).toFixed(4)})`);
