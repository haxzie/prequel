/**
 * Puts the background pictures in R2 and writes the catalogue the app reads.
 *
 *   pnpm --filter @prequel/api backgrounds          # upload what has changed
 *   pnpm --filter @prequel/api backgrounds --dry    # say what it would do
 *
 * Reads `backgrounds/` at the repo root — a folder per category — and writes
 * three things into the bucket: the full picture under `backgrounds/raw/`, a
 * swatch-sized one under `backgrounds/thumbnail/`, and `backgrounds/config.json`
 * listing both with a BlurHash the picker can draw immediately.
 *
 * Re-running it is cheap. Every entry carries the MD5 of its bytes, so the
 * script fetches the catalogue it is about to replace and skips any picture
 * whose hash still matches — uploading forty megabytes to change one label is
 * the kind of thing nobody does twice.
 *
 * It validates the catalogue against `backgroundsConfig` before writing it,
 * which is the same schema the route validates on the way back out. A
 * catalogue that cannot be parsed should fail here, where the person who
 * produced it is watching, rather than in an editor with an empty picker.
 *
 * macOS only, deliberately: it shells out to `sips` for dimensions, thumbnails
 * and pixels rather than pulling in a native image dependency, and the app it
 * serves is macOS only anyway.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { AwsClient } from "aws4fetch";
import { encode as encodeBlurhash } from "blurhash";

import {
  BACKGROUNDS_CONFIG_KEY,
  BACKGROUNDS_RAW_PREFIX,
  BACKGROUNDS_THUMBNAIL_PREFIX,
  BACKGROUNDS_VERSION,
  backgroundsConfig,
  type BackgroundEntry,
  type BackgroundsConfig,
} from "../src/lib/backgrounds.ts";

/** Longest edge of a swatch. The picker draws them about 80 points across. */
const THUMBNAIL_EDGE = 640;

/** What the BlurHash is computed from. Its own resolution is four by three. */
const BLUR_EDGE = 32;

const root = fileURLToPath(new URL("../../../backgrounds/", import.meta.url));
const dry = process.argv.includes("--dry");

// ── credentials ─────────────────────────────────────────────────────────────

/**
 * Read from `.dev.vars` rather than the environment.
 *
 * It is where the Worker's own secrets already live, so there is one place to
 * put a credential and no chance of the script and the API disagreeing about
 * which bucket they mean.
 */
function credentials(): Record<string, string> {
  const file = fileURLToPath(new URL("../.dev.vars", import.meta.url));
  if (!existsSync(file)) throw new Error(`no ${file} — R2 credentials live there`);

  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match) out[match[1]!] = match[2]!.trim().replace(/^["']|["']$/g, "");
  }

  for (const key of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) {
    if (!out[key]) throw new Error(`${key} is not set in .dev.vars`);
  }
  return out;
}

const env = credentials();

const client = new AwsClient({
  accessKeyId: env.R2_ACCESS_KEY_ID!,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
  // R2 ignores the region but the signature covers it, and "auto" is the
  // literal string R2 signs with — the same note as `src/lib/r2.ts`.
  region: "auto",
  service: "s3",
});

function objectUrl(key: string): string {
  // Path style: R2's account endpoint serves every bucket off one hostname.
  return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${key
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

// ── pictures ────────────────────────────────────────────────────────────────

function sips(...args: string[]): string {
  return execFileSync("sips", args, { encoding: "utf8" });
}

function dimensions(path: string): { width: number; height: number } {
  const out = sips("-g", "pixelWidth", "-g", "pixelHeight", path);
  const width = Number(/pixelWidth:\s*(\d+)/.exec(out)?.[1]);
  const height = Number(/pixelHeight:\s*(\d+)/.exec(out)?.[1]);
  if (!width || !height) throw new Error(`could not read the size of ${path}`);
  return { width, height };
}

/**
 * A BlurHash of the picture.
 *
 * Via a 32-pixel BMP, which is the trick that keeps this dependency-free:
 * `sips` will write one, and an uncompressed 24-bit BMP is a header and then
 * rows of bytes. Decoding a PNG would have meant a decoder.
 */
function blurhashOf(path: string): string {
  const bmp = join(tmpdir(), `prequel-blur-${process.pid}.bmp`);
  try {
    sips("-s", "format", "bmp", "-Z", String(BLUR_EDGE), path, "--out", bmp);
    const data = readFileSync(bmp);

    const start = data.readUInt32LE(10);
    const width = data.readInt32LE(18);
    // Negative means the rows are stored top-down, which is what `sips` writes.
    const signed = data.readInt32LE(22);
    const height = Math.abs(signed);
    const topDown = signed < 0;
    const depth = data.readUInt16LE(28);
    if (depth !== 24) throw new Error(`expected a 24-bit BMP, got ${depth}`);

    // Rows are padded to a multiple of four bytes.
    const stride = Math.floor((width * 3 + 3) / 4) * 4;
    const rgba = new Uint8ClampedArray(width * height * 4);

    for (let y = 0; y < height; y += 1) {
      const row = start + (topDown ? y : height - 1 - y) * stride;
      for (let x = 0; x < width; x += 1) {
        const from = row + x * 3;
        const to = (y * width + x) * 4;
        // BMP stores blue, green, red.
        rgba[to] = data[from + 2]!;
        rgba[to + 1] = data[from + 1]!;
        rgba[to + 2] = data[from]!;
        rgba[to + 3] = 255;
      }
    }

    return encodeBlurhash(rgba, width, height, 4, 3);
  } finally {
    rmSync(bmp, { force: true });
  }
}

function thumbnail(path: string): Buffer {
  const out = join(tmpdir(), `prequel-thumb-${process.pid}.jpg`);
  try {
    sips(
      "-s",
      "format",
      "jpeg",
      "-s",
      "formatOptions",
      "70",
      "-Z",
      String(THUMBNAIL_EDGE),
      path,
      "--out",
      out,
    );
    return readFileSync(out);
  } finally {
    rmSync(out, { force: true });
  }
}

/** `soft-focus.jpg` becomes `soft-focus` and `Soft Focus`. */
function named(file: string): { id: string; label: string } {
  const id = file.replace(/\.jpg$/i, "");
  const label = id
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  return { id, label };
}

// ── the run ─────────────────────────────────────────────────────────────────

async function existing(): Promise<Map<string, BackgroundEntry>> {
  const response = await withRetries("reading the catalogue", () =>
    client.fetch(objectUrl(BACKGROUNDS_CONFIG_KEY)),
  );
  if (response.status === 404) return new Map();
  if (!response.ok) throw new Error(`could not read the catalogue: ${response.status}`);

  const parsed = backgroundsConfig.safeParse(await response.json());
  if (!parsed.success) {
    // Not fatal: a catalogue this script cannot read is one it is about to
    // replace. It only costs the skip-what-is-unchanged shortcut.
    console.warn("the catalogue in the bucket did not parse; uploading everything");
    return new Map();
  }

  return new Map(parsed.data.backgrounds.map((entry) => [entry.file, entry]));
}

/**
 * Retries, because a long run of large PUTs will drop a connection.
 *
 * Not a nicety: the catalogue is only written once every picture is up, so a
 * socket closing on the twentieth upload loses the nineteen before it — there
 * is nothing on the other side yet for the hash check to resume from. Cheaper
 * to survive the blip than to design around it.
 */
async function withRetries<T>(what: string, run: () => Promise<T>): Promise<T> {
  let last: unknown;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await run();
    } catch (cause) {
      last = cause;
      const wait = 400 * 2 ** (attempt - 1);
      console.warn(`${what} failed (${attempt}/4), retrying in ${wait}ms`);
      await new Promise((resume) => setTimeout(resume, wait));
    }
  }

  throw last;
}

