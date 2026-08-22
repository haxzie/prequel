/**
 * The allowance has to mean what it says.
 *
 * What this replaced was an in-memory `Map` in a Next route: per instance, reset
 * on every deploy, so the real limit was "12 an hour, times however many lambdas
 * are warm". The failure mode was invisible — nothing errors when a limiter
 * quietly allows ten times what it advertises — which is why it is tested now
 * that it is a table.
 */
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { database } from "../src/db.ts";
import { sweep, take } from "../src/lib/rate-limit.ts";
import { scalar } from "./helpers.ts";

const ALLOWANCE = { limit: 3, windowSeconds: 3600 };

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

// Each test gets an empty table. Miniflare keeps one database per suite, so a
// count left behind by the test before would show up as an allowance that had
// already been partly spent.
beforeEach(async () => {
  await env.DB.exec("DELETE FROM rate_limit");
});

describe("take", () => {
  it("allows exactly the allowance and then stops", async () => {
    const db = database(env);

    expect(await take(db, "install:a", ALLOWANCE)).toBe(true);
    expect(await take(db, "install:a", ALLOWANCE)).toBe(true);
    expect(await take(db, "install:a", ALLOWANCE)).toBe(true);
    expect(await take(db, "install:a", ALLOWANCE)).toBe(false);
  });

  it("counts each subject separately", async () => {
    const db = database(env);

    for (let i = 0; i < 3; i += 1) await take(db, "install:a", ALLOWANCE);

    // One machine exhausting its allowance must not lock anybody else out,
    // which is what a single global counter would do.
    expect(await take(db, "install:b", ALLOWANCE)).toBe(true);
  });

  it("does not let a refused request consume the allowance twice", async () => {
    const db = database(env);

    for (let i = 0; i < 3; i += 1) await take(db, "install:a", ALLOWANCE);
    await take(db, "install:a", ALLOWANCE);
    await take(db, "install:a", ALLOWANCE);

    const [row] = await env.DB.prepare("SELECT count FROM rate_limit WHERE subject = ?")
      .bind("install:a")
      .raw<[number]>();

    // The update is conditioned on `count < limit`, so a refusal writes nothing.
    // A counter that kept climbing would work here and silently extend the
    // lockout past the window.
    expect(row?.[0]).toBe(3);
  });

  it("lets the subject through again once the window rolls", async () => {
    const db = database(env);

    for (let i = 0; i < 3; i += 1) await take(db, "install:a", ALLOWANCE);
    expect(await take(db, "install:a", ALLOWANCE)).toBe(false);

    // The window's start is part of the key, so the next one is a different row
    // rather than a counter somebody has to remember to reset.
    const short = { limit: 3, windowSeconds: 1 };
    expect(await take(db, "install:a", short)).toBe(true);
  });

  it("survives concurrent calls without overshooting", async () => {
    const db = database(env);

    // Ten at once against an allowance of three. If the decision were a read
    // followed by a write, several would read the same count and all pass.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => take(db, "install:race", ALLOWANCE)),
    );

    expect(results.filter(Boolean)).toHaveLength(3);
  });
});

describe("sweep", () => {
  it("keeps the window in progress and the one before it", async () => {
    const db = database(env);
    await take(db, "install:a", ALLOWANCE);

    await sweep(db, ALLOWANCE.windowSeconds);

    // A request arriving as the boundary passes must not have the row it is
    // using deleted out from under it, which is what the two-window margin buys.
    expect(await take(db, "install:a", ALLOWANCE)).toBe(true);

    const remaining = await scalar<number>(env.DB.prepare("SELECT count(*) FROM rate_limit"));
    expect(remaining).toBe(1);
  });
});
