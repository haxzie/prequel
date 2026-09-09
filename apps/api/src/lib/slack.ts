/**
 * The handful of things worth putting in front of a person the moment they
 * happen.
 *
 * Two feeds, because they are read for different reasons: `signups` is a
 * heartbeat somebody glances at, and `events` is the one you go back through
 * when a number moves. Mixing them makes the quiet feed noisy and the noisy one
 * useless, so they are two webhooks rather than one with a prefix.
 *
 * **This is not analytics.** PostHog already has every one of these and can
 * answer questions about them; Slack cannot answer anything and is not supposed
 * to. What it does is interrupt — so only events where being told within the
 * minute changes what somebody does belong here, and every one of them names a
 * person, because "a video was shared" is a number and "Ana shared a video" is
 * something to act on.
 *
 * **Both URLs are optional and silence is the unconfigured state**, the same
 * call `POSTHOG_PROJECT_TOKEN` makes. A deployment that was never given a
 * webhook posts nothing rather than logging a failure per event, and a fork
 * needs no Slack workspace to run the Worker.
 *
 * A webhook URL is a credential — anyone holding one can post into the channel
 * — so these live in `wrangler secret`, never in `wrangler.jsonc`.
 */
import { eq } from "drizzle-orm";

import { schema } from "@prequel/db";

import type { Env } from "../env.ts";
import type { Database } from "../db.ts";

/** How long to wait on Slack before giving up on a message. */
const TIMEOUT_MS = 5_000;

/** Which feed a message belongs in. */
export type SlackFeed = "signups" | "events";

/**
 * The only part of an execution context this file uses.
 *
 * Structural rather than `ExecutionContext`, for the reason `posthog.ts` gives:
 * Hono declares its own and the two differ by fields nothing here touches.
 */
export interface Deferrable {
  waitUntil(promise: Promise<unknown>): void;
}

/** Whoever the message is about. Both halves are optional at some call sites. */
export interface Person {
  name?: string | null;
  email?: string | null;
}

function webhookFor(env: Env, feed: SlackFeed): string | undefined {
  const url = feed === "signups" ? env.SLACK_SIGNUPS_WEBHOOK_URL : env.SLACK_EVENTS_WEBHOOK_URL;
  return url && url.length > 0 ? url : undefined;
}

/**
 * Who the event is about, as one readable phrase.
 *
 * The name is not enough on its own — two people called Ana are one support
 * thread away from being confused with each other — and the email is not enough
 * either, because a name is what anybody actually recognises. So both when both
 * are known, and never a bare "someone" where an address would have done.
 */
export function describe(person: Person | null | undefined): string {
  const name = person?.name?.trim();
  const email = person?.email?.trim();

  if (name && email) return `${name} (${email})`;
  if (email) return email;
  if (name) return name;
  return "someone we have no address for";
}

/**
 * The account behind a user id, for the call sites that only hold one.
 *
 * A read per notification, which is affordable precisely because these events
 * are rare — a share, a checkout, a payment. Anything that happened on every
 * request would not belong in Slack in the first place.
 */
export async function personById(db: Database, userId: string): Promise<Person | null> {
  const [row] = await db
    .select({ name: schema.user.name, email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);

  return row ?? null;
}

/** The owner of a team, for the webhook, which knows a team and not a person. */
export async function personByTeam(db: Database, teamId: string): Promise<Person | null> {
  const [row] = await db
    .select({ name: schema.user.name, email: schema.user.email })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(eq(schema.member.organizationId, teamId))
    .orderBy(schema.member.createdAt)
    .limit(1);

  return row ?? null;
}

/**
 * Posts one message, and never throws.
 *
 * Awaited only where there is no execution context to hang it off — the Better
 * Auth `user.create.after` hook, which is handed neither. Everywhere else use
 * `notify`, which does not make a request wait on Slack.
 */
export async function post(env: Env, feed: SlackFeed, text: string): Promise<void> {
  const url = webhookFor(env, feed);
  if (!url) return;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ text }),
    });

    // Said out loud rather than swallowed: a webhook revoked in Slack answers
    // 403 for ever after, and the only symptom is a channel that went quiet —
    // which reads as nothing happening rather than as a broken integration.
    if (!response.ok) {
      console.error(`slack: ${feed} answered ${String(response.status)}`);
    }
  } catch (cause) {
    console.error(`slack: could not reach ${feed}`, cause);
  }
}

/**
 * Posts on the way out, so no response waits on Slack.
 *
 * The same arrangement `capture` in `posthog.ts` uses, and for the same reason:
 * a request must neither wait on, nor fail because of, somewhere we are only
 * telling about it.
 */
export function notify(env: Env, ctx: Deferrable, feed: SlackFeed, text: string): void {
  if (!webhookFor(env, feed)) return;
  ctx.waitUntil(post(env, feed, text));
}
