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
 * Each hotspot is printed beside its image so `shared/contract.ts` copies a
 * number decided here rather than guessing one.
 */
const STYLES = [
  // The modern pointer, in the same two tones and each outlined in the other.
  // The SVG it is taken from has no stroke at all, and a pointer with nothing
  // round it disappears into anything of its own tone. The hand and the two
  // resize pointers are finished artwork as well — see `GLYPHS` — and the
  // classic arrow shares them, because the old hand-typed hand was a
  // silhouette nobody would take for one.
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
  // The named pointers: the modern shape in a colour, outlined in white, the
  // way a collaborator's cursor is drawn in a multiplayer canvas. The outline
  // stays for the reason every other pointer has one — a coloured arrow over
  // a button of the same colour is invisible without it. A fill is a grey
  // level everywhere else in this table and a colour here; `draw` takes
  // either. Five, each far enough from the others to be told apart at a
  // glance, and each with white text legible on its tag — which is why there
  // is no yellow.
  { id: "tag-blue", shape: "pointer", fill: [13, 153, 255], stroke: 255, alpha: 255 },
  { id: "tag-purple", shape: "pointer", fill: [151, 71, 255], stroke: 255, alpha: 255 },
  { id: "tag-pink", shape: "pointer", fill: [255, 36, 189], stroke: 255, alpha: 255 },
  { id: "tag-orange", shape: "pointer", fill: [255, 122, 0], stroke: 255, alpha: 255 },
  { id: "tag-green", shape: "pointer", fill: [20, 174, 92], stroke: 255, alpha: 255 },
];

/** A fill or stroke as `[r, g, b]`, whether it was written as a grey or a colour. */
function channels(tone) {
  return Array.isArray(tone) ? tone : [tone, tone, tone];
}

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
 * The shapes taken from icon sets, as the `d` attribute of each glyph, verbatim.
 *
 * Copied in rather than fetched: a build must not need a network or an SVG
 * library to draw a pointer. Verbatim rather than transcribed so a line can be
 * checked against the source by eye — the pointer used to be a hand-converted
 * list of absolute commands, which was right, but only provably so by
 * converting it again.
 *
 * Two families. The pointer and the resize arrows are Fluent UI System Icons
 * (MIT, Microsoft). The hand is Font Awesome's, because Fluent's `hand_point`
 * is a mitten — a thumb and a lump — and a link cursor with no fingers on it
 * reads as a smudge at the size a pointer is drawn. Font Awesome Free is
 * CC BY 4.0, and this comment is the attribution it asks for: the project's
 * own guidance is that the credit embedded beside the artwork is sufficient.
 *
 * None of them carries a stroke of its own. The outline comes from the same
 * fill-and-outline pass every other shape here goes through, which is what
 * makes a black pointer visible against something black. On the hand that
 * pass also fills the three finger creases, which are cut-outs: they come out
 * in the outline's tone, which is what draws them.
 */
const GLYPHS = {
  // ic_fluent_cursor_28_filled
  pointer:
    "M6 3.604c0-1.346 1.56-2.09 2.607-1.243l16.88 13.669c1.018.824.435 2.47-.875 2.47h-9.377a2.25 2.25 0 0 0-1.749.835l-4.962 6.134C7.682 26.51 6 25.915 6 24.576z",
  // Font Awesome 7 Solid `hand-pointer`, by Dave Gandy — CC BY 4.0,
  // https://creativecommons.org/licenses/by/4.0/
  hand: "M224 104c0-22.1 17.9-40 40-40s40 17.9 40 40v148.2c8.5-7.6 19.7-12.2 32-12.2c20.6 0 38.2 13 45 31.2c8.8-9.3 21.2-15.2 35-15.2c25.3 0 46 19.5 47.9 44.3c8.5-7.7 19.8-12.3 32.1-12.3c26.5 0 48 21.5 48 48v112c0 70.7-57.3 128-128 128h-85.3c-5 0-9.9-.3-14.7-1c-55.3-5.6-106.2-34-140-79l-72-96c-13.3-17.7-9.7-42.7 8-56s42.7-9.7 56 8l56 74.7zm112 264c0-8.8-7.2-16-16-16s-16 7.2-16 16v96c0 8.8 7.2 16 16 16s16-7.2 16-16zm48-16c-8.8 0-16 7.2-16 16v96c0 8.8 7.2 16 16 16s16-7.2 16-16v-96c0-8.8-7.2-16-16-16m80 16c0-8.8-7.2-16-16-16s-16 7.2-16 16v96c0 8.8 7.2 16 16 16s16-7.2 16-16z",
  // ic_fluent_arrow_bidirectional_left_right_24_filled
  "resize-h":
    "M10.707 7.295a1 1 0 0 1 0 1.414l-4.293 4.293h15.172l-4.293-4.293a1 1 0 0 1 1.414-1.414l6 6a1 1 0 0 1 0 1.414l-6 6a1 1 0 0 1-1.414-1.415l4.293-4.292H6.414l4.293 4.292a1 1 0 0 1-1.414 1.415l-6-6a1 1 0 0 1 0-1.415l6-6a1 1 0 0 1 1.414 0",
  // ic_fluent_arrow_bidirectional_up_down_24_filled
  "resize-v":
    "M7.975 9.689a1 1 0 1 1-1.45-1.378l4.75-5a1 1 0 0 1 1.45 0l4.75 5a1 1 0 1 1-1.45 1.378L13 6.505v10.99l3.025-3.184a1 1 0 1 1 1.45 1.378l-4.75 5a1 1 0 0 1-1.45 0l-4.75-5a1 1 0 1 1 1.45-1.378L11 17.496V6.505z",
};

