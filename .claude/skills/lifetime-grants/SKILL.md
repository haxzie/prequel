---
name: lifetime-grants
description: Comp somebody onto the lifetime plan by hand, or take it back. Use when asked to grant, gift or upgrade an account to lifetime, give a user a free or lifetime plan, sort out a supporter or a refund who should keep the licence, or work out why a team that was granted one is back on free. Covers finding the team from an email address, the two writes that make a grant stick, the convention the existing manual rows use, and what a grant does not give them.
---

# Manual lifetime grants

There is no comp path in the product. `apps/api/src/routes/webhooks/dodo.ts` is
the only code that grants the lifetime licence, and it only runs on a real
payment. A comp is therefore two statements typed straight at the production
database, and this is what they are.

Nothing here touches the repo. A grant is data, not a deploy.

## The one thing to understand first

**The `purchase` row is the entitlement. The `plan` column is a cache of it.**

`resolvePlan` in `apps/api/src/lib/entitlement.ts` derives the tier from the
`subscription` and `purchase` tables; `applyPlan` writes that answer into
`organization.plan` and `storage_quota_bytes`. Every webhook and the hourly
cron call `applyPlan`, and it recomputes from the tables rather than being told
what to write.

So a grant that sets only the column looks correct in the dashboard and
evaporates the next time anything calls `applyPlan` — a Dodo webhook for that
team, or a grace window closing. And a grant that inserts only the row leaves
the column saying `free`, which is what `/v1/me` actually serves. Both writes,
every time.

## Finding the team

Teams are single-member and `organizationLimit` is 1, so an email address
resolves to exactly one team.

```bash
cd apps/api
npx wrangler d1 execute prequel --remote --env production --json --command \
  "SELECT u.id AS user_id, u.email, u.name, o.id AS team_id, o.name AS team_name, o.plan, o.storage_quota_bytes
   FROM user u
   JOIN member m ON m.user_id = u.id
   JOIN organization o ON o.id = m.organization_id
   WHERE u.email = 'someone@example.com'"
```

No rows means no account, not a missing team — the cron creates a team for any
account that lacks one. Check the spelling of the address before concluding
they never signed up.

Check for an existing `purchase` or `subscription` row on that team before
writing. `purchase.team_id` is unique, so a second insert fails rather than
doing anything silly, but a team already on Pro does not need this at all.

## Making the grant

Two statements, one command. `created_at` defaults to `unixepoch()`.

```bash
npx wrangler d1 execute prequel --remote --env production --json --command \
  "INSERT INTO purchase (id, team_id, dodo_payment_id, dodo_customer_id, product_id)
   VALUES ('pur_<21 chars>', '<team_id>', 'manual-grant-pur_<same 21 chars>', 'manual-grant', 'manual-lifetime-grant');
   UPDATE organization SET plan='lifetime', storage_quota_bytes=5000000000 WHERE id='<team_id>';"
```

The id is the project's own format — `pur_` and 21 base58 characters, the same
shape `id()` in `apps/api/src/lib/ids.ts` emits. Generate one rather than
inventing characters by hand:

```bash
node -e 'const A="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const b=require("crypto").randomBytes(21);let o="";for(const x of b)o+=A[x%A.length];
console.log("pur_"+o)'
```

`5000000000` is `LIFETIME_QUOTA_BYTES` — decimal, not binary, and it has to
stay that way. The dashboard prints it with a base-1000 formatter, so
`5 * 1024 ** 3` reaches the user as "5.4 GB", a number nobody was quoted.

Read the row back afterwards. A `changes: 1` on each statement is the write
landing, not the result being right.

### The fields, and why they say that

| Column             | Value                   | Why                                                                   |
| ------------------ | ----------------------- | --------------------------------------------------------------------- |
| `dodo_payment_id`  | `manual-grant-<row id>` | `NOT NULL` and unique. Embedding the row id makes it unique for free. |
| `dodo_customer_id` | `manual-grant`          | `NOT NULL`. There is no payer at Dodo to name.                        |
| `product_id`       | `manual-lifetime-grant` | Keeps comps separable from real sales in any revenue query.           |

That last one is the whole reason these are not given the live product id. The
schema keeps `product_id` verbatim so a future product is separable, and a comp
counted as a `pdt_0Nmfhrp46FPz4Y0C8ExmS` sale is revenue that never existed.

**One older row does not follow this.** `pur_pzHLejYRidJ7JqprtMsLe` uses
`manual_<date>_<username>` with `dodo_customer_id: manual` and the real
lifetime product id. It predates the convention. Match the `manual-grant` rows
and leave that one alone — rewriting it to match would be a production write
that buys nothing.

## What a grant does not give them

**The billing portal will not open.** `customerId()` returns whatever is in
`dodo_customer_id`, which for a comp is the literal `manual-grant`. That is a
truthy value, so `POST /v1/billing/portal` sails past its own "never paid for
anything" 404 and fails at Dodo instead, on a customer that does not exist.
Tell them the portal is not for them rather than letting them find the error.

**There is no receipt and no invoice.** Nothing was charged, so Dodo has
nothing to show. If somebody needs paperwork, they need a real transaction.

**It is not a refund.** A comp on top of a real payment leaves the payment
where it is; refunding is separate and happens in Dodo.

## After the write

`/v1/me` reads `organization.plan` and `storage_quota_bytes` straight off the
row on every call, so the change is live immediately — no deploy, no
re-sign-in. A client that has already fetched keeps its copy until it asks
again; opening the dashboard or restarting the Mac app is enough.

It also ends any trial messaging. `trialStatus` in `apps/api/src/lib/trial.ts`
takes the plan, and a team on `lifetime` is no longer counting days down.

## Taking one back

Mirror the grant. The row and the column, in that order, so nothing observes
`free` with a licence still sitting behind it:

```bash
npx wrangler d1 execute prequel --remote --env production --json --command \
  "DELETE FROM purchase WHERE team_id='<team_id>' AND dodo_customer_id='manual-grant';
   UPDATE organization SET plan='free', storage_quota_bytes=2000000000 WHERE id='<team_id>';"
```

The `dodo_customer_id` guard is deliberate: without it the same statement
deletes a licence somebody paid for, and there is no other record of that
purchase on this side.

**Check what they are storing first.** Dropping the quota from 5 GB to 2 GB
does not delete anything — the uploader only refuses new videos — but a team
left over quota can no longer share, which they will read as the product
breaking rather than as a plan change.

## Comping Pro

No precedent, and it is not the same shape. Pro is a subscription, so
entitlement comes from a `subscription` row with `status = 'active'`, and the
cron sweeps subscriptions on `graceUntil` — a fabricated one is something the
hourly job will form opinions about. Lifetime has no status and no end date,
which is exactly why it is the one that comps cleanly.

If somebody needs unlimited storage rather than 5 GB, say so and agree the
approach before writing anything.
