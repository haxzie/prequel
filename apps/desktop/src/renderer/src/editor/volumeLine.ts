/**
 * The volume line a clip and a bed wear, as arithmetic.
 *
 * Two questions, both of them easy to get subtly wrong and neither of them
 * worth answering twice: where the line sits for a level, and what a level a
 * clip's *two* track volumes turn into when one line is dragged.
 *
 * Pure, so the awkward cases — a muted track, both tracks muted, a line
 * dragged past either end — are tested without a pointer.
 */

/**
 * The loudest a line goes, matching the sliders in the panel.
 *
 * Two, so unity sits halfway up the bar rather than at the top. That is what
 * makes the line able to say "louder than recorded" at all, and it is where
 * every editor people arrive from puts 0 dB.
 */
export const MAX_LEVEL = 2;

/** Where a level sits, as a fraction from the top of the bar. */
export function levelY(level: number): number {
  return 1 - clamp(level) / MAX_LEVEL;
}

/**
 * How tall a bar's waveform is drawn, as a percentage of the bar.
 *
 * Exactly the room under the line, which is what ties the two together: the
 * line is the ceiling of the sound, so the wave is drawn against that ceiling
 * rather than against the bar. A clip pulled down to a quarter whose wave kept
 * its full height would be one bar saying two different things about one
 * number — and the wave is the thing people actually read.
 *
 * Zero at silence. A bar with no wave in it is what no sound looks like.
 */
export function waveHeight(level: number): number {
  return (1 - levelY(level)) * 100;
}

/** The level a fraction from the top of the bar means. */
export function levelAt(y: number): number {
  return clamp(MAX_LEVEL * (1 - Math.min(Math.max(y, 0), 1)));
}

/**
 * A clip's two track volumes, scaled so the louder of them lands on `level`.
 *
 * One line cannot show two numbers, so it shows the louder and moves both —
 * *proportionally*, which is the part that matters. Setting both to the
 * dragged level would be simpler and would quietly throw away a balance
 * somebody had set in the panel: a voice at full over system audio at a
 * quarter would come back from one drag with the two equal, and nothing on
 * screen would say what had gone.
 *
 * A track already at zero stays at zero. It was muted on purpose, and a line
 * that unmuted it would be the drag doing something nobody asked for.
 *
 * With both at zero there is no ratio to keep, so the level is simply applied
 * to both — otherwise a clip silenced by hand could never be brought back from
 * the timeline at all.
 */
export function scaledAudio(
  mic: number,
  system: number,
  level: number,
): { mic: number; system: number } {
  const loudest = Math.max(mic, system);
  const wanted = clamp(level);

  if (loudest <= 0) return { mic: wanted, system: wanted };

  const scale = wanted / loudest;
  return { mic: clamp(mic * scale), system: clamp(system * scale) };
}

function clamp(level: number): number {
  return Math.min(Math.max(level, 0), MAX_LEVEL);
}