/**
 * A path's `d` attribute as closed polygons, one per subpath, in the glyph's
 * own box.
 *
 * Only the commands the four glyphs above use — `M L H V C S A Z`, in both
 * cases — and a deliberate error for anything else, so a glyph pasted in with
 * a `Q` fails here rather than drawing with a piece missing. Arcs are the
 * circular case `arc` handles; Fluent draws every rounded corner that way and
 * never with an ellipse or a rotation.
 *
 * A second `M` starts a second ring. Whether that ring is a hole or an island
 * is not decided here: `inside` counts crossings over every ring, which for
 * these glyphs — cut-outs wholly within the shape — is the even-odd rule the
 * SVGs are drawn with.
 */
function outline(d) {
  const tokens = d.match(/[MLHVCSAZmlhvcsaz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const rings = [];
  let points = [];
  let at = [0, 0];
  let command = "";
  /** The last cubic's second control point, which `S` reflects. */
  let handle = null;

  const next = () => Number(tokens.shift());
  const close = () => {
    if (points.length > 0) rings.push(points);
    points = [];
  };

  while (tokens.length > 0) {
    if (/[A-Za-z]/.test(tokens[0])) command = tokens.shift();
    // A command followed by more numbers than it takes repeats itself, which
    // is how a path writes two lines in a row without saying `l` twice.
    const relative = command === command.toLowerCase();
    const origin = relative ? at : [0, 0];
    const letter = command.toUpperCase();

    // A smooth curve's first handle is the last one mirrored through the
    // current point, or the point itself when the last command was not a
    // curve. Taken before the switch, because the switch below is what
    // replaces it.
    const mirrored = handle ? [2 * at[0] - handle[0], 2 * at[1] - handle[1]] : at;
    handle = null;

    switch (letter) {
      case "M": {
        // A move inside a path closes the ring before it and opens the next.
        // An `M` that repeats its numbers draws lines, like a repeated `L`.
        if (points.length > 0) close();
        at = [origin[0] + next(), origin[1] + next()];
        points.push(at);
        while (tokens.length > 0 && !/[A-Za-z]/.test(tokens[0])) {
          at = [(relative ? at[0] : 0) + next(), (relative ? at[1] : 0) + next()];
          points.push(at);
        }
        break;
      }
      case "L": {
        at = [origin[0] + next(), origin[1] + next()];
        points.push(at);
        break;
      }
      case "H": {
        at = [origin[0] + next(), at[1]];
        points.push(at);
        break;
      }
      case "V": {
        at = [at[0], origin[1] + next()];
        points.push(at);
        break;
      }
      case "C":
      case "S": {
        const control = [
          letter === "C" ? [origin[0] + next(), origin[1] + next()] : mirrored,
          [origin[0] + next(), origin[1] + next()],
          [origin[0] + next(), origin[1] + next()],
        ];
        points.push(...cubic(at, control));
        handle = control[1];
        at = control[2];
        break;
      }
      case "A": {
        const radius = next();
        const ry = next();
        const rotation = next();
        const large = next() === 1;
        const sweep = next() === 1;
        const to = [origin[0] + next(), origin[1] + next()];
        if (ry !== radius || rotation !== 0) {
          throw new Error(`only circular arcs are drawn: a${radius} ${ry} ${rotation}`);
        }
        points.push(...arc(at, to, radius, large, sweep));
        at = to;
        break;
      }
      case "Z": {
        // Closing is implicit — a ring joins its last point to its first — so
        // the command moves the pen back to the start and ends the ring.
        at = points[0] ?? at;
        close();
        break;
      }
      default:
        throw new Error(`unsupported path command: ${command}`);
    }
  }

  close();
  return rings;
}

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
function arc(from, to, radius, large, clockwise) {
  const mx = (from[0] + to[0]) / 2;
  const my = (from[1] + to[1]) / 2;
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;

  // How far off that midpoint the centre sits. Clamped at zero because a radius
  // too small to span the ends would put the square root in the negative, and
  // the specification's answer there is to grow the radius rather than fail.
  const offset = Math.max(0, (radius * radius - dx * dx - dy * dy) / (dx * dx + dy * dy));
  // Which side of the chord the centre is on is what the two flags decide
  // between them: the long way round in a given direction is the short way
  // round from the centre on the other side.
  const scale = Math.sqrt(offset) * (large !== clockwise ? 1 : -1);

  const cx = mx + scale * dy;
  const cy = my - scale * dx;

  const start = Math.atan2(from[1] - cy, from[0] - cx);
  let sweep = Math.atan2(to[1] - cy, to[0] - cx) - start;

  // In the direction the flag asked for. Whether that is the short way or the
  // long way round already fell out of where the centre was put.
  if (clockwise && sweep < 0) sweep += Math.PI * 2;
  if (!clockwise && sweep > 0) sweep -= Math.PI * 2;

  const points = [];
  for (let i = 1; i <= STEPS; i++) {
    const angle = start + (sweep * i) / STEPS;
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }

  return points;
}

/**
 * A Fluent glyph fitted into the image, and where its tip lands in it.
 *
 * Anchored on the tip rather than on the bounding box, which for these shapes
 * are not the same point: the corner a pointer points with is rounded off, and
 * the fingertip a hand points with is the crown of an arc, so the box's own
 * corner sits in empty space outside the artwork. Aiming from there would miss
 * what is being pointed at by a margin that grows with the frame.
 *
 * `tip` picks the point that does the pointing: the pointer's is the one
 * furthest towards the top-left, the hand's is the highest.
 */
function fitted(shape, tip) {
  const rings = outline(GLYPHS[shape]);
  const span = SIZE - OUTLINE * 2;

  const all = rings.flat();
  const xs = all.map(([x]) => x);
  const ys = all.map(([, y]) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const width = Math.max(...xs) - left;
  const height = Math.max(...ys) - top;

  // Fitted on its longer edge, so it is drawn at the scale the arrow is. A
  // shape that points with a tip is laid out from the corner like the arrow;
  // one that points with its middle is centred, so its hotspot is the image's.
  const scale = span / Math.max(width, height);
  const dx = tip ? 0 : (span - width * scale) / 2;
  const dy = tip ? 0 : (span - height * scale) / 2;
  const placed = rings.map((ring) =>
    ring.map(([x, y]) => [OUTLINE + dx + (x - left) * scale, OUTLINE + dy + (y - top) * scale]),
  );

  // The tip is on the outer ring, which every glyph here writes first; a
  // cut-out is never the part that points.
  return { rings: placed, tip: tip ? placed[0].reduce(tip) : null };
}

/** Which point of a glyph does the pointing, for `fitted`. */
const TIPS = {
  pointer: (best, p) => (p[0] + p[1] < best[0] + best[1] ? p : best),
  hand: (best, p) => (p[1] < best[1] ? p : best),
};

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
 * The shape scaled into the image, leaving room for the outline on every side,
 * as rings: one for a plain silhouette, more for a glyph with cut-outs.
 */
function rings(shape) {
  const span = SIZE - OUTLINE * 2;

  if (shape in GLYPHS) return fitted(shape, TIPS[shape]).rings;

  // Centred rather than anchored to the corner, because it points with its
  // middle. The arrow points with a corner and is laid out from it, which is
  // what makes its hotspot the small fraction below.
  if (shape === "ibeam") return [centred(IBEAM, IBEAM_ASPECT, span)];

  const width = span * ASPECT;
  return [ARROW.map(([x, y]) => [OUTLINE + (x / 0.56) * width, OUTLINE + (y / 0.86) * span])];
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

/**
 * Even-odd ray cast over every ring at once, so a ring inside another is a
 * hole. The shapes here never self-intersect, so this needs no winding rule.
 */
function inside(rings, px, py) {
  let hit = false;
  for (const points of rings) {
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

/** Shortest distance from a point to any ring's boundary. */
function distance(rings, px, py) {
  let best = Infinity;

  for (const points of rings) {
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
  const shape = rings(style.shape);
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

          const within = inside(shape, px, py);

          if (within) white++;
          else if (distance(shape, px, py) <= OUTLINE) black++;
        }
      }

      const total = SAMPLES * SAMPLES;
      const covered = white + black;
      const at = (y * SIZE + x) * 4;

      // Colour is the average of the samples that landed on something, so an
      // edge pixel is part fill and part outline rather than part fill and part
      // nothing — which would read as a gap in the outline. Per channel, so a
      // coloured fill and a white outline mix to the right tint at the edge.
      const fill = channels(style.fill);
      const stroke = channels(style.stroke);
      for (let channel = 0; channel < 3; channel++) {
        rgba[at + channel] =
          covered === 0
            ? 0
            : Math.round((white * fill[channel] + black * stroke[channel]) / covered);
      }
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

function encodePng(rgba, size = SIZE) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour + alpha

  const raw = Buffer.alloc(size * (1 + size * 4));
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0; // filter: none
    for (let x = 0; x < size * 4; x++) raw[offset++] = rgba[y * size * 4 + x];
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
  // The modern pointer's tip is rounded off and the hand's fingertip is the
  // crown of an arc, so both are measured from the artwork rather than assumed
  // to be a corner — see `fitted()`.
  if (shape === "pointer" || shape === "hand") {
    const { tip } = fitted(shape, TIPS[shape]);
    return { x: tip[0] / SIZE, y: tip[1] / SIZE };
  }
  // Everything else points with its middle: a dot by definition, and the text
  // and resize pointers because that is where the system puts their hotspot —
  // an I-beam aimed from its corner would insert one character off.
  return { x: 0.5, y: 0.5 };
}

// ── The pointer stick ───────────────────────────────────────────────────────
//
// A teacher's pointer rather than a cursor: a small white hand on a black rod
// that runs off the bottom of the picture, so the end of the handle is never on
// screen. Drawn here because it is made of the same two ingredients as
// everything above — the Font Awesome hand, and a shape with a hairline round
// it — but it is built differently enough to be worth saying how.
//
// Two things set it apart. It is drawn far larger, because the rod has to leave
// the frame from anywhere in it — `reach` in `contract.ts` sizes it against the
// frame rather than against the Size control — and a 128px square resampled up
// by that much is a blur. And it is a rod, a highlight and a hand rather than
// one silhouette, so it is composited layer over layer instead of filled and
// outlined in a single pass.

/** A signed distance, in image pixels: negative inside, positive outside. */
function signedDistance(rings, px, py) {
  const away = distance(rings, px, py);
  return inside(rings, px, py) ? -away : away;
}

/**
 * A rod: everything within a radius of a segment, the radius growing along it.
 *
 * A segment rather than a polygon because that is what a rod is, and the ends
 * come out round for free — which is what the butt of a foam grip looks like.
 * The taper is the real reason, though: a handle of one width reads as a wire.
 */
function rodAt([ax, ay], [bx, by], near, far) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;

  return (px, py) => {
    const t =
      length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) - (near + (far - near) * t);
  };
}

/**
 * The hand glyph scaled, leaned and placed so its fingertip lands on `tip`.
 *
 * The fingertip is picked on the glyph before it is turned, and then followed
 * through the transform, rather than picked again afterwards. They are the same
 * point at this lean and would stop being at a steeper one — and the hotspot
 * `contract.ts` carries is this point, so "whichever corner is highest" is not
 * what it may mean.
 */
function leaningHand(size, { hand, tilt, tip }) {
  const rings = outline(GLYPHS.hand);
  const all = rings.flat();
  const left = Math.min(...all.map(([x]) => x));
  const top = Math.min(...all.map(([, y]) => y));
  const width = Math.max(...all.map(([x]) => x)) - left;
  const height = Math.max(...all.map(([, y]) => y)) - top;

  // Fitted on its longer edge, the way every other glyph here is, so `hand`
  // means the same thing it would in `fitted`.
  const scale = (hand * size) / Math.max(width, height);
  const angle = (tilt * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const place = ([x, y]) => {
    const px = (x - left) * scale;
    const py = (y - top) * scale;
    return [px * cos - py * sin, px * sin + py * cos];
  };

  // The fingertip: the highest point of the glyph as drawn, which is the crown
  // of the index finger's arc — `TIPS.hand`, on the outer ring, which every
  // glyph here writes first.
  const finger = rings[0].reduce(TIPS.hand);
  const [fx, fy] = place(finger);
  const dx = tip[0] * size - fx;
  const dy = tip[1] * size - fy;

  const rings_ = rings.map((ring) =>
    ring.map((point) => {
      const [x, y] = place(point);
      return [x + dx, y + dy];
    }),
  );

  // The fist's middle, which is where the handle has to pass through. Not the
  // fingertip: that is off to one side of the hand, and a rod run from it comes
  // out of the edge of the fist rather than out of the grip.
  const placed = rings_.flat();
  const xs = placed.map(([x]) => x);
  const ys = placed.map(([, y]) => y);
  const centre = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];

  return { rings: rings_, centre };
}

/**
 * The area centroid of a closed ring, which a vertex average is not.
 *
 * Every curve in these glyphs is sampled into sixteen points, so the vertices
 * crowd the rounded corners — an average of them is pulled towards whichever
 * corner happens to be roundest.
 */
function centroid(ring) {
  let twiceArea = 0;
  let x = 0;
  let y = 0;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    twiceArea += cross;
    x += (ring[j][0] + ring[i][0]) * cross;
    y += (ring[j][1] + ring[i][1]) * cross;
  }

  return [x / (3 * twiceArea), y / (3 * twiceArea)];
}

/**
 * How far the default pointer leans, in radians right of straight down.
 *
 * Measured off `GLYPHS.pointer` rather than chosen, because the number it has
 * to agree with is that glyph: the stick is the pointer with a handle on it,
 * and a handle at some other angle makes it a second pointer that happens to
 * be in the same list. From the tip to the shape's own centroid, which for an
 * arrow is the line down its shaft.
 */
function pointerLean() {
  const ring = outline(GLYPHS.pointer)[0];
  const tip = ring.reduce(TIPS.pointer);
  const middle = centroid(ring);
  return Math.atan2(middle[0] - tip[0], middle[1] - tip[1]);
}

/**
 * How far below the fist's middle the handle starts, as a share of the hand.
 *
 * Inside the fist rather than at the wrist, so the two are one object: a rod
 * that begins where the hand ends meets it at a seam, and a seam between a
 * hand and a stick is a hand balanced on the end of one. The overlap is never
 * seen — the hand is drawn last, over the rod.
 */
const ROD_GRIP = 0.2;

/**
 * One pointer stick: the grip, the light down it, and the hand, in that order.
 *
 * Every length is a fraction of the image, so the big sprite and the small
 * swatch are the same drawing at two sizes rather than two drawings.
 */
function stick(size, spec) {
  const { rings: hand, centre } = leaningHand(size, spec);
  // One axis for both, which is the whole of what holds them together: the
  // hand is turned onto the pointer's lean and the handle runs straight on
  // down it. Two angles — a hand at one lean on a rod at another — is the kink
  // at the wrist that reads as the two being separate things.
  const lean = (spec.tilt * Math.PI) / 180;
  const along = [-Math.sin(lean), Math.cos(lean)];
  const from = [
    centre[0] + along[0] * spec.hand * ROD_GRIP * size,
    centre[1] + along[1] * spec.hand * ROD_GRIP * size,
  ];
  const at = (span) => [from[0] + along[0] * span * size, from[1] + along[1] * span * size];
  // The rod's two sides, as unit normals, and the lit one — the upper, light
  // being above here for the same reason every shadow drops downwards. Picked
  // rather than written out, so the lean can change sign without the highlight
  // quietly moving onto the shaded side.
  const across = along[0] > 0 ? [along[1], -along[0]] : [-along[1], along[0]];
  /** The same point moved across the rod, onto the lit side. */
  const shift = ([x, y], by) => [x + across[0] * by, y + across[1] * by];

  /** Where a part can possibly reach, so `drawLayers` can skip the rest. */
  const around = (points, margin) => [
    Math.min(...points.map(([x]) => x)) - margin,
    Math.min(...points.map(([, y]) => y)) - margin,
    Math.max(...points.map(([x]) => x)) + margin,
    Math.max(...points.map(([, y]) => y)) + margin,
  ];

  const hairline = spec.hairline * size;
  const rod = spec.rod.map((share) => share * size);
  const ends = [at(spec.grip[0]), at(spec.grip[1])];

  return [
    // The grip, in one piece from under the fist to past the image's own edge.
    // A rounded butt drawn inside the square would be an end the frame can
    // show, and a pointing stick with a visible end is a baton.
    //
    // No hairline. Every other pointer here carries one because it is a flat
    // silhouette that would otherwise vanish into its own tone, and a rod is
    // not: it has a length of shading down it, and an outline on something
    // that long draws two parallel lines the eye reads before the handle
    // between them. The cost is honest — a black handle over black content is
    // its highlight and nothing else.
    {
      shape: rodAt(ends[0], ends[1], rod[0], rod[1]),
      hairline: 0,
      bounds: around(ends, rod[1]),
      fill: [26, 26, 28],
      stroke: [26, 26, 28],
    },
    // The light down the grip's upper side. Foam catches it there, and it is
    // what keeps the handle a handle rather than a gap in the picture now that
    // there is no outline round it.
    {
      shape: rodAt(
        shift(ends[0], rod[0] * 0.42),
        shift(ends[1], rod[1] * 0.42),
        rod[0] * 0.26,
        rod[1] * 0.26,
      ),
      hairline: 0,
      bounds: around(ends, rod[1]),
      fill: [92, 92, 100],
      stroke: [92, 92, 100],
    },
    // The hand keeps its outline: it is a flat white silhouette, and white on
    // white is the case every pointer here is outlined for.
    {
      shape: (px, py) => signedDistance(hand, px, py),
      hairline,
      bounds: around(hand.flat(), hairline + 1),
      fill: [255, 255, 255],
      stroke: [36, 36, 40],
    },
  ];
}

/**
 * Layers composited in order, each antialiased with its own outline.
 *
 * Source-over per layer rather than one accumulation over all three, which is
 * the opposite of what `draw` does above and right for the opposite reason:
 * there the fill and its outline are two parts of one shape, and averaging them
 * together is what stops a grey seam appearing between them. Here they are
 * separate objects, one lying on another, and a hand averaged into the rod
 * beneath it would come out grey where it overlaps.
 *
 * Supersampled only along the edges. The sprite is four million pixels and the
 * hand is a polygon of several hundred edges, so sixteen samples of everything
 * is minutes of wall clock for an image that is almost entirely either solid or
 * empty. A layer's distance at the pixel's centre says which: more than a pixel
 * either side of its own boundary and the answer is the same at every subsample
 * — so only the hairline of pixels the boundary actually crosses is sampled
 * sixteen times, and the rest cost one distance each.
 */
function drawLayers(size, layers) {
  const rgba = new Uint8Array(size * size * 4);
  const total = SAMPLES * SAMPLES;
  // Half a pixel reaches every subsample; the extra half is the slack that
  // stops a boundary grazing the corner of a cell being called solid.
  const edge = Math.SQRT1_2 + 0.5;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Premultiplied while it is composited, and divided back out at the end:
      // a PNG carries straight alpha, and both rasterisers multiply it in
      // themselves after they sample.
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;

      for (const layer of layers) {
        const [left, top, right, bottom] = layer.bounds;
        if (x + 1 < left || x > right || y + 1 < top || y > bottom) continue;

        const centre = layer.shape(x + 0.5, y + 0.5);
        if (centre > layer.hairline + edge) continue;

        let fill = 0;
        let stroke = 0;

        if (centre < -edge) {
          fill = total;
        } else {
          for (let sy = 0; sy < SAMPLES; sy++) {
            for (let sx = 0; sx < SAMPLES; sx++) {
              const away = layer.shape(x + (sx + 0.5) / SAMPLES, y + (sy + 0.5) / SAMPLES);
              if (away <= 0) fill++;
              else if (away <= layer.hairline) stroke++;
            }
          }
        }

        const covered = fill + stroke;
        if (covered === 0) continue;

        const cover = covered / total;
        const tone = (channel) =>
          (fill * layer.fill[channel] + stroke * layer.stroke[channel]) / covered;
        red = tone(0) * cover + red * (1 - cover);
        green = tone(1) * cover + green * (1 - cover);
        blue = tone(2) * cover + blue * (1 - cover);
        alpha = cover + alpha * (1 - cover);
      }

      if (alpha <= 0) continue;
      const at = (y * size + x) * 4;
      rgba[at] = Math.round(red / alpha);
      rgba[at + 1] = Math.round(green / alpha);
      rgba[at + 2] = Math.round(blue / alpha);
      rgba[at + 3] = Math.round(alpha * 255);
    }
  }

  return rgba;
}

