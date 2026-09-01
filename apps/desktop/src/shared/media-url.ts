/**
 * The shape of a `prequel-media://` URL, defined once.
 *
 * Main serves these and the renderer requests them, so both have to agree on
 * the encoding exactly — a mismatch is a 404 that looks like a missing file.
 * Deliberately free of any `electron` or Node import so both can use it.
 */

import type { PermissionId } from "./contract.js";

export const MEDIA_SCHEME = "prequel-media";

/**
 * A URL for one file inside a recording.
 *
 * `recording` is the session directory's *name*, never its path: the handler
 * resolves it against the recordings directory and refuses anything that lands
 * outside, so a full path here would simply be rejected.
 */
export function mediaUrl(recording: string, fileName: string): string {
  return `${MEDIA_SCHEME}://recording/${encodeURIComponent(recording)}/${encodeURIComponent(fileName)}`;
}

/**
 * A URL for a finished export, wherever the user chose to put it.
 *
 * A third host, and the only one whose file is not under the recordings
 * directory — an export is saved wherever the save dialog pointed, and the
 * traversal guard the `recording` route relies on cannot cover a path outside
 * the root it checks against. So this route resolves nothing: main registers
 * the file it has just written by name, and a name that was never registered
 * is not a path to be sanitised, it is a request for something that does not
 * exist.
 */
export function exportUrl(fileName: string): string {
  return `${MEDIA_SCHEME}://export/${encodeURIComponent(fileName)}`;
}

/**
 * A URL for a background thumbnail main has cached.
 *
 * A fourth host rather than a path under `recording`: these live in the app's
 * own cache directory, not inside any recording, and the `recording` route's
 * traversal guard is written against the recordings directory.
 */
export function backgroundUrl(fileName: string): string {
  return `${MEDIA_SCHEME}://background/${encodeURIComponent(fileName)}`;
}

/**
 * A URL for one of the app's own shipped images.
 *
 * A second host rather than a second scheme: the privileges, the CSP entry and
 * the handler are all already in place for this one. The handler serves these
 * from a fixed list of file names, so nothing a renderer can put here reaches
 * anything else.
 */
export function assetUrl(fileName: string): string {
  return `${MEDIA_SCHEME}://asset/${encodeURIComponent(fileName)}`;
}

/**
 * A URL for the macOS icon of one permission.
 *
 * The flat `permission-<id>.png` name is the convention `assetPath` matches on,
 * and it is spelled out once here for the same reason the rest of this file
 * exists: the two sides have to agree exactly, and a name built by hand in the
 * renderer is a 404 that reads as a missing icon.
 */
export function permissionIconUrl(id: PermissionId): string {
  return assetUrl(`permission-${id}.png`);
}

/** The last path segment of a session directory. */
export function recordingName(dir: string): string {
  return dir.split("/").filter(Boolean).pop() ?? "";
}
