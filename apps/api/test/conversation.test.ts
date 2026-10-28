/**
 * Who may write under a share link, and what the link lets them read.
 *
 * The property under test is the split: a share link is the permission to
 * *watch*, so reading the conversation needs nothing at all, and writing to it
 * needs a session. Everything else here guards the two ways that goes wrong —
 * a stranger posting as nobody, and an emoji that is not one of ours ending up
 * drawn on the scrub bar of a page sent to strangers.
 */
import {
  applyD1Migrations,
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import app from "../src/index.ts";
import { scalar } from "./helpers.ts";
import { deviceToken, sha256 } from "../src/lib/ids.ts";

let token = "";
let otherToken = "";

const SLUG = "aShareLinkSlug12";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const table of [
    "video_comment",
    "video_reaction",
    "rate_limit",
    "device_token",
    "video",
    "member",
    "organization",
    "user",
  ]) {
    await env.DB.exec(`DELETE FROM ${table}`);
  }

  await env.DB.exec("INSERT INTO user (id, name, email) VALUES ('u1', 'Ana', 'ana@example.com')");
  await env.DB.exec("INSERT INTO user (id, name, email) VALUES ('u2', 'Bo', 'bo@example.com')");
  await env.DB.exec(
    "INSERT INTO organization (id, name, slug, storage_quota_bytes) VALUES ('org1', 'Acme', 'acme', 1000000)",
  );
  await env.DB.exec(
    "INSERT INTO member (id, organization_id, user_id, role) VALUES ('m1', 'org1', 'u1', 'owner')",
  );
  await env.DB.exec(
    "INSERT INTO organization (id, name, slug, storage_quota_bytes) VALUES ('org2', 'Other', 'other', 1000000)",
  );
  await env.DB.exec(
    "INSERT INTO member (id, organization_id, user_id, role) VALUES ('m2', 'org2', 'u2', 'owner')",
  );
  // One line, because `exec` splits on them and a wrapped statement is
  // "incomplete input" from D1 rather than a syntax error anyone can read.
  await env.DB.exec(
    `INSERT INTO video (id, slug, team_id, owner_id, title, status, object_key, content_type, size_bytes, duration_ms) VALUES ('vid1', '${SLUG}', 'org1', 'u1', 'A recording', 'ready', 'videos/vid1.mp4', 'video/mp4', 100, 60000)`,
  );

  token = deviceToken();
  await env.DB.prepare(
    "INSERT INTO device_token (id, token_hash, user_id, label) VALUES ('d1', ?, 'u1', 'Ana-Mac')",
  )
    .bind(await sha256(token))
    .run();

  otherToken = deviceToken();
  await env.DB.prepare(
    "INSERT INTO device_token (id, token_hash, user_id, label) VALUES ('d2', ?, 'u2', 'Bo-Mac')",
  )
    .bind(await sha256(otherToken))
    .run();
});

