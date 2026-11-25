/**
 * Where pnpm put `@ffmpeg/core`, and which version it is.
 *
 * Shared by the guard that runs before `dev` and `build` and by the uploader,
 * so there is one answer to "which core is installed" rather than two that can
 * drift — which would be a guard passing on a version the uploader did not
 * send.
 */
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

export type InstalledCore = {
  /** The directory holding `ffmpeg-core.js` and `ffmpeg-core.wasm`. */
  dist: string;
  version: string;
};

/**
 * Resolved through the package's own export map rather than assembled from a
 * path: pnpm's layout is a content-addressed store behind symlinks, so
 * `node_modules/@ffmpeg/core/dist/...` is not where the files actually are.
 *
 * `./package.json` is *not* exported by this package, so the version cannot be
 * imported and is found by walking up from the entry point to the first
 * `package.json` that claims to be `@ffmpeg/core`. Walking rather than assuming
 * two levels up, because that depends on which of `dist/umd` and `dist/esm` the
 * export map resolves to and is the kind of thing a patch release moves.
 */
export function installedCore(require: NodeJS.Require): InstalledCore {
  const entry = require.resolve("@ffmpeg/core");

  for (let dir = dirname(entry); ;) {
    const manifest = join(dir, "package.json");

    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, "utf8")) as {
        name?: string;
        version?: string;
      };
      if (parsed.name === "@ffmpeg/core") {
        if (!parsed.version) throw new Error(`${manifest} has no version`);
        return { dist: dirname(entry), version: parsed.version };
      }
    }

    const up = dirname(dir);
    if (up === dir) throw new Error(`no @ffmpeg/core package.json above ${entry}`);
    dir = up;
  }
}
