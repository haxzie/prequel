/**
 * The camera frames, put where both rasterisers can find them.
 *
 * The artwork ships inside the app, and a plan names it the way it names a
 * wallpaper — `@library/frames/polaroid.png` — so it has to be on the shelf by
 * the time an editor draws one. Copied there rather than referenced from the
 * bundle, for the reason every other asset is: a path resolved against the
 * library is a path the exporter already knows how to open, and nothing on
 * either side has to learn where an app bundle is.
 *
 * On the shelf rather than into the recording, unlike the pointer images. A
 * pointer sprite is two kilobytes and copying it per recording is what makes a
 * recording stand on its own; the frames are three megabytes between them, and
 * three megabytes per recording of the same four files is exactly what the
 * library exists to stop — see `shared/library.ts`.
 *
 * In main because everything that fills the shelf is: the renderer is handed
 * `prequel-media:` URLs and never a path.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { CAMERA_FRAME_FILES } from "../shared/camera-frames.js";
import { shelfDir } from "./library.js";

/**
 * Puts every frame on the shelf, replacing any that differ from the bundle's.
 *
 * Compared by content rather than skipped on existence, the same rule the
 * pointer images follow: the artwork is the app's, not the project's, so a
 * recut frame that only ever reached projects made after the update would
 * leave every older one drawing the old picture with nothing in the editor to
 * say a newer one existed. Four reads once per editor open.
 *
 * Never throws. A frame that will not copy is a camera without a plate, which
 * is a plainer picture — failing the open instead would lose the recording.
 */
export function provideFrames(): void {
  const shelf = shelfDir("frames");

  try {
    mkdirSync(shelf, { recursive: true });
  } catch (cause) {
    console.warn("[frames] could not make the shelf:", cause);
    return;
  }

  for (const file of CAMERA_FRAME_FILES) {
    const target = join(shelf, file);

    try {
      const source = fileURLToPath(new URL(`../../resources/frames/${file}`, import.meta.url));
      if (existsSync(target) && readFileSync(target).equals(readFileSync(source))) continue;
      copyFileSync(source, target);
    } catch (cause) {
      console.warn(`[frames] could not provide ${file}:`, cause);
    }
  }
}
