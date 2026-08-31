/**
 * The team every account gets, and the name it starts with.
 *
 * There used to be a page for this: sign in, name your team, then the
 * dashboard. It was one step, and it was the only step that could fail — which
 * it did, for a week, leaving people signed in and owning nothing. A step that
 * can only ever produce one outcome is better done for the user than asked of
 * them, so the team is created with the account and nothing is asked.
 *
 * The name is a guess, which is the cost of not asking. It is a guess the user
 * can change, and `suggestName` below is the same rule the form used to fill
 * its field with — so what an account ends up called is what the form would
 * have offered anyway, minus the click.
 *
 * `ensureTeam` is idempotent by check-then-act rather than by constraint. There
 * is no unique index on `member.userId` and there should not be: one member per
 * team is what the product does today, not what the table means, and the index
 * would have to come off again the first time somebody is invited anywhere.
 */
import { eq } from "drizzle-orm";

import { schema } from "@prequel/db";

import type { Database } from "../db.ts";
import { id } from "./ids.ts";

/**
 * Domains that are somebody's mail provider rather than somebody's employer.
 *
 * "Gmail" is not a team anybody works at, and offering it as a name would be
 * worse than falling back to their own. Moved here from the onboarding page
 * along with the rest of the rule.
 */
const CONSUMER = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "fastmail.com",
]);

/**
 * A team name, from the email's domain where that domain is an employer, and
 * from the person's own name where it is not.
 */
export function suggestName(name: string, email: string): string {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";

  if (domain && !CONSUMER.has(domain)) {
    const label = domain.split(".")[0] ?? "";
    if (label) return label.charAt(0).toUpperCase() + label.slice(1);
  }

  const first = name.trim().split(/\s+/)[0];
  return first ? `${first}'s team` : "My team";
}

const TAIL = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * A URL-safe slug, with a random tail.
 *
 * The tail is not decoration: slugs are unique across every team on Prequel,
 * and "Acme" is a name several unrelated companies will pick. Without it the
 * second one to sign up hits a constraint violation — which, now that this runs
 * during sign-up rather than behind a form, would be a failed registration
 * rather than a message on a page somebody can retype.
 */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    // The combining marks NFKD just split off, dropped rather than left to be
    // treated as separators. Without this "Café Ltd" slugifies to `caf-ltd`,
    // because the accent becomes a word boundary — which is what the onboarding
    // form did to anybody outside ASCII.
    //
    // Only what NFKD decomposes. A letter that is not an accented base — ø, ð,
    // æ — is still dropped, and the answer for those is a transliteration table
    // rather than another regex. Not worth one: the tail below is what makes a
    // slug unique, and nothing reads a team slug as its identity.
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);

  const bytes = crypto.getRandomValues(new Uint8Array(5));
  let tail = "";
  for (const byte of bytes) tail += TAIL[byte % TAIL.length];

  return `${base || "team"}-${tail}`;
}

/**
 * The team this user owns, creating it if they have none.
 *
 * Returns the team's id, or null if it could not be created — every caller
 * treats that as "carry on without one" rather than as a failure of whatever
 * they were actually doing. Sign-up must not fail because a name collided, and
 * the sweep in `cron.ts` picks up anyone this missed.
 */
export async function ensureTeam(
  db: Database,
  user: { id: string; name: string; email: string },
): Promise<string | null> {
  const [existing] = await db
    .select({ organizationId: schema.member.organizationId })
    .from(schema.member)
    .where(eq(schema.member.userId, user.id))
    .orderBy(schema.member.createdAt)
    .limit(1);

  if (existing) return existing.organizationId;

  const teamId = id("org");
  const name = suggestName(user.name, user.email);

  await db.insert(schema.organization).values({
    id: teamId,
    name,
    slug: slugify(name),
    // The whole reason this column exists: the membership below is a second
    // write, and if it is the one that fails then this is the only thing left
    // saying whose team this was. `cron.ts` repairs from it.
    createdBy: user.id,
  });

  await db.insert(schema.member).values({
    id: id("mem"),
    organizationId: teamId,
    userId: user.id,
    role: "owner",
  });

  return teamId;
}
