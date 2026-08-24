/**
 * What the app tells us about how it is used.
 *
 * Not PostHog. The app posts to the Worker's `/v1/events` and the Worker
 * forwards, which keeps the project token out of the `.dmg`, lets the server
 * attach an identity the app is not allowed to assert about itself, and means
 * analytics can be rerouted or switched off without asking anybody to install a
 * new build.
 *
 * Modelled on `log.ts`: a two-function surface that never throws. Every call
 * site here sits next to something a user is doing, and none of them can be
 * allowed to fail because a network did.
 *
 * Nothing in here reaches a renderer. It could not anyway — the renderer's CSP
 * is `connect-src 'self' prequel-media:` — but the point is that events are
 * observations main already makes, not something a window asks for.
 */
import { release } from "node:os";

import { app } from "electron";

import { apiFetch } from "./api.js";
// `auth.ts` imports `track` back. The cycle is safe because neither side reaches
// for the other while the modules are evaluating — `authToken` is called inside
// `flush`, and `track` inside a sign-in — but it is the reason nothing here may
// run at module scope.
import { authToken } from "./auth.js";
import { installId } from "./install-id.js";

/**
 * How long an event may sit in the queue.
 *
 * Long enough that a burst — starting a recording touches three of these — is
 * one request, short enough that a launch is visible while somebody is still
 * looking at the dashboard waiting for it.
 */
const FLUSH_MS = 15_000;

/**
 * How many events force a flush early.
 *
 * Comfortably inside the fifty the Worker accepts, so a batch is never refused
 * for being too large.
 */
const FLUSH_AT = 20;

interface Queued {
  event: string;
  properties?: Record<string, unknown>;
  timestamp: string;
}

let queue: Queued[] = [];
let timer: NodeJS.Timeout | null = null;
let context: Record<string, unknown> | null = null;

/**
 * Records something that happened.
 *
 * Fire and forget, and safe to call from anywhere in main — including from a
 * `before-quit` handler, where anything that threw would abandon the quit and
 * strand the app with no way out but `kill -9`.
 *
 * Properties are for shapes and outcomes: a format, a duration, an error code.
 * Never a file path, a recording title, a device label, a hostname or an email.
 * The only email we hold is added by the Worker, from its own database, on the
 * one event that needs it.
 */
export function track(event: string, properties?: Record<string, unknown>): void {
  try {
    // Stamped now rather than on arrival. A batch can be fifteen seconds old and
    // a whole recording can start and stop inside one; stamping at the server
    // would collapse a session into a single instant.
    queue.push({ event, properties, timestamp: new Date().toISOString() });

    if (queue.length >= FLUSH_AT) {
      void flush();
      return;
    }

    timer ??= setTimeout(() => void flush(), FLUSH_MS);
    // A pending timer must not hold the process open. Without this an app that
    // has nothing else to do waits out the interval before it can quit.
    timer.unref?.();
  } catch {
    // Nothing here is worth reporting, and nowhere to report it that would not
    // itself be a call into this file.
  }
}

/**
 * Sends whatever is queued.
 *
 * A failed batch is dropped. There is no retry, no backoff and no spool on disk,
 * matching `api.ts`, which has none of those anywhere either — the alternative
 * to losing an analytics event is holding a growing list of them in a process
 * that may be quit at any moment, which is a leak with a worse failure at the
 * end of it.
 */
export async function flush(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  if (queue.length === 0) return;

  // Taken before the await, so anything tracked while this request is in flight
  // goes into the next batch rather than being sent twice or dropped with it.
  const events = queue;
  queue = [];

  try {
    await apiFetch("/v1/events", {
      method: "POST",
      token: authToken(),
      headers: { "x-prequel-install": installId() },
      body: JSON.stringify({ context: describe(), events }),
    });
  } catch {
    // Offline, signed out, or a Worker that is down. All three are ordinary and
    // none of them is the user's problem.
  }
}

/**
 * Everything true of this copy of the app, built once.
 *
 * Sent per request rather than per event, and folded into every event's
 * properties by the Worker — so `app_version` is on all of them rather than on
 * whichever one remembered to include it. Which version is in the wild is the
 * question none of our logging has ever been able to answer.
 */
function describe(): Record<string, unknown> {
  context ??= {
    app: "desktop",
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    osVersion: release(),
    packaged: app.isPackaged,
    locale: app.getLocale(),
  };

  return context;
}
