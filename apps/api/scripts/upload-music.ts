/**
 * Puts the music library in R2 and writes the catalogue the app reads.
 *
 *   pnpm --filter @prequel/api music          # upload what has changed
 *   pnpm --filter @prequel/api music --dry    # say what it would do
 *
 * Reads `music/` at the repo root — a folder per category — converts each file
 * to `.m4a` and writes two things into the bucket: the audio under
 * `music/raw/`, and `music/config.json` listing it with the length the editor
 * lays a bed at.
 *
 * Re-running it is cheap, the way `upload-backgrounds.ts` is: every entry
 * carries the MD5 of the *converted* bytes, and anything whose hash still
 * matches is skipped.
 *
 * It validates the catalogue against `musicConfig` before writing it, which is
 * the same schema the route validates on the way back out. A catalogue that
 * cannot be parsed should fail here, where the person who produced it is
 * watching, rather than in an editor with an empty picker.
 *
 * macOS only, deliberately: it shells out to `afconvert` for the encode and
 * `afinfo` for the length rather than pulling in a native audio dependency,
 * and the app it serves is macOS only anyway.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { AwsClient } from "aws4fetch";

import {
  MUSIC_CONFIG_KEY,
  MUSIC_RAW_PREFIX,
  MUSIC_VERSION,
  musicConfig,
  type MusicConfig,
  type MusicEntry,
} from "../src/lib/music.ts";

/**
 * What a bed is encoded at.
 *
 * 160 kbit AAC in stereo. Music is the one thing in an export that is heard on
 * its own rather than under a voice, and 128 — what the recorder writes its
 * own tracks at — is audible on a cymbal. Still a fifth of the size of the
 * lossless file somebody handed us.
 */
const BIT_RATE = "160000";

/** The formats worth looking at. Anything else in a folder is ignored. */
const SOURCES = /\.(m4a|mp3|wav|aiff|aif|flac|caf|aac)$/i;

const NS_PER_SECOND = 1_000_000_000;

const root = fileURLToPath(new URL("../../../music/", import.meta.url));
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

// ── audio ───────────────────────────────────────────────────────────────────

/**
 * The file re-encoded as AAC in an MP4, as bytes.
 *
 * Every source goes through this, including one that is already `.m4a`. A
 * copied file would keep whatever it was made with — 320 kbit, or a mono
 * 22 kHz podcast export — and the point of the step is that every track in the
 * library is the same thing at the same level.
 *
 * `-f m4af` is the container, `-d aac` the codec, `-b` the rate; `--soundcheck
 * -generate` is deliberately absent, because normalisation is a decision about
 * how loud the library is relative to a voice and the editor's volume slider
 * is where that is made.
 */
function encoded(path: string): Buffer {
  const out = join(tmpdir(), `prequel-music-${process.pid}.m4a`);
  try {
    execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", BIT_RATE, path, out], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    return readFileSync(out);
  } finally {
    rmSync(out, { force: true });
  }
}

/**
 * How long the file is, in nanoseconds.
 *
 * Read off the *encoded* bytes rather than the source. AAC is framed, so an
 * encode rounds the length up to the next 1024 samples and pads the start —
 * a handful of milliseconds, and the number in the catalogue has to be the
 * length of the file the app actually plays, because that is what it trims
 * and loops against.
 */
function lengthOf(path: string): number {
  const out = execFileSync("afinfo", [path], { encoding: "utf8" });
  const seconds = Number(/estimated duration:\s*([0-9.]+)/.exec(out)?.[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`could not read the length of ${path}`);
  }
  return Math.round(seconds * NS_PER_SECOND);
}

/** `slow-wander.m4a` becomes `slow-wander` and `Slow Wander`. */
function named(file: string): { id: string; label: string } {
  const id = file.replace(SOURCES, "");
  const label = id
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  return { id, label };
}

/**
 * The credits for one category, where it has any.
 *
 * A file beside the audio rather than a field in a name, because an
 * attribution is a sentence — "Kai Engel, CC BY 4.0" — and a file name is a
 * URL segment. Missing is the ordinary case and means no credit is required.
 */
function credits(folder: string): Record<string, string> {
  const path = join(folder, "attribution.json");
  if (!existsSync(path)) return {};

  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
  } catch (cause) {
    // Fatal, unlike most things here. A missing credit is a licence breach,
    // and the moment to find out is while somebody is looking at the terminal.
    throw new Error(`${path} is not readable JSON: ${String(cause)}`);
  }
}

