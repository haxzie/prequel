/**
 * Puts ffmpeg's core beside the site, out of git.
 *
 * `@ffmpeg/core` is 32MB of WebAssembly. It cannot be committed — the note at
 * the top of `src/lib/assets.ts` has the long version, and it applies here with
 * more force than it does to a video: a binary in git is in git for ever, and
 * this one changes with every version bump. It is also not R2 material, because
 * it has to be pinned to the exact `@ffmpeg/ffmpeg` in `package.json`, and a
 * file uploaded by hand is a version nobody can see from the lockfile.
 *
 * So it is copied out of `node_modules` into `public/ffmpeg` before `dev` and
 * before `build`, and `public/ffmpeg` is ignored. The copy is what Next serves,
 * same origin, which is the other half of the point: loading the core from
 * unpkg would put a third party in the path of a tool whose whole claim is that
 * nothing leaves the tab.
 *
 * Called explicitly from the `dev` and `build` scripts rather than from a
 * `prebuild` hook: pnpm does not run pre/post scripts by default, so the hook
 * would be silently skipped on Vercel and the tools would 404 in production
 * only.
 */
import { createRequire } from "node:module";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

// Resolved through the package's own export map rather than assembled from a
// path: pnpm's layout is a content-addressed store behind symlinks, so
// `node_modules/@ffmpeg/core/dist/...` is not where the files actually are.
// `./package.json` is *not* exported by this package, which is why the entry
// point is resolved instead and the directory taken from it.
const from = dirname(require.resolve("@ffmpeg/core"));
const to = join(import.meta.dirname, "..", "public", "ffmpeg");

await mkdir(to, { recursive: true });

for (const file of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
  const source = join(from, file);
  const target = join(to, file);

  // Skipped when it is already there and the same size, which is what keeps
  // `pnpm dev` from copying 32MB on every restart.
  const [a, b] = await Promise.all([stat(source), stat(target).catch(() => null)]);
  if (b && a.size === b.size) continue;

  await copyFile(source, target);
  console.log(`ffmpeg: copied ${file} (${(a.size / 1_000_000).toFixed(1)}MB)`);
}
