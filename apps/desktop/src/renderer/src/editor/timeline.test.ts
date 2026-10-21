/**
 * The arithmetic every frame of playback and every exported frame depends on.
 *
 * Two things here are the classic ways an editor goes subtly wrong: a cut that
 * lands between two frames rather than on one, and a track whose late start is
 * corrected twice.
 */
import { describe, expect, it } from "vitest";

import type { TrackMedia } from "../../../shared/contract";
import {
  clickMarks,
  place,
  sliceAt,
  splitAt,
  toFileTime,
  toProjectTime,
  toProjectTimeThrough,
  spanInProject,
  toSourceTime,
  totalDuration,
  trimmedTo,
  type Slice,
  type TrimGrab,
} from "./timeline";

const S = 1_000_000_000;

/** One 10-second take, uncut. */
const WHOLE: Slice[] = [{ id: "a", source: { start: 0, end: 10 * S }, speed: 1 }];

/** The same take with 2s–4s removed. */
const CUT: Slice[] = [
  { id: "a", source: { start: 0, end: 2 * S }, speed: 1 },
  { id: "b", source: { start: 4 * S, end: 10 * S }, speed: 1 },
];

function track(overrides: Partial<TrackMedia> = {}): TrackMedia {
  return {
    kind: "camera",
    segment: 0,
    file: "camera.mp4",
    url: "prequel-media://recording/take/camera.mp4",
    offset: 0,
    duration: 10 * S,
    width: 1280,
    height: 720,
    frameRate: 30,
    matteUrl: null,
    matteFile: null,
    ...overrides,
  };
}

describe("place", () => {
  it("lays slices end to end", () => {
    const placed = place(CUT);

    expect(placed[0]!.timelineStart).toBe(0);
    expect(placed[0]!.duration).toBe(2 * S);
    // The second slice follows immediately: the removed span leaves no gap.
    expect(placed[1]!.timelineStart).toBe(2 * S);
    expect(placed[1]!.duration).toBe(6 * S);
  });

  it("reports the edited length, not the recorded one", () => {
    expect(totalDuration(place(WHOLE))).toBe(10 * S);
    expect(totalDuration(place(CUT))).toBe(8 * S);
  });

  it("survives an empty edit", () => {
    expect(place([])).toEqual([]);
    expect(totalDuration([])).toBe(0);
  });

  it("halves the project-time span of a slice played at double speed", () => {
    const placed = place([{ id: "a", source: { start: 0, end: 10 * S }, speed: 2 }]);
    expect(placed[0]!.duration).toBe(5 * S);
  });

  it("doubles the project-time span of a slice played at half speed", () => {
    const placed = place([{ id: "a", source: { start: 0, end: 10 * S }, speed: 0.5 }]);
    expect(placed[0]!.duration).toBe(20 * S);
  });
});

describe("sliceAt", () => {
  it("gives a boundary to the later slice", () => {
    // Half-open ranges are what make a cut land on a frame rather than between
    // two. At exactly 2s the second slice is playing, not the first.
    expect(sliceAt(place(CUT), 2 * S)!.id).toBe("b");
    expect(sliceAt(place(CUT), 2 * S - 1)!.id).toBe("a");
  });

  it("resolves the very end of the edit to the last slice", () => {
    // There is no slice after the end, and returning nothing would leave the
    // playhead with no frame to show when it runs out.
    expect(sliceAt(place(CUT), 8 * S)!.id).toBe("b");
  });

  it("has nothing to return for an empty edit", () => {
    expect(sliceAt([], 0)).toBeUndefined();
  });
});

