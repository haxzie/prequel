/**
 * The mailing list, kept in step with the database.
 *
 * Mails holds one contact per address, and this file is the only thing that
 * writes to it. Three moments reach it: an account is created, a team's plan is
 * recomputed, and somebody changes their mind on the settings screen.
 *
 * **The two write verbs are not interchangeable.** `POST /v1/contacts`
 * *replaces* the stored properties object, so it is only ever used where there
 * is nothing to lose — a contact being created for the first time. Everywhere
 * afterwards is `PATCH`, which merges, because by then the contact carries
 * fields this app did not put there: whatever a campaign or an import added,
 * and the subscription state itself. A `POST` where a `PATCH` belonged does not
 * fail — it silently empties every key it did not mention, and the only symptom
 * is a segment that quietly stops matching anybody.
 *
 * **`MAILS_API_KEY` is optional and silence is the unconfigured state**, the
 * same call `lib/slack.ts` and `POSTHOG_PROJECT_TOKEN` make. A deployment that
 * was never given a key writes nothing rather than logging a failure per
 * sign-up, and a fork needs no Mails account to run the Worker.
 *
 * **Nothing here throws.** A marketing list being unreachable must not fail a
 * sign-up, a webhook Dodo will retry, or a checkbox. Every function reports a
 * boolean and logs its own failure, and the one caller who is a person waiting
 * — the settings screen — is the only one that reads it.
 */
import { eq } from "drizzle-orm";

import { schema } from "@prequel/db";

import type { Database } from "../db.ts";
import type { Deferrable, Env } from "../env.ts";
import { type Plan } from "./entitlement.ts";

/** How long to wait on Mails before giving up. Matches `lib/slack.ts`. */
const TIMEOUT_MS = 5_000;

/**
 * What Pro bills a month, in whole dollars, for the `mrr` property.
 *
 * A constant rather than something read off the subscription: Dodo's
 * subscription payload carries no amount — see `DodoSubscription` in
 * `lib/dodo.ts` — and the price lives on the product in their dashboard. So
 * this has to track the published number in `apps/web/src/lib/pricing.ts`, and
 * cannot import it: `apps/api` and `apps/web` share no code.
 *
 * The lifetime licence is deliberately zero. It is one charge that does not
 * recur, and counting $39 as monthly revenue would overstate MRR by the whole
 * of it every month for ever.
 */
const MRR: Record<Plan, number> = { free: 0, pro: 9, lifetime: 0 };

/** Whoever the contact is about. */
export interface Contact {
  email: string;
  name?: string | null;
}

/**
 * The properties this app owns on a contact.
 *
 * Every one is derived from a row here, which is what makes re-sending any of
 * them safe. Anything a campaign sets lives outside this type and survives,
 * because everything below the creation call is a merge.
 */
export interface Properties {
  plan?: Plan;
  mrr?: number;
  name?: string | null;
  signedUpAt?: string;
}

/**
 * Whether this deployment writes to Mails at all.
 *
 * Exported because `routes/me.ts` has to tell "Mails refused this" apart from
 * "there is no Mails here" — the first is a 502 and the second is a preference
 * recorded locally on a deployment that sends nobody anything. Deriving that
 * rule a second time at the call site is how the two come to disagree about
 * what a half-configured deployment is.
 */
export function enabled(env: Env): boolean {
  return configured(env) !== undefined;
}

function configured(env: Env): { base: string; key: string } | undefined {
  const key = env.MAILS_API_KEY;
  const base = env.MAILS_API_URL;
  if (!key || key.length === 0 || !base || base.length === 0) return undefined;
  return { base: base.replace(/\/+$/, ""), key };
}

/**
 * One request, and the status it answered. Never throws.
 *
 * The status rather than a boolean because one code is actionable: Mails
 * answers 404 `Contact not found` to a `PATCH` for an address it does not hold,
 * and `syncPlan` turns that into a create rather than giving up. Everything
 * else only needs to know whether it landed.
 *
 * The failure is said out loud rather than swallowed, for the reason
 * `lib/slack.ts` gives about a revoked webhook: a key rotated in Mails answers
 * 401 for ever after, and the only symptom is a list that stopped growing —
 * which reads as nobody signing up rather than as a broken integration.
 *
 * `undefined` is "no answer at all" — unconfigured, timed out, or unreachable —
 * and is deliberately not a number, so it can never be mistaken for a 404 and
 * drive the fallback below on a deployment that simply has no Mails.
 */
