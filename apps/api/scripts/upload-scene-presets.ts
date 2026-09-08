/**
 * Publishes the scene presets and writes the catalogue the app reads.
 *
 *   pnpm --filter @prequel/api scene-presets          # upload what has changed
 *   pnpm --filter @prequel/api scene-presets --dry    # say what it would do
 *
 * Reads `scene-presets/` at the repo root: one `<id>.json` holding the look, and
 * one `<id>.jpg` beside it — a still of what that look produces. Writes the card
 * under `scene-presets/thumbnail/` and `scene-presets/config.json` listing every
 * preset with a BlurHash the picker can draw immediately.
 *
 * Re-running it is cheap. Every entry carries the MD5 of its card, so a run that
 * only changes a name does not send the pictures again.
 *
 * **It cross-checks the background catalogue.** A published look may name a
 * wallpaper, and the only wallpapers it may name are the ones already in
 * `backgrounds/config.json` — so applying one is the download path the app
 * already has rather than a second one. A preset naming a picture that is not
 * there is refused here, where the person who published it is watching, instead
 * of reaching an editor as a composition that will not draw.
 *
 * macOS only, deliberately, for the reason the backgrounds uploader is: it
 * shells out to `sips` rather than pulling in a native image dependency.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { AwsClient } from "aws4fetch";
import { encode as encodeBlurhash } from "blurhash";

import { BACKGROUNDS_CONFIG_KEY, backgroundsConfig } from "../src/lib/backgrounds.ts";
import {
  SCENE_PRESETS_CONFIG_KEY,
  SCENE_PRESETS_THUMBNAIL_PREFIX,
  SCENE_PRESETS_VERSION,
  scenePresetsConfig,
  type ScenePresetEntry,
  type ScenePresetsConfig,
} from "../src/lib/scene-presets.ts";

/** Longest edge of a card. The menu draws them about 140 points across. */
const CARD_EDGE = 640;

/** What the BlurHash is computed from. Its own resolution is four by three. */
const BLUR_EDGE = 32;

const root = fileURLToPath(new URL("../../../scene-presets/", import.meta.url));
const dry = process.argv.includes("--dry");

// ── credentials ─────────────────────────────────────────────────────────────

/**
 * Read from `.dev.vars` rather than the environment, for the reason the
 * backgrounds uploader gives: it is where the Worker's own secrets already
 * live, so there is one place to put a credential and no chance of the script
 * and the API disagreeing about which bucket they mean.
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
  return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${key
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

// ── pictures ────────────────────────────────────────────────────────────────

function sips(...args: string[]): string {
  return execFileSync("sips", args, { encoding: "utf8" });
}

/**
 * A BlurHash of the card.
 *
 * Via a 32-pixel BMP, which is the trick that keeps this dependency-free:
 * `sips` will write one, and an uncompressed 24-bit BMP is a header and then
 * rows of bytes. Decoding a JPEG would have meant a decoder.
 */
