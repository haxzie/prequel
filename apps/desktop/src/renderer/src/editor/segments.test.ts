/**
 * Which file a moment is in, at and around a seam.
 *
 * The failure this pins is quiet: pick the wrong side of a seam and the first
 * frames of the new take come out of the old take's file, which looks like
 * footage rather than like a bug.
 */
import { describe, expect, it } from "vitest";

import type { TrackMedia } from "../../../shared/contract";
import { kindsOf, matteKey, mediaKey, segmentAt, segmentsOf } from "./segments";

const S = 1_000_000_000;

function media(overrides: Partial<TrackMedia> = {}): TrackMedia {
  return {
    kind: "screen",
    segment: 0,
    file: "screen.mp4",
    url: "prequel-media://recording/take/screen.mp4",
    offset: 0,
    duration: 10 * S,
    width: 1920,
    height: 1080,
    frameRate: 60,
    matteUrl: null,
    matteFile: null,
    ...overrides,
  };
}

/** A recording extended once: ten seconds, then six more. */
const SCREEN: TrackMedia[] = [
  media(),
  media({ segment: 1, file: "2/screen.mp4", offset: 10 * S, duration: 6 * S }),
];

describe("segmentAt", () => {
  it("gives a seam to the later take", () => {
    // Half-open, so the join lands on a frame. The other way round, the first
    // frame of the new footage would be read out of the old file.
    expect(segmentAt(SCREEN, 10 * S - 1)?.file).toBe("screen.mp4");
    expect(segmentAt(SCREEN, 10 * S)?.file).toBe("2/screen.mp4");
    expect(segmentAt(SCREEN, 10 * S + 1)?.file).toBe("2/screen.mp4");
  });

  it("does not hold the earlier take's last frame past a seam", () => {
    // The tolerance closes gaps at a track's edges, and a seam is not a gap.
    // Consulted first it would freeze take one over the opening half second of
    // take two, which reads as the new footage arriving late.
    expect(segmentAt(SCREEN, 10 * S + 200_000_000)?.file).toBe("2/screen.mp4");
  });

  it("holds the next segment across a gap between two takes' cameras", () => {
    // Take two's camera opens a couple of hundred milliseconds after take two's
    // screen, exactly as take one's did, so a camera track has a gap at every
    // seam. Both edges are inside the tolerance there; the one that matters is
    // the take the playhead is actually in.
    const camera: TrackMedia[] = [
      media({
        kind: "camera",
        file: "camera.mp4",
        offset: 200_000_000,
        duration: 10 * S - 200_000_000,
      }),
      media({
        kind: "camera",
        segment: 1,
        file: "2/camera.mp4",
        offset: 10 * S + 180_000_000,
        duration: 6 * S - 180_000_000,
      }),
    ];

    expect(segmentAt(camera, 10 * S + 50_000_000)?.file).toBe("2/camera.mp4");
    // Before the first take's camera opened there is nothing ahead but it.
    expect(segmentAt(camera, 0)?.file).toBe("camera.mp4");
  });

  it("holds the last segment just past the end, and nothing beyond it", () => {
    // A microphone switched off for the second take stops at the seam. Holding
    // its last sample over the whole of the new footage would misrepresent the
    // recording far more than silence does.
    const mic: TrackMedia[] = [media({ kind: "microphone", file: "mic.m4a", duration: 10 * S })];

    expect(segmentAt(mic, 10 * S + 100_000_000)?.file).toBe("mic.m4a");
    expect(segmentAt(mic, 11 * S)).toBeNull();
  });

  it("answers null for a track with no segments at all", () => {
    expect(segmentAt([], 0)).toBeNull();
  });
});

describe("keys", () => {
  it("names one element per kind and segment", () => {
    expect(mediaKey("screen", 0)).toBe("screen:0");
    expect(mediaKey("camera", 1)).toBe("camera:1");
    // The matte is a key rather than a kind: every enumeration of kinds — the
    // mixer, the timeline's rows, the probe — would otherwise have to skip it.
    expect(matteKey(1)).toBe("camera_matte:1");
  });
});

describe("segmentsOf and kindsOf", () => {
  it("splits the flat media list back into tracks", () => {
    expect(segmentsOf(SCREEN, "screen").map((track) => track.segment)).toEqual([0, 1]);
    expect(segmentsOf(SCREEN, "camera")).toEqual([]);
    // One entry per kind however many takes recorded it: the panels ask whether
    // the recording has a camera, never whether take two does.
    expect([...kindsOf(SCREEN)]).toEqual(["screen"]);
  });
});
