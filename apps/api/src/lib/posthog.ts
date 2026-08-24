/**
 * Everything Prequel tells PostHog.
 *
 * Two halves, split so the interesting one can be tested without a network: the
 * rules that decide *who* an event belongs to are a pure function, and `capture`
 * is the transport around it.
 *
 * This is the first outbound `fetch` in this Worker hung off `waitUntil` — the
 * three that already use it (`middleware.ts`, `routes/public.ts`,
 * `routes/transcribe.ts`) are all D1 writes. The reasoning is the same and the
 * consequence is stronger: a request must not wait on, or fail because of,
 * analytics.
 */
import type { Env } from "../env.ts";

/** Prefix on an anonymous id, so it cannot collide with a Better Auth user id. */
const ANONYMOUS_PREFIX = "install_";

/**
 * The largest batch PostHog is sent in one request.
 *
 * Matched to the cap `routes/events.ts` enforces on an incoming batch, which is
 * where it actually matters. Repeated here because server-side events can be
 * appended to a batch after that check.
 */
const MAX_BATCH = 100;

/** How long to wait on PostHog before giving up on the events entirely. */
const TIMEOUT_MS = 5_000;

/** What a client sends. Deliberately narrow — no ids, no identity, no email. */
export interface EventContext {
  app: string;
  version: string;
  platform: string;
  arch: string;
  osVersion: string;
  packaged: boolean;
  locale: string;
}

export interface IncomingEvent {
  event: string;
  properties?: Record<string, unknown>;
  /** ISO 8601. Sent by the client because a batch can be up to 15 seconds old. */
  timestamp?: string;
}

/** Who the batch belongs to, resolved by the route from the credentials it got. */
export interface Subject {
  userId: string | null;
  teamId: string | null;
  /** The `x-prequel-install` header. The anonymous half of the identity. */
  installId: string | null;
  /**
   * The account behind `userId`, read from D1.
   *
   * Only fetched when the batch contains `signed_in`, because it is only used to
   * populate the person on `$identify` — a D1 read on every batch would put a
   * query on the hot path of every recording for a value that changes once.
   */
  person: { email: string; name: string } | null;
}

export interface PostHogEvent {
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
  timestamp?: string;
}

export type Environment = "development" | "production";

/**
 * The only part of an execution context this file uses.
 *
 * Structural rather than `ExecutionContext`, because Hono declares its own and
 * the two differ by fields nothing here touches. Naming the method is what lets
 * a handler pass `c.executionCtx` straight through.
 */
