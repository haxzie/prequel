import type { ReactNode } from "react";

/**
 * The bits of a timeline three sections draw and none of them owns.
 *
 * The strip itself — clips, zoom bars, the playhead, the ruler — comes from
 * `editor-controls.tsx`, which carries the app's own class strings. What is
 * here is the row label the app puts down the left of a lane, and two runs of
 * audio peaks for a wave to be drawn from.
 */

/** The mono label down the left of a lane, at the app's field size. */
export function Lane({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-14 shrink-0 truncate text-[11px] text-editor-muted sm:w-20">{label}</span>
      <div className="relative min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * Peaks for a voice lane, as `waveform.ts` would hand them over: one 0–1
 * amplitude per 50ms bucket, normalised so the loudest reaches the top.
 *
 * Written out rather than generated. A random figure per bucket would differ
 * between the server's render and the client's and hydration would report it,
 * and speech does not look random anyway — it runs in phrases with breaths
 * between them, which is what a voice track actually draws.
 */
export const VOICE = [
  0.08, 0.31, 0.62, 0.78, 0.55, 0.71, 0.44, 0.18, 0.06, 0.04, 0.12, 0.48, 0.83, 0.66, 0.9, 0.72,
  0.41, 0.15, 0.05, 0.09, 0.35, 0.68, 0.52, 0.79, 0.61, 0.33, 0.11, 0.04, 0.07, 0.28, 0.57, 0.74,
  0.95, 0.63, 0.38, 0.16, 0.06, 0.05, 0.22, 0.51, 0.7, 0.58, 0.42, 0.19, 0.08, 0.04, 0.14, 0.46,
  0.76, 0.88, 0.6, 0.36, 0.13, 0.05, 0.1, 0.4, 0.65, 0.5, 0.27, 0.09,
];

/**
 * The system track: quieter, and in bursts rather than in phrases.
 *
 * A notification and a video playing under the voice, which is what this track
 * usually carries and why it has a gain of its own.
 */
export const SYSTEM = [
  0.05, 0.04, 0.06, 0.42, 0.68, 0.51, 0.22, 0.07, 0.05, 0.04, 0.04, 0.05, 0.31, 0.55, 0.47, 0.39,
  0.44, 0.36, 0.29, 0.41, 0.5, 0.38, 0.25, 0.12, 0.06, 0.04, 0.05, 0.18, 0.46, 0.61, 0.4, 0.2,
];