// ── the run ─────────────────────────────────────────────────────────────────

async function existing(): Promise<Map<string, MusicEntry>> {
  const response = await withRetries("reading the catalogue", () =>
    client.fetch(objectUrl(MUSIC_CONFIG_KEY)),
  );
  if (response.status === 404) return new Map();
  if (!response.ok) throw new Error(`could not read the catalogue: ${response.status}`);

  const parsed = musicConfig.safeParse(await response.json());
  if (!parsed.success) {
    // Not fatal: a catalogue this script cannot read is one it is about to
    // replace. It only costs the skip-what-is-unchanged shortcut.
    console.warn("the catalogue in the bucket did not parse; uploading everything");
    return new Map();
  }

  return new Map(parsed.data.tracks.map((entry) => [entry.file, entry]));
}

/**
 * Retries, because a long run of large PUTs will drop a connection.
 *
 * Not a nicety: the catalogue is only written once every file is up, so a
 * socket closing on the twentieth upload loses the nineteen before it — there
 * is nothing on the other side yet for the hash check to resume from.
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
  if (!existsSync(root)) throw new Error(`no music at ${root}`);

  const { categories } = JSON.parse(readFileSync(join(root, "categories.json"), "utf8")) as {
    categories: { id: string; label: string }[];
  };

  const before = await existing();
  const tracks: MusicEntry[] = [];
  let uploaded = 0;
  let skipped = 0;

  for (const category of categories) {
    const folder = join(root, category.id);
    if (!existsSync(folder) || !statSync(folder).isDirectory()) {
      console.warn(`${category.id}: no folder, skipping`);
      continue;
    }

    const attribution = credits(folder);

    for (const source of readdirSync(folder).sort()) {
      if (!SOURCES.test(source)) continue;

      const path = join(folder, source);
      const { id, label } = named(source);
      const file = `${id}.m4a`;

      // Encoded before the hash, because the hash is of what goes in the
      // bucket. `afconvert` on a three-minute track is well under a second,
      // and doing it the other way round — hashing the source — would re-upload
      // the whole library the day the bit rate changed and skip nothing the day
      // it did not.
      const bytes = encoded(path);
      const md5 = createHash("md5").update(bytes).digest("hex");
      const was = before.get(file);
      const unchanged = was?.md5 === md5;

      const entry: MusicEntry = {
        id,
        label,
        category: category.id,
        file,
        md5,
        bytes: bytes.length,
        // Off the catalogue where the bytes have not changed: the length is a
        // property of those bytes, and a second `afinfo` would say the same
        // thing after writing a temporary file to say it to.
        duration: unchanged && was ? was.duration : withTemp(bytes, lengthOf),
        attribution: attribution[file] ?? attribution[source] ?? "",
      };

      if (unchanged) {
        skipped += 1;
      } else if (dry) {
        console.log(`would upload ${category.id}/${file}`);
        uploaded += 1;
      } else {
        await put(`${MUSIC_RAW_PREFIX}/${file}`, bytes, "audio/mp4");
        console.log(`uploaded ${category.id}/${file}`);
        uploaded += 1;
      }

      tracks.push(entry);
    }
  }

  const config: MusicConfig = {
    version: MUSIC_VERSION,
    updated: new Date().toISOString(),
    categories,
    tracks,
  };

  // Validated before it is written, not after. This is the file both ends
  // agree on, and the moment to catch a bad one is while the person who made
  // it is still looking at the terminal.
  const checked = musicConfig.parse(config);

  if (dry) {
    console.log(`\nwould write ${MUSIC_CONFIG_KEY} with ${checked.tracks.length} entries`);
  } else {
    await put(MUSIC_CONFIG_KEY, Buffer.from(JSON.stringify(checked, null, 2)), "application/json");
    console.log(`\nwrote ${MUSIC_CONFIG_KEY}`);
  }

  console.log(`${checked.tracks.length} tracks — ${uploaded} uploaded, ${skipped} unchanged`);
}

/**
 * Runs `read` against bytes that are only in memory.
 *
 * `afinfo` takes a path and the encode hands back a buffer, so there is a file
 * either way; this keeps it to one place and removes it afterwards.
 */
function withTemp<T>(bytes: Buffer, read: (path: string) => T): T {
  const path = join(tmpdir(), `prequel-music-read-${process.pid}.m4a`);
  try {
    writeFileSync(path, bytes);
    return read(path);
  } finally {
    rmSync(path, { force: true });
  }
}

await main();