async function status(
  env: Env,
  path: string,
  body?: unknown,
  method: "POST" | "PATCH" = "POST",
): Promise<number | undefined> {
  const settings = configured(env);
  if (!settings) return undefined;

  try {
    const response = await fetch(`${settings.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${settings.key}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (!response.ok) {
      console.error(`mails: ${method} ${path} answered ${String(response.status)}`);
    }

    return response.status;
  } catch (cause) {
    console.error(`mails: could not reach ${method} ${path}`, cause);
    return undefined;
  }
}

/** The same, for the callers that only care whether it landed. */
async function call(
  env: Env,
  path: string,
  body?: unknown,
  method: "POST" | "PATCH" = "POST",
): Promise<boolean> {
  const code = await status(env, path, body, method);
  return code !== undefined && code >= 200 && code < 300;
}

/**
 * The first name, as a greeting would use it.
 *
 * `user.name` is `NOT NULL` but is whatever the provider handed over — for some
 * accounts a full name, for others a single word, and for a magic-link sign-up
 * the address itself. The first token is the only split that is never wrong in
 * a way "Hi {{firstName}}" would show.
 */
function firstName(name: string | null | undefined): string | undefined {
  return (name ?? "").trim().split(/\s+/)[0] || undefined;
}

/**
 * Creates the contact for a new account.
 *
 * The one place `POST` is correct: there is no contact yet, so there are no
 * properties for a replace to destroy. Called from the Better Auth
 * `user.create.after` hook, which is handed no execution context — so it is
 * awaited, and the five-second timeout above is what bounds what that costs a
 * sign-up.
 *
 * Re-running it on an address that is already a contact is the one way to lose
 * fields here, which is why nothing else calls it. The backfill script
 * (`scripts/sync-mails-contacts.mjs`) is the deliberate exception.
 */
export async function createContact(
  env: Env,
  user: Contact & { createdAt?: Date },
  plan: Plan = "free",
): Promise<boolean> {
  if (!configured(env)) return false;

  return call(env, "/v1/contacts", {
    email: user.email,
    firstName: firstName(user.name),
    properties: {
      name: user.name,
      // A new account is on no plan and inside its trial. Stated rather than
      // left out, so a segment on `plan` matches everybody from the first day
      // instead of only those who have since been through a webhook.
      plan,
      mrr: MRR[plan],
      signedUpAt: (user.createdAt ?? new Date()).toISOString(),
    },
    ...(env.MAILS_LIST_ID ? { lists: [env.MAILS_LIST_ID] } : {}),
  });
}

/** Merges properties into a contact that already exists. */
export async function updateContact(
  env: Env,
  email: string,
  properties: Properties,
): Promise<boolean> {
  return call(env, `/v1/contacts/${encodeURIComponent(email)}`, { properties }, "PATCH");
}

/**
 * Tells Mails what a team now pays, after `applyPlan` has decided it.
 *
 * Addressed by team because that is what a payment knows, and sent to the
 * team's owner because that is who holds the address — the same resolution
 * `personByTeam` in `lib/slack.ts` makes, and for the same reason. Teams are
 * single-member today, so the owner is the only member; if that changes, a
 * plan is still a property of the person who bought it.
 *
 * `applyPlan` returns the resolved plan rather than being told one, so the
 * caller passes what it got back — a team that cancelled Pro while holding the
 * lifetime licence is `lifetime` here, not `free`, which is the distinction
 * that would otherwise put a paying customer into a win-back campaign.
 */
export async function syncPlan(
  env: Env,
  db: Database,
  teamId: string,
  plan: Plan,
): Promise<boolean> {
  if (!configured(env)) return false;

  const [owner] = await db
    .select({
      email: schema.user.email,
      name: schema.user.name,
      createdAt: schema.user.createdAt,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(eq(schema.member.organizationId, teamId))
    .orderBy(schema.member.createdAt)
    .limit(1);

  // A team with no members. Reachable for a team whose only account was
  // deleted, and there is no address to write to — not an error.
  if (!owner) return false;

  const code = await status(
    env,
    `/v1/contacts/${encodeURIComponent(owner.email)}`,
    { properties: { plan, mrr: MRR[plan] } },
    "PATCH",
  );

  if (code !== undefined && code >= 200 && code < 300) return true;

  /**
   * Mails does not hold this address, so there is nothing to merge into.
   *
   * **This is not a rare path and it must not be a silent one.** `createContact`
   * swallows its own failures by design — it runs in a sign-up hook, where
   * throwing would hand somebody an error page for an account they now have —
   * so an address missed at sign-up is missed for good. Add every account that
   * predates this integration, and the first thing most contacts would see is a
   * 404 on the one event worth knowing about: that they started paying.
   *
   * A create is safe precisely because the `PATCH` said there is no contact:
   * the rule at the top of this file is that `POST` may only be used where
   * there are no stored properties to replace, and a 404 is that proof.
   */
  if (code === 404) {
    return createContact(env, owner, plan);
  }

  return false;
}

/**
 * The same, on the way out, so no webhook delivery waits on Mails.
 *
 * The arrangement `notify` in `lib/slack.ts` and `capture` in `lib/posthog.ts`
 * both use: a request must neither wait on, nor fail because of, somewhere we
 * are only telling about it. Dodo in particular retries anything that is not a
 * 2xx, so a slow mailing list would turn into a duplicated delivery.
 */
export function syncPlanLater(
  env: Env,
  ctx: Deferrable,
  db: Database,
  teamId: string,
  plan: Plan,
): void {
  if (!configured(env)) return;
  ctx.waitUntil(syncPlan(env, db, teamId, plan));
}

/**
 * Adds the address to the suppression list, or takes it off again.
 *
 * Awaited by `routes/me.ts` and its result used, which makes this the one
 * caller in the file that is a person waiting rather than something being
 * told. A toggle that says "Saved" over a request Mails refused is how
 * somebody comes to be sent email they switched off, so the route writes our
 * own row only once this has answered.
 *
 * **Resubscribing does not undo everything.** A bounce or a complaint stays
 * suppressed on Mails' side and this cannot reverse it — so a `true` here
 * means the request was accepted, not that the next campaign will reach them.
 */
export async function setSubscribed(
  env: Env,
  email: string,
  subscribed: boolean,
): Promise<boolean> {
  return call(
    env,
    `/v1/contacts/${encodeURIComponent(email)}/${subscribed ? "resubscribe" : "unsubscribe"}`,
  );
}
