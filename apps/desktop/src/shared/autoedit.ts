/**
 * The first cut, made for you.
 *
 * A screen recording tells you what mattered if you know where to look: people
 * click on the thing they are talking about, and they type into the field they
 * want you to see. This turns those into zooms — once, when a recording is
 * opened for the first time.
 *
 * Everything it produces is an ordinary `ZoomSlice`. Each one can be moved,
 * retimed, retargeted or deleted like any other, which is the whole design
 * constraint: an automatic edit you cannot take apart is worse than no
 * automatic edit, because the first thing anyone does with one is disagree with
 * it.
 *
 * Pure, and free of any `electron`, Node or DOM import, so the judgement calls
 * below are testable without a recording.
 */
import type { MediaTime } from "./manifest.js";
import { DEFAULT_ZOOM, type ZoomSlice } from "./project.js";

const NS = 1_000_000_000;

/**
 * How far apart two events can be and still belong to the same shot.
 *
 * The number that decides whether a sequence reads as one action or several.
 * Too small and clicking through a menu becomes four zooms fighting each other;
 * too large and a click at the start and one at the end of a minute collapse
 * into a single limp push. A second and a half is about the pause people leave
 * between finishing one thing and starting the next.
 */
const CLUSTER_GAP = 1.5 * NS;

/** Held before the first event and after the last, so the move has somewhere to
    happen and does not snap away the instant the click lands. */
const LEAD_IN = 0.7 * NS;
const LEAD_OUT = 1.1 * NS;

/** Shorter than this and the ease alone would fill it. */
const MIN_SPAN = 1.2 * NS;

/**
 * Longer than this and a click cluster stops being a shot and becomes the whole
 * video.
 */
const MAX_CLICK_SPAN = 9 * NS;

/**
 * Typing gets much longer, because it is one continuous act.
 *
 * Someone filling in a form is doing a single thing for as long as it takes,
 * and cutting away in the middle of it to come back afterwards is worse than
 * either holding or never zooming at all. The cap exists only so a field left
 * focused for the rest of a recording does not zoom the rest of the recording.
 */
const MAX_TYPING_SPAN = 45 * NS;

/** Nothing closer together than this is worth two separate zooms. */
const MIN_GAP = 0.6 * NS;

/** One thing that happened, wherever it happened. */
export interface Moment {
  at: MediaTime;
  /** As fractions of the captured frame. */
  x: number;
  y: number;
  kind: "click" | "typing";
}

export interface AutoEditOptions {
  /** The recording's length, so nothing runs off the end. */
  duration: MediaTime;
  /** Whether a pointer track exists to follow. Without one a `cursor` zoom has
      nothing to aim at, so the clusters become fixed regions instead. */
  hasCursor: boolean;
}

/**
 * Zooms for a recording, from what happened in it.
 *
 * Returns an empty list when there is nothing worth zooming to — which is the
 * right answer for a recording of someone reading, and better than inventing
 * movement to justify the feature.
 */
