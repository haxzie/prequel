/**
 * `shared/media-url.ts`, for a browser.
 *
 * Same exports, same encoding, a different scheme: `/media/<host>/...` on the
 * gallery's own origin, which `server/media.ts` answers. The Vite config swaps
 * this in wherever the renderer imports the real one.
 *
 * `satisfies typeof import(...)` is what keeps the two honest: an export added
 * to the real module without a twin here fails the gallery's typecheck rather
 * than a screenshot.
 */
import type { PermissionId } from "../src/shared/contract";
import { libraryParts } from "../src/shared/library";

export const MEDIA_SCHEME = "prequel-media";

const ROOT = "/media";

export function mediaUrl(recording: string, fileName: string): string {
  // One of ours, which lives on the shelf rather than in the recording — the
  // same branch the real `mediaUrl` takes, and here for the same reason: every
  // caller holds a name out of a project and none of them knows which of the
  // two roots it came from. Without it a wallpaper or a camera frame from the
  // catalogue is looked for inside the fixture recording and 404s.
  const shelved = libraryParts(fileName);
  if (shelved) {
    return `${ROOT}/library/${shelved.kind}/${encodeURIComponent(shelved.file)}`;
  }
  return `${ROOT}/recording/${encodeURIComponent(recording)}/${encodeURIComponent(fileName)}`;
}

export function exportUrl(id: string, fileName: string): string {
  return `${ROOT}/export/${encodeURIComponent(id)}/${encodeURIComponent(fileName)}`;
}

export function exportThumbnailUrl(id: string): string {
  return `${ROOT}/export-thumb/${encodeURIComponent(id)}.jpg`;
}

export function backgroundUrl(fileName: string): string {
  return `${ROOT}/background/${encodeURIComponent(fileName)}`;
}

export function scenePresetUrl(name: string): string {
  return `${ROOT}/scene-preset/mine/${encodeURIComponent(name)}`;
}

export function assetUrl(fileName: string): string {
  return `${ROOT}/asset/${encodeURIComponent(fileName)}`;
}

export function fontUrl(fileName: string): string {
  return `${ROOT}/font/${encodeURIComponent(fileName)}`;
}

export function permissionIconUrl(id: PermissionId): string {
  return assetUrl(`permission-${id}.png`);
}

export function recordingName(dir: string): string {
  return dir.split("/").filter(Boolean).pop() ?? "";
}

const shape = {
  MEDIA_SCHEME,
  mediaUrl,
  exportUrl,
  exportThumbnailUrl,
  backgroundUrl,
  scenePresetUrl,
  assetUrl,
  fontUrl,
  permissionIconUrl,
  recordingName,
} as const;

shape satisfies typeof import("../src/shared/media-url");
