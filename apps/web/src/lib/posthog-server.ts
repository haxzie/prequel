/**
 * Events the site records from the server, where `posthog-js` cannot reach.
 *
 * There is exactly one of those and it is the one that matters most: `/download`
 * is a redirect, not a page. Nothing renders, so no browser SDK ever runs — and
 * the click that starts the download is the click the whole site exists for.
 *
 * A raw `fetch` rather than `posthog-node`, matching `apps/api/src/lib/posthog.ts`,
 * which sends the desktop app's events the same way. The capture endpoint is one
 * POST of JSON; a second analytics dependency to build the same object is weight
 * for nothing. This is a copy of the shape, not shared code — `AGENTS.md` keeps
 * `apps/web` and `apps/api` from importing across the boundary, and the two have
 * different reasons to change.
 */
import { env } from "@prequel/env";

/** How long to wait on PostHog before giving up. */
const TIMEOUT_MS = 3_000;

/**
 * The cookie `posthog-js` keeps its identity in.
 *
 * Reading it is what ties a server-side event to the person who was browsing:
 * without it the download is an island, and the funnel from landing page to
 * download cannot be drawn at all. The name is derived from the project token,
 * which is the SDK's own convention.
 */
function cookieName(): string {
  return `ph_${env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN}_posthog`;
}

/**
 * Who to file the event under.
 *
 * `null` when there is no PostHog cookie — an ad blocker, a first visit with
 * the SDK blocked, or a link opened straight from a README. Those still count
 * as downloads, so the caller invents an id and tells PostHog not to build a
 * person around it.
 */
export function distinctIdFrom(cookie: string | undefined): string | null {
  if (!cookie) return null;

  try {
    // The SDK stores URL-encoded JSON: `{"distinct_id":"...","$sesid":[...]}`.
    const stored = JSON.parse(decodeURIComponent(cookie)) as { distinct_id?: unknown };
    return typeof stored.distinct_id === "string" && stored.distinct_id !== ""
      ? stored.distinct_id
      : null;
  } catch {
    // A cookie from a different SDK version, or a truncated one. Not worth
    // repairing — the event is still recorded, just anonymously.
    return null;
  }
}

/** Reads the PostHog identity out of a request's `Cookie` header. */
export function identify(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;

  const name = cookieName();
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return distinctIdFrom(rest.join("="));
  }

  return null;
}

/**
 * Which deployment this is, stamped on every event.
 *
 * The same property `instrumentation-client.ts` registers and the Worker
 * attaches to the desktop app's events. One PostHog project holds all three, and
 * this is the only thing keeping a developer's `pnpm dev` out of the insights.
 */
function environment(): string {
  return env.NEXT_PUBLIC_APP_URL.startsWith("https://") ? "production" : "development";
}

/**
 * Sends one event, and never throws.
 *
 * `/batch/` with a single event rather than the single-event endpoint, because
 * that is the request `apps/api/src/lib/posthog.ts` already makes and knows the
 * exact shape of — including the one detail that is not guessable: `distinct_id`
 * goes both at the top level *and* inside `properties`, and sending one without
 * the other is a coin flip on whether the event is attributed or dropped.
 *
 * Called from inside `after()`, so it runs once the response is on its way — a
 * redirect must not wait on analytics, and must not fail because of it.
 */
export async function capture(
  event: string,
  {
    distinctId,
    properties = {},
  }: { distinctId: string | null; properties?: Record<string, unknown> },
): Promise<void> {
  const token = env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  // A build with no token stays silent rather than throwing, the same guard
  // `instrumentation-client.ts` and the Worker both make.
  if (!token) return;

  const anonymous = distinctId === null;
  // Somebody we have never seen still downloaded the app, so the event is
  // recorded — under an id nothing else will ever share.
  const id = distinctId ?? `anon_${crypto.randomUUID()}`;

  try {
    const response = await fetch(new URL("/batch/", env.NEXT_PUBLIC_POSTHOG_HOST), {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        // PostHog's name for the project token in this payload, not ours.
        api_key: token,
        batch: [
          {
            event,
            distinct_id: id,
            timestamp: new Date().toISOString(),
            properties: {
              ...properties,
              distinct_id: id,
              app: "web",
              environment: environment(),
              // Without this every blocked visitor becomes a PostHog person who
              // does one thing and is billed for afterwards — the same reason
              // `instrumentation-client.ts` pins `defaults: "2025-05-24"`.
              ...(anonymous ? { $process_person_profile: false } : {}),
            },
          },
        ],
      }),
    });

    // Said out loud rather than swallowed. A silently dropped analytics call is
    // indistinguishable from nobody downloading anything, and the only place
    // that difference is visible is a server log.
    if (!response.ok) console.error(`posthog: answered ${response.status}`);
  } catch (error) {
    console.error("posthog: unreachable", error);
  }
}