export function autoZooms(moments: readonly Moment[], options: AutoEditOptions): ZoomSlice[] {
  const clusters = cluster(moments);
  const zooms: ZoomSlice[] = [];

  for (const [index, group] of clusters.entries()) {
    const first = group[0]!.at;
    const last = group[group.length - 1]!.at;

    const typed = group.filter((moment) => moment.kind === "typing").length;
    const typing = typed > group.length / 2;

    const start = Math.max(0, first - LEAD_IN);
    const end = Math.min(options.duration, Math.max(last + LEAD_OUT, start + MIN_SPAN));

    // The zoom runs to the last thing that happened, so typing holds until the
    // typing stops. That only works because the capture beats once a second
    // while a field stays focused — without it a minute in one box is a single
    // sample and this would be a two-second zoom at the start of it.
    const longest = typing ? MAX_TYPING_SPAN : MAX_CLICK_SPAN;
    if (end - start < MIN_SPAN || end - start > longest) continue;

    // Never over what came before. `sanitiseProject` would drop an overlap
    // anyway, and dropping is a worse answer than not making one.
    const previous = zooms[zooms.length - 1];
    if (previous && start < previous.source.end + MIN_GAP) continue;

    const centre = middleOf(group);

    zooms.push({
      id: `auto-${String(index)}`,
      source: { start, end },
      // Typing knows exactly which field to frame; a run of clicks is better
      // served by following the pointer, which is where the next one will be.
      target: typing ? "typing" : options.hasCursor ? "cursor" : "region",
      x: centre.x,
      y: centre.y,
      level: levelFor(group),
      speed: DEFAULT_ZOOM.speed,
      // Off, like the default. The first cut should read as a steadier version
      // of the recording, not as a different sort of video — and softening what
      // someone may have been reading is not a decision to make for them.
      blur: DEFAULT_ZOOM.blur,
      blurSafe: DEFAULT_ZOOM.blurSafe,
      blurStrength: DEFAULT_ZOOM.blurStrength,
      ...tiltFor(centre),
    });
  }

  return zooms;
}

/**
 * Groups moments that belong to the same shot.
 *
 * By time alone, deliberately. Clicking a menu and then the item it opened
 * happens in two different places and is unmistakably one action; splitting on
 * distance would cut it in half and produce a zoom that arrives just in time to
 * leave.
 */
function cluster(moments: readonly Moment[]): Moment[][] {
  const sorted = [...moments].sort((a, b) => a.at - b.at);
  const clusters: Moment[][] = [];

  for (const moment of sorted) {
    const current = clusters[clusters.length - 1];
    const previous = current?.[current.length - 1];

    if (current && previous && moment.at - previous.at <= CLUSTER_GAP) current.push(moment);
    else clusters.push([moment]);
  }

  return clusters;
}

function middleOf(group: readonly Moment[]): { x: number; y: number } {
  const total = group.reduce((sum, moment) => ({ x: sum.x + moment.x, y: sum.y + moment.y }), {
    x: 0,
    y: 0,
  });

  return { x: total.x / group.length, y: total.y / group.length };
}

/**
 * How far in to push, from how tightly the cluster sits.
 *
 * A run of clicks inside one small control deserves a closer look than a run
 * scattered across the screen — and pushing in hard on the scattered one would
 * spend the whole shot panning between them.
 */
function levelFor(group: readonly Moment[]): number {
  const centre = middleOf(group);
  const spread = group.reduce(
    (widest, moment) =>
      Math.max(widest, Math.abs(moment.x - centre.x), Math.abs(moment.y - centre.y)),
    0,
  );

  // Tight enough to fit in a quarter of the frame: 2.2×. Spread across half of
  // it: barely more than 1.4×.
  return clamp(2.4 - spread * 4, 1.4, 2.4);
}

/**
 * A lean, from where on screen it happened.
 *
 * Away from the edge it is nearest, so the picture turns towards the thing
 * being shown rather than away from it — and flat through the middle, where a
 * tilt would be motion for its own sake. The magnitudes are small: this runs
 * on every recording without being asked, and something that announces itself
 * that often stops being cinematic very quickly.
 */
function tiltFor(centre: { x: number; y: number }): { tilt: number; yaw: number } {
  // −1 at the left edge, 0 in the middle, 1 at the right.
  const across = clamp((centre.x - 0.5) * 2, -1, 1);
  const down = clamp((centre.y - 0.5) * 2, -1, 1);

  // Cubed, so the middle of the frame stays genuinely flat and only the outer
  // third leans much at all. A linear falloff tilts everything slightly, which
  // reads as a wobble rather than as intent.
  return {
    yaw: round(across ** 3 * 12),
    tilt: round(down ** 3 * -8),
  };
}

function round(value: number): number {
  // The trailing zero normalises -0, which a centred cluster produces and which
  // is not equal to 0 under `Object.is` — the sort of thing that reads as a
  // failing test rather than as a signed zero.
  return Math.round(value * 10) / 10 + 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
