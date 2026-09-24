/**
 * The version guard is the reason this file exists.
 *
 * A manifest written by a newer build could describe tracks that line up
 * differently, and editing it anyway would produce an export that is wrong in
 * ways nothing downstream could detect. Failing loudly is the whole point.
 */
import { describe, expect, it } from "vitest";

import type { Manifest } from "./manifest.js";
import {
  findTrack,
  MANIFEST_VERSION,
  ManifestError,
  parseManifest,
  seamsOf,
  trackStart,
} from "./manifest.js";

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
        segments: [
          {
            file_name: "screen.mp4",
            start: 0,
            end: 10 * S,
            width: 3024,
            height: 1964,
            samples: 600,
            dropped: 0,
          },
        ],
      },
      {
        kind: "camera",
        segments: [
          {
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
      },
    ],
    takes: [{ dir: "", start: 0, end: 10 * S }],
  };
}

/** A v1 manifest, as every recording in anybody's library is written. */
function v1(): Record<string, unknown> {
  return {
    version: 1,
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
        kind: "microphone",
        file_name: "mic.m4a",
        start: 120_000_000,
        end: 10 * S,
        samples: 470,
        dropped: 2,
      },
    ],
    cursor: [{ at: 0, x: 0.5, y: 0.5 }],
  };
}

describe("parseManifest", () => {
  it("round-trips a manifest written by the recorder", () => {
    expect(parseManifest(JSON.stringify(sample()))).toEqual(sample());
  });

  it("carries the camera's matte when the recorder wrote one, and not otherwise", () => {
    // Every recording made before the matte existed has a camera track with no
    // such key. It has to open as a camera with no matte, not refuse to open —
    // and one that has it must keep the file name, which is the only thing the
    // editor uses to find the file.
    expect(
      findTrack(parseManifest(JSON.stringify(sample())), "camera")!.segments[0]!.matte,
    ).toBeUndefined();

    const matted = sample();
    matted.tracks[1]!.segments[0]!.matte = {
      file_name: "camera-matte.mp4",
      width: 512,
      height: 288,
      samples: 290,
      dropped: 2,
    };
    expect(findTrack(parseManifest(JSON.stringify(matted)), "camera")!.segments[0]!.matte).toEqual({
      file_name: "camera-matte.mp4",
      width: 512,
      height: 288,
      samples: 290,
      dropped: 2,
    });
  });

  it("preserves a late track's start offset", () => {
    // The whole reason the manifest exists: a track that started late must not
    // silently be treated as starting at zero.
    const manifest = parseManifest(JSON.stringify(sample()));
    expect(trackStart(findTrack(manifest, "camera")!)).toBe(250_000_000);
    expect(trackStart(findTrack(manifest, "screen")!)).toBe(0);
  });

  it("refuses a manifest from an incompatible version", () => {
    const future = { ...sample(), version: MANIFEST_VERSION + 1 };
    expect(() => parseManifest(JSON.stringify(future))).toThrow(ManifestError);
  });

  it("refuses a manifest with no version at all", () => {
    const { version: _version, ...rest } = sample();
    expect(() => parseManifest(JSON.stringify(rest))).toThrow(ManifestError);
  });

  it("reads a version one manifest as one segment per track", () => {
    // Every recording in anybody's library. Its one file per track becomes a
    // one-segment list and the whole of it becomes one take, so nothing
    // downstream needs a case for a recording made before takes existed.
    const manifest = parseManifest(JSON.stringify(v1()));

    expect(manifest.version).toBe(MANIFEST_VERSION);
    expect(manifest.takes).toEqual([{ dir: "", start: 0, end: 10 * S }]);
    expect(seamsOf(manifest)).toEqual([]);

    const screen = findTrack(manifest, "screen")!;
    expect(screen.segments).toEqual([
      {
        file_name: "screen.mp4",
        start: 0,
        end: 10 * S,
        width: 3024,
        height: 1964,
        samples: 600,
        dropped: 0,
      },
    ]);
    // The late mic survives the upgrade; losing it would slide every word of
    // the recording 120 ms early.
    expect(trackStart(findTrack(manifest, "microphone")!)).toBe(120_000_000);
    expect(manifest.cursor).toHaveLength(1);
    // No flag in a v1 manifest means the pointer was drawn into the frames.
    // Defaulting the other way puts two pointers in every old export.
    expect(manifest.cursor_baked ?? true).toBe(true);
  });

  it("reports the seams a recording was extended at", () => {
    // From the take table and never from a track's segment boundaries, which
    // disagree by however long each device took to open.
    const extended = sample();
    extended.duration = 16 * S;
    extended.takes = [
      { dir: "", start: 0, end: 10 * S },
      { dir: "2", start: 10 * S, end: 16 * S },
    ];

    expect(seamsOf(extended)).toEqual([10 * S]);
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