function blurhashOf(path: string): string {
  const bmp = join(tmpdir(), `prequel-preset-blur-${process.pid}.bmp`);
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

function card(path: string): Buffer {
  const out = join(tmpdir(), `prequel-preset-card-${process.pid}.jpg`);
  try {
    sips(
      "-s",
      "format",
      "jpeg",
      "-s",
      "formatOptions",
      "70",
      "-Z",
      String(CARD_EDGE),
      path,
      "--out",
      out,
    );
    return readFileSync(out);
  } finally {
    rmSync(out, { force: true });
  }
}

// ── the run ─────────────────────────────────────────────────────────────────

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

async function existing(): Promise<Map<string, ScenePresetEntry>> {
  const response = await withRetries("reading the catalogue", () =>
    client.fetch(objectUrl(SCENE_PRESETS_CONFIG_KEY)),
  );
  if (response.status === 404) return new Map();
  if (!response.ok) throw new Error(`could not read the catalogue: ${String(response.status)}`);

  const parsed = scenePresetsConfig.safeParse(await response.json());
  if (!parsed.success) {
    // Not fatal: a catalogue this script cannot read is one it is about to
    // replace. It only costs the skip-what-is-unchanged shortcut.
    console.warn("the catalogue in the bucket did not parse; uploading everything");
    return new Map();
  }

  return new Map(parsed.data.presets.map((entry) => [entry.id, entry]));
}

/**
 * Every wallpaper the background catalogue currently holds.
 *
 * Fetched rather than read off disk, because what matters is what the *app*
 * will be able to download, which is what is in the bucket.
 */
export async function publishedBackgrounds(): Promise<Set<string>> {
  const response = await withRetries("reading the background catalogue", () =>
    client.fetch(objectUrl(BACKGROUNDS_CONFIG_KEY)),
  );
  if (!response.ok) return new Set();

  const parsed = backgroundsConfig.safeParse(await response.json());
  if (!parsed.success) return new Set();

  return new Set(parsed.data.backgrounds.map((entry) => entry.file));
}

/** The wallpaper a look names, if it names one. */
function wallpaperOf(preset: { background?: Record<string, unknown> }): string | null {
  const paint = preset.background?.["background"] as
    { kind?: string; source?: string; path?: string } | undefined;

  return paint?.kind === "image" && paint.source === "preset" ? (paint.path ?? null) : null;
}

async function main(): Promise<void> {
  if (!existsSync(root)) throw new Error(`no presets at ${root}`);

  const before = await existing();
  const wallpapers = await publishedBackgrounds();
  const presets: ScenePresetEntry[] = [];
  let uploaded = 0;
  let skipped = 0;

  for (const file of readdirSync(root).sort()) {
    if (!file.endsWith(".json")) continue;

    const id = file.replace(/\.json$/, "");
    const look = JSON.parse(readFileSync(join(root, file), "utf8")) as Record<string, unknown>;
    const picture = join(root, `${id}.jpg`);
    if (!existsSync(picture)) throw new Error(`${id} has no card at ${id}.jpg`);

    // The cross-check. A look naming a wallpaper the app cannot fetch applies to
    // a composition that will not draw, and nothing downstream would say why.
    const wallpaper = wallpaperOf(look);
    if (wallpaper && !wallpapers.has(wallpaper)) {
      throw new Error(
        `${id} names the wallpaper ${wallpaper}, which is not in the background catalogue — ` +
          `add it to backgrounds/ and run \`pnpm --filter @prequel/api backgrounds\` first`,
      );
    }

    const bytes = readFileSync(picture);
    const md5 = createHash("md5").update(bytes).digest("hex");
    const was = before.get(id);
    // The whole point of the hash: the same card is already up there, so it does
    // not need sending again. The entry is still rebuilt, because a name or a
    // setting can move without the picture changing.
    const unchanged = was?.md5 === md5;

    const entry = {
      ...look,
      id,
      md5,
      blurhash: unchanged && was ? was.blurhash : blurhashOf(picture),
    } as ScenePresetEntry;

    if (unchanged) {
      skipped += 1;
    } else if (dry) {
      console.log(`would upload ${id}`);
      uploaded += 1;
    } else {
      await put(`${SCENE_PRESETS_THUMBNAIL_PREFIX}/${id}.jpg`, card(picture), "image/jpeg");
      console.log(`uploaded ${id}`);
      uploaded += 1;
    }

    presets.push(entry);
  }

  const config: ScenePresetsConfig = {
    version: SCENE_PRESETS_VERSION,
    updated: new Date().toISOString(),
    presets,
  };

  // Validated before it is written, not after. This is the file both ends agree
  // on, and the moment to catch a bad one is while the person who made it is
  // still looking at the terminal.
  const checked = scenePresetsConfig.parse(config);

  if (dry) {
    console.log(`\nwould write ${SCENE_PRESETS_CONFIG_KEY} with ${checked.presets.length} entries`);
  } else {
    await put(
      SCENE_PRESETS_CONFIG_KEY,
      Buffer.from(JSON.stringify(checked, null, 2)),
      "application/json",
    );
    console.log(`\nwrote ${SCENE_PRESETS_CONFIG_KEY}`);
  }

  console.log(`${checked.presets.length} presets — ${uploaded} uploaded, ${skipped} unchanged`);
}

await main();
