/**
 * The transcript as the finished file has it.
 *
 * The editor's words are on the session clock — nanoseconds, with the cuts
 * still to be applied — and the share page's chapters are drawn against the
 * exported file, which has neither. This is the one conversion. A word whose
 * start was cut away is dropped rather than moved, the same rule
 * `survivingWords` uses for the captions: it is not in the file, so it cannot
 * be in a chapter.
 *
 * Pure, and beside the timeline rather than in `shared/` because it depends
 * on `toProjectTime`, which is the editor's.
 */
import type { ShareTranscript } from "../../../shared/contract";
import type { Transcript } from "../../../shared/transcript";
import { sliceAt, toProjectTime, type PlacedSlice } from "./timeline";

const MS = 1_000_000;

export function transcriptForShare(
  transcript: Transcript | null,
  placed: readonly PlacedSlice[],
): ShareTranscript | null {
  if (!transcript) return null;

  const words: ShareTranscript["words"] = [];

  for (const word of transcript.words) {
    const at = toProjectTime(placed, word.at);
    if (at === null) continue;

    // A word that starts inside a kept clip and ends past the cut is kept,
    // ending where the clip does — that is where it stops being heard. Clamped
    // to the clip even when the word's end survives in a *later* clip, or the
    // word would be said to span the join.
    const clip = sliceAt(placed, at)!;
    const clipEnd = clip.timelineStart + clip.duration;
    const end = Math.min(toProjectTime(placed, word.end) ?? clipEnd, clipEnd);

    words.push({
      at: Math.round(at / MS),
      end: Math.round(Math.max(at, end) / MS),
      text: word.text,
    });
  }

  // Nothing survived the cut, which the API would take as a transcript of
  // silence. Null says what it is.
  if (words.length === 0) return null;

  return { language: transcript.language, words };
}
