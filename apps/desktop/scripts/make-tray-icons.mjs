// Generates the menu-bar tray icons.
//
// macOS template images must be black-with-alpha only: the system inverts them
// for light/dark menu bars and for the highlighted state. Any colour here would
// break that, so the icons are drawn as pure alpha masks.
//
// Run via `pnpm icons`; output is committed so a normal build needs no
// image tooling. That is also why the idle glyph's outline is inlined as path
// data and rasterised here rather than read from an `.svg` at build time: a
// generator that needs a rasteriser installed is one that stops being run, and
// the committed PNGs then drift from the source they claim to come from.
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

/**
 * The idle glyph: a video camera with the "auto" sparkle in it.
 *
 * Material Symbols `auto_videocam` (outline), Apache-2.0 — see
 * https://github.com/google/material-design-icons/blob/master/LICENSE
 *
 * Fitted to its own ink rather than to the 24-unit viewBox it is drawn in. The
 * glyph occupies x 2..22, y 4..20 of that box, so honouring the viewBox spends
 * a fifth of the canvas on padding the menu bar already provides — which is
 * what made the icon read as small beside everything else up there.
 */
const IDLE_PATH =
  "M4 20q-.825 0-1.413-.588T2 18V6q0-.825.588-1.413T4 4h12q.825 0 1.413.588T18 6v4.5l4-4v11l-4-4V18q0 .825-.588 1.413T16 20H4Zm0-2h12V6H4v12Zm0 0V6v12Zm6-2l1.25-2.75L14 12l-2.75-1.25L10 8l-1.25 2.75L6 12l2.75 1.25L10 16Z";

/**
 * Splits path data into subpaths of straight segments.
 *
 * Curves are flattened rather than solved: the fill below only ever asks which
 * side of an edge a point is on, and at 16 and 32 pixels the error from enough
 * line segments is far below one sample. Segment count follows the control
 * polygon's length so a long sweep does not get the same four steps as a corner.
 *
 * Arcs are rejected outright. Silently dropping one would produce a glyph that
 * is subtly wrong rather than one that fails, and this runs by hand — a throw
 * is seen, a warning in a build log is not.
 */
