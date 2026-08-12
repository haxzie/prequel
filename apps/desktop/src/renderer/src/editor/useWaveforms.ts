/**
 * Decoding a recording's audio into something the timeline can draw.
 *
 * Runs once per session and produces one merged peak array covering the whole
 * recording, which every clip then reads its own span out of. Doing it per clip
 * would decode the same files again on every cut.
 */
import { useEffect, useState } from "react";

import type { TrackMedia } from "../../../shared/contract";
import type { MediaTime } from "../../../shared/manifest";
import { bucketCount, mergePeaks, peaksFrom, placeOnSession } from "./waveform";

/**
 * What the decode resamples to.
 *
 * `decodeAudioData` resamples to its context's rate, and the peaks only need
 * enough resolution to find the loudest sample in a 50ms bucket — 8 kHz leaves
 * 400 samples per bucket, which is far more than the shape needs. Decoding at
 * the file's own 48 kHz would spend around 230MB of `Float32Array` on a
 * ten-minute take to produce exactly the same picture.
 *
 * 8000 is also the floor Chromium accepts for a context rate; asking for less
 * throws rather than clamping.
 */
const DECODE_RATE = 8000;

const AUDIO_KINDS = new Set(["microphone", "system_audio"]);

/**
 * Peaks for the whole recording, or null until they are ready.
 *
 * Null rather than an empty array while decoding, so a clip can tell "no audio
 * in this recording" from "not decoded yet" and skip drawing a flat line that
 * would then be replaced.
 */
export function useWaveforms(media: TrackMedia[], duration: MediaTime): Float32Array | null {
  const [peaks, setPeaks] = useState<Float32Array | null>(null);

  // Keyed on the URLs rather than the array: `media` is a fresh array on every
  // render of the editor, and depending on it directly would decode the whole
  // recording again each time.
  const key = media
    .filter((track) => AUDIO_KINDS.has(track.kind))
    .map((track) => track.url)
    .join("\n");

  useEffect(() => {
    const urls = key === "" ? [] : key.split("\n");
    if (urls.length === 0 || duration <= 0) {
      setPeaks(new Float32Array(0));
      return;
    }

    // The editor can be closed, or a different recording opened into the same
    // window, while a long take is still decoding.
    let live = true;
    const total = bucketCount(duration);

    void Promise.all(
      urls.map(async (url) => {
        const track = media.find((candidate) => candidate.url === url)!;
        const samples = await decode(url);
        if (samples === null) return new Float32Array(0);

        return placeOnSession(peaksFrom(samples, bucketCount(track.duration)), track.offset, total);
      }),
    ).then((tracks) => {
      if (live) setPeaks(mergePeaks(tracks));
    });

    return () => {
      live = false;
    };
    // Deliberately not depending on `media` itself: it is a fresh array each
    // render, and its offsets cannot change without one of the URLs changing
    // too — a different recording is a different set of URLs.
  }, [key, media, duration]);

  return peaks;
}

/**
 * Mono samples for one audio file, or null if it cannot be decoded.
 *
 * A missing or unreadable track is not worth failing the timeline over — the
 * clip simply draws without that track's contribution, which is the same thing
 * it does for a recording that had no microphone.
 */
async function decode(url: string): Promise<Float32Array | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const encoded = await response.arrayBuffer();
    if (encoded.byteLength === 0) return null;

    // `length` has to be at least 1 even though nothing is ever rendered
    // through this context: it exists only to give `decodeAudioData` a rate to
    // resample to.
    const context = new OfflineAudioContext(1, 1, DECODE_RATE);
    const buffer = await context.decodeAudioData(encoded);

    return buffer.getChannelData(0);
  } catch {
    return null;
  }
}
