/**
 * An error report must not carry the user with it, and must not become the
 * failure it is reporting.
 *
 * The properties on these events are the one place a file path arrives without
 * anybody choosing to send one: every `ENOENT` quotes the path it could not
 * open, and in a packaged build that path opens with the user's home directory.
 * `track`'s own rule is that a property is a shape or an outcome and never a
 * path, so these are the tests that keep this file from being the exception.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Electron's own events, captured rather than ignored.
 *
 * The two process-gone handlers decide whether a failure is reported at all,
 * and that decision is only reachable through `app.on` — so the mock keeps the
 * handlers instead of dropping them, and the tests at the bottom of this file
 * fire them with the words Electron actually passes.
 */
const handlers = new Map<string, (...args: unknown[]) => void>();
vi.mock("electron", () => ({
  app: {
    on: (event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
    },
  },
}));

const sent: { event: string; properties?: Record<string, unknown> }[] = [];
vi.mock("./analytics.js", () => ({
  track: (event: string, properties?: Record<string, unknown>) => {
    sent.push({ event, properties });
  },
}));

/**
 * A fresh module per test.
 *
 * The session cap and the set of failures already reported are module state, so
 * one import shared across this file lets an earlier test spend the budget and
 * silently disarm a later one: "takes something that is not an Error" used to
 * run with the cap already full, return at the guard, and pass without ever
 * reaching the line it exists to check. `vi.resetModules()` alone does not do
 * it — the binding has to be taken again after the reset.
 */
let redact: (text: string) => string;
let reportError: (scope: string, cause: unknown, extra?: Record<string, unknown>) => void;
let watchForErrors: () => void;

beforeEach(async () => {
  sent.length = 0;
  handlers.clear();
  vi.resetModules();
  ({ redact, reportError, watchForErrors } = await import("./errors.js"));
});

/**
 * Installs the listeners and hands back the two this file tests.
 *
 * `watchForErrors` also installs on `process`, and those must not outlive the
 * test — vitest has its own `uncaughtException` handling, and a stray listener
 * calling into a reset module is a failure attributed to whatever ran next. So
 * anything this adds to `process` comes straight back off; only Electron's are
 * kept, and they live in the mock.
 */
function watching(): {
  renderer: (details: { reason: string; exitCode: number }) => void;
  child: (details: { type: string; reason: string; exitCode: number }) => void;
} {
  const had = {
    uncaught: process.listeners("uncaughtException"),
    rejection: process.listeners("unhandledRejection"),
  };

  watchForErrors();

  for (const listener of process.listeners("uncaughtException")) {
    if (!had.uncaught.includes(listener)) process.off("uncaughtException", listener);
  }
  for (const listener of process.listeners("unhandledRejection")) {
    if (!had.rejection.includes(listener)) process.off("unhandledRejection", listener);
  }

  return {
    // The signatures Electron calls these with: the renderer's carries the
    // `webContents` the tests have no use for, and the child's does not.
    renderer: (details) => handlers.get("render-process-gone")?.({}, {}, details),
    child: (details) => handlers.get("child-process-gone")?.({}, details),
  };
}

describe("redact", () => {
  it("takes the account name out of a path", () => {
    expect(redact("open '/Users/dana/Movies/Prequel/take'")).toBe(
      "open '/Users/~/Movies/Prequel/take'",
    );
  });

  it("keeps the part of the path that says where, not who", () => {
    // The library the failure happened in is worth knowing. Whose it was is not.
    expect(redact("/Users/dana/Movies/Prequel/.recordings")).toContain("Movies/Prequel");
  });

  it("leaves a path that names nobody alone", () => {
    expect(redact("/Applications/Prequel.app/Contents/MacOS/Prequel")).toBe(
      "/Applications/Prequel.app/Contents/MacOS/Prequel",
    );
  });

  it("redacts every path in a stack, not just the first", () => {
    const stack = "at a (/Users/dana/one.js:1)\nat b (/Users/sam/two.js:2)";
    expect(redact(stack)).not.toMatch(/dana|sam/);
  });
});

