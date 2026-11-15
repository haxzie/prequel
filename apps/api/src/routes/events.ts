/**
 * Where the desktop app's analytics arrive.
 *
 * The app does not talk to PostHog. It posts here and this Worker forwards, for
 * three reasons: the project token never ships inside a `.dmg`, the events are
 * enriched with an identity the app is not allowed to assert about itself, and
 * analytics can be rerouted or switched off without asking anybody to install a
 * new build.
 *
 * Nothing here is behind `authenticate`. An app that has never been signed in
 * still launches, and refusing `app_launched` would discard the whole
 * pre-sign-in funnel — how many installs get past the permission prompt, how
 * many record something, how many ever sign in.
 */
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { schema } from "@prequel/db";

import { isMilestone, MAX_PER_BATCH, milestoneLine, type Milestone } from "../lib/milestones.ts";
import { capture, environmentOf, toCaptureBatch } from "../lib/posthog.ts";
import { accountById, configured, notify } from "../lib/slack.ts";
import { optionalIdentity, type App, type AppContext } from "../middleware.ts";

const events = new Hono<AppContext>();

/** One of the two events worth a Slack line, narrowed off an incoming batch. */
type Announcement = z.infer<typeof Event> & { event: Milestone };

/**
 * The most events one request may carry.
 *
 * The app flushes every fifteen seconds or every twenty events, so a legitimate
 * batch is well inside this. It is a bound on what a single request can cost,
 * not a throttle.
 */
const MAX_EVENTS = 50;

/**
 * The most one event's properties may serialise to.
 *
 * Properties are the only part of the payload with no fixed shape, so this is
 * the only place a client can send something unbounded. PostHog would take it;
 * the bill is what would notice.
 */
const MAX_PROPERTY_BYTES = 8 * 1024;

const Context = z.object({
  app: z.string().min(1).max(32),
  version: z.string().min(1).max(32),
  platform: z.string().min(1).max(32),
  arch: z.string().min(1).max(16),
  osVersion: z.string().min(1).max(64),
  packaged: z.boolean(),
  locale: z.string().min(1).max(32),
});

const Event = z.object({
  event: z.string().min(1).max(64),
  properties: z.record(z.string(), z.unknown()).optional(),
  /**
   * When it actually happened.
   *
   * Sent by the client rather than stamped here, because a batch can be fifteen
   * seconds old and a whole recording can start and stop inside one. Stamping on
   * arrival would collapse a session into a single instant.
   */
  timestamp: z.iso.datetime().optional(),
});

const Batch = z.object({
  context: Context,
  events: z.array(Event).min(1).max(MAX_EVENTS),
});

/**
 * Takes a batch and says nothing useful back.
 *
 * Always 202, including when PostHog is unconfigured, unreachable or refusing
 * the events. The client has no reasonable response to any of that — dropping
 * analytics is the correct outcome and it already does not retry — and a client
 * that surfaces an analytics failure to a user is worse than no analytics.
 *
 * Deliberately not rate-limited in D1. Transcription is, because every call
 * costs money at OpenAI; this costs a `waitUntil`, and a counter write per batch
 * would put a D1 write on the hot path of every recording. The caps above are
 * what bound one request.
 */
events.post("/", async (c) => {
  const parsed = Batch.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ message: "That request isn't valid." }, 400);

  const { context, events: incoming } = parsed.data;

  for (const event of incoming) {
    if (!event.properties) continue;
    if (JSON.stringify(event.properties).length > MAX_PROPERTY_BYTES) {
      return c.json({ message: "That request isn't valid." }, 400);
    }
  }

  /**
   * The events in this batch somebody should be told about within the minute.
   *
   * Read off the same batch rather than reported separately by the app, so the
   * line in Slack and the point on the chart are the one event. See
   * `lib/milestones.ts`.
   */
  const milestones = incoming.filter((event): event is Announcement => isMilestone(event.event));
  const announcing = milestones.length > 0 && configured(c.env, "events");

  // Before any work. An unconfigured deployment should cost a JSON parse and
  // nothing else — no identity resolution, no D1 read. Both halves are checked:
  // a deployment with a webhook and no project token still announces, and one
  // with neither does nothing at all.
  if (!c.env.POSTHOG_PROJECT_TOKEN && !announcing) return c.json({ ok: true }, 202);

  const identity = await optionalIdentity(c);

  // The same header the transcription limiter uses, and the same reason it is a
  // header rather than a field: it identifies a machine, and it has no business
  // being something a request body can claim on another install's behalf.
  const installId = c.req.header("x-prequel-install")?.slice(0, 64) ?? null;

  if (c.env.POSTHOG_PROJECT_TOKEN) {
    const batch = toCaptureBatch(
      incoming,
      context,
      {
        userId: identity?.userId ?? null,
        teamId: identity?.teamId ?? null,
        installId,
        // Read only when there is a `$identify` to populate. On every other
        // batch this would be a D1 query per recording for a value that changes
        // once.
        person:
          identity && incoming.some((event) => event.event === "signed_in")
            ? await person(c, identity.userId)
            : null,
      },
      environmentOf(c.env),
    );

    capture(c.env, c.executionCtx, batch);
  }

  /**
   * Announced only for an account, and only once the account is known.
   *
   * An install that has never signed in is a number, and the file this posts
   * through says why that is not what the feed is for: "a video was shared" is
   * a number, "Ana shared a video" is something to act on. Those recordings are
   * in PostHog, where the funnel they belong to is drawn. Dropping them here
   * also keeps the read off the hot path of every app that is not signed in.
   */
  if (announcing && identity) {
    const account = await accountById(c.get("db"), identity.userId, identity.teamId);

    for (const event of milestones.slice(0, MAX_PER_BATCH)) {
      notify(
        c.env,
        c.executionCtx,
        "events",
        milestoneLine(event.event, event.properties, account),
      );
    }
  }

  return c.json({ ok: true }, 202);
});

/**
 * The account behind a user id.
 *
 * The app never sends an email — it is added here, from our own database, on the
 * one event that needs it. That is the difference between a person record with a
 * name on it and a client being trusted to say who it is.
 */
async function person(c: App, userId: string) {
  const [row] = await c
    .get("db")
    .select({ name: schema.user.name, email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);

  return row ?? null;
}

export default events;
