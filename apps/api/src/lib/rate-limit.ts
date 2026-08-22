/**
 * A transcription allowance that survives a deploy.
 *
 * What this replaces was an in-memory `Map` in a Next route handler, and both
 * that route and the web README said plainly what was wrong with it: per
 * instance, reset on every deploy. The effective limit was "12 an hour, times
 * however many lambdas happen to be warm, divided by how recently we shipped".
 *
 * Fixed windows rather than a sliding one. A sliding window needs the timestamps
 * of every call kept and filtered, which is what the `Map` did; a fixed window
 * is one integer. The cost is that an allowance can be spent twice across a
 * boundary, which for a cost control on a paid API is not worth a second table.
 */
import { and, eq, sql } from "drizzle-orm";

import { schema } from "@prequel/db";

import type { Database } from "../db.ts";

export interface Allowance {
  limit: number;
  windowSeconds: number;
}

/**
 * Spends one unit, and says whether there was one to spend.
 *
 * The window's start is part of the key, so a new window is an insert and a
 * continuing one is an update. There is no read-then-write for two concurrent
 * requests to interleave inside — the `where count < limit` on the update is
 * what makes the decision, and D1 evaluates it as one statement.
 */
export async function take(
  db: Database,
  subject: string,
  { limit, windowSeconds }: Allowance,
): Promise<boolean> {
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;

  // `on conflict do nothing`: the row may already exist, and racing to create it
  // is not an error. Whichever request loses simply falls through to the update.
  await db
    .insert(schema.rateLimit)
    .values({ subject, windowStart, count: 0 })
    .onConflictDoNothing();

  const claimed = await db
    .update(schema.rateLimit)
    .set({ count: sql`${schema.rateLimit.count} + 1` })
    .where(
      and(
        eq(schema.rateLimit.subject, subject),
        eq(schema.rateLimit.windowStart, windowStart),
        sql`${schema.rateLimit.count} < ${limit}`,
      ),
    )
    .returning({ count: schema.rateLimit.count });

  return claimed.length > 0;
}

/**
 * Drops windows that have finished.
 *
 * Called opportunistically from the request path through `waitUntil`, not on a
 * timer — a Worker has no timer that outlives a request, and a cron trigger for
 * a table this small would be a deployment surface for no benefit. The `2 *`
 * keeps the immediately-previous window around, which costs nothing and means a
 * request arriving as the boundary passes cannot delete the row it is using.
 */
export function sweep(db: Database, windowSeconds: number): Promise<unknown> {
  const cutoff = Math.floor(Date.now() / 1000) - 2 * windowSeconds;
  return db.delete(schema.rateLimit).where(sql`${schema.rateLimit.windowStart} < ${cutoff}`);
}
