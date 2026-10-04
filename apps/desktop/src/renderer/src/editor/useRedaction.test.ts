//! What a second reading replaces, and what it must not undo.
import { describe, expect, it } from "vitest";

import type { MaskSlice, RedactGroup } from "../../../shared/project";
import { merged } from "./useRedaction";

const LOOK = { mode: "blur" as const, strength: 0.6 };

/** What the fixtures below belong to, which is what a reading of them replaces. */
const READ: readonly RedactGroup[] = ["contact"];

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

    const next = merged([shown], [found], LOOK, READ);

    expect(next).toHaveLength(1);
    expect(next[0]!.visible).toBe(false);
  });

  it("keeps a dismissal whose cover was found a little earlier this time", () => {
    // An id carries the first moment with it, so a reader that samples ten
    // times a second finds the same thing earlier than one that sampled once —
    // a different id for the same cover. Matched on the bucket as well, or
    // every dismissal is lost the first time the reader improves.
    const shown = mask("m1234-3000", { visible: false, bucket: 77 });
    const found = mask("m1234-2100", { bucket: 77 });

    const next = merged([shown], [found], LOOK, READ);

    expect(next).toHaveLength(1);
    expect(next[0]!.visible).toBe(false);
  });

  it("takes the new reading's geometry over the old one's", () => {
    // Why this is a replacement and not a merge. The reader is the only thing
    // that knows where a cover goes, so a cover found by an older reader kept
    // its geometry for ever — and a scan that followed a face ten times a
    // second could not replace one that followed it once. Scan again did
    // nothing anybody could see.
    const before = mask("m1", {
      keys: [{ at: 0, x: 0.1, y: 0.1, width: 0.2, height: 0.05 }],
      source: { start: 0, end: 8_000_000_000 },
    });
    const after = mask("m1", {
      keys: [
        { at: 0, x: 0.5, y: 0.5, width: 0.2, height: 0.05 },
        { at: 100_000_000, x: 0.52, y: 0.5, width: 0.2, height: 0.05 },
      ],
      source: { start: 0, end: 100_000_000 },
    });

    const next = merged([before], [after], LOOK, READ);

    expect(next).toHaveLength(1);
    expect(next[0]!.keys).toEqual(after.keys);
    expect(next[0]!.source).toEqual(after.source);
  });

  it("keeps the look somebody gave a cover", () => {
    // Restyled by hand. The geometry is the reading's; how it is drawn is not.
    const mine = mask("m1", { mode: "pixelate", strength: 0.9 });

    const next = merged([mine], [mask("m1")], LOOK, READ);

    expect(next[0]!.mode).toBe("pixelate");
    expect(next[0]!.strength).toBe(0.9);
  });

  it("adds what it has not seen before", () => {
    const next = merged([mask("m1")], [mask("m1"), mask("m2")], LOOK, READ);

    expect(next.map((entry) => entry.id)).toEqual(["m1", "m2"]);
  });

  it("drops a cover the reading no longer finds", () => {
    // The other half of replacing. A face that has gone, or one that was never
    // a face, has to be able to leave — otherwise every reading only ever adds
    // and the list grows with every mistake any reader has ever made.
    const next = merged([mask("m1"), mask("m2")], [mask("m1")], LOOK, READ);

    expect(next.map((entry) => entry.id)).toEqual(["m1"]);
  });

  it("dresses a new cover in the look that was asked for", () => {
    const next = merged([], [mask("m1")], { mode: "pixelate", strength: 0.8 }, READ);

    expect(next[0]!.mode).toBe("pixelate");
    expect(next[0]!.strength).toBe(0.8);
  });

  it("keeps a hand-drawn cover a reading knows nothing about", () => {
    const byHand = mask("manual-1", { origin: "manual" });

    const next = merged([byHand], [mask("m1")], LOOK, READ);

    expect(next.map((entry) => entry.id)).toEqual(["manual-1", "m1"]);
  });

  it("leaves alone the covers this reading was not looking for", () => {
    // A reading asked for faces alone has nothing to say about the card number
    // the last one found. Replacing that would be a leak introduced by looking
    // for something else.
    const card = mask("card-1", { group: "financial", label: "Card number" });
    const face = mask("face-1", { group: "people", label: "Face" });

    const next = merged([card, face], [mask("face-2", { group: "people" })], LOOK, ["people"]);

    expect(next.map((entry) => entry.id)).toEqual(["card-1", "face-2"]);
  });
});
