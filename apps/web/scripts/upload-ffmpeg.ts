/**
 * Puts the converter's ffmpeg core in R2.
 *
 *   pnpm --filter @prequel/web ffmpeg          # upload the installed core
 *   pnpm --filter @prequel/web ffmpeg --dry    # say what it would do
 *
 * Takes the two files out of the installed `@ffmpeg/core` and writes them to
 * `ffmpeg/<version>/` in the bucket, where `lib/free-tools/ffmpeg-core.ts` says
 * they are. Run it once per version: the keys name the version, so an upload
 * never replaces anything and the objects are immutable for a year.
 *
 * The bytes come from `node_modules` rather than from unpkg on purpose, and it
 * is the answer to the objection the script this replaced used to make — that a
 * file put in a bucket by hand is a version nobody can see from the lockfile.
 * What is uploaded here is exactly what pnpm installed, and the version is read
 * off that same package, so the lockfile remains the only thing that decides
 * which core the site uses.
 *
 * Nothing in `apps/web` is imported by `apps/api` or the other way about, and
 * this does not change that: the credentials are read out of the Worker's
 * `.dev.vars` because that is the one place R2 credentials live in this project
 * — the same three names `release-mirror.yml` uses — and a second copy beside
 * this script would be a second thing to rotate.
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { AwsClient } from "aws4fetch";

import {
  FFMPEG_CORE_BASE,
  FFMPEG_CORE_FILES,
  FFMPEG_CORE_VERSION,
} from "../src/lib/free-tools/ffmpeg-core.ts";

import { installedCore } from "./ffmpeg-core-install.ts";

const dry = process.argv.includes("--dry");

/** Version-pinned keys never change, so they can be cached for as long as anyone
    keeps them — the same reasoning, and the same string, as `release-mirror.yml`. */
const IMMUTABLE = "public, max-age=31536000, immutable";

// ── credentials ─────────────────────────────────────────────────────────────

/** Read from the Worker's `.dev.vars`, where this project's R2 credentials live. */
function credentials(): Record<string, string> {
  const file = fileURLToPath(new URL("../../api/.dev.vars", import.meta.url));
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
  // "auto" is the literal string R2 signs with — the same note as `src/lib/r2.ts`.
  region: "auto",
  service: "s3",
});

function objectUrl(key: string): string {
  return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${key
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

// ── the run ─────────────────────────────────────────────────────────────────

/**
 * Retries, for the same reason the fonts and backgrounds scripts have one.
 *
 * The wasm is 30MB in a single PUT and R2 will drop the connection part way
 * through it — `EPIPE`, not a status code, so nothing is retried by the fetch
 * itself and the object is simply absent. Observed on the first run of this
 * script, which is why it is here.
 *
 * A refusal with a status is not retried: a 403 is a credential, and sending it
 * four times only takes longer to say so.
 */
async function withRetries<T>(what: string, run: () => Promise<T>): Promise<T> {
  let last: unknown;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await run();
    } catch (cause) {
      if ((cause as { fatal?: boolean }).fatal) throw cause;
      last = cause;
      const wait = 400 * 2 ** (attempt - 1);
      console.warn(`${what} failed (${attempt}/4), retrying in ${String(wait)}ms`);
      await new Promise((resume) => setTimeout(resume, wait));
    }
  }

  throw last;
}

async function head(key: string): Promise<boolean> {
  const response = await withRetries(`HEAD ${key}`, () =>
    client.fetch(objectUrl(key), { method: "HEAD" }),
  );
  return response.ok;
}

async function put(key: string, body: Buffer, type: string): Promise<void> {
  await withRetries(`PUT ${key}`, async () => {
    const response = await client.fetch(objectUrl(key), {
      method: "PUT",
      body: new Uint8Array(body),
      headers: { "content-type": type, "cache-control": IMMUTABLE },
    });
    if (!response.ok) {
      throw Object.assign(new Error(`PUT ${key} refused: ${response.status}`), { fatal: true });
    }
  });
}

async function main(): Promise<void> {
  const core = installedCore(createRequire(import.meta.url));

  // The guard that runs before `dev` and `build` says the same thing, but this
  // script is also the one somebody reaches for straight after a version bump,
  // and uploading 0.12.11 under 0.12.10's key would be the one mistake here that
  // cannot be undone by running it again.
  if (core.version !== FFMPEG_CORE_VERSION) {
    throw new Error(
      `installed @ffmpeg/core is ${core.version} but ffmpeg-core.ts says ${FFMPEG_CORE_VERSION}. ` +
        `Set FFMPEG_CORE_VERSION to ${core.version} first, then upload.`,
    );
  }

  for (const [file, type] of Object.entries(FFMPEG_CORE_FILES)) {
    const key = `ffmpeg/${FFMPEG_CORE_VERSION}/${file}`;
    const bytes = readFileSync(join(core.dist, file));
    const size = `${(bytes.length / 1_048_576).toFixed(1)}MB`;

    if (await head(key)) {
      console.log(`${key} is already there (${size}), skipping`);
      continue;
    }
    if (dry) {
      console.log(`would upload ${key} (${size}, ${type})`);
      continue;
    }

    await put(key, bytes, type);
    console.log(`uploaded ${key} (${size}, ${type})`);
  }

  if (dry) return;

  // Through the public domain rather than the bucket, because that is the path
  // the browser takes: a write that lands while the custom domain is not serving
  // it is a converter that cannot load, and it looks fine from the bucket side.
  // The content type is checked too — `instantiateStreaming` refuses anything
  // but `application/wasm`, and R2 infers something else unless told.
  for (const [file, type] of Object.entries(FFMPEG_CORE_FILES)) {
    const url = `${FFMPEG_CORE_BASE}/${file}`;
    const response = await fetch(url, { method: "HEAD" });
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);

    const served = response.headers.get("content-type");
    if (served !== type) throw new Error(`${url} is served as ${served}, not ${type}`);

    // Read from the page's origin, so the browser needs the bucket's CORS rules
    // to let it. Nothing in this repo sets them — they are account configuration
    // — so a missing header is worth failing on rather than discovering in a tab.
    if (!response.headers.get("access-control-allow-origin")) {
      throw new Error(`${url} sends no access-control-allow-origin; set the bucket's CORS rules`);
    }

    console.log(`${url} → ${response.status}, ${served}`);
  }
}

await main();
