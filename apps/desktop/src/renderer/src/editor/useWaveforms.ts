/**
 * The peaks the timeline draws, for the whole recording.
 *
 * Asked of main, which has Rust stream each file through AVFoundation — see
 * `main/peaks.ts` for why the renderer no longer decodes audio itself. What
 * comes back per track is raw amplitude; this merges the tracks into the one
 * shape every clip reads its own span out of. Doing it per clip would ask for
 * the same files again on every cut.
 */
import { useEffect, useState } from "react";

import type { TrackMedia } from "../../../shared/contract";
import type { MediaTime } from "../../../shared/manifest";
import { bucketCount, mergePeaks, normalised, placeOnSession } from "./waveform";

const AUDIO_KINDS = new Set(["microphone", "system_audio"]);

/**
 * Peaks for the whole recording, or null until they are ready.
 *
 * Null rather than an empty array while loading, so a clip can tell "no audio
 * in this recording" from "not ready yet" and skip drawing a flat line that
 * would then be replaced.
 */
export function useWaveforms(
  dir: string,
  media: TrackMedia[],
  duration: MediaTime,
): Float32Array | null {
  const [peaks, setPeaks] = useState<Float32Array | null>(null);

  // Keyed on what decides the answer and nothing else. `media` is a fresh
  // array on every render of the editor — the cleaned microphone swaps in by
  // rebuilding it — and an effect keyed on the array itself asked main for
  // every track again each time. A file's offset and length cannot change
  // without its name changing too, so the three fields together are the key.
  const key = media
    .filter((track) => AUDIO_KINDS.has(track.kind))
    .map((track) => `${track.file}\t${String(track.offset)}\t${String(track.duration)}`)
    .join("\n");

  useEffect(() => {
    if (key === "" || duration <= 0) {
      setPeaks(new Float32Array(0));
      return;
    }

    // The editor can be closed, or a different recording opened into the same
    // window, while a long take is still being read.
    let live = true;
    const total = bucketCount(duration);
    const tracks = key.split("\n").map((line) => {
      const [file, offset, length] = line.split("\t") as [string, string, string];
      return { file, offset: Number(offset), duration: Number(length) };
    });

    void (async () => {
      const placed: Float32Array[] = [];

      // One at a time, not all at once. Main reads each file in constant
      // memory, but three decoders over three hour-long files is still three
      // cores for nothing — the editor is already playing the first second.
      for (const track of tracks) {
        const result = await window.prequel.editor.peaks(dir, track.file);
        if (!live) return;

        // A missing or unreadable track is not worth failing the timeline
        // over — the clip simply draws without that track's contribution,
        // the same thing it does for a recording that had no microphone.
        if (!result.ok) {
          console.warn(`[waveform] no peaks for ${track.file}: ${result.message}`);
          continue;
        }

        placed.push(
          placeOnSession(
            normalised(result.value, bucketCount(track.duration)),
            track.offset,
            total,
          ),
        );
      }

      if (live) setPeaks(mergePeaks(placed));
    })();

    return () => {
      live = false;
    };
  }, [dir, key, duration]);

  return peaks;
}
