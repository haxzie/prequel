/**
 * The `session.json` a screenshot gets.
 *
 * Worth pinning rather than reading: a still is a *session* — one frame, one
 * segment, one take — and every one of the fields here is what makes the
 * editor, the library tile and the export treat it as one. The failures this
 * catches are all silent. A missing `still` opens an editor that points a
 * decoder at a PNG and draws a hole; a `duration` of zero gives the project an
 * empty slice and a composition with no clip to dress; a crop left relative to
 * the target reopens the area picker over the wrong part of the screen.
 *
 * `stillManifest` is pure precisely so this can be tested at all — the one
 * thing that produces the picture needs a display, a grant and ScreenCaptureKit.
 */
import { describe, expect, it } from "vitest";

import { MANIFEST_VERSION, STILL_FILE_NAME, isStill, parseManifest } from "../shared/manifest.js";
import { STILL_DURATION } from "../shared/project.js";
import { stillManifest } from "./screenshot.js";

const SOURCE = {
  kind: "display",
  id: 1,
  title: "Display 3024×1964",
  scaleFactor: 2,
};

describe("a screenshot's manifest", () => {
  it("says it is a still, so nothing opens a decoder on it", () => {
    const manifest = stillManifest({ width: 3024, height: 1964 }, SOURCE);

    expect(manifest.still).toBe(true);
    expect(isStill(manifest)).toBe(true);
  });

  it("names the PNG rather than a video, at the size that was captured", () => {
    const manifest = stillManifest({ width: 3024, height: 1964 }, SOURCE);

    const [screen] = manifest.tracks;
    expect(manifest.tracks).toHaveLength(1);
    expect(screen?.kind).toBe("screen");
    expect(screen?.segments).toHaveLength(1);
    expect(screen?.segments[0]?.file_name).toBe(STILL_FILE_NAME);
    expect(screen?.segments[0]?.width).toBe(3024);
    expect(screen?.segments[0]?.height).toBe(1964);
    expect(screen?.segments[0]?.samples).toBe(1);
  });

  it("gives the clock a length, so the project has a slice to dress", () => {
    const manifest = stillManifest({ width: 100, height: 100 }, SOURCE);

    // Zero would be an empty half-open range, which is a project with no clip
    // in it — nothing selected, nothing to put a background behind.
    expect(manifest.duration).toBe(STILL_DURATION);
    expect(manifest.tracks[0]?.segments[0]?.end).toBe(STILL_DURATION);
    expect(manifest.takes).toEqual([{ dir: "", start: 0, end: STILL_DURATION }]);
  });

  it("claims no pointer layer whether the arrow was in the shot or not", () => {
    const manifest = stillManifest({ width: 100, height: 100 }, SOURCE);

    // Baked is how a session says it has no layer to draw, and a still has
    // none: whatever is in the picture is all there is. Getting this the wrong
    // way round would put an arrow from no samples at all over the frame.
    expect(manifest.cursor_baked).toBe(true);
    expect(manifest.cursor).toBeUndefined();
  });

  it("records an area's region in the display's own points", () => {
    const manifest = stillManifest(
      { width: 800, height: 600 },
      {
        ...SOURCE,
        kind: "area",
        crop: { x: 1512, y: 100, width: 400, height: 300 },
      },
    );

    // Already rebased by the caller onto the display's origin, which is what
    // the area picker reads back to pre-drag the region. A crop still relative
    // to a second monitor's target would reopen 1512 points to the left.
    expect(manifest.source.crop).toEqual({ x: 1512, y: 100, width: 400, height: 300 });
  });

  it("is something this build can read back", () => {
    const manifest = stillManifest({ width: 100, height: 100 }, SOURCE);

    // Through the real parser, not a cast: the version check is the one thing
    // that would make a screenshot refuse to open, and writing a manifest this
    // build rejects is a failure nothing else here would notice.
    const read = parseManifest(JSON.stringify(manifest));

    expect(read.version).toBe(MANIFEST_VERSION);
    expect(read.still).toBe(true);
  });
});
