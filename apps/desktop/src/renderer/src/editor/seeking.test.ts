/**
 * That a seek does not blank the preview.
 *
 * Assigning `currentTime` drops a video element's `readyState` to 1 until the
 * decoder has produced the new picture — measured at three frames on a small
 * local file, and longer on a real 4K recording. Two separate mistakes turned
 * that into a visible flash of the background between slices and on every scrub,
 * and both are the kind that reads as correct:
 *
 * - Answering "no frame" for those frames, which drops the whole layer out of the
 *   plan. The background is a separate item, so it is all that is left.
 * - Seeking at *every* slice boundary, including the contiguous ones `splitAt`
 *   makes, which paid that cost at ordinary cuts that need no seek at all.
 *
 * Both are asserted here rather than in the loop that contains them: the loop
 * needs a DOM, four media elements and a GPU, and none of those are what broke.
 */
import { describe, expect, it } from "vitest";

import { isReady } from "./webgl";
import { hasJumped, place, splitAt, toSourceTime } from "./timeline";

/** Enough of a video element for `isReady`, which is all it looks at. */
function video(state: {
  readyState: number;
  videoWidth?: number;
  seeking?: boolean;
  currentSrc?: string;
}): HTMLVideoElement {
  return {
    readyState: state.readyState,
    videoWidth: state.videoWidth ?? 1920,
    seeking: state.seeking ?? false,
    currentSrc: state.currentSrc ?? "prequel-media://screen.mp4",
  } as unknown as HTMLVideoElement;
}

describe("a video element mid-seek", () => {
  it("still has a frame worth drawing", () => {
    // The element has to have decoded once for there to be a frame to hold, so
    // this is the sequence rather than a single state: settled, then seeking.
    const element = video({ readyState: 4 });
    expect(isReady(element)).toBe(true);

    // What `currentTime =` does, and what was measured for three frames.
    Object.assign(element, { readyState: 1, seeking: true });

    expect(isReady(element)).toBe(true);
  });

  it("has nothing to hold before its first frame has ever decoded", () => {
    // Metadata has arrived, so the geometry is known — but no frame has been
    // uploaded, and an incomplete texture samples as black. Drawing the layer
    // here would trade a background flash for a black one.
    expect(isReady(video({ readyState: 1, seeking: true }))).toBe(false);
  });

  it("holds nothing across a change of source", () => {
    // The elements are reused between sessions — they are rendered with
    // `key={track.kind}` — so a flag kept per element would let a second
    // recording draw a frame from the first one.
    const element = video({ readyState: 4, currentSrc: "prequel-media://first.mp4" });
    expect(isReady(element)).toBe(true);

    Object.assign(element, {
      readyState: 1,
      seeking: true,
      currentSrc: "prequel-media://second.mp4",
    });

    expect(isReady(element)).toBe(false);
  });

  it("is not drawn before its metadata arrives", () => {
    expect(isReady(video({ readyState: 0, videoWidth: 0 }))).toBe(false);
  });

  it("is not a frame at all when there is no element", () => {
    expect(isReady(null)).toBe(false);
  });
});

describe("crossing a cut", () => {
  /** Two slices from one, exactly as the editor's split produces them. */
  const split = splitAt(
    [{ id: "a", source: { start: 0, end: 10_000_000_000 } }],
    4_000_000_000,
    () => "b",
  );
  const placed = place(split);

  it("leaves the two halves contiguous in source time", () => {
    // The premise of the assertion below. If a split ever produced a gap, the
    // seek this test says is unnecessary would become necessary.
    expect(split).toHaveLength(2);
    expect(split[0]!.source.end).toBe(split[1]!.source.start);
  });

  it("needs no seek, because the decoder is already there", () => {
    // A frame either side of the boundary, at the spacing playback actually
    // steps in. Seeking here is what flushed the decoder and flashed the
    // background at every ordinary cut.
    const before = toSourceTime(placed, 4_000_000_000 - 16_000_000);
    const after = toSourceTime(placed, 4_000_000_000 + 16_000_000);

    expect(hasJumped(before, after)).toBe(false);
  });

  it("still seeks when the playhead really lands elsewhere", () => {
    // A scrub, or a boundary between slices that are not contiguous — a trim or
    // a reorder. Here the flush is the only way to show the right frame.
    const from = toSourceTime(placed, 1_000_000_000);
    const to = toSourceTime(placed, 8_000_000_000);

    expect(hasJumped(from, to)).toBe(true);
  });

  it("is not a jump on the first tick, when there is no previous time", () => {
    expect(hasJumped(null, 5_000_000_000)).toBe(false);
  });
});
