import type { Region } from "../../../shared/contract";

/**
 * Converting between what the overlay draws in and what is recorded in.
 *
 * The overlay covers exactly one display, so a CSS pixel in it is normally a
 * display point: main creates the window at the display's own bounds, and
 * Electron's points and the renderer's CSS pixels are the same unit. They are
 * not always. Chromium lays a window out at a device scale it decides for
 * itself, and when that scale disagrees with the one AppKit reports, the
 * viewport is a different size from the window containing it — a full-width
 * drag on a 1512-point display came back 1655 wide, and the recording was
 * about a tenth too big and shifted with it.
 *
 * Nothing downstream can catch that: the crop goes to ScreenCaptureKit, which
 * crops in points, and a region in some other unit is still a perfectly valid
 * region. So the conversion happens here, against the viewport — which covers
 * exactly this display whatever unit it is measured in.
 */

/** Display points per CSS pixel, per axis. One when the two agree. */
export interface Space {
  x: number;
  y: number;
}

/** No conversion: a CSS pixel is a point. */
export const SAME: Space = { x: 1, y: 1 };

/**
 * The overlay's scale, from the display it covers and the viewport covering it.
 *
 * Per axis rather than one number, because nothing guarantees the two agree and
 * averaging them would put a region slightly wrong on both.
 */
export function spaceOf(
  display: { width: number; height: number },
  viewport: { width: number; height: number },
): Space {
  // A zero on either side means the window is not on screen yet; one is wrong
  // by nothing, where a division would be wrong by everything.
  return {
    x: viewport.width > 0 && display.width > 0 ? display.width / viewport.width : 1,
    y: viewport.height > 0 && display.height > 0 ? display.height / viewport.height : 1,
  };
}

/** A rectangle the overlay drew, as the display points it covers. */
export function toPoints(rect: Region, space: Space): Region {
  return {
    x: rect.x * space.x,
    y: rect.y * space.y,
    width: rect.width * space.x,
    height: rect.height * space.y,
  };
}

/** A rectangle in display points, as the CSS pixels that cover it. */
export function toPixels(rect: Region, space: Space): Region {
  return {
    x: rect.x / space.x,
    y: rect.y / space.y,
    width: rect.width / space.x,
    height: rect.height / space.y,
  };
}
