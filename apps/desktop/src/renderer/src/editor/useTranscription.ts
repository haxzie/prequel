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
import type { Transcript } from "../../../shared/transcript";
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
   * Transcribes a recording with a microphone the first time it is opened.
   *
   * Automatic rather than a button, because there is nothing to decide: it runs
   * on this machine, it costs nothing, and a button that everyone presses every
   * time is a step in the way of the thing they came for.
   *
   * Once per session and only when there is no transcript already — the file on
   * disk is the record of it having run, so reopening a captioned recording
   * does not transcribe it again. A failure is not retried automatically
   * either; reopening the recording is what asks for that.
   */
  const asked = useRef(false);

  useEffect(() => {
    asked.current = false;
  }, [session.dir]);

  useEffect(() => {
    if (asked.current || session.transcript) return;
    if (!session.media.some((track) => track.kind === "microphone")) return;

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
    ready: transcript !== null,
    stage,
    progress,
    error,
  };
}
