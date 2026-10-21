/**
 * The peaks each music file draws on its bar.
 *
 * `useWaveforms`' twin, and deliberately not the same hook. That one merges
 * the recording's tracks onto one session-time shape, because every clip reads
 * its own span out of it; a music file has nothing to do with the session's
 * clock — a bed shows the stretch of the *file* between its offset and its end
 * — so the peaks are kept per file, indexed from each file's own zero.
 *
 * Asked of main, which has Rust stream the file through AVFoundation and
 * caches a `.peaks` sidecar beside it. The renderer decoding audio itself is
 * what used to kill the editor on a long take — see `main/peaks.ts`.
 */
import { useEffect, useState } from "react";

import type { MusicFile } from "../../../shared/music";
import { bucketCount, normalisedRange } from "./waveform";

/**
 * Peaks by file name, for whichever files have answered.
 *
 * A map that fills in rather than one answer at the end: a bed laid while
 * another file is still being read draws its bar immediately and its wave a
 * moment later, which is the same bargain the filmstrip makes.
 */
export function useMusicPeaks(
  dir: string,
  files: readonly MusicFile[],
): ReadonlyMap<string, Float32Array> {
  const [peaks, setPeaks] = useState<ReadonlyMap<string, Float32Array>>(new Map());

  // Keyed on what decides the answer and nothing else. `files` is a fresh array
  // on every render of the editor, and an effect keyed on the array itself
  // would ask main for every file again on each one. A file's name cannot
  // change without its bytes changing too — they are content-addressed — so
  // the names and lengths together are the key.
  const key = files.map((file) => `${file.file}\t${String(file.duration)}`).join("\n");

  useEffect(() => {
    if (key === "") {
      setPeaks(new Map());
      return;
    }

    // The editor can be closed, or a different recording opened into the same
    // window, while a long song is still being read.
    let live = true;

    void (async () => {
      for (const line of key.split("\n")) {
        const [file, duration] = line.split("\t") as [string, string];
        const result = await window.prequel.editor.peaks(dir, file);
        if (!live) return;

        // A file that cannot be read is not worth failing the row over — the
        // bar simply draws without a wave, which is what it does while the
        // peaks are still being made.
        if (!result.ok) {
          console.warn(`[waveform] no peaks for ${file}: ${result.message}`);
          continue;
        }

        // Stretched between what is quiet and what is loud in this file, not
        // divided by its loudest moment: a mastered track drawn that way is a
        // flat slab, because that is what mastering does — see
        // `normalisedRange`.
        const shape = normalisedRange(result.value, bucketCount(Number(duration)));
        setPeaks((held) => new Map(held).set(file, shape));
      }
    })();

    return () => {
      live = false;
    };
  }, [dir, key]);

  return peaks;
}
