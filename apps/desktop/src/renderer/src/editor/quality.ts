/**
 * The resolution row: what it offers, and what it costs.
 *
 * Its own module rather than four helpers inside `ExportDialog.tsx`, because
 * every one of them is arithmetic over `outputFrame` with no React in it —
 * and the thing they exist to prevent is a row of tiles that lie about what
 * they would write, which is worth a test rather than an eye.
 */
import type { Size } from "../../../shared/layout";
import { GIF_MAX_SHORT_EDGE, outputFrame } from "../../../shared/project";

/** How the resolution choice reads. Values are the frame's shorter edge. */
export type Quality = "full" | "2160" | "1080" | "720" | "480";

export const QUALITIES: { value: Quality; label: string; title: string }[] = [
  { value: "full", label: "Full", title: "The frame's own size" },
  { value: "2160", label: "4K", title: "Scaled so the shorter edge is 2160px" },
  { value: "1080", label: "1080p", title: "Scaled so the shorter edge is 1080px" },
  { value: "720", label: "720p", title: "Scaled so the shorter edge is 720px" },
  { value: "480", label: "480p", title: "Scaled so the shorter edge is 480px" },
];

/**
 * The frame above which an export is worth warning about, in megapixels.
 *
 * Clear of anything the 4K tile can produce, which is the number that matters
 * — the line names that tile as the way out, and a warning that stayed up
 * after you took its advice would be worse than none. 2160 on the shorter edge
 * is 8.3 megapixels at 16:9, 9.1 on the 1.96:1 frame that was reported, and
 * 10.9 even at 21:9. Twelve clears all of them.
 *
 * Above it the cost is real rather than theoretical: the export loop measures
 * 4.2ms a frame at 4K and 10.8ms at 6014×3074, where the GPU composite is half
 * of each frame and the rest is decode and encode. An hour of footage at the
 * larger one is hours of exporting.
 *
 * The line is the whole fix for somebody who already has Full saved on a
 * project. `DEFAULT_SHORT_EDGE` caps new ones, but a stored setting is the
 * user's and is not quietly rewritten, so the dialog says what the number
 * costs instead.
 */
const HUGE_MEGAPIXELS = 12;

/**
 * The listed option a stored size corresponds to.
 *
 * Matched against the list rather than formatted from the number: a project
 * written by a build that offered a different set of sizes would otherwise
 * select nothing at all, and a row of tiles with none of them outlined looks
 * broken rather than out of date.
 */
export function qualityOf(shortEdge: number | null): Quality {
  if (shortEdge === null) return "full";
  return QUALITIES.find((quality) => shortEdgeOf(quality.value) === shortEdge)?.value ?? "full";
}

/**
 * Which of the offered tiles a stored setting lights up.
 *
 * By the frame it resolves to, not by the number it stores, and that is the
 * whole point: `offeredFor` drops a size that would write the recording's own
 * frame, so a project saved at 2160 on a 3024×1964 capture has no 4K tile to
 * match against. Matched by name it would light nothing at all — and a row of
 * tiles with none of them outlined reads as broken rather than as out of date,
 * which is the same reason `qualityOf` matches the list instead of formatting
 * the number.
 *
 * It lights Full there, which is also the truth: 2160 on that recording *is*
 * Full, pixel for pixel. The setting is not changed, only shown as what it
 * actually produces.
 */
export function selectedIn(
  source: Size,
  shortEdge: number | null,
  offered: typeof QUALITIES,
): Quality {
  const chosen = outputFrame(source, shortEdge);
  const same = offered.find((quality) => {
    const frame = outputFrame(source, shortEdgeOf(quality.value));
    return frame.width === chosen.width && frame.height === chosen.height;
  });

  return same?.value ?? qualityOf(shortEdge);
}

export function shortEdgeOf(quality: Quality): number | null {
  return quality === "full" ? null : Number(quality);
}

/** Whether this frame is big enough to be worth a word before the press. */
export function huge(frame: Size): boolean {
  return area(frame) / 1_000_000 > HUGE_MEGAPIXELS;
}

function area(frame: Size): number {
  return frame.width * frame.height;
}

/**
 * The choices that would actually write a different file, largest first.
 *
 * `outputFrame` never upscales, so a quality whose shorter edge is already
 * past the recording's resolves to the recording's own size — the same picture
 * Full writes. Offering both is two tiles that do the same thing, and on a
 * 14-inch capture at 3024×1964 that is exactly what 4K and Full were: byte for
 * byte identical, with one of them selected and the other sitting there
 * looking like it would help.
 *
 * It is not new with 4K. Full and 1080p were the same tile on a 1080p
 * recording all along; adding a size in the middle of the range is what made
 * it the common case rather than the rare one.
 *
 * Full is always first and always offered: it is what the recording is, and
 * every other entry is measured against it.
 */
export function offeredFor(source: Size, qualities: typeof QUALITIES): typeof QUALITIES {
  const full = area(outputFrame(source, null));

  return qualities.filter((quality) => {
    if (quality.value === "full") return true;
    return area(outputFrame(source, shortEdgeOf(quality.value))) < full;
  });
}

/**
 * The largest offered choice that is genuinely smaller than this one, or null.
 *
 * What the warning names. Worked out rather than written into the sentence,
 * because the tile that helps depends on the recording: on a 6014×3074 take it
 * is 4K, and on one already inside 4K there is no 4K tile to point at and the
 * answer is 1080p.
 */
export function cheaperThan(
  source: Size,
  chosen: Size,
  qualities: typeof QUALITIES,
): string | null {
  const smaller = qualities
    .map((quality) => ({
      label: quality.label,
      pixels: area(outputFrame(source, shortEdgeOf(quality.value))),
    }))
    .filter((quality) => quality.pixels < area(chosen))
    .sort((first, second) => second.pixels - first.pixels);

  return smaller[0]?.label ?? null;
}

export function allowedForGif(quality: Quality): boolean {
  const edge = shortEdgeOf(quality);
  return edge !== null && edge <= GIF_MAX_SHORT_EDGE;
}

/**
 * The frame an export is written at, given what the row is set to.
 *
 * One rule, in one place, because two things ask: the dialog, to print the
 * size and to decide whether to warn, and the hook, to lay the composition out
 * and to hand the exporter a width and a height. Two copies would be a sheet
 * that promises one size and a file that is another.
 *
 * **A screenshot ignores the setting.** A quality is a trade between how long
 * a render takes and how much detail survives it, and a still has neither side
 * of it: one frame, drawn in the time it takes to draw, lossless at whatever
 * size it is given. So the row is not offered for one — see `ExportDialog` —
 * and this is what decides instead. Without it a screenshot came out at
 * whatever a video was last exported at, which after the control is gone is a
 * 480p PNG with nothing on the sheet to say so or to change it.
 */
export function exportFrame(source: Size, shortEdge: number | null, still: boolean): Size {
  return outputFrame(source, still ? null : shortEdge);
}
