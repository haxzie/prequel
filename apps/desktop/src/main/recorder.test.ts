import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { createFakeRecorder } from "./recorder.fake.js";
import { describeRecorderError, getRecorder, RecorderErrorCode, setRecorder } from "./recorder.js";
import { newRecordingPath, RecordingSession } from "./session.js";

// Never write into the user's real ~/Movies/Prequel from a test run.
const SCRATCH = mkdtempSync(join(tmpdir(), "prequel-test-"));

afterEach(() => setRecorder(null));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

describe("describeRecorderError", () => {
  it("splits a native error into code and message", () => {
    const error = new Error("SCREEN_ACCESS_DENIED: grant Prequel access in System Settings");

    expect(describeRecorderError(error)).toEqual({
      code: RecorderErrorCode.ScreenAccessDenied,
      message: "grant Prequel access in System Settings",
    });
  });

  it("does not strip a prefix it does not recognise", () => {
    // Colons are common in prose; only known codes may be treated as one.
    expect(describeRecorderError(new Error("Error: something went wrong"))).toEqual({
      code: null,
      message: "Error: something went wrong",
    });
  });

  it("handles messages with no separator and non-Error values", () => {
    expect(describeRecorderError(new Error("boom"))).toEqual({ code: null, message: "boom" });
    expect(describeRecorderError("TIMEOUT: gave up")).toEqual({
      code: RecorderErrorCode.Timeout,
      message: "gave up",
    });
  });
});

describe("getRecorder", () => {
  it("returns the injected recorder without loading the native addon", async () => {
    const fake = createFakeRecorder();
    setRecorder(fake);
    await expect(getRecorder()).resolves.toBe(fake);
  });
});

describe("newRecordingPath", () => {
  it("produces a session directory name safe for shells and Finder", () => {
    const path = newRecordingPath(new Date("2026-08-10T21:30:05.123Z"), SCRATCH);
    const name = path.split("/").pop()!;

    // A directory, not a file: a session is several tracks kept together.
    expect(name).toMatch(/^Prequel [\d-]+ [\d-]+$/);
    expect(name).not.toContain(":");
    expect(name).not.toContain(".123");
  });

  it("does not collide across seconds", () => {
    const a = newRecordingPath(new Date("2026-08-10T21:30:05Z"), SCRATCH);
    const b = newRecordingPath(new Date("2026-08-10T21:30:06Z"), SCRATCH);
    expect(a).not.toEqual(b);
  });
});

describe("RecordingSession", () => {
  function session() {
    const recorder = createFakeRecorder();
    return { recorder, session: new RecordingSession(async () => recorder) };
  }

  const target = {
    kind: "Display" as const,
    id: 1,
    title: "Display",
    appName: "",
    appPath: "",
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    scaleFactor: 2,
  };

  it("walks idle → recording → idle", async () => {
    const { session: s } = session();
    expect(s.snapshot().status).toBe("idle");

    await s.start({ target });
    expect(s.snapshot().status).toBe("recording");
    expect(s.snapshot().target).toEqual(target);
    expect(s.isBusy()).toBe(true);

    const result = await s.stop();
    expect(result).not.toBeNull();
    expect(s.snapshot().status).toBe("idle");
    expect(s.snapshot().target).toBeNull();
  });

  it("records where the file went so the UI can reveal it", async () => {
    const { session: s } = session();
    await s.start({ target });
    const outputPath = s.snapshot().outputPath;
    await s.stop();

    expect(outputPath).toBeTruthy();
    expect(s.snapshot().lastResult?.outputPath).toBe(outputPath);
  });

  it("ignores a second start instead of stacking recordings", async () => {
    const { session: s } = session();
    await s.start({ target });
    // Must not throw ALREADY_RECORDING at the user for a double-click.
    await s.start({ target });
    expect(s.snapshot().status).toBe("recording");
  });

  it("toggles pause and back", async () => {
    const { session: s } = session();
    await s.start({ target });

    await s.togglePause();
    expect(s.snapshot().status).toBe("paused");
    await s.togglePause();
    expect(s.snapshot().status).toBe("recording");
  });

  it("stops cleanly from paused", async () => {
    const { session: s } = session();
    await s.start({ target });
    await s.pause();
    await s.stop();
    expect(s.snapshot().status).toBe("idle");
  });

  it("does nothing when told to stop or pause while idle", async () => {
    const { session: s } = session();
    await expect(s.stop()).resolves.toBeNull();
    await expect(s.togglePause()).resolves.toBeUndefined();
    expect(s.snapshot().status).toBe("idle");
  });

  it("returns to idle when starting fails, rather than looking armed", async () => {
    const recorder = createFakeRecorder();
    recorder.startRecording = async () => {
      throw new Error("SCREEN_ACCESS_DENIED: nope");
    };
    const s = new RecordingSession(async () => recorder);

    await expect(s.start({ target })).rejects.toThrow(/SCREEN_ACCESS_DENIED/);

    const state = s.snapshot();
    expect(state.status).toBe("idle");
    expect(state.target).toBeNull();
    expect(state.error?.code).toBe(RecorderErrorCode.ScreenAccessDenied);
  });

  it("excludes paused time from the elapsed clock", async () => {
    vi.useFakeTimers();
    try {
      const { session: s } = session();
      await s.start({ target });

      vi.advanceTimersByTime(1000);
      await s.pause();
      vi.advanceTimersByTime(5000); // paused: must not count
      await s.resume();
      vi.advanceTimersByTime(1000);

      // 7s of wall clock, 5s paused → 2s of media.
      expect(s.snapshot().elapsedMs).toBe(2000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("notifies subscribers on every transition", async () => {
    const { session: s } = session();
    const seen: string[] = [];
    const unsubscribe = s.subscribe((state) => seen.push(state.status));

    await s.start({ target });
    await s.pause();
    await s.resume();
    await s.stop();
    unsubscribe();

    expect(seen).toEqual([
      "idle",
      "starting",
      "recording",
      "paused",
      "recording",
      "stopping",
      "idle",
    ]);
  });

  it("stops notifying after unsubscribe", async () => {
    const { session: s } = session();
    const seen: string[] = [];
    s.subscribe((state) => seen.push(state.status))();

    await s.start({ target });
    expect(seen).toEqual(["idle"]);
  });
});
