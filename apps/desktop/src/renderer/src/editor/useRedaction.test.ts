//! What a second reading must not undo.
import { describe, expect, it } from "vitest";

import type { MaskSlice } from "../../../shared/project";
import { merged } from "./useRedaction";

const LOOK = { mode: "blur" as const, strength: 0.6 };

function mask(id: string, patch: Partial<MaskSlice> = {}): MaskSlice {
  return {
    id,
    origin: "auto",
    group: "contact",
    label: "Email address",
    preview: "a•••@example.com",
    bucket: 1234,
    source: { start: 0, end: 1_000_000_000 },
    mode: "blur",
    strength: 0.6,
    visible: true,
    keys: [{ at: 0, x: 0.1, y: 0.1, width: 0.2, height: 0.05 }],
    ...patch,
  };
}

describe("reading a recording again", () => {
  it("does not put back a cover somebody turned off", () => {
    // The rule the whole feature's credibility rests on. A cover arrives
    // covering, so turning one off is somebody saying "that is my work, not a
    // leak" — and a scan that covered it again on the next open would be the
    // app overruling them, every time they opened the recording.
    const shown = mask("m1", { visible: false });
    const found = mask("m1");

    const next = merged([shown], [found], LOOK);

    expect(next).toHaveLength(1);
    expect(next[0]!.visible).toBe(false);
  });

  it("keeps a cover's own style and position", () => {
    // Restyled and dragged by hand. A scan finds the same thing and must leave
    // all of it alone: the id is what says "this is already here".
    const mine = mask("m1", {
      mode: "pixelate",
      strength: 0.9,
      keys: [{ at: 0, x: 0.5, y: 0.5, width: 0.1, height: 0.1 }],
    });

    const next = merged([mine], [mask("m1")], LOOK);

    expect(next[0]).toEqual(mine);
  });

  it("adds what it has not seen before", () => {
    const next = merged([mask("m1")], [mask("m1"), mask("m2")], LOOK);

    expect(next.map((entry) => entry.id)).toEqual(["m1", "m2"]);
  });

  it("dresses a new cover in the look that was asked for", () => {
    // The panel's style and strength apply to what a reading finds, and only to
    // what is new — restyling everything on a rescan would throw away every
    // per-cover choice somebody had made.
    const next = merged([], [mask("m2", { mode: "blur", strength: 0.1 })], {
      mode: "pixelate",
      strength: 0.8,
    });

    expect(next[0]!.mode).toBe("pixelate");
    expect(next[0]!.strength).toBe(0.8);
  });

  it("keeps a hand-drawn cover a reading knows nothing about", () => {
    const byHand = mask("manual-1", { origin: "manual" });

    const next = merged([byHand], [mask("m1")], LOOK);

    expect(next.map((entry) => entry.id)).toEqual(["manual-1", "m1"]);
  });
});
