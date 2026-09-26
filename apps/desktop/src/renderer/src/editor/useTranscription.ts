/**
 * Making a transcript, and following how it is going.
 *
 * The first thing in the app to call `window.prequel.editor.transcribe` at all:
 * main has run this job since captions were first sketched, but nothing has
 * ever asked it to.
 *
 * Progress arrives as a broadcast rather than as the resolution of `start`, so
 * an editor reopened part way through a long take picks the job up where it is
 * instead of waiting on a promise it never made. That also means the finished
 * transcript comes in on the terminal event, which is why it is held here
 * rather than read back off the session.
 */
import { useEffect, useRef, useState } from "react";

import type { EditorSession } from "../../../shared/contract";
import { untranscribed, type Transcript } from "../../../shared/transcript";
import type { CaptionsState } from "./Inspector";

/** The transcript in force, and everything the captions panel shows about it. */
export interface Transcription extends CaptionsState {
  transcript: Transcript | null;
}

export function useTranscription(session: EditorSession): Transcription {
  // Seeded from disk, then replaced by whatever a run produces. Both are the
  // same thing to everything downstream.
  const [transcript, setTranscript] = useState<Transcript | null>(session.transcript);
  const [stage, setStage] = useState<CaptionsState["stage"]>("idle");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTranscript(session.transcript);
    setStage("idle");
    setProgress(null);
    setError(null);
  }, [session]);

  /**
   * Transcribes whatever has not been transcribed yet, the first time the
   * recording is opened.
   *
   * Automatic rather than a button, because there is nothing to decide: it runs
   * on this machine, it costs nothing, and a button that everyone presses every
   * time is a step in the way of the thing they came for.
   *
   * Once per session, and asked of the transcript rather than of its existence:
   * a clip imported into a recording that was captioned months ago is footage
   * nothing has listened to, and "there is a transcript" would call that done.
   * The answer comes from `untranscribed`, which main asks the same way. A
   * failure is not retried automatically; reopening the recording is what asks
   * for that.
   */
  const asked = useRef(false);

  useEffect(() => {
    asked.current = false;
  }, [session.dir]);

  useEffect(() => {
    if (asked.current) return;
    if (untranscribed(session.manifest, session.transcript).length === 0) return;

    asked.current = true;
    setStage("preparing");
    void window.prequel.editor.transcribe.start(session.dir).then((result) => {
      if (result.ok) return;
      // `ALREADY_TRANSCRIBING` is not a failure to report: another window on
      // the same recording got there first, and its progress is broadcast to
      // this one anyway.
      if (result.code === "ALREADY_TRANSCRIBING") return;
      setStage("failed");
      setError(result.message ?? "Captions could not be generated.");
    });
  }, [session]);

  useEffect(() => {
    return window.prequel.editor.transcribe.onProgress((update) => {
      // Broadcast to every window, so a second editor open on another recording
      // would otherwise show this one's progress.
      if (update.dir !== session.dir) return;

      setProgress(update.progress ?? null);

      switch (update.stage) {
        case "preparing":
        case "transcribing":
          setStage(update.stage);
          setError(null);
          break;
        case "done":
          setStage("idle");
          setProgress(null);
          if (update.transcript) setTranscript(update.transcript);
          break;
        case "cancelled":
          setStage("idle");
          setProgress(null);
          break;
        case "failed":
          setStage("failed");
          setProgress(null);
          setError(update.error?.message ?? "Captions could not be generated.");
          break;
      }
    });
  }, [session.dir]);

  return {
    transcript,
    // Words, not a file. A recording where every source turned out to be silent
    // now gets a transcript of its own — that is what stops it being offered for
    // transcription again on every open — and there is still nothing to caption
    // with, so the switch stays off and the panel still says so.
    ready: (transcript?.words.length ?? 0) > 0,
    stage,
    progress,
    error,
  };
}
