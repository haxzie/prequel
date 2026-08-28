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
  // The modern pointer, in the same two tones and each outlined in the other.
  // The SVG it is taken from has no stroke at all, and a pointer with nothing
  // round it disappears into anything of its own tone.
  { id: "modern-black", shape: "pointer", fill: 0, stroke: 255, alpha: 255 },
  { id: "modern-white", shape: "pointer", fill: 255, stroke: 0, alpha: 255 },
  { id: "black", shape: "arrow", fill: 0, stroke: 255, alpha: 255 },
  { id: "black-hand", shape: "hand", fill: 0, stroke: 255, alpha: 255 },
  { id: "black-text", shape: "ibeam", fill: 0, stroke: 255, alpha: 255 },
  { id: "black-resize-h", shape: "resize-h", fill: 0, stroke: 255, alpha: 255 },
  { id: "black-resize-v", shape: "resize-v", fill: 0, stroke: 255, alpha: 255 },
  { id: "white", shape: "arrow", fill: 255, stroke: 0, alpha: 255 },
  { id: "white-hand", shape: "hand", fill: 255, stroke: 0, alpha: 255 },
  { id: "white-text", shape: "ibeam", fill: 255, stroke: 0, alpha: 255 },
  { id: "white-resize-h", shape: "resize-h", fill: 255, stroke: 0, alpha: 255 },
  { id: "white-resize-v", shape: "resize-v", fill: 255, stroke: 0, alpha: 255 },
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

/**
 * The modern pointer, in the 28×28 box its artwork was drawn in.
 *
 * Fluent UI System Icons (MIT, Microsoft), transcribed from the glyph's `d`
 * attribute rather than fetched: a build must not need a network or an SVG
 * library to draw a pointer. Kept as the commands the path actually uses so it
 * can be checked against the source a line at a time — the only edit is that
 * every coordinate is absolute where the path wrote some of them relative.
 *
 * It carries no stroke of its own. The outline comes from the same
 * fill-and-outline pass every other shape here goes through, which is what
 * makes a black pointer visible against something black.
 */
const POINTER = [
  { to: [6, 3.604] },
  {
    curve: [
      [6, 2.258],
      [7.56, 1.514],
      [8.607, 2.361],
    ],
  },
  { line: [25.487, 16.03] },
  {
    curve: [
      [26.505, 16.854],
      [25.922, 18.5],
      [24.612, 18.5],
    ],
  },
  { line: [15.235, 18.5] },
  // The one arc in the path — `a2.25 2.25 0 0 0` — the rounded corner where the
  // tail meets the shoulder.
  { arc: [13.486, 19.335], radius: 2.25, clockwise: false },
  { line: [8.524, 25.469] },
  {
    curve: [
      [7.682, 26.51],
      [6, 25.915],
      [6, 24.576],
    ],
  },
];

/**
 * Straight pieces each curve is cut into.
 *
 * Sixteen is past the point where the outline pass can tell: the supersampler
 * already averages sixteen samples a pixel, so a finer curve only moves an edge
 * by less than the noise it is being drawn through.
 */
const STEPS = 16;