async function put(key: string, body: Buffer, type: string): Promise<void> {
  await withRetries(`PUT ${key}`, async () => {
    const response = await client.fetch(objectUrl(key), {
      method: "PUT",
      body: new Uint8Array(body),
      headers: { "content-type": type },
    });
    // A 5xx is worth another go; a 4xx is a bad request or a bad credential and
    // will fail the same way four times.
    if (!response.ok && response.status >= 500) {
      throw new Error(`PUT ${key} failed: ${response.status}`);
    }
    if (!response.ok) {
      throw Object.assign(new Error(`PUT ${key} refused: ${response.status}`), { fatal: true });
    }
  });
}

async function main(): Promise<void> {
  if (!existsSync(root)) throw new Error(`no pictures at ${root}`);

  const { categories } = JSON.parse(readFileSync(join(root, "categories.json"), "utf8")) as {
    categories: { id: string; label: string }[];
  };

  const before = await existing();
  const backgrounds: BackgroundEntry[] = [];
  let uploaded = 0;
  let skipped = 0;

  for (const category of categories) {
    const folder = join(root, category.id);
    if (!existsSync(folder) || !statSync(folder).isDirectory()) {
      console.warn(`${category.id}: no folder, skipping`);
      continue;
    }

    for (const file of readdirSync(folder).sort()) {
      if (!file.endsWith(".jpg")) continue;

      const path = join(folder, file);
      const bytes = readFileSync(path);
      const md5 = createHash("md5").update(bytes).digest("hex");
      const { id, label } = named(file);
      const was = before.get(file);

      // The whole point of the hash: the same bytes are already up there, so
      // the picture and its thumbnail do not need sending again. The entry is
      // still rebuilt, because a label or a category can move without the
      // pixels changing.
      const unchanged = was?.md5 === md5;

      const { width, height } = dimensions(path);
      const entry: BackgroundEntry = {
        id,
        label,
        category: category.id,
        file,
        md5,
        bytes: bytes.length,
        width,
        height,
        blurhash: unchanged && was ? was.blurhash : blurhashOf(path),
      };

      if (unchanged) {
        skipped += 1;
      } else if (dry) {
        console.log(`would upload ${category.id}/${file}`);
        uploaded += 1;
      } else {
        await put(`${BACKGROUNDS_RAW_PREFIX}/${file}`, bytes, "image/jpeg");
        await put(`${BACKGROUNDS_THUMBNAIL_PREFIX}/${file}`, thumbnail(path), "image/jpeg");
        console.log(`uploaded ${category.id}/${file}`);
        uploaded += 1;
      }

      backgrounds.push(entry);
    }
  }

  const config: BackgroundsConfig = {
    version: BACKGROUNDS_VERSION,
    updated: new Date().toISOString(),
    categories,
    backgrounds,
  };

  // Validated before it is written, not after. This is the file both ends
  // agree on, and the moment to catch a bad one is while the person who made
  // it is still looking at the terminal.
  const checked = backgroundsConfig.parse(config);

  if (dry) {
    console.log(
      `\nwould write ${BACKGROUNDS_CONFIG_KEY} with ${checked.backgrounds.length} entries`,
    );
  } else {
    await put(
      BACKGROUNDS_CONFIG_KEY,
      Buffer.from(JSON.stringify(checked, null, 2)),
      "application/json",
    );
    console.log(`\nwrote ${BACKGROUNDS_CONFIG_KEY}`);
  }

  console.log(
    `${checked.backgrounds.length} backgrounds — ${uploaded} uploaded, ${skipped} unchanged`,
  );
}

await main();
