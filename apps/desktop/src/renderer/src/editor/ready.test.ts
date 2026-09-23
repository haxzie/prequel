import { describe, expect, it } from "vitest";

import { previewReady } from "./ready";

const base = {
  videoKinds: ["screen"],
  matte: false,
  decoded: new Set(["screen"]),
  wanted: [] as string[],
  settled: new Set<string>(),
};

describe("revealing the preview", () => {
  it("waits for every video track, not just the first to decode", () => {
    expect(
      previewReady({ ...base, videoKinds: ["screen", "camera"], decoded: new Set(["screen"]) }),
    ).toBe(false);

    expect(
      previewReady({
        ...base,
        videoKinds: ["screen", "camera"],
        decoded: new Set(["screen", "camera"]),
      }),
    ).toBe(true);
  });

  it("waits for the matte, so a cutout is never revealed as a bare rectangle", () => {
    expect(previewReady({ ...base, matte: true })).toBe(false);
    expect(previewReady({ ...base, matte: true, decoded: new Set(["screen", "camera_matte"]) })).toBe(
      true,
    );
  });

  it("waits for every image the plan names", () => {
    expect(previewReady({ ...base, wanted: ["monterey.jpg"] })).toBe(false);
    expect(
      previewReady({ ...base, wanted: ["monterey.jpg"], settled: new Set(["monterey.jpg"]) }),
    ).toBe(true);
  });

  // The two that cost a release. Both reached users as an editor stuck on
  // "Loading the recording…" for ever, with a timeline and a panel that worked
  // and nothing in any log — so both are pinned as *failures*, not omissions.
  it("reveals once a track that will not open has been reported", () => {
    // `camera` settles through `onError` rather than `onLoadedData`. Before
    // that existed this stayed false until the window was closed.
    expect(
      previewReady({
        ...base,
        videoKinds: ["screen", "camera"],
        decoded: new Set(["screen", "camera"]),
      }),
    ).toBe(true);
  });

  it("reveals once an image that will never arrive has given up", () => {
    // A background deleted from the recording directory: the retry ladder ends
    // and the path settles unloaded. Waiting on the image map instead held the
    // whole preview behind a file that was never coming.
    expect(
      previewReady({ ...base, wanted: ["gone.jpg"], settled: new Set(["gone.jpg"]) }),
    ).toBe(true);
  });
});
