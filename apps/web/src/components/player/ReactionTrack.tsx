"use client";

import type { Reaction } from "./conversation";
import { formatTime } from "./time";

/**
 * The emoji people left, on the timeline they left them on.
 *
 * Directly above the scrub bar and in the same coordinate space, so a mark
 * sits over the moment it belongs to rather than near it — which is the whole
 * claim the row makes. Clicking one goes there: a reaction is somebody saying
 * *look at this bit*, and the obvious thing to do with it is look at that bit.
 *
 * Drawn from React state rather than written per frame like the bar under it.
 * These change when somebody presses an emoji — a few times a recording, not
 * sixty times a second — so the loop never touches this.
 */
export function ReactionTrack({
  reactions,
  duration,
  onSeek,
}: {
  reactions: readonly Reaction[];
  /** Seconds. Zero before the metadata has loaded, which is when nothing is drawn. */
  duration: number;
  onSeek: (seconds: number) => void;
}) {
  if (reactions.length === 0 || duration <= 0) return null;

  return (
    <div className="pointer-events-none relative h-5 select-none" aria-hidden="true">
      {reactions.map((reaction) => {
        const seconds = reaction.atMs / 1000;
        const fraction = Math.min(Math.max(seconds / duration, 0), 1);

        return (
          <button
            key={reaction.id}
            type="button"
            tabIndex={-1}
            title={`${reaction.emoji} ${reaction.by} · ${formatTime(seconds, duration)}`}
            // The marks overlap where people agreed, and that pile is worth
            // seeing — it is what a cluster on a timeline means. The hover
            // lifts one out of the pile so the one under the pointer is the
            // one that is read.
            className="pointer-events-auto absolute bottom-0 -translate-x-1/2 text-sm leading-none transition-transform hover:z-10 hover:scale-125"
            style={{ left: `${fraction * 100}%` }}
            onClick={(event) => {
              // The bar below is a slider that seeks on pointer-down over its
              // whole width; without this a press on a mark would seek twice,
              // once to the mark and once to wherever the emoji happened to
              // be drawn.
              event.stopPropagation();
              onSeek(seconds);
            }}
          >
            {reaction.emoji}
          </button>
        );
      })}
    </div>
  );
}
