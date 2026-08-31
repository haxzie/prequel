/**
 * Teams with nobody in them.
 *
 * This is the state that took onboarding down: creating a team is two writes
 * with no transaction across them — the organization, then the creator's
 * `member` row — and a failure in between leaves a team no query returns and no
 * user can reach. The billing gate that caused it is gone, but the gap is Better
 * Auth's and is still there, so the sweep is what keeps the invariant true.
 *
 * The assertions are about what a *user* ends up with, not about row counts for
 * their own sake. A repaired team is somebody getting back the team they named;
 * a deleted one is litter that was never anybody's.
 */
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { scheduled } from "../src/cron.ts";
import { scalar } from "./helpers.ts";

/** Comfortably past `ORPHAN_GRACE_MS`, in whole seconds. */
const LONG_AGO = Math.floor(Date.now() / 1000) - 6 * 60 * 60;

/** Inside the grace window: a team that is still being created right now. */
const JUST_NOW = Math.floor(Date.now() / 1000);

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const table of ["video", "subscription", "member", "organization", "user"]) {
    await env.DB.exec(`DELETE FROM ${table}`);
  }

  await env.DB.exec("INSERT INTO user (id, name, email) VALUES ('u1', 'Ana', 'ana@example.com')");
});

async function team(
  id: string,
  { createdBy = "u1" as string | null, createdAt = LONG_AGO } = {},
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO organization (id, name, slug, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(id, `Team ${id}`, `slug-${id}`, createdBy, createdAt)
    .run();
}

const teams = () => scalar<number>(env.DB.prepare("SELECT COUNT(*) FROM organization"));

/**
 * Whether one specific team is still there.
 *
 * The sweep also *creates* a team for any account that has none — see
 * `settleUsers` — so a bare count of organizations no longer says whether the
 * shell under test survived. Asking about the row by name is what these are
 * actually about.
 */
const survives = async (teamId: string) =>
  (await scalar<number>(
    env.DB.prepare("SELECT COUNT(*) FROM organization WHERE id = ?").bind(teamId),
  )) === 1;

const memberOf = (teamId: string) =>
  scalar<string>(
    env.DB.prepare("SELECT user_id FROM member WHERE organization_id = ?").bind(teamId),
  );

describe("teams with no members", () => {
  it("gives the creator back the team they named", async () => {
    await team("org1");

    await scheduled(env);

    // Repaired, not deleted. The user named this team and is waiting on it.
    expect(await teams()).toBe(1);
    expect(await memberOf("org1")).toBe("u1");
    expect(await scalar(env.DB.prepare("SELECT role FROM member"))).toBe("owner");
  });

  it("leaves a team alone while it is still being created", async () => {
    // The gap between the two writes is milliseconds. Acting inside it would
    // mean the sweep racing the very thing it exists to repair.
    await team("org1", { createdAt: JUST_NOW });

    await scheduled(env);

    expect(await memberOf("org1")).toBeUndefined();
    expect(await survives("org1")).toBe(true);
  });

  it("does not hand somebody a second team when they retried and succeeded", async () => {
    // What every affected user actually did: hit the error, made another team,
    // got in. Seating them on the abandoned one would give them two teams,
    // which is the state `organizationLimit: 1` exists to prevent — and which
    // the dashboard has no way to switch between.
    await team("abandoned");
    await team("theirs");
    await env.DB.exec(
      "INSERT INTO member (id, organization_id, user_id, role) VALUES ('m1', 'theirs', 'u1', 'owner')",
    );

    await scheduled(env);

    expect(await scalar(env.DB.prepare("SELECT COUNT(*) FROM member"))).toBe(1);
    expect(await memberOf("theirs")).toBe("u1");
    // The abandoned one held nothing, so it goes.
    expect(await teams()).toBe(1);
  });

  it("removes a shell that nothing records the creator of", async () => {
    // The thirty-seven in production. `created_by` was added after they were
    // written, so there is nothing to repair them from.
    await team("org1", { createdBy: null });

    await scheduled(env);

    expect(await survives("org1")).toBe(false);
  });

  it("never cascades over a team that has recordings in it", async () => {
    // The one that would turn a bookkeeping fault into data loss: `video`
    // cascades on `team_id`, so deleting here deletes somebody's recordings.
    await team("org1", { createdBy: null });
    await env.DB.prepare(
      `INSERT INTO video (id, slug, team_id, title, object_key, content_type, size_bytes)
       VALUES ('v1', 'abc', 'org1', 'A recording', 'k', 'video/mp4', 1)`,
    ).run();

    await scheduled(env);

    expect(await survives("org1")).toBe(true);
    expect(await scalar(env.DB.prepare("SELECT COUNT(*) FROM video"))).toBe(1);
  });

  it("never cascades over a team that is paying", async () => {
    await team("org1", { createdBy: null });
    await env.DB.prepare(
      `INSERT INTO subscription (id, team_id, dodo_subscription_id, dodo_customer_id, status)
       VALUES ('s1', 'org1', 'sub_1', 'cus_1', 'active')`,
    ).run();

    await scheduled(env);

    expect(await survives("org1")).toBe(true);
  });

  it("leaves healthy teams entirely alone", async () => {
    await team("org1");
    await env.DB.exec(
      "INSERT INTO member (id, organization_id, user_id, role) VALUES ('m1', 'org1', 'u1', 'owner')",
    );

    await scheduled(env);

    expect(await teams()).toBe(1);
    expect(await scalar(env.DB.prepare("SELECT COUNT(*) FROM member"))).toBe(1);
  });
});