describe("project ↔ source", () => {
  it("maps straight through when nothing has been cut", () => {
    expect(toSourceTime(place(WHOLE), 3 * S)).toBe(3 * S);
  });

  it("skips the removed span", () => {
    const placed = place(CUT);

    // Just before the cut, times still line up.
    expect(toSourceTime(placed, 1 * S)).toBe(1 * S);
    // Immediately after it, the playhead is at 4s in the source, not 2s.
    expect(toSourceTime(placed, 2 * S)).toBe(4 * S);
    expect(toSourceTime(placed, 3 * S)).toBe(5 * S);
  });

  it("maps the very end of the edit to the end of the last clip", () => {
    // The timeline is drawn as a half-open range, so the final pixel belongs to
    // no clip. Falling through to the raw project time there hands back a
    // *source* value that is short by however much was cut away — and dragging
    // a zoom's end handle to the far right then collapses it backwards instead
    // of pinning it to the end of the recording.
    const placed = place(CUT);
    expect(toSourceTime(placed, totalDuration(placed))).toBe(10 * S);
    expect(toSourceTime(place(WHOLE), 10 * S)).toBe(10 * S);
  });

  it("round-trips across a cut", () => {
    const placed = place(CUT);

    for (const time of [0, 1 * S, 2 * S, 5 * S, 8 * S - 1]) {
      const source = toSourceTime(placed, time)!;
      expect(toProjectTime(placed, source)).toBe(time);
    }
  });

  it("keeps a span that starts in a cut", () => {
    // The case that made a zoom invisible: an automatic zoom is placed against
    // the whole recording, then a cut removes the moment it starts on. Asking
    // about its edges one at a time answers "nowhere" and the bar is not drawn
    // — while the zoom still occupies its source range, so every click on those
    // seconds silently does nothing.
    const placed = place(CUT);

    // 3s of source is inside the removed 2s-4s. The span still covers 5s-8s of
    // the source, which is the last 3s of the edit.
    expect(spanInProject(placed, { start: 3 * S, end: 8 * S })).toEqual({
      start: 2 * S,
      end: 6 * S,
    });
  });

  it("draws a span across a cut as one range", () => {
    // It applies either side of the join, and two bars would read as two zooms.
    expect(spanInProject(place(CUT), { start: 1 * S, end: 5 * S })).toEqual({
      start: 1 * S,
      end: 3 * S,
    });
  });

  it("reports a span that survived nowhere as absent", () => {
    expect(spanInProject(place(CUT), { start: 2 * S, end: 4 * S })).toBeNull();
  });

  it("agrees with the per-moment mapping when nothing was cut away", () => {
    expect(spanInProject(place(WHOLE), { start: 3 * S, end: 7 * S })).toEqual({
      start: 3 * S,
      end: 7 * S,
    });
  });

  it("reports a moment that was cut out as absent", () => {
    // 3s of source falls in the removed span. There is no project time for it,
    // and inventing the nearest one would silently move the playhead.
    expect(toProjectTime(place(CUT), 3 * S)).toBeNull();
  });

  it("has no source time for an empty edit", () => {
    expect(toSourceTime([], 0)).toBeNull();
  });

  it("round-trips at double speed", () => {
    // A speed slice is the same shape of bug as a cut: the two directions scale
    // oppositely, and getting only one of them right still round-trips wrong.
    const placed = place([{ id: "a", source: { start: 0, end: 10 * S }, speed: 2 }]);

    for (const time of [0, 1 * S, 4 * S - 1]) {
      const source = toSourceTime(placed, time)!;
      expect(toProjectTime(placed, source)).toBe(time);
    }
  });

  it("reports a shorter project-time span for a span on a sped-up slice", () => {
    const placed = place([{ id: "a", source: { start: 0, end: 10 * S }, speed: 2 }]);
    // 4s of source at 2x covers 2s of project time.
    expect(spanInProject(placed, { start: 2 * S, end: 6 * S })).toEqual({
      start: 1 * S,
      end: 3 * S,
    });
  });

  it("maps a span's end on the end of its clip, and scales it by speed", () => {
    // Half-open `toProjectTime` has nothing at 2s of CUT; the edge of a zoom
    // that ends on the cut must still land on the join.
    expect(toProjectTime(place(CUT), 2 * S)).toBeNull();
    expect(toProjectTimeThrough(place(CUT), 2 * S)).toBe(2 * S);
    expect(toProjectTimeThrough(place(CUT), 3 * S)).toBeNull();

    const placed = place([{ id: "a", source: { start: 0, end: 10 * S }, speed: 2 }]);
    expect(toProjectTimeThrough(placed, 6 * S)).toBe(3 * S);
    expect(toProjectTimeThrough(placed, 10 * S)).toBe(5 * S);
  });
});

