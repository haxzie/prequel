/**
 * What the scan hands the editor has to survive being saved and read back.
 *
 * `covers` is the one seam where a Rust struct's JSON becomes a `MaskSlice`,
 * and the TypeScript side of it is a hand-written declaration of that JSON —
 * so the compiler has nothing to check it against and a disagreement is silent
 * in both directions.
 *
 * It was silent. `prequel-sensitive` spelled a rectangle `w`/`h` where this
 * reads `width`/`height`, every key crossed over with two `undefined`s,
 * `JSON.stringify` dropped them, and the cover reached `project.json` with a
 * position and no size. `sanitiseMasks` then did exactly its job and threw the
 * keys away, so the panel listed a finding as covered and the film showed it in
 * full. The Rust half of the contract is pinned in
 * `crates/prequel-ocr/tests/says_where_in_one_spelling.rs`; this is the half
 * that holds whatever Rust decides to call things.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: () => [] } }));
vi.mock("../broadcast.js", () => ({ toEveryWindow: () => undefined }));
vi.mock("../recorder.js", () => ({ getRecorder: () => undefined }));
vi.mock("../log.js", () => ({ log: () => undefined }));

import { sanitiseMasks } from "../../shared/project.js";
import { covers, saltFor, type Finding } from "./index.js";

const finding = (over: Partial<Finding> = {}): Finding => ({
  category: "face",
  label: "Face",
  preview: "Face",
  bucket: 4987375,
  confidence: 0.95,
  covered: true,
  uncertain: false,
  keys: [
    { at: 3_000_000_000, x: 0.41, y: 0.5, width: 0.08, height: 0.14 },
    { at: 4_000_000_000, x: 0.35, y: 0.55, width: 0.08, height: 0.14 },
  ],
  ...over,
});

const GROUPS = ["contact", "financial", "credential", "people"] as const;

/** Written to `project.json` and read again, which is all a save is. */
const saved = (masks: unknown) => sanitiseMasks(JSON.parse(JSON.stringify(masks)));

describe("a cover from a scan", () => {
  it("survives a save with every key it was found with", () => {
    const made = covers([finding()], GROUPS);
    expect(made).toHaveLength(1);

    const read = saved(made);
    expect(read).toHaveLength(1);
    expect(read[0]!.keys).toHaveLength(made[0]!.keys.length);
  });

  it("keeps a size on every key", () => {
    // The assertion that was missing. A key with a position and no size reads
    // back as nothing at all, and nothing at all is an uncovered face.
    for (const key of saved(covers([finding()], GROUPS))[0]!.keys) {
      expect(key.width).toBeGreaterThan(0);
      expect(key.height).toBeGreaterThan(0);
    }
  });

  it("writes no key the save would throw away", () => {
    // Stated as the general property rather than as four fields, so a fifth
    // one added later is covered by the same test.
    const made = covers([finding()], GROUPS);
    const before = made.flatMap((mask) => mask.keys);
    const after = saved(made).flatMap((mask) => mask.keys);

    expect(after).toEqual(before);
  });

  it("is still visible and still has its span after the trip", () => {
    const read = saved(covers([finding()], GROUPS))[0]!;

    expect(read.visible).toBe(true);
    expect(read.source.end).toBeGreaterThan(read.source.start);
  });
});

describe("the salt a recording's buckets are made with", () => {
  it("is the same every time the same recording is read", () => {
    // What a cover's id rests on, through its bucket. A salt that changed
    // between readings gave the same thing a new id each time — so a cover
    // somebody had turned off came back beside its own dismissal, and every
    // other one was added a second time. `merged` can only tell "already here"
    // from "new" if this holds still.
    expect(saltFor("rec-2026-10-04-abc")).toBe(saltFor("rec-2026-10-04-abc"));
  });

  it("is a different one for a different recording", () => {
    // The reason it is salted at all: the same card number in two recordings
    // must not bucket the same way, or an artefact travelling beside one video
    // says something about another.
    expect(saltFor("rec-one")).not.toBe(saltFor("rec-two"));
  });

  it("is a decimal the addon can read as a number", () => {
    // It crosses as a string because a u64 does not survive JSON, and Rust
    // parses it with `u64::from_str` — anything else lands as a zero salt,
    // silently, which would put every recording in the same buckets.
    const salt = saltFor("rec-2026-10-04-abc");

    expect(salt).toMatch(/^\d+$/);
    expect(BigInt(salt)).toBeLessThan(2n ** 64n);
  });
});
