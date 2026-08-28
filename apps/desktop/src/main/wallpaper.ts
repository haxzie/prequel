/**
 * Backgrounds, copied into the recording that uses them.
 *
 * Copied rather than referenced, and that is the important part: the desktop
 * picture changes tomorrow, and an export has to produce the same video it
 * produced today. It also makes a recording directory self-contained, which is
 * what lets it move between machines.
 *
 * Reading the *current* wallpaper is harder than it should be on macOS 14+.
 * `~/Library/Application Support/Dock/desktoppicture.db` is legacy and often
 * absent; the current store, `com.apple.wallpaper/Store/Index.plist`, leaves
 * its `Files` array empty for the stock pictures and hides the real identity
 * inside an NSKeyedArchiver blob; `NSWorkspace.desktopImageURL(for:)` is not
 * bound by cidre and returns a multi-image dynamic HEIC anyway; and
 * `osascript` needs an Automation grant that fails confusingly.
 *
 * So the plist is only a fast path, for the case where the user picked their
 * own image and it is named outright. Anything else falls back to a real
 * screenshot of the wallpaper window, which Prequel is uniquely able to take
 * because it already holds the Screen Recording grant — and which is correct
 * for dynamic and video wallpapers, where there is no still file to find.
 */
import { execFile } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { dialog } from "electron";

import { backgroundPreset } from "../shared/backgrounds.js";
import type { BackgroundImage } from "../shared/contract.js";
import { mediaUrl } from "./media-protocol.js";
import { getRecorder } from "./recorder.js";

const run = promisify(execFile);

import { WALLPAPER_FILE_NAME as WALLPAPER_FILE } from "../shared/project.js";

/** Longest edge of a copied background. A 6K wallpaper is not worth keeping. */
const MAX_EDGE = 2560;

const WALLPAPER_INDEX = join(
  homedir(),
  "Library",
  "Application Support",
  "com.apple.wallpaper",
  "Store",
  "Index.plist",
);

/**
 * Puts the current desktop picture into a recording.
 *
 * Returns null when it cannot be found at all, so the option can simply be
 * absent rather than failing — the same posture `app-icons.ts` takes, where a
 * sandbox refusal is not worth failing the whole picker over.
 */
export async function captureWallpaper(dir: string): Promise<BackgroundImage | null> {
  return capture(dir, { reuse: false });
}

/**
 * Makes sure a recording has a wallpaper to use as its default background.
 *
 * Reuses the copy already in the directory rather than re-capturing: the
 * default is meant to be what the desktop looked like when the recording was
 * made, and re-taking it on every open would silently restyle an old edit the
 * next time the user changed their wallpaper.
 */
export async function ensureWallpaper(dir: string): Promise<boolean> {
  return (await capture(dir, { reuse: true })) !== null;
}

async function capture(dir: string, options: { reuse: boolean }): Promise<BackgroundImage | null> {
  const destination = join(dir, WALLPAPER_FILE);

  if (options.reuse && existsSync(destination)) return described(dir, WALLPAPER_FILE);

  const named = await namedWallpaperFile();
  if (named) {
    // `sips` rather than a straight copy: the stock pictures are HEIC, which a
    // renderer cannot draw, and they are far larger than a background needs.
    if (await convert(named, destination)) return described(dir, WALLPAPER_FILE);
  }

  // No file to find — a stock picture, or a dynamic or video wallpaper that has
  // no still image at all. Screenshot what is actually on the desktop instead.
  try {
    await (await getRecorder()).captureWallpaper(0, destination);
    // Downscaled in place: the capture comes back at the display's full
    // resolution, which on a Retina panel is far more than a background needs.
    await convert(destination, destination);
    return described(dir, WALLPAPER_FILE);
  } catch (cause) {
    // Not worth failing the picker over — the option is simply absent and the
    // other backgrounds still work.
    console.warn("[wallpaper] could not capture the desktop:", cause);
    return null;
  }
}

/**
 * Lets the user choose their own background image.
 *
 * Copied in under a stable name so the project can reference it relatively.
 */
