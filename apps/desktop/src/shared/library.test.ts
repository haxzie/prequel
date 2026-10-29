import { describe, expect, it } from "vitest";

import { isLibraryRef, libraryParts, libraryRef, LIBRARY_PREFIX } from "./library.js";

describe("pointing at an asset of ours", () => {
  it("round-trips a shelf and a name", () => {
    expect(libraryParts(libraryRef("backgrounds", "monterey.jpg"))).toEqual({
      kind: "backgrounds",
      file: "monterey.jpg",
    });
    expect(libraryParts(libraryRef("music", "slow-wander.m4a"))).toEqual({
      kind: "music",
      file: "slow-wander.m4a",
    });
  });

  it("says nothing about a recording's own file", () => {
    // The whole of the back-compatibility story: every project written before
    // the library existed carries bare names, and every one of them has to go
    // on resolving against the recording directory.
    for (const name of ["monterey.jpg", "wallpaper.jpg", "cursor-arrow.png", "2/screen.mp4"]) {
      expect(libraryParts(name)).toBe(null);
      expect(isLibraryRef(name)).toBe(false);
    }
  });

  it("refuses anything that could climb out of the shelf", () => {
    // This path comes out of a project file and is joined onto a directory, so
    // a traversal has to be impossible here rather than caught downstream.
    for (const bad of [
      `${LIBRARY_PREFIX}backgrounds/../../secrets.jpg`,
      `${LIBRARY_PREFIX}backgrounds/sub/dir.jpg`,
      `${LIBRARY_PREFIX}../backgrounds.jpg`,
      `${LIBRARY_PREFIX}backgrounds/.jpg`,
      `${LIBRARY_PREFIX}fonts/inter.woff2`,
      `${LIBRARY_PREFIX}backgrounds/`,
      LIBRARY_PREFIX,
    ]) {
      expect(libraryParts(bad)).toBe(null);
    }
  });
});
