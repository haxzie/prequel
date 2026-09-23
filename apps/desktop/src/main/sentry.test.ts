/**
 * What may leave the machine in a Sentry event.
 *
 * `redact` has its own tests in `errors.test.ts`; these are about the fields
 * only this file touches. A stack frame's `filename` is the one that matters:
 * it is the most path-shaped field in the payload, it is populated by the SDK
 * rather than by anything the app wrote, and it is nowhere near the message a
 * `beforeSend` is usually written to scrub.
 */
import type { ErrorEvent } from "@sentry/electron/main";
import { describe, expect, it, vi } from "vitest";

// Neither is exercised here — the SDK would pull in the real `electron`, which
// has no `app` outside a running Electron.
vi.mock("electron", () => ({
  app: { isPackaged: false, getName: () => "Prequel", getVersion: () => "0.0.0" },
}));
vi.mock("@sentry/electron/main", () => ({ init: vi.fn(), captureException: vi.fn() }));

const { scrub } = await import("./sentry.ts");

const HOME = "/Users/dana";

describe("scrubbing an event before it is sent", () => {
  it("takes the account name out of every stack frame", () => {
    const event = scrub({
      exception: {
        values: [
          {
            value: `ENOENT: no such file or directory, open '${HOME}/Movies/Prequel/take/screen.mp4'`,
            stacktrace: {
              frames: [
                { filename: `${HOME}/Applications/Prequel.app/out/main/index.js` },
                {
                  filename: "/Users/sam/build/renderer.js",
                  abs_path: "/Users/sam/build/renderer.js",
                },
              ],
            },
          },
        ],
      },
    } as unknown as ErrorEvent);

    const serialised = JSON.stringify(event);
    expect(serialised).not.toMatch(/dana|sam/);
    // Still says where, having stopped saying who.
    expect(serialised).toContain("Movies/Prequel");
  });

  it("drops the hostname, which on a Mac is usually a person's name", () => {
    const event = scrub({ server_name: "Danas-MacBook-Pro.local" } as unknown as ErrorEvent);
    expect(event.server_name).toBeUndefined();
  });

  it("leaves an event naming nobody alone", () => {
    const event = scrub({
      message: "the screen track would not open",
      exception: {
        values: [{ value: "DEMUXER_ERROR_COULD_NOT_OPEN", stacktrace: { frames: [] } }],
      },
    } as unknown as ErrorEvent);

    expect(event.message).toBe("the screen track would not open");
    expect(event.exception?.values?.[0]?.value).toBe("DEMUXER_ERROR_COULD_NOT_OPEN");
  });

  it("survives an event with no exception, message or frames", () => {
    // Sentry sends these: a transaction, a session update, a plain capture.
    expect(() => scrub({} as unknown as ErrorEvent)).not.toThrow();
  });
});
