/**
 * Where a bed's sound comes from, and how loud it is.
 *
 * Both answers are mirrored in Rust — `crates/prequel-render/src/music.rs` —
 * so the numbers below are deliberately the same ones that file's tests carry:
 * a ten-second bed starting at two seconds, with two-second fades. If one side
 * is changed and the other is not, somebody's music fades differently in the
 * exported file from the way it did on screen, and nothing says so until the
 * video has been watched.
 *
 * The properties, rather than the arithmetic: a bed is silent outside itself,
 * it never exceeds its own level however its fades are set, and a file that is
 * shorter than the bar it is in is silence at the end rather than a held
 * sample — unless it repeats, in which case it starts again from its own
 * beginning and not from wherever it was trimmed to.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  musicAt,
  musicFileOf,
  musicFileTime,
  musicGain,
  MUSIC_TRIM,
  MUSIC_FILE_NAME,
  SHIPPED_MUSIC,
  shippedMusic,
  type MusicSlice,
} from "./music";

const S = 1_000_000_000;

function bed(patch: Partial<MusicSlice> = {}): MusicSlice {
  return {
    id: "music-0",
    at: 2 * S,
    length: 10 * S,
    file: "wander.m4a",
    offset: 0,
    volume: 1,
    muted: false,
    fadeIn: 2 * S,
    fadeOut: 2 * S,
    repeat: false,
    ...patch,
  };
}

describe("musicGain", () => {
  it("is silent outside the bed", () => {
    expect(musicGain(bed(), 0)).toBe(0);
    expect(musicGain(bed(), 2 * S - 1)).toBe(0);
    // Half-open, like every other span in the project: the end is not in it.
    expect(musicGain(bed(), 12 * S)).toBe(0);
  });

  it("rises over the fade in and falls over the fade out", () => {
    // Against the trim rather than against one: a bed at its own full level is
    // `MUSIC_TRIM` in the mix, which is what keeps speech audible under it.
    expect(musicGain(bed(), 2 * S)).toBe(0);
    expect(musicGain(bed(), 3 * S)).toBeCloseTo(MUSIC_TRIM / 2);
    expect(musicGain(bed(), 4 * S)).toBeCloseTo(MUSIC_TRIM);
    expect(musicGain(bed(), 10 * S)).toBeCloseTo(MUSIC_TRIM);
    expect(musicGain(bed(), 11 * S)).toBeCloseTo(MUSIC_TRIM / 2);
  });

  it("holds a song well under a voice at its own full level", () => {
    // The number itself, asserted once. A mastered song mixed in at unity
    // buries a laptop microphone — see `MUSIC_TRIM` — and the row was shipped
    // with this wrong, which is the only reason the constant exists.
    expect(MUSIC_TRIM).toBeLessThanOrEqual(0.3);
    expect(musicGain(bed(), 7 * S)).toBeLessThan(0.5);
  });

  it("carries the level through both ramps", () => {
    expect(musicGain(bed({ volume: 0.5 }), 7 * S)).toBeCloseTo(MUSIC_TRIM * 0.5);
    expect(musicGain(bed({ volume: 0.5 }), 3 * S)).toBeCloseTo(MUSIC_TRIM * 0.25);
  });

  it("never exceeds its level on a bed shorter than its fades", () => {
    // The case the clamp to half exists for. Without it the two ramps cross
    // and the middle of the bed is twice as loud as the bed is — which does
    // not fail anywhere, it just distorts.
    const short = bed({ at: 0, length: 2 * S, fadeIn: 4 * S, fadeOut: 4 * S });

    for (let step = 0; step <= 20; step += 1) {
      expect(musicGain(short, (step * 2 * S) / 20)).toBeLessThanOrEqual(MUSIC_TRIM);
    }
    // And still reaches its level exactly once, in the middle.
    expect(musicGain(short, S)).toBeCloseTo(MUSIC_TRIM);
  });

  it("is silent when muted, whatever the level says", () => {
    expect(musicGain(bed({ muted: true }), 7 * S)).toBe(0);
  });
});

describe("musicFileTime", () => {
  it("walks the file forward with the bed", () => {
    expect(musicFileTime(bed(), 2 * S, 60 * S)).toBe(0);
    expect(musicFileTime(bed(), 5 * S, 60 * S)).toBe(3 * S);
  });

  it("starts at the trim rather than at the top", () => {
    expect(musicFileTime(bed({ offset: 30 * S }), 2 * S, 60 * S)).toBe(30 * S);
  });

  it("is silent past the end of a file that does not repeat", () => {
    // A bar ten seconds long over a four-second song: six seconds in, the
    // song has run out. The alternative every naive implementation produces is
    // the last sample held, which is a tone.
    expect(musicFileTime(bed(), 8 * S, 4 * S)).toBeNull();
    // A hair before the end, it is still playing.
    expect(musicFileTime(bed(), 6 * S - 1, 4 * S)).toBe(4 * S - 1);
  });

  it("starts the file again from its own beginning when it repeats", () => {
    const looped = bed({ repeat: true, offset: 3 * S });
    // Three seconds in, from an offset of three, is six — which is past the
    // end of a four-second file, so the second pass is two seconds in.
    expect(musicFileTime(looped, 5 * S, 4 * S)).toBe(2 * S);
    // And not 3s + 2s: a repeat is the song again, not the trim again.
    expect(musicFileTime(looped, 5 * S, 4 * S)).not.toBe(5 * S);
  });

  it("is silent outside the bed, and where the length is not known", () => {
    expect(musicFileTime(bed(), 0, 60 * S)).toBeNull();
    expect(musicFileTime(bed(), 12 * S, 60 * S)).toBeNull();
    expect(musicFileTime(bed(), 5 * S, 0)).toBeNull();
  });
});

describe("musicAt", () => {
  it("finds the bed over a moment, and nothing in the gaps", () => {
    const beds = [bed(), bed({ id: "music-1", at: 20 * S, length: 5 * S })];

    expect(musicAt(beds, 5 * S)?.id).toBe("music-0");
    expect(musicAt(beds, 21 * S)?.id).toBe("music-1");
    expect(musicAt(beds, 15 * S)).toBeUndefined();
  });
});

describe("musicFileOf", () => {
  it("is undefined for a bed whose file the project does not list", () => {
    const files = [{ file: "wander.m4a", label: "Wander", duration: 60 * S }];

    expect(musicFileOf(files, bed())?.label).toBe("Wander");
    expect(musicFileOf(files, bed({ file: "other.m4a" }))).toBeUndefined();
  });
});

describe("the shipped track", () => {
  it("names a file the app can copy", () => {
    // The guard the backgrounds' own test is: `ensureMusic` copies the file
    // named here out of `resources/music`, and a name with nothing behind it
    // is a bed that plays silence with nothing anywhere to say why.
    for (const track of SHIPPED_MUSIC) {
      expect(MUSIC_FILE_NAME.test(track.file)).toBe(true);
      expect(existsSync(join(import.meta.dirname, "../../resources/music", track.file))).toBe(true);
      // Long enough to be a bed rather than a sting.
      expect(track.duration).toBeGreaterThan(10 * S);
      expect(shippedMusic(track.file)).toBe(track);
    }
  });

  it("does not claim a file it did not ship", () => {
    expect(shippedMusic("wander.m4a")).toBeUndefined();
  });
});