export async function pickBackgroundImage(dir: string): Promise<BackgroundImage | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Choose a background",
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "heic", "heif"] }],
  });

  const source = filePaths[0];
  if (canceled || !source) return null;

  const name = "background-custom.png";
  const destination = join(dir, name);

  // Converted rather than copied: a HEIC or a 48-megapixel photo would either
  // fail to draw or make every preview frame expensive.
  if (await convert(source, destination)) return described(dir, name);

  try {
    copyFileSync(source, destination);
    return described(dir, name);
  } catch (cause) {
    console.warn("[wallpaper] could not copy the chosen image:", cause);
    return null;
  }
}

/**
 * Copies one of the shipped wallpapers into the recording.
 *
 * Copied rather than referenced, for the same reason the desktop picture is:
 * a recording directory that carries everything it needs can be moved between
 * machines and will still export the video it exported today. The app's own
 * asset could also change between releases, and an edit should not.
 *
 * Already downscaled and compressed on the way into the bundle, so unlike a
 * user-chosen photo there is nothing here worth converting.
 */
export function copyPresetBackground(dir: string, presetId: string): BackgroundImage | null {
  const preset = backgroundPreset(presetId);
  if (!preset) {
    console.warn(`[wallpaper] no such background preset: ${presetId}`);
    return null;
  }

  const destination = join(dir, preset.file);

  try {
    // Skipped when it is already there — picking the same background twice is
    // not a reason to rewrite a megabyte.
    if (!existsSync(destination)) {
      copyFileSync(
        fileURLToPath(new URL(`../../resources/backgrounds/${preset.file}`, import.meta.url)),
        destination,
      );
    }
    return described(dir, preset.file);
  } catch (cause) {
    console.warn(`[wallpaper] could not copy ${preset.file}:`, cause);
    return null;
  }
}

/**
 * The wallpaper's own file, when the store names one.
 *
 * Only true when the user picked their own picture. The stock ones report a
 * `default` provider with an empty file list, which is why this is a fast path
 * rather than the mechanism.
 */
async function namedWallpaperFile(): Promise<string | null> {
  if (!existsSync(WALLPAPER_INDEX)) return null;

  try {
    // The same tool `app-icons.ts` uses, for the same reason: these are binary
    // plists, and nothing will read them as text.
    //
    // XML rather than JSON. The store keeps an NSKeyedArchiver blob beside the
    // file list, JSON has no way to spell a `data` value, and `plutil` refuses
    // the *whole* conversion over it: "Invalid object in plist for JSON
    // format". So the fast path did not merely miss the odd wallpaper, it threw
    // on every Mac whose store holds a blob — which is every Mac using a stock
    // picture — and the warning it logged said nothing about why.
    const { stdout } = await run("/usr/bin/plutil", [
      "-convert",
      "xml1",
      "-o",
      "-",
      WALLPAPER_INDEX,
    ]);
    const found = [...stdout.matchAll(/<string>(file:[^<]+)<\/string>/g)]
      .map((match) => match[1]!)
      .map((url) => {
        try {
          return decodeURIComponent(new URL(url).pathname);
        } catch {
          return null;
        }
      })
      .find((path): path is string => path !== null && existsSync(path));

    return found ?? null;
  } catch (cause) {
    console.warn("[wallpaper] could not read the wallpaper store:", cause);
    return null;
  }
}

/** Flattens and downscales to a PNG the renderer can draw cheaply. */
async function convert(source: string, destination: string): Promise<boolean> {
  try {
    await run("/usr/bin/sips", [
      "-s",
      "format",
      "png",
      "-Z",
      String(MAX_EDGE),
      source,
      "--out",
      destination,
    ]);
    return existsSync(destination);
  } catch (cause) {
    console.warn(`[wallpaper] could not convert ${source}:`, cause);
    return false;
  }
}

function described(dir: string, name: string): BackgroundImage {
  return { path: name, url: mediaUrl(dir, name) };
}
