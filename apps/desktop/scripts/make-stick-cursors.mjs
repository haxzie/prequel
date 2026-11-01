/**
 * The pointer sticks, built out of artwork.
 *
 * `make-cursor.mjs` beside this draws its pointers: outlined silhouettes filled
 * from distance fields, in two or three flat tones. That is the right way to
 * make an arrow and the wrong way to make a toy — a knitted glove, a lump of
 * neon or a varnished dowel is a *material*, and a material is shading, which a
 * distance field cannot express at any number of tones. The stick used to be
 * drawn there and is not any more, for exactly that reason.
 *
 * The wooden hand is TinyHand's, which is MIT licensed — `NOTICE.md` at the
 * root carries the notice that licence asks for. Nothing of its code is here;
 * this reads its PNG. The other three are ours, under `artwork/hands`.
 *
 * ## What this has to change about them
 *
 * A source image is portrait and upright: the hand at the top, and under it
 * either a rod of one width ending in a rounded butt, or nothing at all.
 * TinyHand's is a layer in a live app, so its rod is stretched to whatever
 * length the pointer is from the edge of the screen at that moment; ours are
 * bare gloves and are given a rod here.
 *
 * Ours is one still sprite, and `reach` in `contract.ts` sizes it against the
 * frame so that the rod leaves the picture from anywhere in the picture. So the
 * butt is cut off, the rod is repeated to a length that always runs past the
 * edge, the whole thing is leaned onto the default pointer's own angle, and the
 * fingertip is placed on the hotspot `CURSOR_STYLES` carries.
 *
 * ## Why it is one pass
 *
 * Resize, then rotate, then place is three resamplings of the same pixels and
 * each one softens them. This is instead a single inverse map: for each pixel
 * of the output, where did it come from on the strip — and the strip is a
 * function rather than an image, so the repeated rod is sampled rather than
 * built. The hand comes down by about ten, so each output pixel averages a
 * block of the source, which is what stops a knit or a grain aliasing into
 * speckle.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

import { STICK_TILT, encodePng } from "./make-cursor.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "../resources");
const SOURCE = resolve(HERE, "../artwork");

/**
 * Enough PNG to read these four files, and a deliberate error for anything
 * else.
 *
 * Eight-bit RGBA, not interlaced, which is what they are. A decoder that
 * quietly coped with a palette or a sixteen-bit sample would be one nobody had
 * ever tested on one, and the failure would be artwork that is subtly the wrong
 * colour rather than a script that stops.
 */
function decodePng(bytes) {
  let at = 8;
  let header = null;
  const parts = [];

  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString("ascii", at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);

    if (type === "IHDR") {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        colour: body[9],
        interlace: body[12],
      };
    } else if (type === "IDAT") parts.push(body);
    else if (type === "IEND") break;

    at += 12 + length;
  }

  if (!header) throw new Error("no IHDR");
  if (header.depth !== 8 || header.colour !== 6 || header.interlace !== 0) {
    throw new Error(
      `only 8-bit RGBA, non-interlaced PNGs are read here — got depth ${String(header.depth)},` +
        ` colour type ${String(header.colour)}, interlace ${String(header.interlace)}`,
    );
  }

  const { width, height } = header;
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * 4;
  const rgba = Buffer.alloc(stride * height);

  // Un-filtering, which is the whole of the format past the inflate: every row
  // names one of five predictors and stores its difference from it.
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const from = y * (stride + 1) + 1;
    const line = y * stride;
    const above = line - stride;

    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? rgba[line + x - 4] : 0;
      const up = y > 0 ? rgba[above + x] : 0;
      const corner = y > 0 && x >= 4 ? rgba[above + x - 4] : 0;

      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - corner;
        const dl = Math.abs(estimate - left);
        const du = Math.abs(estimate - up);
        const dc = Math.abs(estimate - corner);
        predicted = dl <= du && dl <= dc ? left : du <= dc ? up : corner;
      } else if (filter !== 0) throw new Error(`unknown row filter ${String(filter)}`);

      rgba[line + x] = (raw[from + x] + predicted) & 0xff;
    }
  }

  return { width, height, rgba };
}

/** Opaque enough to be the hand rather than the soft edge around it. */
const SOLID = 8;

/**
 * Where the hand stops, how wide it is, and where its rod is if it has one.
 *
 * Measured rather than written down, because these are not drawn to one
 * template: the wrist is wherever that hand's cuff happens to end. Under half
 * the hand's own width is rod every time — a fist with one finger up is never
 * less than twice as wide as the stick holding it.
 */
