/**
 * Analytics must not be able to break the app it is measuring.
 *
 * Every `track` call in main sits next to something a user is doing — starting a
 * recording, finishing an export, signing out — and none of those may fail
 * because a Worker is down or a Mac is on a train. The batching matters for a
 * duller reason: the app posts to our own API, and one request per event would
 * mean a dozen round-trips for a single recording.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getVersion: () => "1.2.3",
    getLocale: () => "en-GB",
    getPath: () => "/tmp/prequel-test",
    isPackaged: true,
  },
}));

vi.mock("./install-id.js", () => ({ installId: () => "install-uuid" }));
vi.mock("./auth.js", () => ({ authToken: () => "prq_test" }));

interface Sent {
  path: string;
  token: string | null;
  headers: Record<string, string>;
  body: { context: Record<string, unknown>; events: { event: string; timestamp: string }[] };
}

const sent: Sent[] = [];
let refuse = false;

vi.mock("./api.js", () => ({
  apiFetch: (
    path: string,
    init: { token: string | null; headers: Record<string, string>; body: string },
  ) => {
    if (refuse) return Promise.reject(new Error("offline"));
    sent.push({
      path,
      token: init.token,
      headers: init.headers,
      body: JSON.parse(init.body) as Sent["body"],
    });
    return Promise.resolve({});
  },
}));

/**
 * Re-imported per test.
 *
 * The queue and the timer are module-level state, which is right in a process
 * that has one of each and wrong across tests — a batch left behind by the test
 * before would be sent by the next one.
 */
let analytics: typeof import("./analytics.js");

beforeEach(async () => {
  sent.length = 0;
  refuse = false;
  vi.resetModules();
  vi.useFakeTimers();
  analytics = await import("./analytics.js");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("track", () => {
  it("sends nothing until the queue is flushed", async () => {
    analytics.track("recording_started");

    // One request per event would be a dozen round-trips for one recording.
    expect(sent).toHaveLength(0);
  });

  it("sends the batch once the interval passes", async () => {
    analytics.track("app_launched");
    analytics.track("recording_started");

    await vi.advanceTimersByTimeAsync(15_000);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.body.events.map((event) => event.event)).toEqual([
      "app_launched",
      "recording_started",
    ]);
  });

  it("flushes early rather than growing past what the API accepts", async () => {
    for (let i = 0; i < 20; i += 1) analytics.track("recording_started");
    await vi.advanceTimersByTimeAsync(0);

    // The Worker refuses a batch of more than fifty. Reaching that would drop
    // every event in it, and only under exactly the load worth measuring.
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body.events).toHaveLength(20);
  });

  it("keeps each event's own time rather than the batch's", async () => {
    analytics.track("recording_started");
    vi.setSystemTime(new Date(Date.now() + 5_000));
    analytics.track("recording_stopped");

    await vi.advanceTimersByTimeAsync(15_000);

    const [first, second] = sent[0]?.body.events ?? [];
    // A batch can be fifteen seconds old and a whole recording can happen inside
    // one. Stamping on arrival would collapse a session into an instant.
    expect(first?.timestamp).not.toBe(second?.timestamp);
  });

  it("carries the version, the install and the token on every request", async () => {
    analytics.track("app_launched");
    await vi.advanceTimersByTimeAsync(15_000);

    expect(sent[0]?.path).toBe("/v1/events");
    expect(sent[0]?.token).toBe("prq_test");
    expect(sent[0]?.headers["x-prequel-install"]).toBe("install-uuid");
    // Which versions are still in the wild is the question nothing in this app
    // has ever been able to answer.
    expect(sent[0]?.body.context["version"]).toBe("1.2.3");
  });
});

describe("flush", () => {
  it("does not throw when the API refuses", async () => {
    refuse = true;
    analytics.track("app_launched");

    // Called from `before-quit`, where a throw abandons the quit and strands the
    // app with no way out but `kill -9`.
    await expect(analytics.flush()).resolves.toBeUndefined();
  });

  it("sends nothing when there is nothing queued", async () => {
    await analytics.flush();
    expect(sent).toHaveLength(0);
  });

  it("does not send the same event twice", async () => {
    analytics.track("app_launched");

    await analytics.flush();
    await analytics.flush();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(sent).toHaveLength(1);
  });

  it("keeps an event tracked mid-flight for the next batch", async () => {
    analytics.track("app_launched");

    const inFlight = analytics.flush();
    analytics.track("recording_started");
    await inFlight;

    await analytics.flush();

    expect(sent.map((request) => request.body.events.map((event) => event.event))).toEqual([
      ["app_launched"],
      ["recording_started"],
    ]);
  });
});
