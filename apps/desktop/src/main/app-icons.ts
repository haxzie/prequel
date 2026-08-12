/**
 * Full-resolution app icons for the window picker.
 *
 * Every API that hands an icon straight over caps out at 32×32 — measured, not
 * assumed: `desktopCapturer`'s `appIcon` is 32px, `app.getFileIcon` offers
 * 16 and 32 (and crashes on `"large"`, which macOS does not support), and
 * `nativeImage.createFromPath` returns an empty image for a `.icns` because it
 * cannot decode that format at all.
 *
 * The only place a large icon exists is the app bundle's own `.icns`, which
 * carries every size up to 1024. So: find the icon file the bundle declares,
 * and let `sips` — on every Mac since forever — render it at the size the
 * picker actually draws.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Rendered edge, in pixels.
 *
 * Comfortably above the card's drawn size at 2x, so the icon stays sharp on a
 * Retina display without decoding a 1024px image for every window.
 */
const ICON_PIXELS = 256;

/** Long enough to fail fast on a hung helper, short enough not to stall the picker. */
const TIMEOUT_MS = 3000;

/**
 * Icons already extracted this session, keyed by bundle path.
 *
 * Apps do not change their icon while running, and the picker is opened over
 * and over — without this, every open would re-shell out for the same handful
 * of apps.
 */
const cache = new Map<string, string | null>();

/**
 * Data URLs for the given app bundles, keyed by bundle path.
 *
 * Bundles that yield nothing are simply absent; the picker draws a name
 * without an icon rather than failing.
 */
export async function iconsFor(bundlePaths: Iterable<string>): Promise<Map<string, string>> {
  const wanted = [...new Set(bundlePaths)].filter(Boolean);
  const missing = wanted.filter((path) => !cache.has(path));

  await Promise.all(
    missing.map(async (path) => {
      try {
        cache.set(path, await extract(path));
      } catch {
        // A missing bundle, an unreadable plist, a sandbox refusal — none of
        // them are worth failing the picker over.
        cache.set(path, null);
      }
    }),
  );

  const icons = new Map<string, string>();
  for (const path of wanted) {
    const icon = cache.get(path);
    if (icon) icons.set(path, icon);
  }
  return icons;
}

/** Renders a bundle's icon to a PNG data URL. */
async function extract(bundlePath: string): Promise<string | null> {
  const icns = await icnsPath(bundlePath);
  if (!icns) return null;

  // `sips` writes to a file rather than stdout, so it needs somewhere to put it.
  const scratch = mkdtempSync(join(tmpdir(), "prequel-icon-"));
  const out = join(scratch, "icon.png");

  try {
    await run(
      "/usr/bin/sips",
      ["-s", "format", "png", "-Z", String(ICON_PIXELS), icns, "--out", out],
      { timeout: TIMEOUT_MS },
    );
    return `data:image/png;base64,${readFileSync(out).toString("base64")}`;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The `.icns` a bundle declares in its Info.plist. */
async function icnsPath(bundlePath: string): Promise<string | null> {
  const plist = join(bundlePath, "Contents", "Info.plist");

  // `plutil` rather than reading the file: an Info.plist is very often the
  // binary format, which is not parseable as text.
  const { stdout } = await run(
    "/usr/bin/plutil",
    ["-extract", "CFBundleIconFile", "raw", "-o", "-", plist],
    { timeout: TIMEOUT_MS },
  );

  const declared = stdout.trim();
  if (!declared) return null;

  // The key is conventionally written without its extension, but not always.
  const file = declared.endsWith(".icns") ? declared : `${declared}.icns`;
  // Guard against a plist pointing outside its own bundle.
  return join(bundlePath, "Contents", "Resources", basename(file));
}