function anatomy({ width, height, rgba }) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] > SOLID) {
        if (left < 0) left = x;
        right = x;
      }
    }
    rows.push(left < 0 ? null : { left, right, width: right - left + 1 });
  }

  const top = rows.findIndex((row) => row !== null);
  const widest = Math.max(...rows.filter(Boolean).map((row) => row.width));

  let wrist = top;
  for (let y = top; y < height; y++) if (rows[y] && rows[y].width > 0.45 * widest) wrist = y;

  // The hand's own box, off the alpha and nothing else: these files carry
  // colour under their transparent pixels, so the bounding box of any other
  // channel is the whole canvas — which would size every hand to its file
  // rather than to the hand.
  let left = width;
  let right = 0;
  for (let y = top; y <= wrist; y++) {
    if (!rows[y]) continue;
    left = Math.min(left, rows[y].left);
    right = Math.max(right, rows[y].right);
  }

  // Clear of the cuff above it and of the rounded butt below, so repeating it
  // cannot repeat a highlight that belongs to either.
  const slab = { from: wrist + 90, to: wrist + 190 };
  const hasRod = slab.to < height && rows.slice(slab.from, slab.to).every((row) => row !== null);

  return {
    top,
    wrist,
    hand: { width: right - left + 1, height: wrist - top },
    slab,
    hasRod,
    // Where a drawn rod has to meet the hand: the middle of the last row of it.
    cuff: rows[wrist] ? (rows[wrist].left + rows[wrist].right) / 2 : width / 2,
  };
}

/**
 * A value read off a profile of control points, smoothly.
 *
 * Smoothstep between neighbours rather than straight lines: a cylinder's
 * shading has no creases in it, and linear segments put a visible crease at
 * every point of the table — which on a rod twelve pixels across is a set of
 * stripes down it.
 */
