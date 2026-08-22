/**
 * The handshake that signs a Mac in, and the three ways it must refuse.
 *
 * A `prequel://` link is not a private channel: macOS logs it, and another
 * application can register the same scheme and be handed it instead. Everything
 * that makes intercepting one useless is on this side of the wire — the code is
 * single-use, short-lived, and worthless without a verifier that never left the
 * app. None of those failures is loud. A code that could be replayed would work
 * perfectly in every manual test.
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

const VERIFIER = "a".repeat(43);

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const table of [
    "desktop_auth_code",
    "device_token",
    "video",
    "member",
    "organization",
    "user",
  ]) {
    await env.DB.exec(`DELETE FROM ${table}`);
  }

  await env.DB.exec(
    "INSERT INTO user (id, name, email, email_verified) VALUES ('u1', 'Ana', 'ana@example.com', 1)",
  );
  await env.DB.exec("INSERT INTO organization (id, name, slug) VALUES ('org1', 'Acme', 'acme')");
  await env.DB.exec(
    "INSERT INTO member (id, organization_id, user_id, role) VALUES ('m1', 'org1', 'u1', 'owner')",
  );
});

/** Puts a code in the database the way `/v1/desktop/authorize` would. */
async function seedCode(options: { code: string; verifier: string; expiresInMs?: number }) {
  const challenge = await sha256(options.verifier);
  const expires = Math.floor((Date.now() + (options.expiresInMs ?? 5 * 60 * 1000)) / 1000);

  await env.DB.prepare(
    "INSERT INTO desktop_auth_code (code, challenge, user_id, team_id, expires_at) VALUES (?, ?, 'u1', 'org1', ?)",
  )
    .bind(options.code, challenge, expires)
    .run();
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const ctx = createExecutionContext();
  const response = await app.fetch(
    new Request(`https://api.prequel.sh${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

/**
 * A ready video in a team.
 *
 * `prepare().run()` rather than `exec`: D1's `exec` splits its input on
 * newlines, so a statement written across several lines arrives truncated with
 * a syntax error that names none of that.
 */
function seedVideo(id: string, teamId: string, ownerId: string, sizeBytes = 100) {
  return env.DB.prepare(
    "INSERT INTO video (id, slug, team_id, owner_id, title, status, object_key, content_type, size_bytes) VALUES (?, ?, ?, ?, 'A recording', 'ready', ?, 'video/mp4', ?)",
  )
    .bind(id, `slug-${id}`, teamId, ownerId, `videos/${teamId}/${id}.mp4`, sizeBytes)
    .run();
}

async function get(path: string, headers: Record<string, string> = {}) {
  const ctx = createExecutionContext();
  const response = await app.fetch(
    new Request(`https://api.prequel.sh${path}`, { headers }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

describe("POST /v1/desktop/token", () => {
  it("trades a code and its verifier for a token", async () => {
    await seedCode({ code: "c1", verifier: VERIFIER });

    const response = await post("/v1/desktop/token", { code: "c1", verifier: VERIFIER });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { token: string; team: { name: string } | null };
    expect(body.token).toMatch(/^prq_/);
    expect(body.team?.name).toBe("Acme");
  });

  it("refuses the wrong verifier", async () => {
    await seedCode({ code: "c1", verifier: VERIFIER });

    // Somebody who saw the deep link has the code and not this. That is the
    // entire security property.
    const response = await post("/v1/desktop/token", { code: "c1", verifier: "b".repeat(43) });
    expect(response.status).toBe(400);
  });

  it("refuses a code that has already been used", async () => {
    await seedCode({ code: "c1", verifier: VERIFIER });

    expect((await post("/v1/desktop/token", { code: "c1", verifier: VERIFIER })).status).toBe(200);

    // macOS will happily deliver the same link twice if the button is pressed
    // twice, so this is an ordinary occurrence rather than an attack.
    const replay = await post("/v1/desktop/token", { code: "c1", verifier: VERIFIER });
    expect(replay.status).toBe(400);

    const tokens = await scalar<number>(env.DB.prepare("SELECT count(*) FROM device_token"));
    expect(tokens).toBe(1);
  });

  it("refuses a code that has expired", async () => {
    await seedCode({ code: "c1", verifier: VERIFIER, expiresInMs: -1000 });

    const response = await post("/v1/desktop/token", { code: "c1", verifier: VERIFIER });
    expect(response.status).toBe(400);
  });

  it("says the same thing however it refuses", async () => {
    await seedCode({ code: "c1", verifier: VERIFIER });

    const unknown = await post("/v1/desktop/token", { code: "nope", verifier: VERIFIER });
    const wrong = await post("/v1/desktop/token", { code: "c1", verifier: "b".repeat(43) });

    // Distinguishing "no such code" from "wrong verifier" would confirm to
    // somebody guessing codes that a given one exists, which is the only thing
    // they would need this endpoint for.
    expect(await unknown.json()).toEqual(await wrong.json());
  });

  it("stores the token hashed, never in the clear", async () => {
    await seedCode({ code: "c1", verifier: VERIFIER });

    const body = (await (
      await post("/v1/desktop/token", { code: "c1", verifier: VERIFIER })
    ).json()) as {
      token: string;
    };

    const stored = await scalar<string>(env.DB.prepare("SELECT token_hash FROM device_token"));

    expect(stored).not.toBe(body.token);
    expect(stored).toBe(await sha256(body.token));
  });
});

describe("a device token's reach", () => {
  /** Signs a second user in, in a team of their own. */
  async function seedOtherTeam(): Promise<string> {
    await env.DB.exec("INSERT INTO user (id, name, email) VALUES ('u2', 'Sam', 'sam@example.com')");
    await env.DB.exec(
      "INSERT INTO organization (id, name, slug) VALUES ('org2', 'Other', 'other')",
    );
    await env.DB.exec(
      "INSERT INTO member (id, organization_id, user_id, role) VALUES ('m2', 'org2', 'u2', 'owner')",
    );

    // The real generator, so the header parser is exercised on the shape it
    // actually has to accept.
    const token = deviceToken();
    await env.DB.prepare(
      "INSERT INTO device_token (id, token_hash, user_id, label) VALUES ('d2', ?, 'u2', 'Sam-Mac')",
    )
      .bind(await sha256(token))
      .run();

    return token;
  }

  it("cannot read another team's library", async () => {
    await seedVideo("v1", "org1", "u1");

    const other = await seedOtherTeam();
    const response = await get("/v1/videos", { authorization: `Bearer ${other}` });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { videos: unknown[] };
    expect(body.videos).toHaveLength(0);
  });

  it("cannot delete another team's recording", async () => {
    await seedVideo("v1", "org1", "u1");

    const other = await seedOtherTeam();
    const ctx = createExecutionContext();
    const response = await app.fetch(
      new Request("https://api.prequel.sh/v1/videos/v1", {
        method: "DELETE",
        headers: { authorization: `Bearer ${other}` },
      }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    // 404 rather than 403: whether a video exists in a team you are not in is
    // not something this endpoint should confirm either.
    expect(response.status).toBe(404);

    const deleted = await scalar<number>(
      env.DB.prepare("SELECT count(*) FROM video WHERE deleted_at IS NOT NULL"),
    );
    expect(deleted).toBe(0);
  });

  it("is refused once revoked", async () => {
    const other = await seedOtherTeam();
    await env.DB.exec("UPDATE device_token SET revoked_at = unixepoch() WHERE id = 'd2'");

    const response = await get("/v1/videos", { authorization: `Bearer ${other}` });
    expect(response.status).toBe(401);
  });
});

describe("GET /v1/me", () => {
  /**
   * A session can outlive the user it belongs to.
   *
   * Sessions are cookie-cached — a signed snapshot good for five minutes with no
   * database read — so deleting a user does not immediately invalidate their
   * session, and a session orphaned some other way never expires at all. The
   * handler used to answer 200 with the `user` key simply missing, which parses
   * fine and then throws on `me.user.name` in a dashboard page.
   */
  it("refuses a session whose user is gone", async () => {
    const token = deviceToken();
    await env.DB.prepare(
      "INSERT INTO device_token (id, token_hash, user_id, label) VALUES ('d9', ?, 'u1', 'Ghost-Mac')",
    )
      .bind(await sha256(token))
      .run();

    expect((await get("/v1/me", { authorization: `Bearer ${token}` })).status).toBe(200);

    await env.DB.exec("DELETE FROM \"user\" WHERE id = 'u1'");

    const response = await get("/v1/me", { authorization: `Bearer ${token}` });
    expect(response.status).toBe(401);

    // Specifically not a 200 with a hole in it.
    expect(await response.json()).not.toHaveProperty("user");
  });
});
