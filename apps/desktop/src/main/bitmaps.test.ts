/**
 * The batched halves of the bitmap store.
 *
 * `haveBitmaps` is what lets the renderer skip drawing a cue it has already
 * drawn, and `writeBitmaps` is what lets it write a chunk of them in one round
 * trip. Both are new names for work `writeBitmap` was already doing one file
 * at a time, so what is worth pinning is that they agree with it — a `have`
 * that answered yes for a file `write` would refuse is a caption placed in the
 * plan with nothing on disk behind it, which renders as a gap and says
 * nothing.
 */
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { haveBitmaps, writeBitmaps, writeBitmap } from "./captions";

const bytes = (fill: number) => new Uint8Array([fill, fill, fill]);

function take(): string {
  const dir = mkdtempSync(join(tmpdir(), "prequel-bitmaps-"));
  mkdirSync(join(dir, "captions"), { recursive: true });
  return dir;
}

describe("asking which bitmaps are there", () => {
  it("answers with the ones on disk and nothing else", () => {
    const dir = take();
    writeFileSync(join(dir, "captions", "a.png"), bytes(1));

    expect(haveBitmaps("captions", dir, ["captions/a.png", "captions/b.png"])).toEqual([
      "captions/a.png",
    ]);
  });

  it("refuses a name that climbs out of the recording", () => {
    // The renderer names these and a name is a string from a window. Reported
    // absent rather than checked, so a path that escapes can never be the
    // reason a draw is skipped.
    const dir = take();
    expect(haveBitmaps("captions", dir, ["../../etc/passwd.png"])).toEqual([]);
    expect(haveBitmaps("nonsense", dir, ["captions/a.png"])).toEqual([]);
  });

  it("agrees with the writer about every file it claims", async () => {
    // The pairing that matters: anything `have` reports is a file the single
    // writer would also have skipped, because they are the same question.
    const dir = take();
    await writeBitmap("captions", dir, "captions/c.png", bytes(7));

    expect(haveBitmaps("captions", dir, ["captions/c.png"])).toEqual(["captions/c.png"]);
    // And the write that follows is a no-op rather than a rewrite.
    await writeBitmap("captions", dir, "captions/c.png", bytes(9));
    expect(readFileSync(join(dir, "captions", "c.png"))).toEqual(Buffer.from(bytes(7)));
  });
});

describe("writing a chunk of bitmaps", () => {
  it("answers per file, in the order it was given", async () => {
    const dir = take();
    const written = await writeBitmaps("captions", dir, [
      { file: "captions/one.png", bytes: bytes(1) },
      { file: "../escape.png", bytes: bytes(2) },
      { file: "captions/three.png", bytes: bytes(3) },
    ]);

    // The caller slices this per cue to decide which landed whole, so a
    // missing entry would shift every cue after it onto another's layers.
    expect(written).toEqual(["captions/one.png", null, "captions/three.png"]);
  });

  it("leaves a file that is already there alone", async () => {
    const dir = take();
    writeFileSync(join(dir, "captions", "kept.png"), bytes(4));

    await writeBitmaps("captions", dir, [{ file: "captions/kept.png", bytes: bytes(5) }]);
    expect(readFileSync(join(dir, "captions", "kept.png"))).toEqual(Buffer.from(bytes(4)));
  });
});
