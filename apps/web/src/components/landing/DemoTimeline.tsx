/**
 * The track under a demo picture: a ruler, a row of slices, and a playhead
 * crossing both.
 *
 * Shared by the zoom demo and the layouts demo below it, and shared
 * because the two are making the same claim in the same visual language —
 * "this is a timeline, and the picture above is showing you the slice under the
 * playhead". Two hand-rolled copies would drift the first time either was
 * touched, and a track whose slices are a different height or whose playhead is
 * a different red is one the eye reads as a different kind of object.
 *
 * What differs between the two is passed in, and it is only ever three things:
 * how many slices there are, what goes in each, and which keyframes drive them.
 * The keyframes cannot be shared, because a duty cycle depends on the count —
 * one slice of four is lit for 25% of the period and one of six for 16.7% — but
 * `demo-playhead` is a plain sweep and both demos do use that one, at their own
 * durations.
 */
import type { ReactNode } from "react";

export function DemoTimeline({
  slices,
  step,
  sliceClass,
  playheadClass,
}: {
  /** One entry per slice: what to draw inside it, and a stable key. */
  slices: { key: string; content: ReactNode }[];
  /** Seconds per slice, used for the delay that staggers them. */
  step: number;
  /** The keyframe that lights a slice, e.g. `animate-demo-slice`. */
  sliceClass: string;
  /** The keyframe that sweeps the head, e.g. `animate-demo-playhead`. */
  playheadClass: string;
}) {
  return (
    // `overflow-x: clip` because of the playhead below: the rail is the full
    // width of the track and finishes a full width to the right of it, so
    // without this the page grows ~400px of horizontal scroll for the second
    // half of every cycle and loses it again — a scrollbar that comes and goes
    // on its own, on every page the demos appear on.
    //
    // `clip` and not `hidden`: `hidden` would make this a scroll container,
    // which anchors and focus can scroll, and it would have to be `hidden` on
    // both axes — the head's triangle sits a pixel above the rail and would be
    // shaved off. `clip` on one axis composes with `visible` on the other.
    //
    // The margin is what the triangle overhangs the rail by at each end: 3px
    // for its own offset and 1px for the rail's, so the head is still whole at
    // both ends of the sweep. Engines without `overflow-clip-margin` trim those
    // four pixels, which costs the tip of an 8px triangle for one frame.
    <div className="relative mt-3 overflow-x-clip [overflow-clip-margin:4px] sm:mt-4">
      <Ruler count={slices.length} />

      <div className="mt-1.5 flex gap-1.5 sm:gap-2">
        {slices.map((slice, index) => (
          <div
            key={slice.key}
            data-demo-slice={index}
            className={`${sliceClass} flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border sm:h-12 sm:gap-2`}
            // A slice later than the one before it, and nothing else about it
            // differs — which is why there is one keyframe rather than one per
            // slice.
            style={{ animationDelay: `${index * step}s` }}
          >
            {slice.content}
          </div>
        ))}
      </div>

      {/* The rail is the full width of the track with the head on its left
          edge, so one `translateX(100%)` is exactly one track width. That is
          also why the wrapper above clips: a full-width element translated a
          full width lands entirely outside the track. */}
      <div className={`${playheadClass} pointer-events-none absolute inset-y-0 left-0 w-full`}>
        <div className="absolute inset-y-0 -left-px w-0.5 rounded-full bg-brand-from">
          {/* A triangle, pointed at the line it sits on. `clip-path` rather than
              the border trick: a transparent-border triangle has no box to
              round or recolour, and this one has to line up with a 2px rail to
              the half pixel. */}
          <span
            className="absolute -top-px -left-[3px] block size-2 bg-brand-from"
            style={{ clipPath: "polygon(50% 100%, 0 0, 100% 0)" }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The ruler over the slices.
 *
 * Ticks and no figures. A timeline this short has nothing worth reading off it
 * — the numbers would be four seconds apart and mean nothing to a visitor — but
 * without any ruler at all the slices read as buttons rather than as something
 * laid out in time.
 *
 * Two repeating gradients rather than a few dozen elements. The period is a
 * percentage of the track, so the ticks stay aligned to the slices at every
 * width: a tall one on each slice boundary, and four short ones inside every
 * slice. Both fall out of the count, which is the only reason the same ruler
 * can sit under a four-slice track and a six-slice one.
 */
function Ruler({ count }: { count: number }) {
  const major = 100 / count;
  const minor = major / 4;

  return (
    <div className="relative h-2.5">
      <div
        className="absolute inset-x-0 bottom-0 h-2.5"
        style={{
          // `--track-accent` is what a demo sets to colour its own track; the
          // fallback is the default the zoom demo has always used. See the rule
          // on `[data-layout-demo]` in `globals.css`.
          backgroundImage: `repeating-linear-gradient(to right, color-mix(in oklab, var(--track-accent, var(--accent)) 60%, transparent) 0 1px, transparent 1px ${major.toFixed(4)}%)`,
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-1.5"
        style={{
          backgroundImage: `repeating-linear-gradient(to right, color-mix(in oklab, var(--fg) 22%, transparent) 0 1px, transparent 1px ${minor.toFixed(4)}%)`,
        }}
      />
    </div>
  );
}
