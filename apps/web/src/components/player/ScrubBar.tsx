"use client";

import { useImperativeHandle, useMemo, useRef, type PointerEvent, type Ref } from "react";

import { chapterAt, formatTime, segments, type Chapter } from "./time";

/** What the player writes to the bar, once a frame. */
export interface ScrubBarHandle {
  paint(at: number, duration: number, buffered: TimeRanges): void;
}

/**
 * The bar, divided where the chapters are.
 *
 * One segment per chapter with a hairline gap between, so the bar itself says
 * where the subject changes before anybody hovers it — the same reason a
 * book has a contents page and not only page numbers. With no chapters it is
 * one segment, and nothing else about it differs.
 *
 * Nothing per frame goes through React. `paint` writes three custom
 * properties on the root — played, buffered, and the hover position — and the
 * segments derive their own fills from those in CSS. Twelve `style` writes a
 * frame would be fine; one is better, and it keeps the arithmetic in one
 * place.
 */
export function ScrubBar({
  ref,
  chapters,
  duration,
  label,
  onSeek,
  onScrubStart,
}: {
  ref?: Ref<ScrubBarHandle>;
  chapters: readonly Chapter[];
  duration: number;
  /** The recording's title, for the slider's accessible name. */
  label: string;
  onSeek: (seconds: number) => void;
  /** The pointer went down on the bar. The player pauses so the drag is a scrub, not a chase. */
  onScrubStart: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const tipTime = useRef<HTMLSpanElement>(null);
  const tipTitle = useRef<HTMLSpanElement>(null);
  /** Where the video is, for the ARIA value and the drag. */
  const state = useRef({ at: 0, duration });
  const dragging = useRef(false);

  const spans = useMemo(() => segments(chapters, duration), [chapters, duration]);

  useImperativeHandle(
    ref,
    () => ({
      paint(at, total, buffered) {
        const element = root.current;
        if (!element) return;
        state.current = { at, duration: total };

        const fraction = total > 0 ? at / total : 0;
        // The end of the range the playhead is in, which is the one that
        // matters: what is buffered behind the head is already watched.
        let ahead = 0;
        for (let i = 0; i < buffered.length; i += 1) {
          if (buffered.start(i) <= at && at <= buffered.end(i)) {
            ahead = buffered.end(i) / total;
            break;
          }
        }

        element.style.setProperty("--played", String(fraction));
        element.style.setProperty("--buffered", String(Math.max(ahead, fraction)));
        element.setAttribute("aria-valuenow", String(Math.round(at)));
        element.setAttribute("aria-valuemax", String(Math.round(total)));
        element.setAttribute("aria-valuetext", `${formatTime(at, total)} of ${formatTime(total)}`);
      },
    }),
    [],
  );

  const strip = useRef<HTMLDivElement>(null);

  // Against the strip rather than the root: the root carries the padding
  // that makes it hittable, and a pointer on that padding is at the strip's
  // end, not a few pixels past it.
  const fractionAt = (event: PointerEvent) => {
    const rect = strip.current!.getBoundingClientRect();
    return Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
  };

  const hover = (event: PointerEvent) => {
    const element = root.current;
    const bubble = tip.current;
    if (!element || !bubble) return;

    const fraction = fractionAt(event);
    const seconds = fraction * state.current.duration;

    element.style.setProperty("--hover", String(fraction));
    if (tipTime.current) tipTime.current.textContent = formatTime(seconds, state.current.duration);

    const index = chapterAt(chapters, seconds);
    const title = index >= 0 ? chapters[index]!.title : "";
    if (tipTitle.current) {
      tipTitle.current.textContent = title;
      tipTitle.current.hidden = title === "";
    }

    // Kept inside the bar. `--hover` centres the bubble on the pointer; at
    // either end that puts half of it off the edge, so the translation is
    // clamped to the bar's own width.
    const half = bubble.offsetWidth / 2;
    const width = strip.current?.clientWidth ?? element.clientWidth;
    const x = Math.min(Math.max(fraction * width, half), width - half);
    bubble.style.transform = `translateX(${x - half}px)`;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    root.current?.setPointerCapture(event.pointerId);
    dragging.current = true;
    onScrubStart();
    onSeek(fractionAt(event) * state.current.duration);
    hover(event);
  };

  const onPointerMove = (event: PointerEvent) => {
    hover(event);
    if (dragging.current) onSeek(fractionAt(event) * state.current.duration);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    root.current?.releasePointerCapture(event.pointerId);
    onSeek(fractionAt(event) * state.current.duration);
  };

  return (
    <div
      ref={root}
      role="slider"
      aria-label={`Seek ${label}`}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={0}
      tabIndex={0}
      // Tall enough to hit and thin enough to look like a line: the visible
      // bar is the inner strip and the padding around it is the target.
      className="group/bar relative -mx-1 cursor-pointer touch-none px-1 py-2"
      style={{ "--played": 0, "--buffered": 0, "--hover": 0 } as React.CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerEnter={(event) => {
        hover(event);
        tip.current?.classList.remove("opacity-0");
      }}
      onPointerLeave={() => tip.current?.classList.add("opacity-0")}
    >
      <div ref={strip} className="flex h-1 gap-[3px] transition-[height] group-hover/bar:h-1.5">
        {spans.map((span) => (
          <div
            key={span.start}
            className="relative h-full overflow-hidden rounded-full bg-white/25"
            style={
              {
                flexGrow: span.end - span.start,
                "--s": span.start,
                "--len": Math.max(span.end - span.start, 0.0001),
              } as React.CSSProperties
            }
          >
            {/* Each fill is the whole bar's fraction, mapped into this segment
                and clamped to it — so a segment is empty until the head
                reaches it, and full once the head has passed. */}
            {/* White for what has played, and two greys under it. The accent
                blue is the editor's playhead and reads as a control here; on
                a black gradient over somebody else's footage, white is the
                colour that belongs to no brand. */}
            <Fill className="bg-white/30" property="--buffered" />
            <Fill className="bg-white/50" property="--hover" hoverOnly />
            <Fill className="bg-white" property="--played" />
          </div>
        ))}
      </div>

      {/* The dot. On the played edge and only on hover, because a scrubber
          with a permanent knob on it is a control, and this is a line. */}
      <div
        className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow transition-opacity group-hover/bar:opacity-100"
        style={{ left: "calc(0.25rem + var(--played) * (100% - 0.5rem))" }}
      />

      {/* Time and chapter under the pointer. Written directly on every move. */}
      <div
        ref={tip}
        className="pointer-events-none absolute bottom-full left-1 mb-2 flex flex-col items-center gap-0.5 rounded-md bg-black/80 px-2 py-1 text-xs opacity-0 backdrop-blur transition-opacity"
      >
        <span ref={tipTitle} className="max-w-56 truncate font-medium" hidden />
        <span ref={tipTime} className="tabular-nums text-white/80">
          0:00
        </span>
      </div>
    </div>
  );
}

/**
 * A fill across one segment, from a bar-wide fraction.
 *
 * `(fraction − start) / length`, clamped to the segment: the whole of the
 * arithmetic is in CSS, so one property write on the root repaints every
 * segment without a line of script per segment.
 */
function Fill({
  className,
  property,
  hoverOnly,
}: {
  className: string;
  property: "--played" | "--buffered" | "--hover";
  hoverOnly?: boolean;
}) {
  return (
    <div
      className={`absolute inset-y-0 left-0 ${className} ${
        hoverOnly ? "opacity-0 group-hover/bar:opacity-100" : ""
      }`}
      style={{
        width: `calc(clamp(0, (var(${property}) - var(--s)) / var(--len), 1) * 100%)`,
      }}
    />
  );
}
