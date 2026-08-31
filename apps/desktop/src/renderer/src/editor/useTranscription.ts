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
import { useEffect, useState } from "react";

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
    onTranscribe: () => {
      // Cleared here rather than on the first progress event: the button has
      // already changed under the pointer, and leaving the last failure under
      // it reads as the new run having failed instantly.
      setError(null);
      setStage("preparing");
      void window.prequel.editor.transcribe.start(session.dir).then((result) => {
        if (result.ok) return;
        setStage("failed");
        setError(result.message ?? "Captions could not be generated.");
      });
    },
    onCancel: () => {
      void window.prequel.editor.transcribe.cancel();
    },
  };
}
