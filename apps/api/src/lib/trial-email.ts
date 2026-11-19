/**
 * The one email a lapsed trial gets.
 *
 * A trial ending is not an event. It is `user.createdAt` plus seven days going
 * past — see `lib/trial.ts`, where the whole thing is a pure function of the
 * clock — so there is no webhook, no row changing state and nothing to hang a
 * send off. A sweep is the only way anybody hears about it, which is the same
 * reason `expireGrace` exists in `cron.ts`.
 *
 * **Nothing here decides whether somebody is allowed to export.** The app
 * works that out for itself from the plan and the end date it is handed, and a
 * send that never happened must not change what somebody can do. This writes
 * no entitlement and reads the plan only to know who to leave alone.
 */
import { and, eq, gte, isNull, lt, or } from "drizzle-orm";

import { schema } from "@prequel/db";

import type { Database } from "../db.ts";
import type { Env } from "../env.ts";
import { emailShell, sendEmail } from "./ses.ts";
import { TRIAL_DAYS } from "./trial.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far back a run will look for a trial that ended.
 *
 * A day would be the literal reading of "expired today" and is the wrong
 * number: one missed run — a deploy, a Cloudflare incident, a schedule edited
 * at the wrong hour — and everybody inside that day is never written to at
 * all, because the window has moved past them and nothing remembers they were
 * skipped.
 *
 * Three days is two missed runs' worth of slack. It is only safe because
 * `trial_email` makes the send idempotent: widening this window cannot email
 * anybody twice, it can only catch somebody the first time.
 */
const CATCH_UP_DAYS = 3;

/**
 * The most that is written to in one run.
 *
 * The window above already bounds this to a few days of sign-ups, so it is
 * never reached in normal running. It is here for the run after somebody
 * widens that window or backfills the table: the bound on a mistake is then
 * one batch rather than every account there has ever been, and the next run an
 * hour later picks up where this one stopped.
 */
const MAX_PER_RUN = 100;

/** What `/app/settings/billing` is reached at. */
const billingUrl = (env: Env) => new URL("/app/settings/billing", env.APP_URL).toString();

/** Where somebody turns this kind of email off. */
const settingsUrl = (env: Env) => new URL("/app/settings", env.APP_URL).toString();

interface Lapsed {
  id: string;
  name: string | null;
  email: string;
}

/**
 * Everybody whose trial has just run out and who has not been written to.
 *
 * Four conditions, and each one is somebody it would be wrong to email:
 *
 * - still on `free`, so nobody who has already paid is asked to pay. Read off
 *   `organization.plan`, which is the flag the rest of the app reads — a team
 *   holding the lifetime licence is not `free` and is not here.
 * - no `trial_email` row, which is the idempotency check.
 * - `marketing` not turned off. No row means subscribed, so the absence of a
 *   preference is a yes — see `emailPreference`.
 * - the trial actually ended, and ended recently.
 *
 * The join through `member` also quietly drops an account with no team. That
 * is a broken account rather than a lapsed one, and the hourly sweep is
 * already repairing it; emailing somebody about a plan while their team is
 * missing would be asking them to pay for an account that does not work yet.
 */
async function lapsed(db: Database, now: number): Promise<Lapsed[]> {
  const endedBefore = new Date(now - TRIAL_DAYS * DAY_MS);
  const endedAfter = new Date(now - (TRIAL_DAYS + CATCH_UP_DAYS) * DAY_MS);

  return db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
    })
    .from(schema.user)
    .innerJoin(schema.member, eq(schema.member.userId, schema.user.id))
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .leftJoin(schema.emailPreference, eq(schema.emailPreference.userId, schema.user.id))
    .leftJoin(schema.trialEmail, eq(schema.trialEmail.userId, schema.user.id))
    .where(
      and(
        eq(schema.organization.plan, "free"),
        isNull(schema.trialEmail.userId),
        or(isNull(schema.emailPreference.userId), eq(schema.emailPreference.marketing, true)),
        lt(schema.user.createdAt, endedBefore),
        gte(schema.user.createdAt, endedAfter),
      ),
    )
    .limit(MAX_PER_RUN);
}

/**
 * Sends to everybody whose trial lapsed, once each.
 *
 * Exported for the cron and for the tests. `now` is injectable because every
 * interesting case here is a date boundary, and a test that has to wait seven
 * days to reach one is a test nobody runs.
 */