describe("toFileTime", () => {
  it("passes straight through for a track that anchored the clock", () => {
    expect(toFileTime(track({ offset: 0 }), 3 * S)).toBe(3 * S);
  });

  it("subtracts a late track's start exactly once", () => {
    // The camera opened 250ms in. At 3s of session time it is 2.75s into its
    // own file — the file itself is zero-based, so this offset is the whole
    // correction and applying it twice is the bug this guards.
    const camera = track({ offset: 250_000_000 });
    expect(toFileTime(camera, 3 * S)).toBe(3 * S - 250_000_000);
  });

  it("holds the first frame across a device that opened late", () => {
    // Every recording has this gap — the camera opens a couple of hundred
    // milliseconds after the screen — and blanking it reads as the camera
    // arriving late rather than as an honest hole.
    const camera = track({ offset: 250_000_000 });
    expect(toFileTime(camera, 100_000_000)).toBe(0);
  });

  it("still has nothing to show long before a track that started late", () => {
    // Past the tolerance it is not a warm-up gap any more, and holding one
    // frame over seconds of recording would be a lie about what was captured.
    const late = track({ offset: 4 * S });
    expect(toFileTime(late, 100_000_000)).toBeNull();
  });

  it("shows the first frame the instant the track begins", () => {
    const camera = track({ offset: 250_000_000 });
    expect(toFileTime(camera, 250_000_000)).toBe(0);
  });

  it("has no frame after a track that stopped early", () => {
    // A camera unplugged mid-take. The screen keeps going; the bubble does not.
    const camera = track({ offset: 0, duration: 4 * S });
    expect(toFileTime(camera, 5 * S)).toBeNull();
  });

  it("holds the last frame across a track that stopped a moment early", () => {
    // The other end of the same warm-up mismatch: tracks stop a few tens of
    // milliseconds apart, and the camera blinking out just before the end of
    // playback is the visible half of it.
    const camera = track({ offset: 0, duration: 4 * S });
    expect(toFileTime(camera, 4 * S + 20_000_000)).toBe(4 * S - 1);
  });
});

describe("splitAt", () => {
  const id = () => "new";

  it("cuts one slice into two that meet exactly", () => {
    const split = splitAt(WHOLE, 4 * S, id);

    expect(split).toHaveLength(2);
    expect(split[0]!.source).toEqual({ start: 0, end: 4 * S });
    expect(split[1]!.source).toEqual({ start: 4 * S, end: 10 * S });
    // No frame is lost or duplicated across the cut.
    expect(totalDuration(place(split))).toBe(totalDuration(place(WHOLE)));
  });

  it("cuts the right slice when the edit already has several", () => {
    const split = splitAt(CUT, 5 * S, id);

    expect(split).toHaveLength(3);
    expect(split.map((slice) => slice.id)).toEqual(["a", "b", "new"]);
    expect(split[1]!.source).toEqual({ start: 4 * S, end: 7 * S });
    expect(split[2]!.source).toEqual({ start: 7 * S, end: 10 * S });
  });

  it("declines to cut on an existing boundary", () => {
    // A zero-length slice is not something the timeline can draw or the
    // exporter can render.
    expect(splitAt(CUT, 2 * S, id)).toHaveLength(2);
    expect(splitAt(CUT, 0, id)).toHaveLength(2);
  });

  it("declines to cut past the end of the edit", () => {
    expect(splitAt(CUT, 8 * S, id)).toHaveLength(2);
    expect(splitAt(CUT, 20 * S, id)).toHaveLength(2);
  });

  it("carries a slice's speed onto both halves", () => {
    const sped: Slice[] = [{ id: "a", source: { start: 0, end: 10 * S }, speed: 2 }];
    const split = splitAt(sped, 4 * S, id);

    expect(split[0]!.speed).toBe(2);
    expect(split[1]!.speed).toBe(2);
  });

  it("cuts at the project-time point the pointer landed on, not the source-time one", () => {
    // At 2x speed, 2s of project time is 4s of source — a cut that used the
    // project-time offset directly would land at 2s of source instead.
    const sped: Slice[] = [{ id: "a", source: { start: 0, end: 10 * S }, speed: 2 }];
    const split = splitAt(sped, 2 * S, id);

    expect(split[0]!.source).toEqual({ start: 0, end: 4 * S });
    expect(split[1]!.source).toEqual({ start: 4 * S, end: 10 * S });
  });
});