function alongProfile(points, at) {
  if (at <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (at >= last[0]) return last[1];

  for (let i = 1; i < points.length; i += 1) {
    const [x1, v1] = points[i];
    if (at > x1) continue;
    const [x0, v0] = points[i - 1];
    const t = (at - x0) / (x1 - x0);
    return v0 + (v1 - v0) * t * t * (3 - 2 * t);
  }

  return last[1];
}

/**
 * The two rods this draws, as a shading profile across the handle.
 *
 * A rod is a cylinder, and what tells you a cylinder is made of is the shape of
 * the light across it — not its colour, which is why a tone and a highlight
 * were not enough. So each of these is the section itself: how bright the
 * handle is at every point from one rim to the other.
 *
 * `dark` is the rod the wooden hand brings with it, matched so that a hand
 * given a rod here and one that brought its own stand in the picker as the same
 * prop. One narrow highlight on near-black, which is what a painted dowel is.
 *
 * `silver` is metal, and metal is three things a painted rod is not. The
 * specular is **hot and narrow** — it clips to white rather than peaking at a
 * grey. There is a **second, softer band near the far rim**, which is light
 * bounced back off whatever the rod is over; it is the single strongest cue
 * that a cylinder is polished, and its absence is why the first attempt read as
 * grey plastic. And the **range is wide**: it goes almost black at one rim and
 * fully white at the core, where plastic stays in the middle of the scale.
 *
 * Every number is a tone from 0 to 255, at a fraction across the handle.
 */
const RODS = {
  dark: [
    [0, 9],
    [0.5, 14],
    [0.62, 48],
    [0.72, 194],
    [0.82, 48],
    [1, 9],
  ],
  silver: [
    // The shaded rim, almost black: this is the edge the handle has, because
    // nothing here is outlined, and a silver rod that starts at mid grey has no
    // edge at all over a light background.
    [0, 34],
    [0.1, 78],
    [0.28, 150],
    [0.46, 232],
    // The specular core, clipped. A highlight that peaks below white is a matt
    // one, whatever else is done to it.
    [0.56, 255],
    [0.64, 236],
    // The turn into shadow, and it has to go further down than feels right:
    // the contrast either side of the core is most of what reads as chrome.
    [0.78, 96],
    // Bounce. Softer and much wider than the specular, and never as bright.
    [0.9, 178],
    [1, 44],
  ],
};

/**
 * How far the lengthwise shimmer swings the tone, and over what span of the
 * handle, as a fraction of the hand's width.
 *
 * Polished metal reflects whatever is around it, so a real rod is never one
 * tone down its length — and a perfectly even one is the other half of why the
 * first silver looked moulded. Slow and shallow on purpose: this is a cue
 * caught out of the corner of the eye, and anything stronger is a rod with
 * stripes painted on it.
 */
const SHIMMER = { depth: 0.1, span: 7 };

/**
 * A rod for a hand that came without one, in the source's own pixels.
 *
 * Four of the five are bare gloves, and a hand with no stick is not a pointer
 * stick. Drawn to the proportions the wooden one arrives in rather than to a
 * taste of our own — a fifth of the hand's width, centred under the cuff.
 */
function rodFor(shape, handle) {
  const profile = RODS[handle];
  const width = shape.hand.width * 0.2;
  const left = shape.cuff - width / 2;
  const metal = handle === "silver";

  return (u, v) => {
    const across = (u - left) / width;
    if (across < 0 || across > 1) return [0, 0, 0, 0];

    // Soft at both edges, so the rod has a round section rather than a flat one
    // and its sides are not a stair under the lean.
    const edge = Math.min(across, 1 - across) * width;
    const alpha = Math.max(0, Math.min(1, edge)) * 255;

    let value = alongProfile(profile, across);

    if (metal) {
      // Two spans that do not divide into each other, so the shimmer does not
      // repeat over the length of a handle this long.
      const run = v / (width * SHIMMER.span);
      const swing = Math.sin(run) * 0.6 + Math.sin(run * 0.37 + 1.3) * 0.4;
      value *= 1 + SHIMMER.depth * swing;
    }

    const tone = Math.max(0, Math.min(255, Math.round(value)));
    // A touch cool. Steel is not neutral grey, and three points of blue is the
    // difference between a rod and a shadow of one.
    return [tone, tone, Math.min(255, tone + (metal ? 6 : 3)), alpha];
  };
}

/**
 * The strip, as a function of where you look rather than as an image.
 *
 * Above the seam it is the hand, in the source's own rows. Below it the rod,
 * repeated for ever — so "run the handle past the edge of the frame" costs
 * nothing and has no joins to get wrong.
 */
function striper(image, shape, handle) {
  const { width, height, rgba } = image;
  const seam = shape.wrist + 40 - shape.top;
  const drawn = shape.hasRod ? null : rodFor(shape, handle);
  const slabHeight = shape.slab.to - shape.slab.from;

  return (u, v) => {
    const x = Math.round(u);

    if (v >= seam && drawn) return drawn(u, v - seam);

    const y =
      v < seam ? shape.top + Math.round(v) : shape.slab.from + (Math.round(v - seam) % slabHeight);

    if (x < 0 || x >= width || y < 0 || y >= height) return [0, 0, 0, 0];
    const at = (y * width + x) * 4;
    return [rgba[at], rgba[at + 1], rgba[at + 2], rgba[at + 3]];
  };
}

/** Where the fingertip lands, as `CURSOR_STYLES` carries it. */
const TIP = { x: 0.045, y: 0.025 };

/** Samples per axis per output pixel — see the note at the top. */
const SAMPLES = 4;

/**
 * One sprite: the strip scaled, leaned and placed by its fingertip.
 *
 * `hand` is the hand's longer edge in output pixels, which is how every pointer
 * in `make-cursor.mjs` is sized too, and `rod` how far past the fist the handle
 * runs — past the image's own edge, so the edge is what cuts it and the handle
 * never has an end anybody can see.
 */
function drawStick(image, shape, handle, { size, hand, rod, tip }) {
  const scale = hand / Math.max(shape.hand.width, shape.hand.height);
  const radians = (STICK_TILT * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  // Clockwise on screen, so the hand goes up and to the left and the handle
  // hangs down and to the right — which is the way the arrow this is leaned
  // onto points.
  const seam = shape.wrist + 40 - shape.top;

  // The fingertip *after* the lean, which is not the fingertip before it: the
  // highest point of a hand turned twenty-nine degrees is further round the
  // finger's arc. Found by turning the hand's own pixels, which is a few
  // hundred thousand of them once and none per output pixel.
  let highest = Infinity;
  let at = 0;
  for (let v = 0; v < seam; v++) {
    const row = (shape.top + v) * image.width;
    for (let u = 0; u < image.width; u++) {
      if (image.rgba[(row + u) * 4 + 3] <= SOLID) continue;
      const y = (u * sin + v * cos) * scale;
      if (y < highest) {
        highest = y;
        at = (u * cos - v * sin) * scale;
      }
    }
  }

  const offsetX = tip.x * size - at;
  const offsetY = tip.y * size - highest;
  const strip = striper(image, shape, handle);

  // How far down the strip anything can be and still land on the image, so the
  // loop below is not asking about a rod that ran off the bottom long ago.
  const reach = (rod + hand) / scale;
  const out = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          // Back the way it came: off the placement, out of the lean, out of
          // the scale.
          const px = x + (sx + 0.5) / SAMPLES - offsetX;
          const py = y + (sy + 0.5) / SAMPLES - offsetY;
          const u = (px * cos + py * sin) / scale;
          const v = (py * cos - px * sin) / scale;
          if (v < 0 || v > reach) continue;

          const [r, g, b, a] = strip(u, v);
          if (a === 0) continue;
          // Premultiplied while it is averaged and divided back out below. A
          // straight average of colour across a soft edge drags in whatever the
          // transparent pixels happen to carry, and these files carry a
          // full-strength colour under theirs.
          const weight = a / 255;
          red += r * weight;
          green += g * weight;
          blue += b * weight;
          alpha += weight;
        }
      }

      if (alpha <= 0) continue;
      const to = (y * size + x) * 4;
      out[to] = Math.round(red / alpha);
      out[to + 1] = Math.round(green / alpha);
      out[to + 2] = Math.round(blue / alpha);
      out[to + 3] = Math.round((alpha / (SAMPLES * SAMPLES)) * 255);
    }
  }

  return out;
}