export async function sweepLapsedTrials(env: Env, db: Database, now = Date.now()): Promise<void> {
  const people = await lapsed(db, now);
  if (people.length === 0) return;

  let sent = 0;
  for (const person of people) {
    // One address failing must not stop the sweep, the same as every other
    // step in `cron.ts`: a suppressed recipient has nothing to do with the
    // next person in the list.
    const ok = await sendOne(env, db, person).catch((error: unknown) => {
      console.error("trial email failed", person.id, error);
      return false;
    });
    if (ok) sent += 1;
  }

  console.warn(`trial email: ${sent} sent of ${people.length} lapsed`);
}

/**
 * Claims the account, then writes to it.
 *
 * **The claim comes first, and the order is the whole design.** If the send
 * came first, anything that interrupted the run between sending and recording
 * it — a Worker evicted, a D1 write refused — would leave somebody who has
 * been emailed with no row saying so, and the next run would email them again.
 * Claiming first means the opposite failure: a send that throws leaves a row
 * saying this account has been dealt with when it has not, and nobody retries.
 *
 * That is the right way round. Being asked twice to pay for something reads as
 * a product that does not know who you are, and it is the failure the
 * recipient sees; a missed one is invisible to them and costs us one email.
 * The log line above is what makes the missed ones findable.
 */
async function sendOne(env: Env, db: Database, person: Lapsed): Promise<boolean> {
  try {
    await db.insert(schema.trialEmail).values({ userId: person.id });
  } catch {
    // The primary key refused it, so another run has this account. Not an
    // error: this is the check doing its job.
    return false;
  }

  await sendEmail(env, {
    to: person.email,
    subject: "Your free week of Prequel is up",
    text: text(env, person),
    html: html(env, person),
  });

  return true;
}

/** The first name, or nothing — never "there". */
function greeting(name: string | null): string {
  const first = name?.trim().split(/\s+/)[0];
  return first ? `Hi ${first},` : "Hi,";
}

/**
 * What the email says, and what it is careful not to say.
 *
 * **It is written to a person, not to a segment.** Short sentences, no
 * features list, no urgency, no discount. Somebody who tried a thing for a
 * week and did not pay for it is owed a straight account of where they stand
 * and a thank you, and nothing else moves the needle anyway.
 *
 * The claim about what still works is checked rather than assumed:
 * `UpgradeDialog` in the app blocks the export and leaves the recordings, the
 * edits and every finished file alone. It says so in the same breath this
 * does, deliberately — somebody who reads this and then opens Prequel should
 * be told the same thing twice, not two different things.
 *
 * The month is written and never annualised, and the lifetime price is stated
 * without a struck price beside it — the rules in `apps/web/src/lib/pricing.ts`,
 * which this cannot import because `apps/api` and `apps/web` share no code.
 *
 * The reply invitation is real. It goes to `SES_FROM`, so it has to stay a
 * mailbox somebody reads; the day it is not, this line comes out.
 */
const HEADING = "Your free week is up";

/**
 * The opening line, which the two parts cannot share.
 *
 * The HTML has `HEADING` above it, so repeating "your free week is up" in the
 * first paragraph reads as a stutter. The plain-text part has no heading at
 * all, so it has to carry the fact itself or it opens on a pleasantry about
 * nothing.
 */
const OPENER_HTML = "I hope you made something good with it.";
const OPENER_TEXT = `Your free week of Prequel is up \u2014 ${OPENER_HTML}`;

const BODY = [
  "Everything you\u2019ve already made is still yours. The recordings, the edits " +
    "and the files you exported are on your Mac and they stay there. The only " +
    "thing that stops is making new ones.",
  "If you\u2019d like to keep going, it\u2019s $9 a month, or $39 once if you\u2019d " +
    "rather just own it.",
  "And if Prequel wasn\u2019t for you, I\u2019d really like to know why. Just hit " +
    "reply \u2014 I read every one.",
];

const SIGN_OFF = "Thanks for giving it a go,";

function text(env: Env, person: Lapsed): string {
  return `${greeting(person.name)}

${OPENER_TEXT}

${BODY[0]}

${BODY[1]}

${billingUrl(env)}

${BODY[2]}

${SIGN_OFF}
Musthaq, Creator of Prequel

Turn these emails off: ${settingsUrl(env)}`;
}

function html(env: Env, person: Lapsed): string {
  const p = (inner: string) => `<p style="margin:0 0 14px">${inner}</p>`;

  return emailShell(
    env.APP_URL,
    HEADING,
    [
      p(greeting(person.name)),
      p(OPENER_HTML),
      ...BODY.map((line) => p(line)),
      p(`${SIGN_OFF}<br />Musthaq, Creator of Prequel`),
    ].join(""),
    { href: billingUrl(env), label: "Keep using Prequel" },
    `You are getting this because you started a Prequel trial. ` +
      `<a href="${settingsUrl(env)}" style="color:#6b6f76">Turn these emails off</a>.`,
  );
}
