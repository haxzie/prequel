/**
 * The emoji a viewer may drop on a recording.
 *
 * A fixed palette rather than free text, and the fixed-ness is the point: these
 * strings are drawn on the scrub bar of a page sent to strangers, and anything
 * that can be typed can be a slur, a zero-width pile of combining marks that
 * draws over the controls, or a string long enough to push the bar off screen.
 * Six characters that are known good cost nothing to check.
 *
 * The palette is *sent* to the page rather than copied into it — see
 * `GET /p/:slug/conversation`. Two hand-kept lists would disagree exactly once,
 * and the symptom would be a button that 400s for no reason the viewer can see.
 */
export const REACTIONS = ["😂", "😍", "😮", "🙌", "👍", "👎"] as const;

export type Reaction = (typeof REACTIONS)[number];

const ALLOWED: ReadonlySet<string> = new Set(REACTIONS);

export function isReaction(value: string): value is Reaction {
  return ALLOWED.has(value);
}