/**
 * The two drawings of every stick: the one that is composited and the one in
 * the panel.
 *
 * Not one image used twice, and the two are not even the same proportions. The
 * sprite is a fifteenth hand and the rest handle, because the rod has to leave
 * the frame from anywhere in it — so a tile cut from that is a hairline across
 * an empty square.
 *
 * The tile is therefore mostly hand, with the stick running out of the bottom
 * corner. Every swatch in that picker is drawn at the same width, so a stick
 * drawn to the sprite's proportions put a hand a third the size of the frog
 * next to it, and the grid read as one row of pointers and one row of
 * something further away. 0.78 is where the hand matches the glyphs around it;
 * past that the stick stops being visible at all, which is the other half of
 * what the tile has to say.
 */
const SHAPES = [
  { suffix: "", size: 2048, hand: 140, rod: 1.25 * 2048, tip: TIP },
  { suffix: "-swatch", size: 128, hand: 0.78 * 128, rod: 0.95 * 128, tip: { x: 0.1, y: 0.03 } },
];

/**
 * Which hands, in the order the picker shows them, and what each is called in
 * `CURSOR_STYLES`.
 *
 * Five, and chosen to be five answers rather than five materials: a plain white
 * glove and its black twin, which between them suit anything; something warm
 * and wooden for a lesson; and two that are frankly toys.
 *
 * `from` is the folder as well as the file — `hands` is ours, `tinyhand` is
 * TinyHand's and carries the notice in `NOTICE.md`.
 *
 * `handle` is the rod drawn under a bare glove, and is only read for one that
 * came without a stick. The pink one takes the silver rod because its glove is
 * pale and a black rod under it reads as two objects rather than one prop; the
 * black glove keeps the dark rod for the same reason in reverse.
 */
const HANDS = [
  // First, and keeping the id the drawn stick had: a project that chose the
  // stick before this goes on to be a different picture rather than a missing
  // one.
  { id: "stick", label: "white", from: "hands/hand_white.png", handle: "dark" },
  { id: "stick-black", label: "black", from: "hands/hand_black.png", handle: "dark" },
  { id: "stick-wood", label: "wooden", from: "tinyhand/hand_wood.png", handle: "dark" },
  { id: "stick-pink", label: "pink", from: "hands/hand_pink.png", handle: "silver" },
  { id: "stick-blue", label: "fuzzy blue", from: "hands/hand_blue.png", handle: "dark" },
];

mkdirSync(OUT_DIR, { recursive: true });

for (const entry of HANDS) {
  const image = decodePng(readFileSync(resolve(SOURCE, entry.from)));
  const shape = anatomy(image);

  for (const form of SHAPES) {
    const file = resolve(OUT_DIR, `cursor-${entry.id}${form.suffix}.png`);
    writeFileSync(file, encodePng(drawStick(image, shape, entry.handle, form), form.size));
    console.log(
      `wrote ${file} (${String(form.size)}px, hotspot ${form.tip.x.toFixed(4)},` +
        ` ${form.tip.y.toFixed(4)}, lean ${STICK_TILT.toFixed(2)}°,` +
        ` rod ${shape.hasRod ? "its own" : entry.handle})`,
    );
  }
}
