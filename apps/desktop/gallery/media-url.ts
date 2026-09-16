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

export const MEDIA_SCHEME = "prequel-media";

const ROOT = "/media";

export function mediaUrl(recording: string, fileName: string): string {
  return `${ROOT}/recording/${encodeURIComponent(recording)}/${encodeURIComponent(fileName)}`;
}

export function exportUrl(fileName: string): string {
  return `${ROOT}/export/${encodeURIComponent(fileName)}`;
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
  backgroundUrl,
  scenePresetUrl,
  assetUrl,
  permissionIconUrl,
  recordingName,
} as const;

shape satisfies typeof import("../src/shared/media-url");
