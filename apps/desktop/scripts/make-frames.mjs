// Makes the camera frames.
//
//   node scripts/make-frames.mjs
//
// Each frame is a picture with a hole in it, hung round the camera. Three of
// them are photographs of objects and are *cut*; the window is flat fills and
// three discs and is *drawn* — see `window-frame.mjs` for why a photograph of
// one can only be worse.
//
// The source art is a keyed cut-out, and a keyed cut-out is never clean: the stamp came
// back with every pixel of its middle at about 8% alpha rather than none, which
// composites as a grey veil over whoever is on camera, and the others carry a
// few per cent of fringe round their edges that reads as a dirty halo. So the
// alpha is levelled, the result is trimmed to what the art actually draws, and
// it is scaled down to what an export is ever asked to draw it at.
//
// **It also prints the aperture**, which is the whole reason this is a script
// and not four runs of a one-liner. `shared/camera-frames.ts` has to say where
// the hole is in each picture, as fractions of it, so the geometry can hang the
// plate round a camera; measured by hand off a screenshot those numbers are
// wrong by a few pixels and the paper sits visibly off the photograph. Paste
// what this prints.
//
// Output is committed, so a normal build needs no image tooling — the same rule
// `make-app-icon.mjs` and `make-tray-icons.mjs` follow. ffmpeg does the pixels;
// the measuring is here because no filter can answer it.
//
// Run via `pnpm frames`.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

import { drawWindowFrame } from "./window-frame.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = resolve(ROOT, "build/frames");
const OUT = resolve(ROOT, "resources/frames");
const SCRATCH = resolve(ROOT, "build/.frames-scratch");

/**
 * The longest edge of the artwork that ships.
 *
 * A plate is about one and a half times the camera, and a camera is a fraction
 * of the frame — so 900 is already above what a 4K export asks of it at any
 * sane bubble size, and the sampler is enlarging below that rather than
 * throwing detail away. The source is 1254, and shipping that was a megabyte a
 * frame for pixels nothing reads.
 */
const CAP = 900;

/**
 * Where each source's alpha is cut, as 0–255.
 *
 * Below `lo` is nothing and above `hi` is the plate, with a ramp between so the
 * edge keeps its antialiasing. Per frame because they were keyed by different
 * hands: three came back with a clean hole and a little fringe, and the stamp
 * came back with its whole middle at about a fifth — which is why its numbers
 * are nowhere near the others'. Lower its `lo` and the veil comes back as a
 * smudge across the top of the picture; raise it much further and the printed
 * keyline inside the border goes with it.
 */
const CUT = [
  { file: "polaroid.png", lo: 8, hi: 24 },
  { file: "stamp.png", lo: 75, hi: 200 },
  { file: "crt.png", lo: 8, hi: 24 },
  { file: "macintosh.png", lo: 8, hi: 24 },
];

/** The frames that are drawn instead, each by a function that returns pixels. */
const DRAWN = [{ file: "window.png", draw: drawWindowFrame }];

/** Anything at or below this is treated as a hole rather than as paper. */
const CLEAR = 8;

function crc32(buf) {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
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
 * Straight-alpha RGBA as a PNG.
 *
 * Written here rather than handed to ffmpeg, which would want the pixels in a
 * file first and then re-encode them: this is the same four chunks
 * `make-app-icon.mjs` writes for its mask, one colour type along.
 *
 * Filter 1 — each byte against the pixel to its left — rather than none. The
 * window is flat fills and long runs of identical pixels, which subtracting a
 * neighbour turns into runs of zeroes; it is a third of the size for a line of
 * arithmetic.
 */
function encodePng(rgba, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha

  const stride = width * 4;
  const raw = Buffer.alloc(height * (1 + stride));
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset++] = 1; // filter: sub
    const row = y * stride;
    for (let x = 0; x < stride; x += 1) {
      raw[offset++] = (rgba[row + x] - (x >= 4 ? rgba[row + x - 4] : 0)) & 0xff;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Where the hole is in one finished frame, as fractions of it. */
function measure(file, width, height) {
  const hole = holeBox(alphaOf(join(OUT, file), width, height), width, height);
  return {
    file,
    width,
    height,
    aperture: {
      x: hole.x / width,
      y: hole.y / height,
      width: hole.width / width,
      height: hole.height / height,
    },
  };
}

function ffmpeg(args) {
  execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "pipe", "inherit"] });
}

/**
 * One frame's alpha channel as width × height bytes.
 *
 * Raw rather than a PNG this would then have to decode: the only thing that
 * reads it is the arithmetic below, and `rawvideo` is already how the media
 * tests get pixels out of ffmpeg.
 */
