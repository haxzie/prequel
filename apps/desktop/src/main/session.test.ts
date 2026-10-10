/**
 * What a stop that failed is allowed to report.
 *
 * A stop that throws is worth a report: the tracks were never finalised and the
 * editor is the next thing to find out, by failing to decode them. One cause is
 * not, and it is the one that fires most: a recording that received no frames is
 * stopped by `CaptureFlow.abandonEmptyRecording`, which has already reported
 * `capture.no_frames` and shown the user the permission dialog. The stop of that
 * recording then filed a second issue, at a higher priority, quoting
 * `AVAssetWriter` -11800 — the encoder being blamed for a stream that never
 * delivered anything.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Target } from "../shared/contract.js";

const SCRATCH = mkdtempSync(join(tmpdir(), "prequel-session-"));
process.env["PREQUEL_RECORDINGS_DIR"] = SCRATCH;

afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

vi.mock("electron", () => ({
  app: { getPath: () => SCRATCH },
  shell: { showItemInFolder: () => undefined },
}));

const reported: string[] = [];
vi.mock("./errors.js", () => ({
  reportError: (scope: string) => void reported.push(scope),
}));

const { createFakeRecorder } = await import("./recorder.fake.js");
const { setRecorder } = await import("./recorder.js");
const { RecordingSession } = await import("./session.js");

const TARGET: Target = {
  kind: "Display",
  id: 1,
  title: "Built-in Retina Display",
  appName: "",
  appPath: "",
  bounds: { x: 0, y: 0, width: 1512, height: 982 },
  scaleFactor: 2,
};

/** A session that has started and whose stop fails with `message`. */
async function stopFailingWith(message: string) {
  const fake = createFakeRecorder();
  setRecorder({
    ...fake,
    stopRecording: async () => {
      throw new Error(message);
    },
  });

  const session = new RecordingSession();
  await session.start({ target: TARGET });
  const result = await session.stop();
  return { session, result };
}

beforeEach(() => {
  reported.length = 0;
  setRecorder(null);
});

describe("a stop that fails", () => {
  it("reports the failure", async () => {
    const { session, result } = await stopFailingWith(
      "ENCODE: encoder: AVAssetWriter failed while writing: -11800",
    );

    expect(result).toBeNull();
    expect(reported).toEqual(["capture.stop"]);
    expect(session.snapshot().error?.code).toBe("ENCODE");
  });

  it("does not report a recording that had no frames", async () => {
    const { session, result } = await stopFailingWith(
      "NO_SCREEN_FRAMES: the capture delivered no frames, so there is no screen track",
    );

    // Still a failed stop, and still on the state the UI reads — only the
    // second report is gone.
    expect(result).toBeNull();
    expect(session.snapshot().error?.code).toBe("NO_SCREEN_FRAMES");
    expect(reported).toEqual([]);
  });
});