function flatten(d) {
  const steps = (length) => Math.min(48, Math.max(4, Math.ceil(length * 4)));

  const polygons = [];
  let points = [];
  // `start` is where `Z` returns to; `previous` is the reflected control point
  // that `T`/`S` need, and is only meaningful straight after a curve.
  let x = 0,
    y = 0,
    startX = 0,
    startY = 0;
  let previousControl = null;

  const lineTo = (nx, ny) => {
    points.push([nx, ny]);
    x = nx;
    y = ny;
    previousControl = null;
  };

  const quadTo = (cx, cy, nx, ny) => {
    const n = steps(Math.hypot(cx - x, cy - y) + Math.hypot(nx - cx, ny - cy));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      points.push([
        u * u * x + 2 * u * t * cx + t * t * nx,
        u * u * y + 2 * u * t * cy + t * t * ny,
      ]);
    }
    x = nx;
    y = ny;
    previousControl = [cx, cy];
  };

  const cubicTo = (c1x, c1y, c2x, c2y, nx, ny) => {
    const n = steps(
      Math.hypot(c1x - x, c1y - y) +
        Math.hypot(c2x - c1x, c2y - c1y) +
        Math.hypot(nx - c2x, ny - c2y),
    );
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      points.push([
        u * u * u * x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * nx,
        u * u * u * y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ny,
      ]);
    }
    x = nx;
    y = ny;
    previousControl = [c2x, c2y];
  };

  const closeSubpath = () => {
    if (points.length > 2) polygons.push(points);
    points = [];
  };

  for (const [, command, rest] of d.matchAll(/([MmLlHhVvQqTtCcSsZz])([^MmLlHhVvQqTtCcSsZz]*)/g)) {
    // `-.5.5` is two numbers and `1e-3` is one, which is why this is a match
    // rather than a split on separators.
    const numbers = (rest.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    const relative = command === command.toLowerCase();
    const upper = command.toUpperCase();

    if (upper === "Z") {
      closeSubpath();
      x = startX;
      y = startY;
      previousControl = null;
      continue;
    }
    if (upper === "A") throw new Error("arc commands are not supported");

    // Every command repeats its own argument list until the numbers run out,
    // and a repeated `M` means `L` — miss that and `m0-2h12V6H4v12Z` above
    // silently becomes a second stray move.
    let step = { M: 2, L: 2, H: 1, V: 1, Q: 4, T: 2, C: 6, S: 4 }[upper];
    for (let i = 0; i < numbers.length; i += step) {
      const a = numbers.slice(i, i + step);
      const first = i === 0;

      if (upper === "M" && first) {
        x = relative ? x + a[0] : a[0];
        y = relative ? y + a[1] : a[1];
        closeSubpath();
        startX = x;
        startY = y;
        points = [[x, y]];
        previousControl = null;
      } else if (upper === "M" || upper === "L") {
        lineTo(relative ? x + a[0] : a[0], relative ? y + a[1] : a[1]);
      } else if (upper === "H") {
        lineTo(relative ? x + a[0] : a[0], y);
      } else if (upper === "V") {
        lineTo(x, relative ? y + a[0] : a[0]);
      } else if (upper === "Q") {
        quadTo(
          relative ? x + a[0] : a[0],
          relative ? y + a[1] : a[1],
          relative ? x + a[2] : a[2],
          relative ? y + a[3] : a[3],
        );
      } else if (upper === "T") {
        // A smooth quadratic reflects the previous control point through the
        // current point; with no previous curve the control point *is* the
        // current point, which degenerates to a straight line.
        const [cx, cy] = previousControl
          ? [2 * x - previousControl[0], 2 * y - previousControl[1]]
          : [x, y];
        quadTo(cx, cy, relative ? x + a[0] : a[0], relative ? y + a[1] : a[1]);
      } else if (upper === "C") {
        cubicTo(
          relative ? x + a[0] : a[0],
          relative ? y + a[1] : a[1],
          relative ? x + a[2] : a[2],
          relative ? y + a[3] : a[3],
          relative ? x + a[4] : a[4],
          relative ? y + a[5] : a[5],
        );
      } else if (upper === "S") {
        const [cx, cy] = previousControl
          ? [2 * x - previousControl[0], 2 * y - previousControl[1]]
          : [x, y];
        cubicTo(
          cx,
          cy,
          relative ? x + a[0] : a[0],
          relative ? y + a[1] : a[1],
          relative ? x + a[2] : a[2],
          relative ? y + a[3] : a[3],
        );
      }
    }
  }

  closeSubpath();
  return polygons;
}

/**
 * Rasterises flattened subpaths to an alpha coverage map.
 *
 * Centred on the canvas at the largest scale that keeps its aspect ratio.
 *
 * Non-zero winding, which is SVG's default and the reason the camera body comes
 * out hollow: its inner rectangle is wound the opposite way to the outer one, so
 * the two cancel. Even-odd would look identical here and differ the moment a
 * glyph overlaps itself.
 */
function fillPath(d, size) {
  const subpaths = flatten(d);

  // The glyph is wider than it is tall, so on a square canvas width is what
  // binds. `Math.min` of the two ratios rather than scaling each axis to fit:
  // the second would fill the canvas exactly and stretch the camera out of
  // shape, which at this size reads as a blurred icon rather than a wrong one.
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const points of subpaths) {
    for (const [px, py] of points) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }
  const scale = Math.min(size / (maxX - minX), size / (maxY - minY));
  const offsetX = (size - (maxX - minX) * scale) / 2 - minX * scale;
  const offsetY = (size - (maxY - minY) * scale) / 2 - minY * scale;

  const polygons = subpaths.map((points) =>
    points.map(([px, py]) => [px * scale + offsetX, py * scale + offsetY]),
  );
  const pixels = new Uint8Array(size * size);
  const samples = 4;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = x + (sx + 0.5) / samples - 0.5;
          const py = y + (sy + 0.5) / samples - 0.5;

          let winding = 0;
          for (const points of polygons) {
            for (let i = 0; i < points.length; i++) {
              const [x0, y0] = points[i];
              const [x1, y1] = points[(i + 1) % points.length];
              // Half-open in y, so a sample level with a shared vertex is
              // counted by exactly one of the two edges rather than both.
              if (y0 <= py) {
                if (y1 > py && (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0) > 0) winding++;
              } else if (y1 <= py && (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0) < 0) {
                winding--;
              }
            }
          }
          if (winding !== 0) hits++;
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
  ["idleTemplate", (size) => fillPath(IDLE_PATH, size)],
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
