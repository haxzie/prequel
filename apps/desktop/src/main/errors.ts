/**
 * What the app says when something goes wrong.
 *
 * The same pipe as everything else it reports: `track` into `/v1/events`, which
 * the Worker forwards to PostHog. Nothing is needed on the server for this —
 * that route takes any event name and any properties under 8 KB — so an error
 * is an event like `recording_started` is, and lands in the same project beside
 * the funnel it interrupted.
 *
 * **Not a crash reporter.** There is no minidump, no symbolication and no
 * upload of the log. What goes out is the shape of the failure: where it
 * happened, what kind of error it was, a redacted message and a redacted stack.
 * Enough to see that forty installs hit the same thing on Tuesday; not enough to
 * read somebody's disk from a dashboard.
 *
 * The rule this file exists to keep is the one in `track`'s own docblock:
 * properties are shapes and outcomes, **never a file path**. An error message is
 * the one place a path arrives without anybody deciding to send one — every
 * `ENOENT` carries the full path it could not open, and in a packaged build that
 * path starts with the user's home directory. So nothing here goes out
 * unredacted — not the message, not the stack, and not a caller's own
 * properties, which go through `safe` for that reason rather than being
 * trusted.
 */
import { homedir } from "node:os";

import { app } from "electron";

import { track } from "./analytics.js";

/**
 * How many error events one run of the app may send.
 *
 * A failing render loop can throw sixty times a second, and the twentieth
 * report of one bug says nothing the first did not. The cap is per launch and
 * deliberately small: this is a signal that something is broken, not a
 * transcript of it breaking. The log already has the transcript.
 */
const MAX_PER_SESSION = 25;

/** Long enough to recognise a failure, short enough to stay a property. */
const MAX_MESSAGE = 300;

/**
 * Long enough for the frames that name our own code.
 *
 * A V8 stack puts the throw site first, so the top of it is the part worth
 * having and a cap loses the Electron and Node frames at the bottom.
 */
const MAX_STACK = 1_200;

let sent = 0;
const seen = new Set<string>();

/**
 * Whether a report is already being built.
 *
 * `track` cannot throw, but everything around it can, and the handler this file
 * installs on `uncaughtException` is reached by anything that escapes anywhere.
 * Without this, one throw inside reporting is a throw inside reporting inside
 * reporting until the stack runs out.
 */
let reporting = false;

/**
 * Records that something failed.
 *
 * `scope` says where, in a handful of fixed words rather than free text, so the
 * events group in PostHog: `main`, `renderer`, `capture.start`, `export`,
 * `share.upload`. It is the field to break the chart down by, so it has to be a
 * category and not a sentence.
 *
 * Safe to call from anywhere, including a `finally` and a quit handler, for the
 * same reason `track` is: nothing in here throws.
 */
export function reportError(scope: string, cause: unknown, extra?: Record<string, unknown>): void {
  if (reporting || sent >= MAX_PER_SESSION) return;
  reporting = true;

  try {
    const error = cause instanceof Error ? cause : null;
    const name = error?.name ?? (cause === null ? "null" : typeof cause);
    const message = redact(error?.message ?? String(cause)).slice(0, MAX_MESSAGE);

    // One report per distinct failure per launch. A retry loop that fails the
    // same way forty times is one fact, and sending it forty times would spend
    // the cap above on a single bug and hide every other one behind it.
    const signature = `${scope}:${name}:${message}`;
    if (seen.has(signature)) return;
    seen.add(signature);
    sent += 1;

    track("app_error", {
      // First, so a caller's own property cannot replace one of the redacted
      // fields below with an unredacted one of the same name — `extra` holding
      // a `message` used to win over the message that had just been through
      // `redact`.
      ...safe(extra),
      scope,
      name,
      message,
      ...(error?.stack ? { stack: redact(error.stack).slice(0, MAX_STACK) } : {}),
    });
  } catch {
    // Reporting a failure must never become one.
  } finally {
    reporting = false;
  }
}

/**
 * A caller's own properties, held to the same rule.
 *
 * `extra` was the one way into one of these events that did not pass through
 * `redact`, which made the promise at the top of this file untrue: every
 * caller today passes a shape — `fatal`, `exit_code`, `child` — and that is
 * exactly how the one that passes a path tomorrow gets through review.
 *
 * Strings are redacted and capped. Anything else is a number, a boolean or one
 * of Electron's own words, none of which can carry a path.
 */
function safe(extra: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!extra) return {};

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extra)) {
    out[key] = typeof value === "string" ? redact(value).slice(0, MAX_MESSAGE) : value;
  }
  return out;
}

/**
 * Takes the user out of a message before it leaves the machine.
 *
 * Two passes, because there are two ways a path arrives. The first is this
 * user's own home directory, which is most of them: `ENOENT: no such file or
 * directory, open '/Users/dana/Movies/Prequel/…'`. The second is any other
 * absolute path under `/Users`, which turns up in stack frames from a build
 * made on somebody else's machine.
 *
 * The account name is what matters here. An install id is anonymous until it
 * arrives next to `/Users/dana`, at which point it is not, and that is a line
 * this app does not cross for analytics.
 */
export function redact(text: string): string {
  const home = homedir();
  const withoutHome = home ? text.split(home).join("~") : text;

  // Everything up to the next separator, so `/Users/dana/Movies` keeps the part
  // that says where in the library it was and loses the part that says who.
  return withoutHome.replace(/\/Users\/[^/\s"')]+/g, "/Users/~");
}

/**
 * Starts reporting the failures nothing else catches.
 *
 * Called once, after `initLogging`, which installs its own listeners on the
 * first two of these. Two listeners rather than one call doing both jobs: the
 * log is written synchronously to a file that has to survive the process dying
 * in the next millisecond, and this queues a network request. Neither should be
 * able to stop the other happening.
 */
export function watchForErrors(): void {
  process.on("uncaughtException", (error) => reportError("main", error, { fatal: true }));
  process.on("unhandledRejection", (reason) => reportError("main.rejection", reason));

  // A renderer going down is what somebody means when they say the app broke,
  // and it throws nothing on this side to catch. `reason` is Electron's own
  // word — `crashed`, `oom`, `killed` — which is exactly the shape wanted here.
  app.on("render-process-gone", (_event, _contents, details) => {
    reportError("renderer", details.reason, { exit_code: details.exitCode });
  });

  // The GPU process and any utility process. Worth having separately: a GPU
  // crash takes the editor's canvas with it and looks to the user like the
  // editor failing rather than the machine.
  app.on("child-process-gone", (_event, details) => {
    reportError("child", details.reason, {
      child: details.type,
      exit_code: details.exitCode,
    });
  });
}
