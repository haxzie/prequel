/**
 * A bug report, on its way to somebody who can answer it.
 *
 * In main because every remote call is: the renderer's CSP is
 * `connect-src 'self' prequel-media:`, so the dialog that collects the text
 * physically cannot post it anywhere. It hands the words across and this makes
 * the call.
 *
 * Signed in only, and the app asks for a sign-in rather than taking the report
 * anonymously. A report with no address is a complaint — there is nowhere to
 * send the answer, no way to ask the one follow-up question that usually
 * settles it, and no way to tell one person's four reports from four people's
 * one. The account is what makes it a conversation.
 *
 * The log goes along when it is asked for, and only then. Nothing else does: no
 * session, no project, no recording, no frame of video. The end of
 * `~/Library/Logs/Prequel/main.log` is the one thing that turns "the export
 * failed" into a fixable report, and it is also the one thing here that was
 * never written to be read by anybody but us — so it is a tick box that says
 * what it sends, not a quiet attachment.
 */
import { readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";

import { app } from "electron";

import { apiFetch, ApiError } from "./api.js";
import { authToken } from "./auth.js";
import { redact } from "./errors.js";
import { logPath } from "./log.js";
import { track } from "./analytics.js";

/**
 * The same cap the Worker enforces.
 *
 * Checked here as well so an over-long report is refused in the dialog, with
 * the text still in the box, rather than making a round trip to come back as a
 * failure that reads like the network.
 */
export const MAX_FEEDBACK = 4_000;

/**
 * How much of the log travels.
 *
 * The end of it, not the start. A log that has been running for an afternoon is
 * megabytes, and the part that explains what just went wrong is always the last
 * few hundred lines — sending the beginning would reliably send the session
 * before the one being reported.
 *
 * Kept well inside Slack's own 40 KB message limit, since the report itself,
 * the fences and the name all have to fit in the same message.
 */
const MAX_LOG_BYTES = 12_000;

/**
 * The tail of the log, with the paths taken out of it.
 *
 * Read from the end with a file handle rather than `readFileSync`: this file
 * grows without bound within a session, and pulling a multi-megabyte log into
 * memory to keep the last twelve kilobytes of it is work nobody asked for on a
 * machine that is, by hypothesis, already misbehaving.
 *
 * Redacted through `errors.ts`'s own function, so a log sent from here is held
 * to the same rule as an error reported from there: `/Users/dana` says who this
 * is, and nothing that leaves this app needs to know. The cost is that a path
 * in a report reads as `/Users/~/Movies/…`, which still says where in the
 * library something was.
 *
 * Never throws. A log that cannot be read must not take the report with it —
 * the words are the part somebody wrote by hand.
 */
function logTail(): string | null {
  try {
    const path = logPath();
    const { size } = statSync(path);

    if (size <= MAX_LOG_BYTES) return redact(readFileSync(path, "utf8"));

    const handle = openSync(path, "r");
    try {
      const buffer = Buffer.alloc(MAX_LOG_BYTES);
      const read = readSync(handle, buffer, 0, MAX_LOG_BYTES, size - MAX_LOG_BYTES);
      // From the first newline, so the tail does not open mid-line — a half
      // timestamp at the top reads as a corrupted log rather than a windowed
      // one. `slice(1)` drops that newline itself; a tail with no newline at
      // all is sent whole rather than emptied.
      const text = buffer.toString("utf8", 0, read);
      const cut = text.indexOf("\n");

      return redact(cut === -1 ? text : text.slice(cut + 1));
    } finally {
      closeSync(handle);
    }
  } catch (cause) {
    // Warned rather than thrown: this is worth tripping over in `pnpm dev`, and
    // in a packaged build it explains a report that arrived with no log after
    // somebody ticked the box.
    console.warn("[feedback] could not read the log:", cause);
    return null;
  }
}

export async function sendFeedback(message: string, withLog = false): Promise<void> {
  const text = message.trim();

  if (text.length === 0) throw new ApiError("EMPTY", "Write something first.");
  if (text.length > MAX_FEEDBACK) {
    throw new ApiError("TOO_LONG", "That is longer than this box can send.");
  }

  const token = authToken();
  if (!token) throw new ApiError("SIGNED_OUT", "Sign in to send a bug report.");

  const log = withLog ? logTail() : null;

  await apiFetch("/v1/desktop/feedback", {
    method: "POST",
    token,
    body: JSON.stringify({
      message: text,
      version: app.getVersion(),
      // Omitted rather than sent as null, so the Worker's schema can stay
      // "optional" and the wire says nothing about a log that is not there.
      ...(log ? { log } : {}),
    }),
  });

  // The count and whether a log came with it, never the words and never a line
  // of the log. What somebody writes into a bug report is theirs and belongs in
  // the one channel they sent it to — `errors.ts` makes the same distinction
  // about a message that arrives with a path in it.
  track("feedback_sent", { with_log: log !== null });
}
