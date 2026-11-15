/**
 * The two things the app does that are worth interrupting somebody over.
 *
 * A recording that finished and an export that landed. Both already arrive at
 * `/v1/events` on their way to PostHog, which is why they are read off that
 * batch rather than reported a second time by the app: one event per thing that
 * happened, and a Slack line that cannot disagree with the chart beside it.
 *
 * The line is built here, as a pure function, because it is the part that is
 * wrong silently. A missing duration reads as a recording of no length, a
 * missing plan reads as a free user, and neither of them fails — the message
 * posts, somebody acts on it, and nothing says it was assembled from a property
 * the app stopped sending two releases ago.
 */
import type { Account } from "./slack.ts";
import { describe } from "./slack.ts";

/** What each milestone is called in the channel. */
const LABELS = {
  recording_stopped: "Recording finished",
  export_done: "Export finished",
} as const;

export type Milestone = keyof typeof LABELS;

/** Whether this event is one of the two. */
export function isMilestone(event: string): event is Milestone {
  return event in LABELS;
}

/**
 * How many messages one batch may produce.
 *
 * The route already caps a batch at fifty events, which is a bound on what a
 * request costs us and not on what it costs the channel: fifty `export_done`s
 * in one body is fifty posts, and a channel nobody can read is the same as no
 * channel. A real batch carries one of these, occasionally two.
 */
export const MAX_PER_BATCH = 5;

/**
 * One line, in the shape the rest of the `events` feed already uses.
 *
 * `*What happened* — who · what they pay us · how long`, and the last two are
 * left out rather than guessed at when they are not known. A duration is the
 * number somebody is actually scanning for — a thirty-second take and a
 * forty-minute one are different events — so it goes last, where the eye lands.
 */
export function milestoneLine(
  event: Milestone,
  properties: Record<string, unknown> | undefined,
  account: Account | null,
): string {
  const parts = [describe(account)];

  if (account?.plan) parts.push(TIERS[account.plan]);

  const duration = durationOf(properties);
  if (duration !== null) parts.push(duration);

  return `*${LABELS[event]}* — ${parts.join(" · ")}`;
}

/** The tiers as a person says them, matching what `billing.ts` posts. */
const TIERS = { free: "Free", pro: "Pro", lifetime: "Lifetime" } as const;

/**
 * The length of the thing, from whichever property carries it.
 *
 * `recording_stopped` sends how long the take ran; `export_done` sends how long
 * the finished film is. Both are `duration_ms` and both mean the same thing to
 * whoever is reading the channel, which is why there is one field and not two.
 *
 * Anything that is not a finite, non-negative number is treated as absent. A
 * client can send what it likes here, and `NaNm` in a Slack message is the sort
 * of thing that gets read as a bug in the product.
 */
function durationOf(properties: Record<string, unknown> | undefined): string | null {
  const value = properties?.["duration_ms"];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;

  return formatDuration(value);
}

/**
 * Milliseconds as minutes and seconds.
 *
 * Rounded to the second, because nobody reading the channel cares about the
 * other three digits, and padded so a column of these lines up. Under a minute
 * drops the minutes entirely — "0m 8s" is more words for less.
 */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;

  if (minutes === 0) return `${String(rest)}s`;
  return `${String(minutes)}m ${String(rest).padStart(2, "0")}s`;
}
