import { describe, expect, it } from "vitest";

import type { CleanTrack, EditorSession, TrackMedia } from "../../../shared/contract";
import { cleanKey, played } from "./useCleanMic";

function track(kind: TrackMedia["kind"], file: string, offset = 0): TrackMedia {
  return {
    kind,
    segment: 0,
    file,
    url: `prequel-media://take/${file}`,
    offset,
    duration: 10_000_000_000,
    width: null,
    height: null,
    frameRate: null,
    matteUrl: null,
    matteFile: null,
  };
}

function session(media: TrackMedia[]): EditorSession {
  return { media } as unknown as EditorSession;
}

function clean(file: string): CleanTrack {
  return { file, url: `prequel-media://take/${file}` };
}

/**
 * The one place the setting does anything: which file the microphone *is*.
 *
 * Everything that plays or exports the recording reads `session.media`, so
 * these are the properties the whole feature rests on — and each of them
 * fails quietly. A swapped offset moves the voice against the picture; a
 * swapped system track cleans the wrong thing; a new object every render
 * re-seeks the decoders.
 */
describe("played", () => {
  const known = new Map([[cleanKey("mic.m4a", "strong"), clean("mic.clean-strong.m4a")]]);

  it("points the microphone at the cleaned file", () => {
    const original = session([track("microphone", "mic.m4a")]);
    const result = played(original, known, "strong");

    expect(result.media[0]!.file).toBe("mic.clean-strong.m4a");
    expect(result.media[0]!.url).toBe("prequel-media://take/mic.clean-strong.m4a");
  });

  it("keeps the track's offset, which belongs to the take and not the file", () => {
    // The microphone routinely opens a few hundred milliseconds after the
    // screen, and that lives only in the manifest. Taking the offset from the
    // cleaned file — which is zero-based, like every session file — would put
    // the voice that far ahead of the picture.
    const original = session([track("microphone", "mic.m4a", 320_000_000)]);

    expect(played(original, known, "strong").media[0]!.offset).toBe(320_000_000);
  });

  it("leaves every other track alone", () => {
    // Particularly the system audio: it is whatever was coming out of the
    // speakers, and a voice model would take a tune apart.
    const original = session([track("system_audio", "system.m4a"), track("screen", "screen.mp4")]);
    const result = played(original, known, "strong");

    expect(result.media.map((media) => media.file)).toEqual(["system.m4a", "screen.mp4"]);
  });

  it("plays the recorded track while its cleaned one is still being made", () => {
    // The pass takes seconds. Holding the microphone back until it finished
    // would be a recording that plays silent on open, which reads as a broken
    // take rather than as work in progress.
    const original = session([track("microphone", "2/mic.m4a")]);

    expect(played(original, known, "strong").media[0]!.file).toBe("2/mic.m4a");
  });

  it("will not play a file cleaned at a different level", () => {
    // The level is in the name, so `strong` cannot answer for `light`.
    // Answering anyway would leave the panel saying Light over a track that is
    // the other thing entirely.
    const original = session([track("microphone", "mic.m4a")]);

    expect(played(original, known, "light").media[0]!.file).toBe("mic.m4a");
  });

  it("hands back the very same session when nothing is swapped", () => {
    // Identity, not equality. The preview keys its map of decoded elements on
    // the session object; a new one each render makes every track look fresh
    // and hard-seeks all four.
    const original = session([track("microphone", "mic.m4a")]);

    expect(played(original, new Map(), "strong")).toBe(original);
    expect(played(original, known, "off")).toBe(original);
  });
});
