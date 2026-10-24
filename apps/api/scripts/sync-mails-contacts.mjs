/**
 * Push every account in production D1 into Mails as a contact.
 *
 * Read-only on our side: one `SELECT` against the live database, then one
 * `POST /v1/contacts` per address. Prints what it would send and sends nothing
 * until `--send` is passed, because `POST /v1/contacts` *replaces* the stored
 * properties object rather than merging into it — a run with a property
 * mis-spelled does not add a bad field, it drops every field that was there
 * before, and there is no undo on the far side.
 *
 *   node apps/api/scripts/sync-mails-contacts.mjs                  # dry run
 *   node apps/api/scripts/sync-mails-contacts.mjs --send
 *   node apps/api/scripts/sync-mails-contacts.mjs --send --list lst_abc123
 *   node apps/api/scripts/sync-mails-contacts.mjs --send --limit 5  # a few first
 *
 * Needs `MAILS_API_KEY`, from the environment or from `apps/api/.dev.vars`
 * alongside everything else; `MAILS_API_URL` defaults to the same origin the
 * Worker uses. Reading the database needs `CLOUDFLARE_API_TOKEN` too:
 * `wrangler` will not fall back to an interactive login from a script and says
 * so rather than hanging.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const api = join(here, "..");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? undefined : argv[at + 1];
};

const send = flag("send");
const listId = value("list");
const limit = value("limit") ? Number(value("limit")) : undefined;
// Four at a time. The endpoint documents no rate limit, so this is slow enough
// to be polite and the 429 handling below is what actually keeps us honest.
const concurrency = Number(value("concurrency") ?? 4);

/**
 * One `KEY=value` file, or nothing if it is not there.
 *
 * Quotes stripped: the repo's own `.env` carries some values quoted and some
 * bare, and a key read as `"mls_…"` with the quotes still on it authenticates
 * against nothing and answers 401 — which reads as a revoked key rather than
 * as a parsing bug.
 */
const parse = (path) => {
  try {
    return Object.fromEntries(
      readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
        .map((line) => [
          line.slice(0, line.indexOf("=")).trim(),
          line
            .slice(line.indexOf("=") + 1)
            .trim()
            .replace(/^["']|["']$/g, ""),
        ]),
    );
  } catch {
    return {};
  }
};

/**
 * Both files, and the environment ahead of either.
 *
 * `apps/api/.dev.vars` is where the Worker's own secrets live, and the repo
 * root `.env` is what `pnpm dev` loads — a key could reasonably be in either,
 * and a script that only read one would report a missing key that is sitting
 * in the other. An exported variable still wins: an operator who sets one for
 * a single run must not be silently handed the one on disk instead.
 */
const vars = { ...parse(join(api, "..", "..", ".env")), ...parse(join(api, ".dev.vars")) };
const key = process.env.MAILS_API_KEY ?? vars.MAILS_API_KEY;
// The same origin `wrangler.jsonc` gives the Worker, defaulted rather than
// required: the key is the thing an operator has to supply, and asking for the
// host as well is how a backfill ends up pointed at the wrong one.
const base = (
  process.env.MAILS_API_URL ??
  vars.MAILS_API_URL ??
  "https://mails-api.haxzie.com"
).replace(/\/+$/, "");

if (send && !key) {
  console.error("MAILS_API_KEY must be set to send — export it or add it to apps/api/.dev.vars");
  process.exit(1);
}

/**
 * One row per account, with the team's plan beside it.
 *
 * `LEFT JOIN` and `GROUP BY`: the hourly cron creates a team for any account
 * that lacks one, so an account that signed up minutes ago may have no `member`
 * row yet. An inner join drops those people from the sync entirely, which reads
 * as "the newest signups never reach Mails" and is the kind of gap nobody
 * notices for months.
 */
const sql = `
  SELECT u.email                AS email,
         u.name                 AS name,
         u.created_at           AS created_at,
         u.email_verified       AS email_verified,
         COALESCE(o.plan, 'free') AS plan,
         (SELECT COUNT(*) FROM video v
           WHERE v.team_id = o.id AND v.status = 'ready' AND v.deleted_at IS NULL)
                                AS shared_videos
  FROM user u
  LEFT JOIN member m ON m.user_id = u.id
  LEFT JOIN organization o ON o.id = m.organization_id
  GROUP BY u.id
  ORDER BY u.created_at
`;

/**
 * The production database's UUID, read out of `wrangler.jsonc`.
 *
 * `cf d1 query` takes an id and refuses a name, unlike `wrangler d1 execute` —
 * so the id has to come from somewhere, and anywhere but the file that already
 * declares it is a second copy to keep in step.
 *
 * It is JSONC and `JSON.parse` is not, so the comments come out and so do the
 * trailing commas — the file has at least one, which is legal there and is a
 * syntax error here.
 */
const databaseId = (() => {
  const config = JSON.parse(
    readFileSync(join(api, "wrangler.jsonc"), "utf8")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/,(\s*[}\]])/g, "$1"),
  );
  const id = config.env?.production?.d1_databases?.[0]?.database_id;
  if (!id) throw new Error("no production database_id in wrangler.jsonc");
  return id;
})();

