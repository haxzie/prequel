/**
 * What the two busiest events in the product say when they reach Slack.
 *
 * Every way this goes wrong is a message that posts anyway. A duration read off
 * a property the app no longer sends reads as a recording of no length; a plan
 * left off reads as a free user; a batch of fifty reads as the product being
 * used fifty times. None of them errors, and all of them are acted on by
 * somebody, so they are pinned here.
 */
import { describe as suite, expect, it } from "vitest";

import {
  formatDuration,
  isMilestone,
  MAX_PER_BATCH,
  milestoneLine,
} from "../src/lib/milestones.ts";

const ANA = { name: "Ana", email: "ana@example.com", plan: "pro" as const };

suite("which events reach the channel", () => {
  it("takes the two that name a thing somebody finished", () => {
    expect(isMilestone("recording_stopped")).toBe(true);
    expect(isMilestone("export_done")).toBe(true);
  });

  it("leaves the rest to PostHog", () => {
    // `export_started` in particular: an export that is running is not news,
    // and announcing both ends doubles the feed for one piece of information.
    for (const event of ["app_launched", "recording_started", "export_started", "export_failed"]) {
      expect(isMilestone(event)).toBe(false);
    }
  });
});

suite("the line", () => {
  it("names the person, the tier and the length", () => {
    expect(milestoneLine("recording_stopped", { duration_ms: 134_000 }, ANA)).toBe(
      "*Recording finished* — Ana (ana@example.com) · Pro · 2m 14s",
    );
  });

  it("uses the same field for an export's length", () => {
    expect(milestoneLine("export_done", { duration_ms: 8_400 }, ANA)).toBe(
      "*Export finished* — Ana (ana@example.com) · Pro · 8s",
    );
  });

  it("leaves out a tier it does not know rather than assuming free", () => {
    // Signed in with no team yet. "Free" here would be a figure where there is
    // a gap, and free is the one answer somebody would act on differently.
    expect(milestoneLine("export_done", { duration_ms: 1_000 }, { ...ANA, plan: null })).toBe(
      "*Export finished* — Ana (ana@example.com) · 1s",
    );
  });

  it("drops a duration that is not a duration", () => {
    // The properties are the one part of the payload with no fixed shape, so a
    // client can send anything here. `NaNm 00s` in a channel reads as a bug in
    // the product rather than in the notifier.
    for (const properties of [{}, { duration_ms: "long" }, { duration_ms: -1 }, undefined]) {
      expect(milestoneLine("export_done", properties, ANA)).toBe(
        "*Export finished* — Ana (ana@example.com) · Pro",
      );
    }
  });
});

suite("a length as somebody reads it", () => {
  it("drops the minutes under a minute", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(8_400)).toBe("8s");
    expect(formatDuration(59_400)).toBe("59s");
  });

  it("pads the seconds so a column of them lines up", () => {
    expect(formatDuration(60_000)).toBe("1m 00s");
    expect(formatDuration(134_000)).toBe("2m 14s");
    expect(formatDuration(3_600_000)).toBe("60m 00s");
  });
});

suite("how many one batch may post", () => {
  it("is far below the batch the route accepts", () => {
    // The route caps a batch at fifty events, which bounds what a request costs
    // us and not what it costs the channel.
    expect(MAX_PER_BATCH).toBeLessThan(50);
  });
});
