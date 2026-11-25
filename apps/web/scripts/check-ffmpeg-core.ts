/**
 * Refuses to build against a core nobody uploaded.
 *
 * Runs before `dev` and `build`, in the slot the copy into `public/ffmpeg` used
 * to occupy. The converter now fetches the core from a key in R2 that names its
 * version, and that version is written out in `lib/free-tools/ffmpeg-core.ts`
 * because a client bundle cannot read the installed package's manifest.
 *
 * Which leaves one way to get it wrong, and it is silent: a `pnpm update` bumps
 * `@ffmpeg/core`, the constant still says the version before it, and the site
 * goes on fetching an older core that is still sitting in the bucket. Everything
 * builds, every page renders, and the converter is running a version the
 * lockfile stopped naming. The failure has no symptom until a bug is chased
 * against the wrong source.
 *
 * Deliberately offline. The question "does the bucket have this" wants a network
 * call and belongs to the uploader, which makes it after writing; a build that
 * reaches for assets.prequel.sh is a build that fails on a train.
 */
import { createRequire } from "node:module";

import { FFMPEG_CORE_VERSION } from "../src/lib/free-tools/ffmpeg-core.ts";

import { installedCore } from "./ffmpeg-core-install.ts";

const { version } = installedCore(createRequire(import.meta.url));

if (version !== FFMPEG_CORE_VERSION) {
  console.error(
    `\n@ffmpeg/core is ${version}, but src/lib/free-tools/ffmpeg-core.ts says ${FFMPEG_CORE_VERSION}.\n\n` +
      `  1. Set FFMPEG_CORE_VERSION to "${version}".\n` +
      `  2. pnpm --filter @prequel/web ffmpeg\n\n` +
      `The converter fetches the core by version, so until both are done it would\n` +
      `load ${FFMPEG_CORE_VERSION} — or nothing at all.\n`,
  );
  process.exit(1);
}
