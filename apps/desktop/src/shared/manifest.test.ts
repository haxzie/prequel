/**
 * The version guard is the reason this file exists.
 *
 * A manifest written by a newer build could describe tracks that line up
 * differently, and editing it anyway would produce an export that is wrong in
 * ways nothing downstream could detect. Failing loudly is the whole point.
 */
import { describe, expect, it } from "vitest";

import type { Manifest } from "./manifest.js";
import { findTrack, MANIFEST_VERSION, ManifestError, parseManifest } from "./manifest.js";

const S = 1_000_000_000;

function sample(): Manifest {
  return {
    version: MANIFEST_VERSION,
    id: "2026-08-11T12-00-00",
    started_at: "2026-08-11T12:00:00Z",
    duration: 10 * S,
    source: { kind: "display", id: 1, title: "Display", scale_factor: 2 },
    tracks: [
      {
        kind: "screen",
        file_name: "screen.mp4",
        start: 0,
        end: 10 * S,
        width: 3024,
        height: 1964,
        samples: 600,
        dropped: 0,
      },
      {
        kind: "camera",
        file_name: "camera.mp4",
        // The camera took 250 ms longer to open than the screen.
        start: 250_000_000,
        end: 10 * S,
        width: 1280,
        height: 720,
        samples: 292,
        dropped: 0,
      },
    ],
  };
}

describe("parseManifest", () => {
  it("round-trips a manifest written by the recorder", () => {
    expect(parseManifest(JSON.stringify(sample()))).toEqual(sample());
  });

  it("preserves a late track's start offset", () => {
    // The whole reason the manifest exists: a track that started late must not
    // silently be treated as starting at zero.
    const manifest = parseManifest(JSON.stringify(sample()));
    expect(findTrack(manifest, "camera")!.start).toBe(250_000_000);
    expect(findTrack(manifest, "screen")!.start).toBe(0);
  });

  it("refuses a manifest from an incompatible version", () => {
    const future = { ...sample(), version: MANIFEST_VERSION + 1 };
    expect(() => parseManifest(JSON.stringify(future))).toThrow(ManifestError);
  });

  it("refuses a manifest with no version at all", () => {
    const { version: _version, ...rest } = sample();
    expect(() => parseManifest(JSON.stringify(rest))).toThrow(ManifestError);
  });

  it("refuses malformed JSON", () => {
    expect(() => parseManifest("{not json")).toThrow(ManifestError);
  });

  it("refuses a manifest with no tracks array", () => {
    const { tracks: _tracks, ...rest } = sample();
    expect(() => parseManifest(JSON.stringify(rest))).toThrow(ManifestError);
  });

  it("reports a missing track rather than inventing one", () => {
    // A silent audio track produces no file and no entry, so absence is the
    // honest answer — not a zero-length track.
    expect(findTrack(parseManifest(JSON.stringify(sample())), "microphone")).toBeUndefined();
  });
});
