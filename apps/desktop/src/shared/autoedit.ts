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
const CLUSTER_GAP = 2.5 * NS;

/**
 * Held before the first event and after the last.
 *
 * The move has to start before the thing it is moving to happens, or the shot
 * arrives to find the click already over. The lead-out matters more: a viewer
 * needs to see the *result* of a click, and pulling out the moment it lands
 * shows them the press and hides the consequence.
 *
 * Both are generous on purpose. The failure people notice is a zoom that came
 * and went before they could read anything; nobody complains that a shot was
 * held a beat too long.
 */
const LEAD_IN = 1.1 * NS;
const LEAD_OUT = 2.2 * NS;

/**
 * Shorter than this and the ease alone would fill it.
 *
 * At the default speed a push takes the best part of a second at each end, so a
 * span under about three is mostly travel with no time at rest in the middle.
 */
const MIN_SPAN = 2.8 * NS;

/**
 * Longer than this and a click cluster stops being a shot and becomes the whole
 * video. A cluster that runs past it is trimmed rather than dropped — see
 * `autoZooms`.
 */
const MAX_CLICK_SPAN = 14 * NS;

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
  const zooms: ZoomSlice[] = [];

  for (const group of cluster(moments)) {
    const typed = group.filter((moment) => moment.kind === "typing").length;
    const typing = typed > group.length / 2;
    const span = group[group.length - 1]!.at - group[0]!.at;

    // A field left focused for the rest of the recording is not a shot, and
    // cutting it up would only make several shots of the same still frame.
    if (typing && span > MAX_TYPING_SPAN) continue;

    // A long run of clicking is the busiest stretch of the recording and the
    // part that most wants a camera on it. It gets cut into shots that follow
    // the action. Discarding it — which is what this did — left the automatic
    // pass silent exactly where the most was happening, and a demo that is one
    // continuous run of clicks came back with no zooms at all.
    const chunks = typing ? [group] : split(group, MAX_CLICK_SPAN - LEAD_IN - LEAD_OUT);

    for (const [index, chunk] of chunks.entries()) {
      const first = chunk[0]!.at;
      const last = chunk[chunk.length - 1]!.at;

      const previous = zooms[zooms.length - 1];
      const floor = previous ? previous.source.end + MIN_GAP : 0;
      const start = Math.max(floor, first - LEAD_IN);

      // Trimmed against what came before rather than dropped: `sanitiseProject`
      // discards an overlap outright, and a shot that starts a little late is a
      // better answer than no shot.
      //
      // Except across separate actions. A later chunk of the *same* run is a
      // re-frame with the camera already in, so it may start after its first
      // click; a different cluster starting that late would be a push arriving
      // to find the thing it came for already over.
      if (index === 0 && start > first) continue;

      // Runs to the last thing that happened, so typing holds until the typing
      // stops. That only works because the capture beats once a second while a
      // field stays focused — without it a minute in one box is a single sample
      // and this would be a short zoom at the start of it.
      const end = Math.min(options.duration, Math.max(last + LEAD_OUT, start + MIN_SPAN));
      if (end - start < MIN_SPAN) continue;

      const centre = middleOf(chunk);

      zooms.push({
        id: `auto-${String(zooms.length)}`,
        source: { start, end },
        // Typing knows exactly which field to frame; a run of clicks is better
        // served by following the pointer, which is where the next one will be.
        target: typing ? "typing" : options.hasCursor ? "cursor" : "region",
        x: centre.x,
        y: centre.y,
        level: levelFor(chunk),
        speed: DEFAULT_ZOOM.speed,
        // The default distance. The automatic pass sets an angle but not how
        // hard the lens sells it, which is a look rather than a reading of the
        // recording.
        depth: DEFAULT_ZOOM.depth,
        // Both off, like the defaults. The first cut should read as a steadier
        // version of the recording rather than as a different sort of video —
        // softening what someone may have been reading is not a decision to make
        // for them, and a vignette even less so.
        vignette: DEFAULT_ZOOM.vignette,
        blur: DEFAULT_ZOOM.blur,
        blurSafe: DEFAULT_ZOOM.blurSafe,
        blurStrength: DEFAULT_ZOOM.blurStrength,
        // The default ease, which is the `smoothstep` the automatic pass has
        // always moved with. Shaping a curve is a taste the recording says
        // nothing about, so this is one of the settings it declines to guess.
        easeInX: DEFAULT_ZOOM.easeInX,
        easeInY: DEFAULT_ZOOM.easeInY,
        easeOutX: DEFAULT_ZOOM.easeOutX,
        easeOutY: DEFAULT_ZOOM.easeOutY,
        ...tiltFor(centre),
      });
    }
  }

  return zooms;
}

