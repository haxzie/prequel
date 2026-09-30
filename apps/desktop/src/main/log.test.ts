/**
 * What reaches the log when one error is standing in for another.
 *
 * `api.ts` turns every network fault into a single `ApiError` — a dropped
 * connection, a DNS failure and a TLS record the far end would not verify all
 * arrive as "Couldn't reach Prequel. Check your connection." The one that
 * actually happened is on `cause`, and `error.stack` does not include it: a
 * share failed on a TLS error and the log said only that the connection might
 * be the problem, which is the least useful true thing it could have said.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const logs = mkdtempSync(join(tmpdir(), "prequel-log-"));
vi.mock("electron", () => ({
  app: {
    getPath: () => logs,
    getName: () => "Prequel",
    getVersion: () => "0.0.32",
    isPackaged: false,
  },
}));

const { initLogging, logPath } = await import("./log.js");

/**
 * What was written during this test, and nothing earlier.
 *
 * The log is append-only and every test in this file shares one, so reading the
 * whole thing would let one test's cause satisfy the next test's assertion —
 * and a test that passes on somebody else's output proves nothing.
 */
let mark = 0;
function written(): string {
  return readFileSync(logPath(), "utf8").slice(mark);
}

describe("the log", () => {
  // Once: `initLogging` wraps `console.warn` around whatever is already there,
  // so calling it per test would write each line as many times as tests had run.
  beforeAll(() => {
    initLogging();
  });

  beforeEach(() => {
    mark = readFileSync(logPath(), "utf8").length;
  });

  it("writes the cause of an error that is standing in for it", () => {
    const cause = new Error("SSLV3_ALERT_BAD_RECORD_MAC");
    console.warn("[share] the transcript did not upload:", new Error("Offline", { cause }));

    expect(written()).toContain("SSLV3_ALERT_BAD_RECORD_MAC");
  });

  it("still writes the error that was reported", () => {
    // The stand-in is the sentence somebody reads in the dialog, and losing it
    // to show the cause would only move the problem.
    console.warn("[share]", new Error("Couldn't reach Prequel.", { cause: new Error("EPROTO") }));

    const text = written();
    expect(text).toContain("Couldn't reach Prequel.");
    expect(text).toContain("EPROTO");
  });

  it("survives an error that causes itself", () => {
    // A wrapper that re-wraps its own cause would otherwise write until the
    // disk filled — the log is append-only and synchronous, so a cycle here is
    // not a slow test but a full volume.
    const loop = new Error("round");
    (loop as { cause?: unknown }).cause = loop;

    console.warn("[share]", loop);

    expect(written().match(/round/g)?.length).toBeLessThan(10);
  });

  it("writes an error with no cause exactly as before", () => {
    console.warn("[share]", new Error("plain"));

    expect(written()).toContain("plain");
    expect(written()).not.toContain("caused by");
  });
});
