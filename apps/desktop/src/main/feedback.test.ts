/**
 * What a bug report takes with it, and what it must not.
 *
 * Three failures, none of which shows up in the dialog. The log arrives with
 * `/Users/dana` in it, and an account name has left the Mac inside something
 * nobody read before pressing Send. The switch is off and a log goes anyway.
 * Or the log cannot be read and takes the report with it — losing the part
 * somebody actually wrote to the part that was attached for them.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp", getVersion: () => "0.0.32" },
}));

const apiFetch = vi.fn();
vi.mock("./api.js", async () => {
  const actual = await vi.importActual<typeof import("./api.js")>("./api.js");
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

let token: string | null = "a-token";
vi.mock("./auth.js", () => ({ authToken: () => token }));

vi.mock("./analytics.js", () => ({ track: () => undefined }));

let log = "";
vi.mock("./log.js", () => ({ logPath: () => log }));

const { sendFeedback } = await import("./feedback.js");

const dir = mkdtempSync(join(tmpdir(), "prequel-feedback-"));

/** Writes a log file and points `logPath` at it. */
function writeLog(contents: string): void {
  log = join(dir, "main.log");
  writeFileSync(log, contents);
}

/** The body of the one call that was made. */
function sentBody(): { message: string; version?: string; log?: string } {
  const [, init] = apiFetch.mock.calls[0] as [string, { body: string }];
  return JSON.parse(init.body) as { message: string; version?: string; log?: string };
}

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ ok: true });
  token = "a-token";
  writeLog("12:00 [info] session start\n");
});

describe("what goes with the report", () => {
  it("sends no log unless one was asked for", async () => {
    await sendFeedback("The blade cut in the wrong place");

    const body = sentBody();
    // Absent, not empty: the Worker's field is optional, and a key that is
    // always present says a log was considered and came back blank.
    expect(body.log).toBeUndefined();
    expect(body.message).toBe("The blade cut in the wrong place");
    expect(body.version).toBe("0.0.32");
  });

  it("takes the account name out of the log", async () => {
    writeLog("12:00 [error] could not open /Users/dana/Movies/Prequel/take.mp4\n");

    await sendFeedback("Export failed", true);

    // The path still says where in the library it was, which is the part worth
    // having. Who they are is not.
    expect(sentBody().log).toContain("/Users/~/Movies/Prequel/take.mp4");
    expect(sentBody().log).not.toContain("/Users/dana");
  });

  it("sends the end of a long log, and never half a line", async () => {
    // A hundred thousand bytes of lines, so the tail lands in the middle of one
    // — which is the only case where the window can be wrong in a way that
    // still looks like a log.
    const lines = Array.from({ length: 4_000 }, (_, i) => `12:00 [info] line ${String(i)}`);
    writeLog(`${lines.join("\n")}\n`);

    await sendFeedback("Something is broken", true);

    const tail = sentBody().log ?? "";
    expect(tail.length).toBeLessThanOrEqual(12_000);
    // The last line is there and the first is long gone: this is the end of the
    // log, which is where what just happened is written.
    expect(tail).toContain("line 3999");
    expect(tail).not.toContain("line 0\n");
    // Every line whole. A tail opening mid-timestamp reads as a corrupted log
    // rather than a windowed one.
    expect(tail.startsWith("12:00 [info] line ")).toBe(true);
  });

  it("still sends the report when the log cannot be read", async () => {
    log = join(dir, "does-not-exist.log");

    await sendFeedback("Something is broken", true);

    // The words are the part somebody wrote by hand. Losing them to a missing
    // file would be the attachment taking the report with it.
    expect(sentBody().message).toBe("Something is broken");
    expect(sentBody().log).toBeUndefined();
  });
});

describe("what it refuses before making a call", () => {
  it("refuses an empty report", async () => {
    await expect(sendFeedback("   ")).rejects.toThrow();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("refuses when nobody is signed in", async () => {
    token = null;

    await expect(sendFeedback("Something is broken")).rejects.toThrow();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