export interface Deferrable {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * Which deployment this is.
 *
 * Read off `APP_URL` rather than a var of its own — the same test `createAuth`
 * already uses to decide about cross-subdomain cookies. Development and
 * production share one PostHog project, so this property is the only thing
 * keeping `pnpm dev` traffic out of every insight. Get it wrong and nothing
 * errors; the numbers are simply too high forever.
 */
export function environmentOf(env: Env): Environment {
  return env.APP_URL.startsWith("https://") ? "production" : "development";
}

/**
 * The id every event for this subject hangs off.
 *
 * The user id once there is one, the install id before that. Null when there is
 * neither, which is a client that sent no credential and no install header —
 * there is nothing to attribute the events to and they are dropped.
 */
export function distinctIdFor(subject: Subject): string | null {
  if (subject.userId) return subject.userId;
  return subject.installId ? `${ANONYMOUS_PREFIX}${subject.installId}` : null;
}

/**
 * Turns a client's batch into PostHog's.
 *
 * Pure, and the only place the identity rules live. Three things happen here
 * that are wrong silently if they are wrong at all:
 *
 * 1. The context is folded into every event, so `app_version` is on all of them
 *    rather than on whichever one the client remembered to put it on.
 * 2. `signed_in` expands into a PostHog `$identify` *and* the event itself. That
 *    `$identify` carries `$anon_distinct_id`, which is what merges the anonymous
 *    person who installed the app into the account they just signed into. It is
 *    issued here and nowhere else — repeating a merge on every batch churns
 *    person rows for nothing.
 * 3. Client properties go on first and are overwritten by ours, so a client
 *    cannot claim a different `environment`, team or app version.
 */
export function toCaptureBatch(
  events: IncomingEvent[],
  context: EventContext,
  subject: Subject,
  environment: Environment,
): PostHogEvent[] {
  const distinctId = distinctIdFor(subject);
  if (!distinctId) return [];

  const shared: Record<string, unknown> = {
    environment,
    app: context.app,
    app_version: context.version,
    platform: context.platform,
    arch: context.arch,
    os_version: context.osVersion,
    packaged: context.packaged,
    locale: context.locale,
    ...(subject.teamId ? { $groups: { team: subject.teamId } } : {}),
  };

  const batch: PostHogEvent[] = [];

  for (const incoming of events) {
    if (incoming.event === "signed_in" && subject.userId && subject.installId) {
      batch.push({
        event: "$identify",
        distinct_id: subject.userId,
        properties: {
          ...shared,
          $anon_distinct_id: `${ANONYMOUS_PREFIX}${subject.installId}`,
          $set: {
            ...(subject.person ? { email: subject.person.email, name: subject.person.name } : {}),
            ...(subject.teamId ? { team_id: subject.teamId } : {}),
          },
        },
        timestamp: incoming.timestamp,
      });
    }

    batch.push({
      event: incoming.event,
      distinct_id: distinctId,
      properties: {
        ...incoming.properties,
        ...shared,
        // Person properties on one event rather than all of them. PostHog
        // charges for person processing, and rewriting the same three values on
        // every recording is the usual way a project's bill gets away from
        // somebody.
        ...(incoming.event === "app_launched"
          ? {
              $set: {
                app_version: context.version,
                os_version: context.osVersion,
                platform: context.platform,
              },
            }
          : {}),
      },
      timestamp: incoming.timestamp,
    });
  }

  return batch;
}

/** An event the Worker itself emits, about something it just did. */
export interface ServerEvent {
  event: string;
  /** The account it happened to, when there is one. */
  userId?: string | null;
  /** Used when there is no account — a public viewer, say. */
  distinctId?: string;
  teamId?: string | null;
  properties?: Record<string, unknown>;
  /**
   * Count it, but do not make a person out of it.
   *
   * For anything a stranger triggers. Without this, every visitor who opens a
   * share link becomes a PostHog person that will never do anything else.
   */
  anonymous?: boolean;
}

/**
 * Sends events the Worker is the authority on.
 *
 * Server-side because the client either cannot see them — a stranger opening a
 * share link — or should not be taken at its word about them. `video_shared`
 * fires here rather than in the app because here is where the object is known to
 * have actually arrived at the size it claimed.
 */
export function captureServer(env: Env, ctx: Deferrable, ...events: ServerEvent[]): void {
  const environment = environmentOf(env);

  const batch = events.flatMap<PostHogEvent>((event) => {
    const distinctId = event.userId ?? event.distinctId;
    if (!distinctId) return [];

    return [
      {
        event: event.event,
        distinct_id: distinctId,
        properties: {
          ...event.properties,
          environment,
          app: "api",
          ...(event.teamId ? { $groups: { team: event.teamId } } : {}),
          ...(event.anonymous ? { $process_person_profile: false } : {}),
        },
      },
    ];
  });

  capture(env, ctx, batch);
}

/**
 * Posts a batch, on the way out.
 *
 * Never awaited by a handler and never able to change a response. A failure is a
 * log line: there is no retry and no queue, because the alternative to losing an
 * analytics event is holding one in a Worker that is about to be evicted.
 */
export function capture(env: Env, ctx: Deferrable, batch: PostHogEvent[]): void {
  if (batch.length === 0) return;

  // Empty means analytics is not configured, which is a deployment that has not
  // been given a token rather than a broken one. Silence, not an error.
  if (!env.POSTHOG_PROJECT_TOKEN) return;

  const body = JSON.stringify({
    // PostHog's name for the project token in this payload, not ours. There is
    // no second credential to go looking for.
    api_key: env.POSTHOG_PROJECT_TOKEN,
    batch: batch.slice(0, MAX_BATCH).map((event) => ({
      event: event.event,
      // Also inside `properties`, which is where PostHog's own batch
      // documentation puts it. Both are read; sending one and not the other is a
      // coin flip on whether the events are attributed or dropped.
      distinct_id: event.distinct_id,
      properties: { ...event.properties, distinct_id: event.distinct_id },
      ...(event.timestamp ? { timestamp: event.timestamp } : {}),
    })),
  });

  ctx.waitUntil(
    fetch(new URL("/batch/", env.POSTHOG_HOST), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
      .then((response) => {
        if (!response.ok) console.error(`posthog: answered ${response.status}`);
      })
      .catch((error: unknown) => {
        console.error("posthog: unreachable", error);
      }),
  );
}