/**
 * `cf`, not `wrangler`.
 *
 * `wrangler` cannot authenticate from a non-interactive shell: its login is a
 * localhost OAuth callback, and with the stored token expired it refuses and
 * asks for `CLOUDFLARE_API_TOKEN` instead of refreshing. `cf` has a device
 * flow, which is approved out of band and works from anywhere. Both read the
 * same database; only one of them can be logged in from a script.
 */
const query = spawnSync(
  "cf",
  ["d1", "query", databaseId, "--sql", sql.replace(/\s+/g, " ").trim()],
  { cwd: api, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);

if (query.status !== 0) {
  console.error(query.stderr || query.stdout);
  process.exit(1);
}

// `cf` prints a banner for agents ahead of the JSON, so slice from the first
// bracket that opens a line rather than handing the whole thing to
// `JSON.parse` — the banner's own prose contains brackets.
const text = query.stdout.slice(query.stdout.search(/^[[{]/m));
const parsed = JSON.parse(text);
const rows = (Array.isArray(parsed) ? parsed[0]?.results : parsed.result?.[0]?.results) ?? [];

if (rows.length === 0) {
  console.error("the query returned no rows — refusing to call this a finished sync");
  process.exit(1);
}

/**
 * `name` is `NOT NULL` but is whatever the OAuth provider handed over, which
 * for some accounts is the email address and for others a single word. Taking
 * the first token is the only split that is never wrong in a way a greeting
 * would show.
 */
const firstName = (name) => (name ?? "").trim().split(/\s+/)[0] || undefined;

const contacts = rows.slice(0, limit ?? rows.length).map((row) => ({
  email: row.email,
  firstName: firstName(row.name),
  properties: {
    name: row.name,
    plan: row.plan,
    emailVerified: Boolean(row.email_verified),
    sharedVideos: Number(row.shared_videos ?? 0),
    // ISO, not the raw unix seconds the column holds — every segment anyone
    // would build on this ("signed up before the launch sale ended") needs a
    // date the far side can compare, and an integer sorts as a string.
    signedUpAt: new Date(Number(row.created_at) * 1000).toISOString(),
  },
  ...(listId ? { lists: [listId] } : {}),
}));

const plans = contacts.reduce((all, c) => {
  all[c.properties.plan] = (all[c.properties.plan] ?? 0) + 1;
  return all;
}, {});

console.log(`${rows.length} accounts in production`);
console.log(`${contacts.length} to send  ${JSON.stringify(plans)}`);
console.log(`list      ${listId ?? "(none — contacts are created unlisted)"}`);
console.log(`endpoint  ${base || "(unset)"}/v1/contacts`);
console.log("");

if (!send) {
  console.log("dry run — nothing sent. First three payloads:");
  for (const contact of contacts.slice(0, 3)) console.log(JSON.stringify(contact, null, 2));
  console.log("\nre-run with --send to push these.");
  process.exit(0);
}

/**
 * One contact, with the two retries that are worth making.
 *
 * A 429 or a 5xx is the far side asking us to come back; a 4xx is this payload
 * being wrong and will be just as wrong the second time, so it is recorded and
 * skipped rather than retried into the rate limit.
 */
const post = async (contact, attempt = 0) => {
  const response = await fetch(`${base}/v1/contacts`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(contact),
  });

  if (response.ok) return { email: contact.email, ok: true };

  const retryable = response.status === 429 || response.status >= 500;
  if (retryable && attempt < 2) {
    const after = Number(response.headers.get("retry-after"));
    const wait = Number.isFinite(after) && after > 0 ? after * 1000 : 2 ** attempt * 1000;
    await new Promise((resolve) => setTimeout(resolve, wait));
    return post(contact, attempt + 1);
  }

  return {
    email: contact.email,
    ok: false,
    status: response.status,
    body: (await response.text()).slice(0, 300),
  };
};

const queue = [...contacts];
const results = [];

await Promise.all(
  Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let contact = queue.shift(); contact; contact = queue.shift()) {
      const result = await post(contact);
      results.push(result);
      if (!result.ok) console.error(`${result.email}: ${result.status} ${result.body}`);
      if (results.length % 50 === 0) console.log(`${results.length}/${contacts.length}`);
    }
  }),
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} synced, ${failed.length} failed`);

// The failures go to a file as well as the terminal. A partial run is normally
// found out about later, and "which addresses did not land" is the only thing
// needed to finish it — scrolling back through a few thousand lines is not.
if (failed.length > 0) {
  const path = join(api, "mails-sync-failures.json");
  writeFileSync(path, JSON.stringify(failed, null, 2));
  console.log(`failures written to ${path}`);
  process.exit(1);
}
