/**
 * Which team a request belongs to, when the session's answer has gone stale.
 *
 * `session.active_organization_id` is written by Better Auth's organization
 * plugin and enforced by nothing: no foreign key, no cascade. Deleting a team
 * leaves every live session of its members naming an id that is not there, and
 * the `??` this replaced only ever caught null — so the dead id reached
 * `identity.teamId` and the next write keyed to a team failed inside D1 on a
 * foreign key.
 *
 * That surfaced as a 500 from `/v1/desktop/authorize` — "Something went wrong",
 * an error floor away from anything naming a team, for an account signed in
 * perfectly well whose own team was sitting there intact. None of it is visible
 * in a manual test unless a team has actually been deleted underneath a session
 * that is still open, which is why it is pinned here.
 */
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { database } from "../src/db.ts";
import { activeTeam } from "../src/middleware.ts";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const table of ["member", "organization", "user"]) {
    await env.DB.exec(`DELETE FROM ${table}`);
  }

  await env.DB.exec(
    "INSERT INTO user (id, name, email, email_verified) VALUES ('u1', 'Ana', 'ana@example.com', 1)",
  );

  // Two teams, seeded oldest first — `firstTeam` orders by `member.created_at`,
  // so a fallback that picked arbitrarily would pass against a single team and
  // start uploading somewhere else the moment anybody had two.
  await env.DB.exec("INSERT INTO organization (id, name, slug) VALUES ('org1', 'Acme', 'acme')");
  await env.DB.exec("INSERT INTO organization (id, name, slug) VALUES ('org2', 'Beta', 'beta')");

  await env.DB.exec(
    "INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ('m1', 'org1', 'u1', 'owner', 1000)",
  );
  await env.DB.exec(
    "INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ('m2', 'org2', 'u1', 'owner', 2000)",
  );
});

describe("the team a session is on", () => {
  it("takes the session's answer when it is still a team the user is in", async () => {
    expect(await activeTeam(database(env), "u1", "org2")).toBe("org2");
  });

  it("falls back to the oldest membership when nothing said which", async () => {
    expect(await activeTeam(database(env), "u1", null)).toBe("org1");
    expect(await activeTeam(database(env), "u1", undefined)).toBe("org1");
  });

  /** The bug. A live session naming a team that has since been deleted. */
  it("falls back when the session names a team that no longer exists", async () => {
    await env.DB.exec("DELETE FROM organization WHERE id = 'org2'");

    expect(await activeTeam(database(env), "u1", "org2")).toBe("org1");
  });

  it("falls back when the user has been removed from the team it names", async () => {
    await env.DB.exec("DELETE FROM member WHERE id = 'm2'");

    expect(await activeTeam(database(env), "u1", "org2")).toBe("org1");
  });

  /**
   * Null rather than the dead id. `requireTeam` reads this as `NO_TEAM` and says
   * so, where a dangling id would reach D1 and come back as a 500.
   */
  it("answers null when the user is in no team at all", async () => {
    await env.DB.exec("DELETE FROM member");

    expect(await activeTeam(database(env), "u1", "org2")).toBeNull();
  });
});
