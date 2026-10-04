/**
 * Reading a recording for things somebody would rather not publish.
 *
 * The transcription's shape, for the transcription's reasons — see
 * `main/transcribe/index.ts`. One run at a time, process-wide; progress and
 * completion on one channel, with completion as a terminal stage rather than a
 * resolved promise, so there is no race between "done" and the tick before it.
 *
 * What is different is what comes back. A transcript is written beside the
 * recording because it is large, derived and regenerable; the covers go into
 * `project.json` instead, through the editor's own reducer. They are *edits* —
 * each one can be turned off, restyled or dragged — and an edit that lived in a
 * derived file would be lost the moment the recording was read again. The
 * reader's own output is not kept at all: everything it found that survives is
 * a mask, and everything that did not was not worth covering.
 */
import { basename, join } from "node:path";

import { IPC_CHANNELS, type RedactProgress } from "../../shared/contract.js";
import { findTrack, isStill, parseManifest, MANIFEST_FILE_NAME } from "../../shared/manifest.js";
import type { MaskSlice, RedactGroup } from "../../shared/project.js";
import { toEveryWindow } from "../broadcast.js";
import { log } from "../log.js";
import { getRecorder, type ScanUpdate } from "../recorder.js";
import { readFileSync } from "node:fs";

/**
 * The scan currently running, if any.
 *
 * Module-level and so process-wide, matching the transcription: two runs over
 * one recording would both write its masks and the loser would overwrite the
 * winner.
 */
let running: string | null = null;

/** Which groups a `prequel-sensitive` category belongs to. */
const GROUP_OF: Record<string, RedactGroup> = {
  email: "contact",
  phone: "contact",
  url: "contact",
  card: "financial",
  iban: "financial",
  national_id: "financial",
  secret: "credential",
  face: "people",
};

/** One finding, as the addon serialises a `Track`. */
export interface Finding {
  category: string;
  label: string;
  preview: string;
  bucket: number;
  confidence: number;
  covered: boolean;
  uncertain: boolean;
  keys: { at: number; x: number; y: number; width: number; height: number; lost?: boolean }[];
}

export class RedactError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Reads `dir`'s screen track and answers with the covers to put on it.
 *
 * Answers rather than writes. The project belongs to the renderer — editor
 * state lives there, as `AGENTS.md` has it — so this hands back a list and the
 * reducer decides what to do with it. Which is also what lets a rescan keep
 * what the user has already turned off: only the renderer knows that.
 */
export async function startRedact(
  dir: string,
  groups: readonly RedactGroup[],
  mode: "blur" | "pixelate",
  strength: number,
): Promise<void> {
  if (running !== null) {
    throw new RedactError("ALREADY_SCANNING", "a recording is already being read");
  }

  const manifest = parseManifest(readFileSync(join(dir, MANIFEST_FILE_NAME), "utf8"));
  if (!manifest) throw new RedactError("FAILED", "this recording has no manifest");
  if (isStill(manifest)) {
    throw new RedactError(
      "UNSUPPORTED",
      "a screenshot is covered with the mask tool rather than by reading it",
    );
  }

  const segments = findTrack(manifest, "screen")?.segments ?? [];
  if (segments.length === 0) {
    throw new RedactError("FAILED", "this recording has no screen track");
  }

  running = dir;
  broadcast({ dir, stage: "preparing", progress: null, error: null });

  try {
    const recorder = await getRecorder();
    const update = await new Promise<ScanUpdate>((done, failed) => {
      let settled = false;

      recorder.startScan(
        {
          segments: segments.map((segment) => ({
            path: join(dir, segment.file_name),
            name: segment.file_name,
            // The file is zero-based and this is where its zero sits on the
            // session clock. Applied once, inside the Rust loop.
            start: segment.start,
            end: segment.end,
          })),
          intervalMs: undefined,
          langs: [],
          // A fresh salt per scan. It only has to be stable *within* one set of
          // findings — a mask carries its bucket, and a later scan compares
          // against that bucket rather than recomputing it.
          salt: String(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)),
          text: groups.some((group) => group !== "people"),
          faces: groups.includes("people"),
        },
        (error, answer) => {
          if (settled) return;
          if (error) {
            settled = true;
            failed(error);
            return;
          }
          if (answer.stage === "scanning") {
            broadcast({ dir, stage: "scanning", progress: answer.progress ?? null, error: null });
            return;
          }
          if (answer.stage === "preparing") return;

          settled = true;
          done(answer);
        },
      );
    });

    if (update.stage === "failed") {
      throw new RedactError(update.code ?? "FAILED", update.message ?? "the scan failed");
    }
    if (update.stage === "cancelled") {
      throw new RedactError("CANCELLED", "the scan was cancelled");
    }

    const masks = covers(JSON.parse(update.findings ?? "[]") as Finding[], groups);
    log("info", `read ${basename(dir)} and found ${String(masks.length)} thing(s) to cover`);

    broadcast({ dir, stage: "done", progress: 1, error: null, masks, mode, strength });
  } catch (cause) {
    const error =
      cause instanceof RedactError
        ? { code: cause.code, message: cause.message }
        : { code: "FAILED", message: cause instanceof Error ? cause.message : String(cause) };

    console.warn(`[redact] ${basename(dir)}: ${error.message}`);
    broadcast({ dir, stage: "failed", progress: null, error });
  } finally {
    running = null;
  }
}

export function cancelRedact(): void {
  if (running === null) return;
  void getRecorder().then((recorder) => {
    recorder.cancelScan();
  });
}

/**
 * The findings that are worth a cover, as covers.
 *
 * Two filters. A group the user did not ask for is dropped even though the
 * reader was told not to look for it, because `text` is one switch for three
 * groups — asking for cards alone still reads every address on the screen, and
 * the alternative is three passes over the same frames.
 *
 * And a finding the reader is not sure of is dropped rather than added turned
 * off. A list of twenty grey rows nobody asked about is how a panel stops being
 * read, and the threshold is Rust's to decide — see `covered`.
 */
export function covers(findings: readonly Finding[], groups: readonly RedactGroup[]): MaskSlice[] {
  return findings
    .filter((finding) => finding.covered)
    .map((finding): MaskSlice | null => {
      const group = GROUP_OF[finding.category];
      if (!group || !groups.includes(group)) return null;

      const keys = finding.keys.map((key) => ({
        at: key.at,
        x: key.x,
        y: key.y,
        width: key.width,
        height: key.height,
      }));
      if (keys.length === 0) return null;

      return {
        // From the bucket and the first moment, so a rescan that finds the same
        // thing in the same place produces the same id — which is what lets the
        // renderer tell "already seen" from "new" without storing a second list.
        id: `m${finding.bucket.toString(36)}-${keys[0]!.at.toString(36)}`,
        origin: "auto",
        group,
        label: finding.label,
        preview: finding.preview,
        bucket: finding.bucket,
        source: { start: keys[0]!.at, end: keys[keys.length - 1]!.at },
        mode: "blur",
        strength: 0.6,
        visible: true,
        keys,
      };
    })
    .filter((mask): mask is MaskSlice => mask !== null);
}

function broadcast(progress: RedactProgress): void {
  toEveryWindow(IPC_CHANNELS.redactProgress, progress);
}