describe("reportError", () => {
  it("sends the shape of the failure", () => {
    reportError("export", new TypeError("could not open the file"), { format: "mp4" });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.event).toBe("app_error");
    expect(sent[0]?.properties).toMatchObject({
      scope: "export",
      name: "TypeError",
      message: "could not open the file",
      format: "mp4",
    });
  });

  it("redacts the message and the stack", () => {
    const error = new Error("ENOENT, open '/Users/dana/Movies/Prequel/take/session.json'");
    error.stack = `Error: ${error.message}\n    at read (/Users/dana/app.js:1:1)`;

    reportError("main", error);

    expect(JSON.stringify(sent[0]?.properties)).not.toContain("dana");
  });

  it("reports one failure once, however often it happens", () => {
    // A retry loop failing the same way forty times is one fact. Sending it
    // forty times would spend the session's budget on a single bug.
    for (let attempt = 0; attempt < 40; attempt += 1) {
      reportError("share.upload", new Error("the network went away"));
    }

    expect(sent).toHaveLength(1);
  });

  it("stops after a bounded number of distinct failures", () => {
    for (let index = 0; index < 100; index += 1) {
      reportError("main", new Error(`failure ${index}`));
    }

    // Bounded, and the bound is small: this says something is broken, where the
    // log says what happened. Exactly the cap rather than merely under it —
    // a budget already spent by an earlier test would also be "under".
    expect(sent).toHaveLength(25);
  });

  it("takes something that is not an Error", () => {
    // `unhandledRejection` hands over whatever was rejected with, which is
    // routinely a string, and once in a while `undefined`.
    expect(() => reportError("main.rejection", "just a string")).not.toThrow();
    expect(() => reportError("main.rejection", undefined)).not.toThrow();

    // And it reported rather than merely surviving. Without this the test
    // passes on a `reportError` that returned at its first guard and never ran
    // a line of what is under test.
    expect(sent).toHaveLength(2);
    expect(sent[0]?.properties).toMatchObject({ name: "string", message: "just a string" });
    expect(sent[1]?.properties).toMatchObject({ name: "undefined", message: "undefined" });
  });

  it("redacts a caller's own properties too", () => {
    // `extra` is the one way into the event that does not go through `redact`
    // on its way, so it is the way a path gets out: every caller passes a shape
    // today, and this is what stops the one that passes a path tomorrow.
    reportError("export", new Error("boom"), { target: "/Users/dana/Movies/take.mp4" });

    expect(JSON.stringify(sent[0]?.properties)).not.toContain("dana");
    expect(sent[0]?.properties).toMatchObject({ target: "/Users/~/Movies/take.mp4" });
  });

  it("does not let a caller overwrite the redacted message", () => {
    // Spread order. `extra` used to land last, so a property sharing a name
    // with one of the redacted fields replaced it — silently, and with the
    // unredacted value.
    reportError("main", new Error("the real failure"), { message: "/Users/dana/whatever" });

    expect(sent[0]?.properties).toMatchObject({ message: "the real failure" });
  });
});

/**
 * Which deaths are worth reporting.
 *
 * Both of these events fire on an ordinary quit, and reporting those swamped
 * everything else: 357 events of `Error: killed` against 37 of every real
 * failure put together, across 25 issues, because the stack ends in a minified
 * name that changes with each build. These are the tests that keep a user
 * choosing Quit from looking like a crash.
 */
describe("watchForErrors", () => {
  it("says nothing when a renderer is taken down with the app", () => {
    watching().renderer({ reason: "killed", exitCode: 0 });

    expect(sent).toHaveLength(0);
  });

  it("says nothing about a clean exit", () => {
    watching().child({ type: "GPU", reason: "clean-exit", exitCode: 0 });

    expect(sent).toHaveLength(0);
  });

  it("reports a renderer that actually crashed", () => {
    watching().renderer({ reason: "crashed", exitCode: 139 });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.properties).toMatchObject({
      scope: "renderer",
      message: "crashed",
      exit_code: 139,
    });
  });

  it("reports a renderer that ran out of memory", () => {
    // The one the editor reaches on a long timeline, and the reason `killed`
    // can be dropped: Chromium has its own word for this.
    watching().renderer({ reason: "oom", exitCode: 0 });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.properties).toMatchObject({ scope: "renderer", message: "oom" });
  });

  it("reports which child process went, so a GPU crash is not read as the editor", () => {
    watching().child({ type: "GPU", reason: "crashed", exitCode: 5 });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.properties).toMatchObject({
      scope: "child",
      child: "GPU",
      message: "crashed",
      exit_code: 5,
    });
  });
});