/** One cubic Bézier, as points along it. The start is the caller's already. */
function cubic(from, [c1, c2, to]) {
  const points = [];

  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    const u = 1 - t;
    points.push([
      u * u * u * from[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * to[0],
      u * u * u * from[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * to[1],
    ]);
  }

  return points;
}

/**
 * One SVG elliptical arc, as points along it.
 *
 * The endpoint form a path is written in says where an arc ends but not where
 * its centre is, and nothing can be walked until the centre is recovered. This
 * is the conversion from the specification's implementation notes, for the
 * circular case — equal radii, no rotation — which is all a rounded corner
 * ever needs.
 */
function arc(from, to, radius, clockwise) {
  const mx = (from[0] + to[0]) / 2;
  const my = (from[1] + to[1]) / 2;
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;

  // How far off that midpoint the centre sits. Clamped at zero because a radius
  // too small to span the ends would put the square root in the negative, and
  // the specification's answer there is to grow the radius rather than fail.
  const offset = Math.max(0, (radius * radius - dx * dx - dy * dy) / (dx * dx + dy * dy));
  const scale = Math.sqrt(offset) * (clockwise ? 1 : -1);

  const cx = mx + scale * dy;
  const cy = my - scale * dx;

  const start = Math.atan2(from[1] - cy, from[0] - cx);
  let sweep = Math.atan2(to[1] - cy, to[0] - cx) - start;

  // The short way round, in the direction the flag asked for.
  if (clockwise && sweep < 0) sweep += Math.PI * 2;
  if (!clockwise && sweep > 0) sweep -= Math.PI * 2;

  const points = [];
  for (let i = 1; i <= STEPS; i++) {
    const angle = start + (sweep * i) / STEPS;
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }

  return points;
}

/** The pointer as a closed polygon, still in its own 28×28 box. */
function pointerOutline() {
  let at = [0, 0];
  const points = [];

  for (const step of POINTER) {
    if (step.curve) {
      points.push(...cubic(at, step.curve));
      at = step.curve[2];
    } else if (step.arc) {
      points.push(...arc(at, step.arc, step.radius, step.clockwise));
      at = step.arc;
    } else {
      at = step.to ?? step.line;
      points.push(at);
    }
  }

  return points;
}

/**
 * The pointer fitted into the image, and where its tip lands in it.
 *
 * Anchored on the tip rather than on the bounding box, which for this shape are
 * not the same point: the corner it points with is rounded off, so the box's
 * own corner sits in empty space outside the artwork. Aiming from there would
 * miss what is being pointed at by a margin that grows with the frame.
 *
 * The tip is the point on the outline furthest towards the top-left, because
 * that is the direction this pointer points.
 */
function pointer() {
  const outline = pointerOutline();
  const span = SIZE - OUTLINE * 2;

  const xs = outline.map(([x]) => x);
  const ys = outline.map(([, y]) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);

  // Fitted on its longer edge, so it is drawn at the scale the arrow is.
  const scale = span / Math.max(Math.max(...xs) - left, Math.max(...ys) - top);
  const points = outline.map(([x, y]) => [
    OUTLINE + (x - left) * scale,
    OUTLINE + (y - top) * scale,
  ]);

  return { points, tip: points.reduce((best, p) => (p[0] + p[1] < best[0] + best[1] ? p : best)) };
}

/**
 * The text cursor, as fractions of its own bounding box.
 *
 * A capital I: a stem with a serif across each end. The serifs are what stop it
 * disappearing into a column of text — a bare vertical bar reads as part of
 * whatever it is over, which is the one thing a pointer must never do.
 *
 * Wound as one closed loop like the arrow, so the same fill-and-outline pass
 * draws it.
 */
const IBEAM = [
  [0.0, 0.0],
  [1.0, 0.0],
  [1.0, 0.09],
  [0.64, 0.09],
  [0.64, 0.91],
  [1.0, 0.91],
  [1.0, 1.0],
  [0.0, 1.0],
  [0.0, 0.91],
  [0.36, 0.91],
  [0.36, 0.09],
  [0.0, 0.09],
];

/** Tall and narrow, the proportions of the glyph it is named after. */
const IBEAM_ASPECT = 0.42;

/**
 * The horizontal resize pointer: a bar with an arrowhead at each end.
 *
 * One loop rather than three pieces — a bar with two triangles laid over it
 * seams where the three antialias against each other, which is the same reason
 * the fill and the outline are accumulated per subsample rather than composited.
 */
const RESIZE = [
  [0.0, 0.5],
  [0.26, 0.16],
  [0.26, 0.36],
  [0.74, 0.36],
  [0.74, 0.16],
  [1.0, 0.5],
  [0.74, 0.84],
  [0.74, 0.64],
  [0.26, 0.64],
  [0.26, 0.84],
];

/** Wide and short. The vertical one is this turned a quarter, and so is its reciprocal. */
const RESIZE_ASPECT = 1 / 0.62;

/** Arrow scaled into the image, leaving room for the outline on every side. */
function polygon(shape) {
  const span = SIZE - OUTLINE * 2;

  if (shape === "hand") {
    return HAND.map(([x, y]) => [OUTLINE + x * span, OUTLINE + y * span]);
  }

  // Centred rather than anchored to the corner, because these three point with
  // their middle. The arrow and the hand point with a corner and are laid out
  // from it, which is what makes their hotspots the small fractions below.
  if (shape === "ibeam") return centred(IBEAM, IBEAM_ASPECT, span);
  if (shape === "resize-h") return centred(RESIZE, RESIZE_ASPECT, span);
  if (shape === "resize-v") {
    // The same shape through the diagonal. Turned here rather than written out
    // twice: two lists of ten points that have to stay each other's transpose
    // is a pair that drifts the first time one of them is adjusted.
    return centred(
      RESIZE.map(([x, y]) => [y, x]),
      1 / RESIZE_ASPECT,
      span,
    );
  }

  if (shape === "pointer") return pointer().points;

  const width = span * ASPECT;
  return ARROW.map(([x, y]) => [OUTLINE + (x / 0.56) * width, OUTLINE + (y / 0.86) * span]);
}

/**
 * A unit-box shape fitted to its longer edge and centred in the image.
 *
 * The longer edge takes the whole span so every pointer is drawn at the same
 * scale as the arrow, and the shorter one falls out of the aspect — a shape
 * stretched to fill a square would be a different pointer.
 */
function centred(points, aspect, span) {
  const width = aspect >= 1 ? span : span * aspect;
  const height = aspect >= 1 ? span / aspect : span;
  const left = (SIZE - width) / 2;
  const top = (SIZE - height) / 2;

  return points.map(([x, y]) => [left + x * width, top + y * height]);
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
  // The modern pointer's tip is rounded off, so it is measured from the artwork
  // rather than assumed to be the corner — see `pointer()`.
  if (shape === "pointer") {
    const { tip } = pointer();
    return { x: tip[0] / SIZE, y: tip[1] / SIZE };
  }
  // The hand points with the top of its index finger.
  if (shape === "hand")
    return { x: (OUTLINE + (SIZE - OUTLINE * 2) * 0.36) / SIZE, y: OUTLINE / SIZE };
  // Everything else points with its middle: a dot by definition, and the text
  // and resize pointers because that is where the system puts their hotspot —
  // an I-beam aimed from its corner would insert one character off.
  return { x: 0.5, y: 0.5 };
}

mkdirSync(OUT_DIR, { recursive: true });

for (const style of STYLES) {
  const file = resolve(OUT_DIR, `cursor-${style.id}.png`);
  writeFileSync(file, encodePng(draw(style)));

  const spot = hotspot(style.shape);
  console.log(`wrote ${file} (${SIZE}px, hotspot ${spot.x.toFixed(4)}, ${spot.y.toFixed(4)})`);
}
