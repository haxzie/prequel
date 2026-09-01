/**
 * Copies the shipped background pictures into the app's resources before a build.
 *
 * Only the offline floor, not the catalogue. The pictures live in `backgrounds/`
 * at the repo root, a folder per category, and are served to the app from R2 —
 * what ships is the handful it must be able to draw with no network at all.
 *
 * `FLOOR` has to agree with `BACKGROUND_PRESETS` in `src/shared/backgrounds.ts`,
 * which is the list main and the renderer both read. Nothing here can import
 * that file, so `backgrounds.test.ts` is the guard: it fails when a preset has
 * no file behind it.
 *
 * `resources/backgrounds` is generated and git-ignored — a second committed copy
 * would be forty megabytes of the same JPEGs in git, and the two would drift the
 * first time somebody edited one. Flat, because a preset names a bare file and
 * the category is metadata rather than a path: a recording copies the file in
 * beside its own media, where there are no folders.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * What ships. Keep in step with `BACKGROUND_PRESETS`.
 *
 * `monterey.jpg` is what `DEFAULT_BACKGROUND` opens a fresh project on, so it
 * is the one file that cannot be dropped without the first recording on an
 * offline machine drawing nothing.
 */
const FLOOR = ["monterey.jpg"];

const source = fileURLToPath(new URL("../../../backgrounds/", import.meta.url));
const destination = fileURLToPath(new URL("../resources/backgrounds/", import.meta.url));

if (!existsSync(source)) {
  console.error(`no backgrounds at ${source} — the pictures live at the repo root`);
  process.exit(1);
}

// Emptied first. A picture renamed or dropped upstream would otherwise stay
// here for ever, and it would still be picked up by the packager.
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });

const found = new Set();
for (const category of readdirSync(source)) {
  const folder = join(source, category);
  if (!statSync(folder).isDirectory()) continue;

  for (const file of readdirSync(folder)) {
    if (!FLOOR.includes(file)) continue;
    cpSync(join(folder, file), join(destination, file));
    found.add(file);
  }
}

// A floor picture that is not there is a build whose first frame is empty, on a
// machine with no network — the one case the floor exists for. Louder than a
// warning, because the app would package and install perfectly well.
const missing = FLOOR.filter((file) => !found.has(file));
if (missing.length > 0) {
  console.error(`backgrounds: ${missing.join(", ")} not found under ${source}`);
  process.exit(1);
}

console.log(`backgrounds: ${found.size} copied into resources`);
