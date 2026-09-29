import { useEffect, useMemo, useState } from "react";

import type { CleanTrack, EditorSession, TrackMedia } from "../../../shared/contract";
import type { MicDenoise } from "../../../shared/project";

/**
 * Playing the cleaned microphone instead of the recorded one.
 *
 * The cleaning itself is a file main writes once — see `main/voice.ts` and
 * `crates/prequel-voice`. What is left for the editor is choosing which file
 * the microphone *is*, and that choice is made here, once, for everything:
 * the preview's audio elements, the waveforms under the timeline and the
 * export all read `session.media`, so swapping the URL and the name there is
 * the whole of it.
 *
 * Deliberately not a node in the preview's audio graph. A denoiser cannot run
 * in WebAudio, so a preview that filtered and an export that did not would
 * disagree about what the take sounds like — and nobody would find out until
 * the file was written. Same rule as the geometry and the sound plan: decided
 * once, played by both.
 */
export interface CleanMic {
  /** The session to play, with every microphone track pointed at its clean file. */
  session: EditorSession;
  /** A pass is running. There is nothing to show but a spinner; it takes seconds. */
  working: boolean;
  /**
   * Why the last pass failed, or null.
   *
   * Surfaced rather than swallowed: the fallback is the *raw* microphone, which
   * sounds exactly like the setting having no effect.
   */
  error: string | null;
}

export function useCleanMic(session: EditorSession, level: MicDenoise): CleanMic {
  /** Clean files known to exist, keyed by `"<file>:<level>"`. */
  const [known, setKnown] = useState<ReadonlyMap<string, CleanTrack>>(new Map());
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every microphone file in the recording — one per take, so a recording
  // extended with a second take cleans both rather than whichever the first
  // lookup found.
  const micFiles = useMemo(
    () =>
      session.media
        .filter((track) => track.kind === "microphone")
        .map((track) => track.file)
        .join("\u0000"),
    [session.media],
  );

  useEffect(() => {
    if (level === "off") {
      setWorking(false);
      setError(null);
      return;
    }

    const files = micFiles.split("\u0000").filter(Boolean);
    if (files.length === 0) return;

    let live = true;
    setWorking(true);
    setError(null);

    void (async () => {
      const found = new Map<string, CleanTrack>();
      let failure: string | null = null;

      // One at a time. Each pass is a few seconds of one core, and asking for
      // four takes at once would make the first one — the only one anybody is
      // listening to yet — four times slower.
      for (const file of files) {
        const result = await window.prequel.editor.cleanMic(session.dir, file, level);
        if (!live) return;
        if (result.ok && result.value) found.set(cleanKey(file, level), result.value);
        else failure ??= result.ok ? "the cleaned track came back empty" : result.message;
      }

      if (!live) return;
      // Merged rather than replaced: switching from light to strong and back
      // should find the first file still there instead of remaking it.
      setKnown((last) => new Map([...last, ...found]));
      setError(failure);
      setWorking(false);
    })();

    return () => {
      live = false;
      setWorking(false);
    };
  }, [session.dir, micFiles, level]);

  const swapped = useMemo(() => played(session, known, level), [session, known, level]);

  return { session: swapped, working, error };
}

/** The key a clean file is remembered under: one per source file per level. */
export function cleanKey(file: string, level: MicDenoise): string {
  return `${file}:${level}`;
}

/**
 * The session as it should be played: microphone tracks pointed at their
 * cleaned files, where those exist.
 *
 * Pure, and the whole of what the setting does. A track with no cleaned file
 * yet is left exactly as it was rather than silenced or held back — the pass
 * takes seconds, and the raw microphone is the right thing to hear meanwhile.
 */
export function played(
  session: EditorSession,
  known: ReadonlyMap<string, CleanTrack>,
  level: MicDenoise,
): EditorSession {
  if (level === "off") return session;

  let changed = false;
  const media = session.media.map((track): TrackMedia => {
    if (track.kind !== "microphone") return track;
    const clean = known.get(cleanKey(track.file, level));
    if (!clean) return track;
    changed = true;
    // Only the two fields that say *which file*. The offset is the
    // microphone's late start on the session clock and belongs to the track,
    // not the file — and the cleaned file is the same length, sample for
    // sample, as the one it was made from.
    return { ...track, file: clean.file, url: clean.url };
  });

  // The same object while nothing has been swapped in. A new `session` on
  // every render would restart the preview's decoders, which key their element
  // map on it.
  return changed ? { ...session, media } : session;
}