describe("trimmedTo", () => {
  /** An edge four seconds into the take, picked up at x=200 on a 10px/s strip. */
  const GRAB: TrimGrab = { source: 4 * S, clientX: 200, perPixel: S / 10 };

  it("moves the edge by what the pointer moved", () => {
    expect(trimmedTo(GRAB, 250)).toBe(9 * S);
    expect(trimmedTo(GRAB, 150)).toBe(-1 * S);
  });

  it("lands in the same place however many moves got there", () => {
    // The failure this exists to prevent: a delta measured against the live
    // clip added the distance already travelled again on every `pointermove`,
    // so a drag reported as fifty small steps trimmed vastly more than the same
    // gesture reported as one.
    const flicked = trimmedTo(GRAB, 250);
    let crawled = 0;
    for (let x = 201; x <= 250; x++) crawled = trimmedTo(GRAB, x);

    expect(crawled).toBe(flicked);
  });

  it("puts the edge back when the pointer comes back", () => {
    trimmedTo(GRAB, 400);
    expect(trimmedTo(GRAB, GRAB.clientX)).toBe(GRAB.source);
  });
});

describe("clickMarks", () => {
  /** A hundred pixels of clip, and a dot every four at the most. */
  const marks = (clicks: number[], slices = WHOLE) => clickMarks(clicks, slices[0]!, 100, 4);

  it("places a press at its share of the clip", () => {
    expect(marks([2.5 * S, 5 * S])).toEqual([0.25, 0.5]);
  });

  it("leaves out the presses this clip cut away", () => {
    // The second clip of `CUT` begins at 4s, so a press at 3s is in the gap and
    // one at 2s is the end of the clip before it.
    expect(marks([2 * S, 3 * S, 5 * S], CUT)).toEqual([]);
    expect(marks([2 * S, 3 * S, 5 * S], [CUT[1]!])).toEqual([1 / 6]);
  });

  it("gives a press on a cut one dot and not two", () => {
    const halves = splitAt(WHOLE, 5 * S, () => "b");
    const first = clickMarks([5 * S], halves[0]!, 100, 4);
    const second = clickMarks([5 * S], halves[1]!, 100, 4);
    expect([first.length, second.length]).toEqual([0, 1]);
  });

  it("thins a cluster to the first press in it", () => {
    // Ten presses inside a tenth of a second — a double-click and a drag — are
    // a tenth of a pixel apart at this scale.
    const burst = Array.from({ length: 10 }, (_, index) => 5 * S + index * (S / 100));
    expect(marks(burst)).toEqual([0.5]);
  });

  it("keeps a press the gap clears", () => {
    // Half a second apart is five pixels at this scale, which clears four.
    expect(marks([5 * S, 5.5 * S])).toEqual([0.5, 0.55]);
  });

  it("draws nothing for a clip with no width yet", () => {
    expect(clickMarks([5 * S], WHOLE[0]!, 0, 4)).toEqual([]);
  });

  it("marks a sped-up clip by where the press is in the footage", () => {
    // The clip plays its ten seconds in five, so half the source is still half
    // the bar: speed changes how wide the clip is, not what is inside it.
    const fast: Slice = { id: "a", source: { start: 0, end: 10 * S }, speed: 2 };
    expect(clickMarks([5 * S], fast, 100, 4)).toEqual([0.5]);
  });
});
