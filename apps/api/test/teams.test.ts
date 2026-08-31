/**
 * Every account has a team, and only one.
 *
 * The team used to come from a form, which made it the one step of sign-up that
 * could fail — and when it did, for a week, it left people signed in and owning
 * nothing. It is created with the account now, so the interesting cases are no
 * longer about the happy path: they are about the three places that guarantee
 * it, and about not handing somebody a second team on the way.
 */
import {
  applyD1Migrations,
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import app from "../src/index.ts";
import { scheduled } from "../src/cron.ts";
import { deviceToken, sha256 } from "../src/lib/ids.ts";
import { ensureTeam, slugify, suggestName } from "../src/lib/teams.ts";
import { database } from "../src/db.ts";
import { scalar } from "./helpers.ts";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const table of ["device_token", "video", "subscription", "member", "organization", "user"]) {
    await env.DB.exec(`DELETE FROM ${table}`);
  }
});

const teamsOf = (userId: string) =>
  scalar<number>(env.DB.prepare("SELECT COUNT(*) FROM member WHERE user_id = ?").bind(userId));

describe("suggestName", () => {
  it("names the team after the employer, not the mail provider", () => {
    expect(suggestName("Conrad Pollack", "conrad@actaport.de")).toBe("Actaport");
    expect(suggestName("Pradhumn", "pradhumn@fasttrackr.ai")).toBe("Fasttrackr");
  });

  it("falls back to the person for a consumer address", () => {
    // "Gmail" is not a team anybody works at, and it is the single most common
    // domain a signup will arrive on.
    expect(suggestName("Steve Kay", "stevekay686@gmail.com")).toBe("Steve's team");
    expect(suggestName("Kobi", "kobisa@icloud.com")).toBe("Kobi's team");
  });

  it("still answers when there is no name at all", () => {
    // Magic-link sign-ups can arrive with an empty name, and a team called ""
    // would render as a blank heading on every dashboard page.
    expect(suggestName("", "someone@gmail.com")).toBe("My team");
  });
});

describe("slugify", () => {
  it("does not collide for two teams with the same name", () => {
    // The reason the tail exists. Without it the second "Acme" to sign up fails
    // its registration, where it used to only fail a form somebody could retype.
    const slugs = new Set(Array.from({ length: 200 }, () => slugify("Acme")));
    expect(slugs.size).toBe(200);
  });

  it("survives a name with nothing URL-safe in it", () => {
    // The fallback matters: a slug of "" would collide with every other such
    // name, and the row would be refused at the unique index.
    expect(slugify("....")).toMatch(/^team-[a-z0-9]{5}$/);
  });

  it("keeps accented letters instead of cutting the name at them", () => {
    expect(slugify("Café Ltd")).toMatch(/^cafe-ltd-[a-z0-9]{5}$/);
  });

  it("always produces something URL-safe", () => {
    for (const name of ["Ünïcødé Ltd", "日本語", "Acme & Co.", "  ", "🎬"]) {
      expect(slugify(name)).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

describe("ensureTeam", () => {
  const ana = { id: "u1", name: "Ana Diaz", email: "ana@gmail.com" };

  beforeEach(async () => {
    await env.DB.exec(
      "INSERT INTO user (id, name, email) VALUES ('u1', 'Ana Diaz', 'ana@gmail.com')",
    );
  });

  it("creates a team owned by the account, with the creator recorded", async () => {
    const teamId = await ensureTeam(database(env), ana);

    expect(teamId).not.toBeNull();
    expect(await teamsOf("u1")).toBe(1);
    expect(await scalar(env.DB.prepare("SELECT role FROM member"))).toBe("owner");
    expect(await scalar(env.DB.prepare("SELECT created_by FROM organization"))).toBe("u1");
    expect(await scalar(env.DB.prepare("SELECT name FROM organization"))).toBe("Ana's team");
  });

  it("is idempotent, so nothing that calls it twice creates two teams", async () => {
    // Three call sites reach this — the sign-up hook, `/v1/me` and the sweep —
    // and they deliberately overlap. Overlapping must be free.
    const first = await ensureTeam(database(env), ana);
    const second = await ensureTeam(database(env), ana);

    expect(second).toBe(first);
    expect(await teamsOf("u1")).toBe(1);
  });
});

describe("an account that ended up with no team", () => {
  beforeEach(async () => {
    await env.DB.exec("INSERT INTO user (id, name, email) VALUES ('u1', 'Ana', 'ana@gmail.com')");
  });

  it("is given one by the hourly sweep", async () => {
    // For somebody who only ever signs in from the Mac and never opens the
    // dashboard — nothing else would ever fix them.
    await scheduled(env);

    expect(await teamsOf("u1")).toBe(1);
  });

  it("is given one by /v1/me, without waiting for the sweep", async () => {
    const token = deviceToken();
    await env.DB.prepare(
      "INSERT INTO device_token (id, token_hash, user_id, label) VALUES ('d1', ?, 'u1', 'Mac')",
    )
      .bind(await sha256(token))
      .run();

    const ctx = createExecutionContext();
    const response = await app.fetch(
      new Request("https://api.prequel.sh/v1/me", {
        headers: { authorization: `Bearer ${token}` },
      }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);

    const body = (await response.json()) as { teams: { name: string }[]; activeTeamId: string };

    // Answered *with* the team, not merely having created one for next time.
    // The dashboard renders off this payload and has nowhere else to go.
    expect(body.teams).toHaveLength(1);
    expect(body.teams[0]?.name).toBe("Ana's team");
    expect(body.activeTeamId).toBe(body.teams[0] && (body.teams[0] as { id?: string }).id);
    expect(await teamsOf("u1")).toBe(1);
  });

  it("is not given a second one once the sweep has repaired the first", async () => {
    // `settleTeams` runs before `settleUsers`, so a team that merely lost its
    // membership is reunited with it rather than the user being handed a new
    // one and the old shell deleted underneath them.
    await env.DB.prepare(
      "INSERT INTO organization (id, name, slug, created_by, created_at) VALUES ('org1', 'Theirs', 'theirs', 'u1', ?)",
    )
      .bind(Math.floor(Date.now() / 1000) - 6 * 60 * 60)
      .run();

    await scheduled(env);

    expect(await teamsOf("u1")).toBe(1);
    expect(await scalar(env.DB.prepare("SELECT name FROM organization"))).toBe("Theirs");
  });
});