/** A call with no credential of any kind — a stranger holding the link. */
async function anonymous(path: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const response = await app.fetch(
    new Request(`https://api.prequel.sh${path}`, {
      ...init,
      headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

function as(bearer: string) {
  return (path: string, init: RequestInit = {}) =>
    anonymous(path, { ...init, headers: { authorization: `Bearer ${bearer}` } });
}

const comment = (body: string, bearer = token) =>
  as(bearer)(`/p/${SLUG}/comments`, { method: "POST", body: JSON.stringify({ body }) });

const react = (emoji: string, atMs: number, bearer = token) =>
  as(bearer)(`/p/${SLUG}/reactions`, { method: "POST", body: JSON.stringify({ emoji, atMs }) });

interface Conversation {
  palette: string[];
  comments: { id: string; body: string | null; mine: boolean; author: { name: string } | null }[];
  reactions: { id: string; emoji: string; atMs: number; by: string; mine: boolean }[];
}

const read = async (init?: RequestInit) =>
  (await (
    init ? anonymous(`/p/${SLUG}/conversation`, init) : anonymous(`/p/${SLUG}/conversation`)
  ).then((r) => r.json())) as Conversation;

describe("GET /p/:slug/conversation", () => {
  it("answers a stranger holding the link", async () => {
    await comment("Looks good to me");

    const body = await read();

    expect(body.comments).toHaveLength(1);
    expect(body.comments[0]!.body).toBe("Looks good to me");
    expect(body.comments[0]!.author!.name).toBe("Ana");
    // Nothing in the answer identifies the author beyond their name — the seed
    // is a hash, and a stranger is not the author of anything.
    expect(body.comments[0]!.mine).toBe(false);
    expect(JSON.stringify(body)).not.toContain("ana@example.com");
  });

  it("offers the palette it will accept", async () => {
    const body = await read();
    expect(body.palette.length).toBeGreaterThan(0);

    // Every emoji the page can draw is one a press will be allowed to store.
    for (const emoji of body.palette) {
      expect((await react(emoji, 1000)).status).toBe(201);
    }
  });

  it("marks what the caller wrote themselves", async () => {
    await comment("Mine");
    await comment("Theirs", otherToken);

    const body = (await as(token)(`/p/${SLUG}/conversation`).then((r) => r.json())) as Conversation;

    expect(body.comments.map((row) => row.mine)).toEqual([true, false]);
  });

  it("is 404 for a recording that was deleted", async () => {
    await env.DB.exec("UPDATE video SET deleted_at = unixepoch() WHERE id = 'vid1'");
    expect((await anonymous(`/p/${SLUG}/conversation`)).status).toBe(404);
  });
});

describe("POST /p/:slug/comments", () => {
  it("refuses a stranger", async () => {
    const response = await anonymous(`/p/${SLUG}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: "Hello" }),
    });

    expect(response.status).toBe(401);
    expect(await scalar<number>(env.DB.prepare("SELECT count(*) FROM video_comment"))).toBe(0);
  });

  it("takes a comment from somebody signed in", async () => {
    const response = await comment("**Nice** work");
    expect(response.status).toBe(201);

    const body = (await response.json()) as { id: string; body: string; mine: boolean };
    expect(body.id).toMatch(/^cmt_/);
    // Stored as it was typed. The markdown is the page's to render, and a body
    // escaped on the way in could never be un-escaped.
    expect(body.body).toBe("**Nice** work");
    expect(body.mine).toBe(true);
  });

  it("keeps a script's markup as text rather than refusing it", async () => {
    const response = await comment("<script>alert(1)</script>");
    expect(response.status).toBe(201);

    const stored = await scalar<string>(env.DB.prepare("SELECT body FROM video_comment"));
    expect(stored).toBe("<script>alert(1)</script>");
  });

  it("refuses an empty one", async () => {
    expect((await comment("   ")).status).toBe(400);
  });

  it("refuses one longer than the limit", async () => {
    expect((await comment("x".repeat(4_001))).status).toBe(400);
  });

  it("is 404 for a recording that was deleted", async () => {
    await env.DB.exec("UPDATE video SET deleted_at = unixepoch() WHERE id = 'vid1'");
    expect((await comment("Hello")).status).toBe(404);
  });
});

describe("DELETE /p/:slug/comments/:id", () => {
  it("lets the author take theirs back, and keeps its place", async () => {
    const created = (await comment("Second thoughts").then((r) => r.json())) as { id: string };

    expect(
      (await as(token)(`/p/${SLUG}/comments/${created.id}`, { method: "DELETE" })).status,
    ).toBe(200);

    const body = await read();
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0]!.body).toBeNull();
    expect(body.comments[0]!.author).toBeNull();
  });

  it("lets the owning team clear one somebody else left", async () => {
    const created = (await comment("Rude", otherToken).then((r) => r.json())) as { id: string };

    expect(
      (await as(token)(`/p/${SLUG}/comments/${created.id}`, { method: "DELETE" })).status,
    ).toBe(200);
  });

  it("refuses somebody who is neither, and says nothing about the comment", async () => {
    const created = (await comment("Mine").then((r) => r.json())) as { id: string };

    const response = await as(otherToken)(`/p/${SLUG}/comments/${created.id}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(404);
    expect(
      await scalar<number>(
        env.DB.prepare("SELECT count(*) FROM video_comment WHERE deleted_at IS NULL"),
      ),
    ).toBe(1);
  });
});

describe("POST /p/:slug/reactions", () => {
  it("refuses a stranger", async () => {
    const response = await anonymous(`/p/${SLUG}/reactions`, {
      method: "POST",
      body: JSON.stringify({ emoji: "👍", atMs: 1000 }),
    });

    expect(response.status).toBe(401);
  });

  it("refuses an emoji that is not one of ours", async () => {
    // The palette is fixed precisely so nothing a person can type is drawn on
    // the bar. A sequence long enough to cover the controls is the failure.
    expect((await react("🤡", 1000)).status).toBe(400);
    expect((await react("👍".repeat(200), 1000)).status).toBe(400);
    expect(await scalar<number>(env.DB.prepare("SELECT count(*) FROM video_reaction"))).toBe(0);
  });

  it("keeps several at different moments", async () => {
    await react("👍", 1_000);
    await react("😍", 42_000);
    await react("👍", 42_000, otherToken);

    const body = await read();

    expect(body.reactions.map((row) => row.atMs)).toEqual([1_000, 42_000, 42_000]);
    expect(body.reactions.map((row) => row.by)).toEqual(["Ana", "Ana", "Bo"]);
  });

  it("clamps a press at the very end to the recording's own length", async () => {
    // The client sends the playhead, which at the end of a file reports a hair
    // past the duration the row records. Refusing that would fail the last
    // press of every recording for a rounding difference nobody can see.
    const response = await react("🙌", 60_050);
    expect(response.status).toBe(201);
    expect(((await response.json()) as { atMs: number }).atMs).toBe(60_000);
  });

  it("lets somebody undo their own and nobody else's", async () => {
    const mine = (await react("👍", 1_000).then((r) => r.json())) as { id: string };

    expect(
      (await as(otherToken)(`/p/${SLUG}/reactions/${mine.id}`, { method: "DELETE" })).status,
    ).toBe(404);
    expect((await as(token)(`/p/${SLUG}/reactions/${mine.id}`, { method: "DELETE" })).status).toBe(
      200,
    );
    expect(await scalar<number>(env.DB.prepare("SELECT count(*) FROM video_reaction"))).toBe(0);
  });
});