/**
 * The hand's lean, in degrees, which is the default pointer's own.
 *
 * Negative because `leaningHand` turns clockwise and the pointer leans the
 * other way: it points up and to the left, so everything hanging off it —
 * the fist and the grip — hangs down and to the right.
 */
const STICK_TILT = (-pointerLean() * 180) / Math.PI;

/**
 * The two pointer sticks: the one that is composited, and the one in the panel.
 *
 * Not one image used twice. The sprite is almost all handle — the hand is a
 * twentieth of it — so a swatch cut from it is a hairline across an empty
 * square, and the picker's tiles are the only caption a pointer has. The swatch
 * is the same stick drawn at the proportions a forty-point tile can show.
 *
 * `size` is large for the sprite because it is drawn large: the rod spans more
 * than a frame's diagonal, so 128px would be resampled up by better than ten.
 */
const STICKS = [
  {
    id: "stick",
    size: 2048,
    hand: 0.042,
    tilt: STICK_TILT,
    // The fingertip, a hair in from the top-left corner. It is also the hotspot
    // `CURSOR_STYLES` carries, so moving it means changing that number — which
    // is why this script prints it.
    //
    // Top *left*, because the handle now runs down and to the right: the
    // pointer this is leaned onto points up and to the left, and a handle on
    // the other side of it would be the arrow drawn back to front.
    tip: [0.045, 0.025],
    // Along the rod from under the fist, as fractions of the image. It runs
    // past the bottom edge so the image's own edge cuts it.
    grip: [0, 1.25],
    // Near the hand and far down the handle. It comes to a narrow end where
    // the hand holds it and swells towards the butt, which is the taper of a
    // pointer rather than of a broom handle — and a rod of one width reads as
    // a wire.
    rod: [0.0055, 0.0122],
    // The hand's, and the hand's only — see `stick`.
    hairline: 0.0024,
  },
  {
    id: "stick-swatch",
    size: SIZE,
    hand: 0.4,
    tilt: STICK_TILT,
    tip: [0.2, 0.06],
    grip: [0, 0.95],
    rod: [0.02, 0.042],
    hairline: 0.016,
  },
];

mkdirSync(OUT_DIR, { recursive: true });

for (const style of STYLES) {
  const file = resolve(OUT_DIR, `cursor-${style.id}.png`);
  writeFileSync(file, encodePng(draw(style)));

  const spot = hotspot(style.shape);
  console.log(`wrote ${file} (${SIZE}px, hotspot ${spot.x.toFixed(4)}, ${spot.y.toFixed(4)})`);
}

for (const spec of STICKS) {
  const file = resolve(OUT_DIR, `cursor-${spec.id}.png`);
  writeFileSync(file, encodePng(drawLayers(spec.size, stick(spec.size, spec)), spec.size));

  // The fingertip is placed rather than measured, so the hotspot is the number
  // that put it there — printed all the same, because `CURSOR_STYLES` copies it
  // and the two have to be the same number.
  console.log(
    `wrote ${file} (${spec.size}px, hotspot ${spec.tip[0].toFixed(4)}, ${spec.tip[1].toFixed(4)},` +
      ` lean ${STICK_TILT.toFixed(2)}°)`,
  );
}
