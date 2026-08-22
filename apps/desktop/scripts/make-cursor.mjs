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

/**
 * Every image the editor draws, and what each one is made of.
 *
 * Two tones rather than four unrelated pointers: a fill and the outline that
 * keeps it visible against its own colour. Each tone ships an arrow *and* a
 * hand because the shape is not a setting — the editor swaps to the hand
 * wherever the recording says the system was showing one, which is what makes
 * a composited pointer behave like the real one over a link.
 *
 * Exported as JSON beside the images so `shared/contract.ts` does not have to
 * repeat numbers that are decided here.
 */
const STYLES = [
  { id: "black", shape: "arrow", fill: 0, stroke: 255, alpha: 255 },
  { id: "black-hand", shape: "hand", fill: 0, stroke: 255, alpha: 255 },
  { id: "white", shape: "arrow", fill: 255, stroke: 0, alpha: 255 },
  { id: "white-hand", shape: "hand", fill: 255, stroke: 0, alpha: 255 },
  // Part opaque, so it marks where the pointer is without hiding what is under
  // it — for a recording where the content matters more than the pointing. It
  // keeps the outline the arrows have all the same: a translucent disc with
  // nothing round it disappears into anything of its own tone, which is how the
  // one option with no outline became the one nobody could see.
  { id: "circle", shape: "dot", fill: 0, stroke: 255, alpha: 200 },
];

/**
 * A pointing hand, as fractions of its own bounding box.
 *
 * Index finger up and to the left, thumb out, the other three curled — the
 * silhouette macOS uses for a link. Drawn as one loop like the arrow.
 */
const HAND = [
  [0.3, 0.0],
  [0.42, 0.06],
  [0.44, 0.42],
  [0.52, 0.36],
  [0.64, 0.4],
  [0.66, 0.36],
  [0.78, 0.42],
  [0.8, 0.38],
  [0.92, 0.46],
  [0.94, 0.74],
  [0.84, 0.96],
  [0.46, 1.0],
  [0.28, 0.84],
  [0.06, 0.58],
  [0.1, 0.48],
  [0.3, 0.56],
];

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
function polygon(shape) {
  const span = SIZE - OUTLINE * 2;

  if (shape === "hand") {
    return HAND.map(([x, y]) => [OUTLINE + x * span, OUTLINE + y * span]);
  }

  const width = span * ASPECT;
  return ARROW.map(([x, y]) => [OUTLINE + (x / 0.56) * width, OUTLINE + (y / 0.86) * span]);
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
 * The style's fill inside the shape, its outline within `OUTLINE` of the edge,
 * transparent beyond.
 *
 * Accumulated per subsample rather than composited in two passes: one shape
 * with the other drawn over it leaves a grey seam wherever the two edges
 * antialias against each other.
 */
function draw(style) {
  const points = polygon(style.shape);
  const rgba = new Uint8Array(SIZE * SIZE * 4);
  const centre = (SIZE - 1) / 2;
  const dotRadius = SIZE * 0.34;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let white = 0;
      let black = 0;

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = x + (sx + 0.5) / SAMPLES;
          const py = y + (sy + 0.5) / SAMPLES;

          if (style.shape === "dot") {
            // Ringed like the arrows rather than left as a bare silhouette: a
            // disc of one tone vanishes into a background of the same tone,
            // and a marker nobody can find is worse than no marker.
            const radial = Math.hypot(px - centre, py - centre);
            if (radial <= dotRadius) white++;
            else if (radial <= dotRadius + OUTLINE) black++;
            continue;
          }

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
      // edge pixel is part fill and part outline rather than part fill and part
      // nothing — which would read as a gap in the outline.
      const shade =
        covered === 0 ? 0 : Math.round((white * style.fill + black * style.stroke) / covered);

      rgba[at] = shade;
      rgba[at + 1] = shade;
      rgba[at + 2] = shade;
      rgba[at + 3] = Math.round((covered / total) * style.alpha);
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

/** Where each shape actually points, as a fraction of its image. */
function hotspot(shape) {
  // The arrow's tip sits one outline in from the top-left corner.
  if (shape === "arrow") return { x: OUTLINE / SIZE, y: OUTLINE / SIZE };
  // The hand points with the top of its index finger.
  if (shape === "hand")
    return { x: (OUTLINE + (SIZE - OUTLINE * 2) * 0.36) / SIZE, y: OUTLINE / SIZE };
  // A dot points with its middle, which is the whole idea of it.
  return { x: 0.5, y: 0.5 };
}

mkdirSync(OUT_DIR, { recursive: true });

for (const style of STYLES) {
  const file = resolve(OUT_DIR, `cursor-${style.id}.png`);
  writeFileSync(file, encodePng(draw(style)));

  const spot = hotspot(style.shape);
  console.log(`wrote ${file} (${SIZE}px, hotspot ${spot.x.toFixed(4)}, ${spot.y.toFixed(4)})`);
}
