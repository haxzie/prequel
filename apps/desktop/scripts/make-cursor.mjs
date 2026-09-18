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
  // The named pointers: the modern shape in a solid colour and nothing round
  // it, the way a collaborator's cursor is drawn in a multiplayer canvas. No
  // outline, on purpose: the colour is the outline's job — it is what keeps
  // the pointer visible against its own tone — and a white ring would make
  // five coloured pointers read as five white ones with a fill. A fill is a
  // grey level everywhere else in this table and a colour here; `draw` takes
  // either. Five, each far enough from the others to be told apart at a
  // glance, and each with white text legible on its tag — which is why there
  // is no yellow.
  {
    id: "tag-blue",
    shape: "pointer",
    fill: [13, 153, 255],
    stroke: 255,
    alpha: 255,
    outline: false,
  },
  {
    id: "tag-purple",
    shape: "pointer",
    fill: [151, 71, 255],
    stroke: 255,
    alpha: 255,
    outline: false,
  },
  {
    id: "tag-pink",
    shape: "pointer",
    fill: [255, 36, 189],
    stroke: 255,
    alpha: 255,
    outline: false,
  },
  {
    id: "tag-orange",
    shape: "pointer",
    fill: [255, 122, 0],
    stroke: 255,
    alpha: 255,
    outline: false,
  },
  {
    id: "tag-green",
    shape: "pointer",
    fill: [20, 174, 92],
    stroke: 255,
    alpha: 255,
    outline: false,
  },
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
          // The glyph is fitted one outline in from the edge whether or not
          // the outline is drawn — see `fitted()` — so a style without one is
          // the same shape at the same place, with the ring left transparent.
          else if (style.outline !== false && distance(shape, px, py) <= OUTLINE) black++;
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

mkdirSync(OUT_DIR, { recursive: true });

for (const style of STYLES) {
  const file = resolve(OUT_DIR, `cursor-${style.id}.png`);
  writeFileSync(file, encodePng(draw(style)));

  const spot = hotspot(style.shape);
  console.log(`wrote ${file} (${SIZE}px, hotspot ${spot.x.toFixed(4)}, ${spot.y.toFixed(4)})`);
}