function alphaOf(path, width, height) {
  const raw = join(SCRATCH, "alpha.gray");
  ffmpeg(["-i", path, "-vf", "alphaextract,format=gray", "-f", "rawvideo", raw]);
  const bytes = readFileSync(raw);
  if (bytes.length !== width * height) {
    throw new Error(`${path}: alpha is ${bytes.length} bytes, expected ${width * height}`);
  }
  return bytes;
}

/** A picture's size, straight from the file. */
function sizeOf(path) {
  const out = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      path,
    ],
    { encoding: "utf8" },
  ).trim();
  const [width, height] = out.split(",").map(Number);
  return { width, height };
}

/** The box around every pixel the art draws anything in, soft edges included. */
function drawnBox(alpha, width, height) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] <= 2) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * The box around the hole the middle of the plate sits in.
 *
 * A flood fill rather than a scan line along the middle. The art has grain in
 * it and the key leaves specks behind; one speck across the centre of the hole
 * cuts a scan in two and measures half of it, which is a number that looks
 * plausible and puts the paper a tenth of a frame off the picture.
 */
function holeBox(alpha, width, height) {
  const seen = new Uint8Array(width * height);
  const start = (height >> 1) * width + (width >> 1);
  if (alpha[start] > CLEAR) throw new Error("the middle of the plate is not a hole");

  const queue = [start];
  seen[start] = 1;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  while (queue.length > 0) {
    const at = queue.pop();
    const x = at % width;
    const y = (at - x) / width;
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < top) top = y;
    if (y > bottom) bottom = y;

    const neighbours = [
      x > 0 ? at - 1 : -1,
      x < width - 1 ? at + 1 : -1,
      y > 0 ? at - width : -1,
      y < height - 1 ? at + width : -1,
    ];
    for (const next of neighbours) {
      if (next < 0 || seen[next] || alpha[next] > CLEAR) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }

  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

rmSync(SCRATCH, { recursive: true, force: true });
mkdirSync(SCRATCH, { recursive: true });
mkdirSync(OUT, { recursive: true });

const measured = [];

for (const { file, draw } of DRAWN) {
  const { width, height, rgba } = draw();
  writeFileSync(join(OUT, file), encodePng(rgba, width, height));
  measured.push(measure(file, width, height));
}

for (const { file, lo, hi } of CUT) {
  const source = join(SOURCE, file);
  // The level, as a straight line through the two cuts. `clip` rather than a
  // `lut` table because the alpha has to survive the scale below as a ramp,
  // and a hard threshold here would leave the edge stepped.
  const level = `clip((alpha(X,Y)-${lo})*255/${hi - lo},0,255)`;

  const levelled = join(SCRATCH, `levelled-${file}`);
  ffmpeg([
    "-i",
    source,
    "-vf",
    `format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${level}'`,
    levelled,
  ]);

  const first = sizeOf(levelled);
  const box = drawnBox(alphaOf(levelled, first.width, first.height), first.width, first.height);

  // Cropped, then scaled, then cut again: scaling re-softens what the level
  // cleaned — a cleared pixel beside an opaque one comes back as a ramp, and
  // the ramp reaches into the hole as a faint rim round the picture.
  const scale = Math.min(1, CAP / Math.max(box.width, box.height));
  const width = Math.round(box.width * scale);
  const height = Math.round(box.height * scale);
  const target = join(OUT, file);
  ffmpeg([
    "-i",
    levelled,
    "-vf",
    `crop=${box.width}:${box.height}:${box.x}:${box.y},` +
      `scale=${width}:${height}:flags=lanczos,` +
      `format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(alpha(X,Y),${CLEAR}),0,alpha(X,Y))'`,
    "-compression_level",
    "100",
    target,
  ]);

  measured.push(measure(file, width, height));
}

rmSync(SCRATCH, { recursive: true, force: true });

const round = (value) => Number(value.toFixed(4));
console.log("\nPaste into CAMERA_FRAMES in src/shared/camera-frames.ts:\n");
for (const { file, width, height, aperture } of measured) {
  console.log(`  ${file}  ${width}x${height}`);
  console.log(
    `    aperture: { x: ${round(aperture.x)}, y: ${round(aperture.y)}, ` +
      `width: ${round(aperture.width)}, height: ${round(aperture.height)} },`,
  );
  // What the hole is actually shaped like, which is what the picker writes
  // the camera's width from — so a frame opens drawn at its own proportions
  // rather than stretched to whatever the last shape left behind.
  console.log(`    aspect: ${round((aperture.width * width) / (aperture.height * height))},`);
}
