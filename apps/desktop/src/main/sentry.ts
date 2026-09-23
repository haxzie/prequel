/**
 * Crash and error reporting, for the failures a log nobody reads cannot answer.
 *
 * Beside `errors.ts` rather than instead of it, because the two are asked
 * different questions. `app_error` goes to PostHog and sits next to the funnel
 * it interrupted — it answers "how many installs hit this, and what were they
 * doing". This answers "what actually happened", with a stack, the breadcrumbs
 * leading up to it, and the native crashes that reach neither `uncaughtException`
 * nor a renderer still alive to report itself. Both are fed from `reportError`,
 * so there is one funnel in the app and two sinks behind it.
 *
 * **The defaults here are wrong for this app and every one of them is turned
 * off below.** Sentry ships to be useful immediately, which means an event
 * carries the machine's hostname, the user's IP, and a breadcrumb trail of
 * every console line and network request that preceded it. `errors.ts` exists
 * because an install id stops being anonymous the moment it arrives next to
 * `/Users/dana` — and a default-configured SDK would send that, plus the
 * hostname, on the very first crash. So the rule that file keeps is kept here
 * too, through the same `redact`.
 *
 * The renderer never talks to Sentry directly and must not be made to: its CSP
 * is `connect-src 'self' prequel-media:`, so a window physically cannot reach
 * `ingest.sentry.io`. `@sentry/electron/renderer` knows this and routes events
 * to main over IPC, which is why it needs no DSN of its own and why nothing
 * here widens the CSP.
 */
import { app } from "electron";

import * as Sentry from "@sentry/electron/main";
import { env } from "@prequel/env";

import { redact, setErrorSink } from "./errors.js";
import { installId } from "./install-id.js";

/**
 * Starts reporting.
 *
 * Called before anything else in `index.ts`, and deliberately before
 * `watchForErrors`: an exception thrown during startup is the one most worth
 * having and the one with the smallest window in which to be caught.
 */
export function initSentry(): void {
  // Packaged builds only. A development crash is in front of somebody with a
  // terminal, and mixing those into the same project makes the release signal
  // — which is the only reason this exists — something to be filtered rather
  // than read. There is no `environment` split for the same reason PostHog's
  // token defaults to empty: a quiet dashboard must mean nothing broke.
  if (!app.isPackaged) return;

  Sentry.init({
    dsn: env.NEXT_PUBLIC_SENTRY_DSN,
    release: `${app.getName()}@${app.getVersion()}`,

    // The install id, which is all the identity this app has and the same one
    // `/v1/events` is keyed by — so an issue here can be lined up with that
    // install's funnel in PostHog. No email and no username: the Worker adds
    // an identity from its own database for the one event that needs it, and
    // nothing in a `.dmg` is allowed to assert who somebody is.
    initialScope: { user: { id: installId() } },

    // Off by default already; set explicitly because the cost of it flipping
    // under us is the IP address and the machine name of every user who
    // crashes.
    sendDefaultPii: false,

    // The hostname, which on a Mac is very often the owner's full name —
    // "Dana's MacBook Pro". Sentry reads it from the OS rather than from
    // anything sent, so it has to be removed rather than not-set.
    serverName: undefined,

    // Console breadcrumbs are the whole log, and this app mirrors renderer
    // warnings into it — which is exactly where an unredacted path is most
    // likely to arrive. The trail that matters is the one this app writes on
    // purpose; the rest is a privacy surface with no owner.
    integrations: (defaults) =>
      defaults.filter(
        (integration) => integration.name !== "Console" && integration.name !== "Breadcrumbs",
      ),

    // Last line rather than the only one: everything above narrows what is
    // collected, and this scrubs what is left. A path can still arrive inside
    // a message, a stack frame or an exception value, and `redact` is the same
    // function `app_error` is held to — one rule, not two that drift.
    beforeSend: (event) => scrub(event),
    beforeBreadcrumb: (breadcrumb) => {
      if (typeof breadcrumb.message === "string") breadcrumb.message = redact(breadcrumb.message);
      return breadcrumb;
    },
  });

  // Registered only now, so everything `reportError` sends has been through an
  // SDK that is actually configured — a `captureException` before `init` is
  // dropped, and dropped silently.
  setErrorSink(captureError);
}

/**
 * Takes the user out of an event.
 *
 * Every field that can hold a path, not just the obvious one. A stack frame's
 * `filename` is the one people forget: it is the *most* path-shaped field in
 * the payload and it is not part of the message `beforeSend` implementations
 * usually reach for.
 */
export function scrub<T extends Sentry.ErrorEvent>(event: T): T {
  if (event.message) event.message = redact(event.message);

  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = redact(exception.value);
    for (const frame of exception.stacktrace?.frames ?? []) {
      if (frame.filename) frame.filename = redact(frame.filename);
      if (frame.abs_path) frame.abs_path = redact(frame.abs_path);
    }
  }

  // Set from the OS after `init`, so it is cleared here as well as above.
  delete event.server_name;

  return event;
}

/**
 * Sends one failure, with the scope that says where it came from.
 *
 * Takes what `reportError` already has rather than reaching for the error
 * itself, so the two sinks can never disagree about what happened: the same
 * call feeds the same facts to both.
 */
function captureError(scope: string, cause: unknown, extra?: Record<string, unknown>): void {
  try {
    Sentry.captureException(cause, {
      tags: { scope },
      // Already through `safe` in `reportError`, so these are redacted and
      // capped before they arrive.
      extra,
    });
  } catch {
    // Reporting a failure must never become one — the rule `reportError` keeps.
  }
}
