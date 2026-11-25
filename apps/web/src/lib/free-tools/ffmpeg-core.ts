/**
 * Where the converter's ffmpeg core is served from.
 *
 * The core is 30MB of WebAssembly and it lives in R2, under a key that names
 * its version, rather than in `public/`. Two reasons, and the second is the one
 * that forced it:
 *
 * It is not ours and it does not change between releases, so shipping it in the
 * deployment means re-uploading 30MB on every deploy to send bytes that are
 * byte-identical to the last ones. R2 holds it once, immutably, and the version
 * in the key is what makes that safe to cache for a year.
 *
 * And a Cloudflare Worker cannot serve it at all: a static asset may be at most
 * 25MiB, so `public/ffmpeg/ffmpeg-core.wasm` is a file the platform refuses to
 * upload. Keeping the core out of the deployment is what leaves the site free to
 * move hosts.
 *
 * `assets.prequel.sh` is our own domain in front of our own bucket, so the
 * promise these pages make — that the file being converted never leaves the
 * machine — is untouched. What arrives from R2 is the encoder, and it travels in
 * that direction only. Loading it from unpkg instead would put a third party in
 * the path, which is a different thing and not one these pages can claim.
 */

/**
 * The version in the bucket, which must be the version in the lockfile.
 *
 * Written out rather than read from `@ffmpeg/core`'s own `package.json`, which
 * the package does not export, and which a client bundle could not read anyway.
 * `scripts/check-ffmpeg-core.ts` runs before `dev` and `build` and fails if this
 * has drifted from what is installed — otherwise a `pnpm update` that bumps the
 * core would leave the site quietly fetching the version before it, and the only
 * symptom would be a converter that behaves like the old build.
 */
export const FFMPEG_CORE_VERSION = "0.12.10";

/** Beside `desktop/` and `backgrounds/`, which are already served from here. */
export const FFMPEG_CORE_BASE = `https://assets.prequel.sh/ffmpeg/${FFMPEG_CORE_VERSION}`;

/**
 * The two files the core is, and the types they must be served as.
 *
 * The type is not decoration. `WebAssembly.instantiateStreaming` refuses a
 * response that is not `application/wasm` — it throws rather than falling back
 * to a slower path — and R2 infers `binary/octet-stream` for a `.wasm` unless
 * told otherwise. The uploader reads these, so the thing that writes the object
 * and the thing that fetches it cannot disagree about either.
 */
export const FFMPEG_CORE_FILES = {
  "ffmpeg-core.js": "text/javascript",
  "ffmpeg-core.wasm": "application/wasm",
} as const;
