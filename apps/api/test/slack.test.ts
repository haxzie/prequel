/**
 * The two ways Slack notification goes wrong without anybody noticing.
 *
 * It posts when it should not — a fork, or a preview deployment, talking into
 * somebody's real channel because absence was read as "use the default" rather
 * than as "say nothing". And it takes a request down with it: a webhook revoked
 * in Slack answers 403 for ever after, and a share that 500s because a channel
 * is gone would be the integration breaking the product it reports on.
 *
 * Both are silent by construction, so both are pinned here rather than left to
 * be discovered from a channel that went quiet.
 */
import { describe as suite, expect, it, vi } from "vitest";

import { describe, notify, post } from "../src/lib/slack.ts";
import type { Env } from "../src/env.ts";

/** Only the two fields `lib/slack.ts` reads. */
function env(overrides: Partial<Env> = {}): Env {
  return overrides as Env;
}

/** Collects what `notify` defers, the way a Worker's `waitUntil` would. */
function context() {
  const pending: Promise<unknown>[] = [];
  return { pending, waitUntil: (promise: Promise<unknown>) => pending.push(promise) };
}

suite("who a message is about", () => {
  it("uses both halves when both are known", () => {
    expect(describe({ name: "Ana", email: "ana@example.com" })).toBe("Ana (ana@example.com)");
  });

  it("falls back to the address rather than to a name nobody can act on", () => {
    expect(describe({ name: "  ", email: "ana@example.com" })).toBe("ana@example.com");
    expect(describe({ email: "ana@example.com" })).toBe("ana@example.com");
  });

  it("says so plainly when there is neither", () => {
    // Not an empty string: a message reading "*Video shared* — " looks like a
    // bug in the notifier rather than a gap in what is known about the sharer.
    expect(describe(null)).toBe("someone we have no address for");
    expect(describe({ name: null, email: null })).toBe("someone we have no address for");
  });
});

suite("a deployment with no webhook", () => {
  it("sends nothing at all", async () => {
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);

    await post(env(), "signups", "hello");
    await post(env({ SLACK_SIGNUPS_WEBHOOK_URL: "" }), "signups", "hello");

    expect(fetched).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("does not even defer the work", () => {
    const ctx = context();
    notify(env(), ctx, "events", "hello");

    // Nothing queued, rather than a queued call that returns early: a Worker
    // that is kept alive to make no request is paying for the integration it
    // was never given.
    expect(ctx.pending).toHaveLength(0);
  });
});

suite("a webhook that is configured", () => {
  it("posts the text to the feed's own URL", async () => {
    const fetched = vi.fn(() => Promise.resolve(new Response("ok")));
    vi.stubGlobal("fetch", fetched);

    await post(
      env({
        SLACK_SIGNUPS_WEBHOOK_URL: "https://hooks.slack.example/signups",
        SLACK_EVENTS_WEBHOOK_URL: "https://hooks.slack.example/events",
      }),
      "events",
      "*Video shared* — Ana (ana@example.com)",
    );

    expect(fetched).toHaveBeenCalledOnce();
    const [url, init] = fetched.mock.calls[0] as unknown as [string, RequestInit];
    // The wrong feed is not a visible failure — both channels exist and both
    // accept anything — so it is worth asserting which one was addressed.
    expect(url).toBe("https://hooks.slack.example/events");
    expect(JSON.parse(String(init.body))).toEqual({
      text: "*Video shared* — Ana (ana@example.com)",
    });

    vi.unstubAllGlobals();
  });

  it("swallows a refusal rather than failing the request that caused it", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("no", { status: 403 })));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      post(env({ SLACK_EVENTS_WEBHOOK_URL: "https://hooks.slack.example/events" }), "events", "hi"),
    ).resolves.toBeUndefined();

    // Logged, though: a revoked webhook is indistinguishable from nothing
    // happening, and this line is the only place the difference shows.
    expect(logged).toHaveBeenCalled();

    logged.mockRestore();
    vi.unstubAllGlobals();
  });

  it("swallows an unreachable Slack too", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      post(env({ SLACK_EVENTS_WEBHOOK_URL: "https://hooks.slack.example/events" }), "events", "hi"),
    ).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalled();

    logged.mockRestore();
    vi.unstubAllGlobals();
  });
});
