/**
 * Reading a recording for things worth covering, and keeping what the user said.
 *
 * `useTranscription`'s shape — an `asked` ref so it runs once per recording, a
 * `dir` filter on a broadcast every window hears, and `ALREADY_SCANNING`
 * swallowed because the run it names is the one this window wanted.
 *
 * What is different is the merge. A transcript is replaced wholesale when it is
 * made again; covers cannot be, because by then somebody has turned some of
 * them off — and a rescan that put those back would be the app arguing with the
 * person using it, every open. So a second reading keeps what is already here
 * and adds only what is new. See `merged`.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { RedactProgress } from "../../../shared/contract";
import type { EditorSession } from "../../../shared/contract";
import type { MaskSlice, RedactGroup, RedactionState } from "../../../shared/project";
import type { EditorAction } from "./state";

export interface Redaction {
  /** `null` once nothing is happening. */
  stage: RedactProgress["stage"] | null;
  /** 0 to 1, or null for a stage with no measure. */
  progress: number | null;
  error: { code: string; message: string } | null;
  /** Reads the recording again, whatever it has been read for before. */
  rescan: () => void;
  cancel: () => void;
}

/**
 * What a second reading replaces, and what it leaves alone.
 *
 * It takes the place of every cover it was looking for, and keeps every
 * decision made about one.
 *
 * It used to keep the covers themselves — everything already on the project,
 * adding only a finding whose id was not there yet. That reads as the careful
 * choice and is the wrong one: the reader is the only thing that knows where
 * a cover goes, so a cover found by an older reader kept its geometry for
 * ever. A scan that followed a face ten times a second could not replace one
 * that followed it once, and pressing Scan again did nothing visible at all.
 * Which is exactly how it was reported — "it still happens", after the reading
 * had been fixed twice.
 *
 * So the geometry is the reading's and the decisions are the user's:
 *
 * - **`visible` survives**, by id and then by bucket. The rule the feature's
 *   credibility rests on: a cover arrives covering, so turning one off is
 *   somebody saying "that is my work, not a leak", and no reading may overrule
 *   it. The bucket is the fallback because an id carries the first moment with
 *   it, and a reader that samples more often finds the same thing a little
 *   earlier — a dismissal must not be lost to that.
 * - **The look survives** where the same cover is found again, so a restyled
 *   one is not dressed again in the panel's current setting.
 * - **A hand-drawn cover is never touched.** Its geometry is the user's, not a
 *   reading's, and no reading knows anything about it.
 * - **Only the groups that were read are replaced.** A reading asked for faces
 *   alone has nothing to say about the card number the last one found, and
 *   replacing that would be a leak introduced by looking for something else.
 */
export function merged(
  existing: readonly MaskSlice[],
  found: readonly MaskSlice[],
  look: { mode: MaskSlice["mode"]; strength: number },
  groups: readonly RedactGroup[],
): MaskSlice[] {
  const read = new Set(groups);
  const byId = new Map(existing.map((mask) => [mask.id, mask]));
  // Every bucket somebody has turned off, whatever id it had at the time.
  const hidden = new Set(existing.filter((mask) => !mask.visible).map((mask) => mask.bucket));

  const kept = existing.filter((mask) => mask.origin === "manual" || !read.has(mask.group));

  return [
    ...kept,
    ...found.map((mask) => {
      const before = byId.get(mask.id);
      return {
        ...mask,
        mode: before?.mode ?? look.mode,
        strength: before?.strength ?? look.strength,
        visible: before ? before.visible : !hidden.has(mask.bucket),
      };
    }),
  ];
}

export function useRedaction(
  session: EditorSession,
  redaction: RedactionState,
  dispatch: (action: EditorAction) => void,
): Redaction {
  const [stage, setStage] = useState<RedactProgress["stage"] | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  // Once per recording. Reset on the directory rather than on the session
  // object, which is replaced whenever anything about the recording is
  // refetched — a reset on that would read the whole take again every time.
  const asked = useRef(false);
  useEffect(() => {
    asked.current = false;
  }, [session.dir]);

  // Held in a ref and not a dependency: the broadcast handler needs the groups
  // as they are when it fires, and listing them as a dependency would tear the
  // subscription down and build it again every time a switch moved — losing the
  // reading in flight.
  const wanted = useRef(redaction);
  wanted.current = redaction;

  const run = useCallback(
    (groups: readonly RedactGroup[]) => {
      if (groups.length === 0) return;
      setError(null);
      setStage("preparing");
      void window.prequel.editor.redact
        .start(session.dir, groups, wanted.current.mode, wanted.current.strength)
        .then((answer) => {
          // The run it names is the one this window asked for, so there is
          // nothing to report and nothing to retry.
          if (!answer.ok && answer.code !== "ALREADY_SCANNING") {
            setStage("failed");
            setError({ code: answer.code ?? "FAILED", message: answer.message });
          }
        });
    },
    [session.dir],
  );

  useEffect(
    () =>
      window.prequel.editor.redact.onProgress((update) => {
        // Every window hears this. A second editor on another recording must
        // not take this one's bar.
        if (update.dir !== session.dir) return;

        setStage(update.stage);
        setProgress(update.progress);
        setError(update.error);

        if (update.stage !== "done") return;

        dispatch({
          type: "setMasks",
          masks: merged(
            session.project.masks,
            update.masks ?? [],
            {
              mode: update.mode ?? wanted.current.mode,
              strength: update.strength ?? wanted.current.strength,
            },
            // What this reading was asked to look for, echoed back, rather than
            // what the panel has switched on now: the two differ the moment
            // anybody touches a group while a reading is in flight, and the
            // merge would then replace covers this reading never looked for.
            update.groups ?? wanted.current.groups,
          ),
        });
      }),
    // `session.project.masks` is read inside and deliberately not a dependency:
    // the merge wants the list as it is when the reading lands, and a
    // subscription rebuilt on every edit to a cover would drop the reading that
    // is producing them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.dir, dispatch],
  );

  // Automatically, once, on a recording that has never been read.
  //
  // `scanned` rather than `masks.length`, and persisted rather than derived:
  // "read it and found nothing" and "never read it" are different answers, and
  // only one of them should start a minute of work on arriving. It is also what
  // stops a recording whose every cover was turned off from being read again.
  useEffect(() => {
    if (asked.current || redaction.scanned) return;
    asked.current = true;
    run(redaction.groups);
  }, [redaction.scanned, redaction.groups, run]);

  const rescan = useCallback(() => {
    asked.current = true;
    run(wanted.current.groups);
  }, [run]);

  const cancel = useCallback(() => {
    void window.prequel.editor.redact.cancel();
  }, []);

  return {
    stage: stage === "done" ? null : stage,
    progress,
    error,
    rescan,
    cancel,
  };
}