/**
 * The automatic pass, run again over an edit that already has zooms in it.
 *
 * `autoZooms` assumes an empty timeline and is what runs once when a recording
 * is opened. This is the version for the button: it has to add shots to work
 * somebody has already done, and the one unforgivable thing it could do is
 * throw away a zoom they placed by hand.
 *
 * So nothing existing is ever moved, retargeted or deleted. A candidate that
 * lands where a zoom already is **extends that zoom** rather than replacing it
 * — the moment it found is real, and the zoom that is already there covering
 * part of it should simply cover the rest. Everything else is inserted into the
 * gaps, trimmed to fit them.
 *
 * A candidate spanning two or more existing zooms is dropped. Extending one of
 * them would mean swallowing the other, and a stretch already carrying two
 * hand-made shots is not a stretch that needs a third opinion.
 */
export function augmentZooms(
  existing: readonly ZoomSlice[],
  moments: readonly Moment[],
  options: AutoEditOptions,
): ZoomSlice[] {
  const kept = [...existing].sort((a, b) => a.source.start - b.source.start);

  for (const candidate of autoZooms(moments, options)) {
    const overlapping = kept.filter(
      (zoom) =>
        zoom.source.start < candidate.source.end && candidate.source.start < zoom.source.end,
    );

    if (overlapping.length > 1) continue;

    const index =
      overlapping.length === 1
        ? kept.indexOf(overlapping[0]!)
        : kept.findIndex((zoom) => zoom.source.start >= candidate.source.end);

    // Where this may reach without touching its neighbours. `sanitiseProject`
    // drops an overlap outright, so staying clear of them is what keeps the
    // result from being quietly smaller than it looks.
    const at = index === -1 ? kept.length : index;
    const before = kept[at - 1];
    const after = overlapping.length === 1 ? kept[at + 1] : kept[at];
    const floor = before ? before.source.end + MIN_GAP : 0;
    const ceiling = after ? after.source.start - MIN_GAP : options.duration;

    if (overlapping.length === 1) {
      const current = overlapping[0]!;
      const start = Math.max(floor, Math.min(current.source.start, candidate.source.start));
      const end = Math.min(ceiling, Math.max(current.source.end, candidate.source.end));

      // Only ever grows. A candidate entirely inside an existing shot leaves it
      // exactly as it was rather than trimming it to the smaller span.
      if (end - start > current.source.end - current.source.start) {
        kept[at] = { ...current, source: { start, end } };
      }
      continue;
    }

    const start = Math.max(floor, candidate.source.start);
    const end = Math.min(ceiling, candidate.source.end);
    if (end - start < MIN_SPAN) continue;

    kept.splice(at, 0, { ...candidate, id: `auto-${String(start)}`, source: { start, end } });
  }

  return kept;
}

/**
 * Cuts one long run into shots no longer than `maxSpan`.
 *
 * Greedy from the front rather than at the widest internal gaps: the gaps
 * inside a cluster are all under `CLUSTER_GAP` by construction, so none of them
 * is a meaningfully better cut than any other, and picking the widest would
 * make the shot boundaries jitter with the input for no visible gain.
 */
function split(group: readonly Moment[], maxSpan: MediaTime): Moment[][] {
  const chunks: Moment[][] = [];
  let current: Moment[] = [];

  for (const moment of group) {
    const first = current[0];
    if (first && moment.at - first.at > maxSpan) {
      chunks.push(current);
      current = [];
    }
    current.push(moment);
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
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
