/**
 * Copies the background pictures into the app's resources before a build.
 *
 * The pictures live in `backgrounds/` at the repo root, in a folder per
 * category — that is what `scripts/upload-backgrounds.mjs` reads and what the
 * hosted catalogue is built from. Keeping a second committed copy inside
 * `apps/desktop/resources` would be forty megabytes of the same JPEGs in git,
 * and the two would drift the first time somebody edited one of them.
 *
 * So `resources/backgrounds` is generated and git-ignored, and this fills it.
 * Flat, because a preset names a bare file and the category is metadata rather
 * than a path — a recording copies the file in beside its own media, where
 * there are no folders.
 *
 * Once the picker reads the hosted catalogue this only needs to copy whichever
 * few are kept as an offline floor. Until then it copies all of them, so the
 * app behaves exactly as it did when they were committed here.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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

let copied = 0;
for (const category of readdirSync(source)) {
  const folder = join(source, category);
  if (!statSync(folder).isDirectory()) continue;

  for (const file of readdirSync(folder)) {
    if (!file.endsWith(".jpg")) continue;
    cpSync(join(folder, file), join(destination, file));
    copied += 1;
  }
}

console.log(`backgrounds: ${copied} copied into resources`);
