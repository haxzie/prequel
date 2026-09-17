import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  TELEPROMPTER_FOOTER,
  TELEPROMPTER_LEADING,
  TELEPROMPTER_LINES,
  TELEPROMPTER_PADDING,
  TELEPROMPTER_SIZES,
  type TeleprompterMode,
  type TeleprompterPosition,
  type TeleprompterState,
} from "../../../shared/contract";
import { tokenise, type ScriptWord } from "../../../shared/teleprompter";
import { useDock } from "../hooks/useDock";
import { useTeleprompter, useTeleprompterPosition } from "../hooks/useTeleprompter";
import { cn } from "../lib/cn";

/**
 * Which of the visible lines the word being read sits on, from the top.
 *
 * The second rather than the middle: what matters to a reader is what comes
 * *next*, so two lines of it are kept in view below the current one and one
 * line of what has been said above — enough to find the place again after a
 * glance at the camera.
 */
const READING_LINE = 1;

/**
 * How long the text takes to settle on a new position.
 *
 * Short enough that voice follow feels attached to the voice; long enough that
 * a word arriving mid-line does not snap. Auto-scroll uses the tick interval
 * instead, so its motion is continuous rather than a step per word.
 */
const FOLLOW_MS = 220;

/** How long after the last wheel event the reader is taken to have stopped. */
const WHEEL_SETTLE_MS = 250;

/** Radius of the concave corners where the island meets the screen edge. */
const EAR = 14;

/**
 * The island.
 *
 * Draws the script and lights the words as main says they are read. Nothing
 * here decides where the reader is: the position arrives on its own channel
 * and is written straight to the DOM — the state of every word span, the
 * scroll transform, the counter — because it changes up to ten times a second
 * and re-rendering a few hundred spans for each would be absurd.
 */
export function Teleprompter() {
  const { preferences, session } = useDock();
  const state = useTeleprompter();
  const recording = session.status !== "idle";
  const words = useMemo(() => tokenise(state.script), [state.script]);

  const viewport = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const counter = useRef<HTMLSpanElement>(null);
  const meter = useRef<HTMLSpanElement>(null);
  const status = useRef<HTMLSpanElement>(null);
  const position = useRef(0);
  /** The reader's own scrolling, in pixels, on top of where the position puts the text. */
  const wheel = useRef(0);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const size = TELEPROMPTER_SIZES[preferences.teleprompterSize];
  const lineHeight = size * TELEPROMPTER_LEADING;
  const viewportHeight = TELEPROMPTER_LINES * lineHeight;
  const mode = preferences.teleprompterMode;
  const settleMs =
    mode === "timed" ? Math.min(600, 60_000 / preferences.teleprompterSpeed) : FOLLOW_MS;

  /**
   * Puts the current word's line on the reading line.
   *
   * Clamped to the text, which is padded by a row above and two below — see
   * the scroller — so the first line and the last can each reach the reading
   * row and no further. Without the padding the first line sat on the top
   * row, and a wheel scrolled to the top landed on the second line's words
   * because those were the ones on the reading row. The wheel's offset is
   * clamped with it, so a long scroll past the end does not have to be
   * scrolled all the way back.
   */
  const layout = useCallback(() => {
    const track = scroller.current;
    if (!track) return;
    const current = track.querySelector<HTMLElement>(`[data-i="${String(position.current)}"]`);
    // Past the end: hold on the last word rather than scrolling into nothing.
    const anchor = current ?? track.querySelector<HTMLElement>("[data-i]:last-of-type");
    const wanted = anchor ? anchor.offsetTop - lineHeight * READING_LINE : 0;
    const furthest = Math.max(0, track.offsetHeight - viewportHeight);
    const scroll = Math.min(Math.max(wanted - wheel.current, 0), furthest);
    wheel.current = wanted - scroll;
    track.style.transform = `translateY(${String(-Math.round(scroll))}px)`;
    // The edges fade only where there is text behind them. A fade over the
    // first line at the top of the script, or the last at its end, dims words
    // that nothing is hiding.
    const view = viewport.current;
    if (view) {
      view.style.setProperty("--fade-top", scroll > 0.5 ? "1" : "0");
      view.style.setProperty("--fade-bottom", scroll < furthest - 0.5 ? "1" : "0");
    }
  }, [lineHeight, viewportHeight]);

  /** Lights the words up to the position. */
  const paint = useCallback(
    (at: number) => {
      const track = scroller.current;
      if (!track) return;
      for (const span of track.querySelectorAll<HTMLElement>("[data-i]")) {
        const index = Number(span.dataset["i"]);
        span.dataset["state"] = index < at ? "read" : index === at ? "current" : "next";
      }
      if (counter.current)
        counter.current.textContent = `${String(Math.min(at, words.length))} / ${String(words.length)}`;
    },
    [words.length],
  );

  const onPosition = useCallback(
    (next: TeleprompterPosition) => {
      if (next.position !== position.current) {
        position.current = next.position;
        // A word moving is main saying where the reader is; the reader's own
        // scrolling is over.
        wheel.current = 0;
        paint(next.position);
        layout();
      }
      meter.current?.style.setProperty("--level", next.level.toFixed(3));
      if (status.current) status.current.dataset["lost"] = next.lost ? "true" : "false";
    },
    [paint, layout],
  );
  useTeleprompterPosition(onPosition);

  // A wheel settle still pending when the island goes would jump a position
  // on a window that is no longer showing.
  useEffect(
    () => () => {
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
    },
    [],
  );

  // The island slides down when shown and up when hidden. The window stays
  // mounted across both, so main says which; the counter restarts the enter
  // animation on a second show, which the same class name would not.
  const [motion, setMotion] = useState<{ phase: "in" | "out"; count: number }>({
    phase: "in",
    count: 0,
  });
  useEffect(
    () =>
      window.prequel.teleprompter.onVisible((visible) =>
        setMotion((last) => ({ phase: visible ? "in" : "out", count: last.count + 1 })),
      ),
    [],
  );

  // A new script, a new size, or a fresh island — the enter animation remounts
  // it, which resets every word to unread — re-lays everything out from the
  // position held.
  useEffect(() => {
    paint(position.current);
    layout();
  }, [words, paint, layout, motion.count]);

  /**
   * Scrolling by hand.
   *
   * The text follows the wheel at once, and when it stops the word now on the
   * reading line becomes the position — so voice follow resumes from where the
   * reader is looking, not where it last heard them. The same idea as clicking
   * a word, with the wheel choosing it.
   */
  const onWheel = (event: React.WheelEvent) => {
    if (words.length === 0) return;
    wheel.current -= event.deltaY;
    layout();
    if (wheelTimer.current) clearTimeout(wheelTimer.current);
    wheelTimer.current = setTimeout(() => {
      const track = scroller.current;
      const view = viewport.current;
      if (!track || !view) return;
      const line = view.getBoundingClientRect().top + lineHeight * (READING_LINE + 0.5);
      let nearest: { index: number; distance: number } | null = null;
      for (const span of track.querySelectorAll<HTMLElement>("[data-i]")) {
        const box = span.getBoundingClientRect();
        const distance = Math.abs(box.top + box.height / 2 - line);
        if (!nearest || distance < nearest.distance) {
          nearest = { index: Number(span.dataset["i"]), distance };
        }
      }
      if (nearest) void window.prequel.teleprompter.jump({ to: nearest.index });
    }, WHEEL_SETTLE_MS);
  };

  const notch = state.notch;
  const paragraphs = useMemo(() => byParagraph(words), [words]);

  return (
    <div className="prompter-theme relative h-full w-full">
      <div
        key={motion.count}
        className={cn(
          "absolute inset-x-(--panel-inset) bottom-(--panel-inset) flex flex-col overflow-visible",
          "bg-prompter-bg text-prompter-fg shadow-[0_10px_28px_rgba(0,0,0,0.5)]",
          notch ? "top-0 rounded-b-[22px]" : "top-(--panel-inset) rounded-[18px]",
          motion.phase === "in" ? "animate-island-in" : "animate-island-out",
          "motion-reduce:animate-none",
        )}
        style={{ "--ear": `${String(EAR)}px` } as React.CSSProperties}
      >
        {notch && (
          <>
            {/* The corners where the island meets the bezel curve outwards,
                the way the notch's own do, so the whole thing reads as one
                shape grown from it rather than a panel stuck under it. */}
            <span className="notch-ear left-[calc(var(--ear)*-1)]" aria-hidden="true" />
            <span
              className="notch-ear right-[calc(var(--ear)*-1)] -scale-x-100"
              aria-hidden="true"
            />
            <div className="flex-none" style={{ height: notch.height }} />
          </>
        )}

        <div
          ref={viewport}
          className="prompter-fade relative overflow-hidden"
          style={{
            height: viewportHeight,
            marginTop: TELEPROMPTER_PADDING,
            marginInline: TELEPROMPTER_PADDING,
          }}
          onWheel={onWheel}
        >
          {words.length === 0 ? (
            <Empty />
          ) : (
            <div
              ref={scroller}
              className="will-change-transform"
              style={{
                fontSize: size,
                lineHeight: `${String(lineHeight)}px`,
                // Room for the first line to sit on the reading row, and the
                // last — so every line can be the one being read.
                paddingTop: lineHeight * READING_LINE,
                paddingBottom: lineHeight * (TELEPROMPTER_LINES - 1 - READING_LINE),
                transition: `transform ${String(settleMs)}ms cubic-bezier(0.2, 0.8, 0.2, 1)`,
              }}
            >
              {paragraphs.map((paragraph, i) => (
                <p key={i} className="m-0 font-semibold text-pretty">
                  {paragraph.map((word) => (
                    <Word key={word.index} word={word} />
                  ))}
                </p>
              ))}
            </div>
          )}
        </div>

        <footer
          className="flex flex-none items-center gap-3 px-4 text-[11px] text-prompter-muted"
          style={{
            height: TELEPROMPTER_FOOTER + TELEPROMPTER_PADDING,
            paddingBottom: TELEPROMPTER_PADDING / 2,
          }}
        >
          <Meter ref={meter} live={state.listening === "on" && !state.paused} />
          {/* Unbreakable: flex would otherwise fold "0 / 68" into a column
              the moment the status beside it wants the room. */}
          <span ref={counter} className="flex-none whitespace-nowrap tabular-nums">
            0 / {words.length}
          </span>
          {/* The one line that gives: it takes what is left and truncates. */}
          <span ref={status} className="prompter-status min-w-0 flex-1 truncate">
            {describe(mode, state, preferences.teleprompterSpeed, recording)}
          </span>
          {/* Left off the narrow island: with the status truncated there is no
              room for a hint, and Settings lists the keys anyway. */}
          {preferences.teleprompterWidth !== "narrow" && (
            <span className="flex-none whitespace-nowrap opacity-70">
              ⌃⌥↑↓ sentence · ⌃⌥␣ pause
            </span>
          )}
        </footer>
      </div>
    </div>
  );
}

/** Words grouped by the line they were written on. */
function byParagraph(words: ScriptWord[]): ScriptWord[][] {
  const groups: ScriptWord[][] = [];
  for (const word of words) {
    const last = groups.at(-1);
    if (last && last[0]!.paragraph === word.paragraph) last.push(word);
    else groups.push([word]);
  }
  return groups;
}

/**
 * One word, lit by its `data-state`.
 *
 * Clicking it is the reader saying "I am here": the position moves and voice
 * follow carries on from it. A direction is drawn but is not a place to land.
 */
function Word({ word }: { word: ScriptWord }) {
  return (
    <>
      <span
        data-i={word.index}
        data-state="next"
        data-direction={word.direction || undefined}
        className="prompter-word no-drag cursor-default rounded-[5px] px-[3px] -mx-[3px]"
        onClick={() => void window.prequel.teleprompter.jump({ to: word.index })}
      >
        {word.text}
      </span>{" "}
    </>
  );
}

function Empty() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <p className="text-sm text-prompter-muted">No script yet.</p>
      <button
        type="button"
        className="no-drag rounded-full bg-white/12 px-3 py-1 text-xs text-prompter-fg hover:bg-white/18"
        onClick={() => void window.prequel.teleprompter.openScript()}
      >
        Write one
      </button>
    </div>
  );
}

/**
 * The microphone, as three bars.
 *
 * Driven by `--level`, written straight to the element by the position
 * handler. Still when nothing is listening, so a silent meter never claims
 * to be hearing.
 */
function Meter({ ref, live }: { ref: React.Ref<HTMLSpanElement>; live: boolean }) {
  return (
    <span
      ref={ref}
      className={cn("flex h-3 flex-none items-end gap-[2px]", !live && "opacity-40")}
      aria-hidden="true"
    >
      <span className="prompter-bar" style={{ "--gain": 0.6 } as React.CSSProperties} />
      <span className="prompter-bar" style={{ "--gain": 1 } as React.CSSProperties} />
      <span className="prompter-bar" style={{ "--gain": 0.8 } as React.CSSProperties} />
    </span>
  );
}

/** What the footer says about how the text is moving, or will. */
function describe(
  mode: TeleprompterMode,
  state: TeleprompterState,
  wpm: number,
  recording: boolean,
): string {
  if (state.paused) return "Paused";
  // Nothing moves the words until the take begins — the microphone stays
  // closed while the panel is merely open — so say what will, rather than
  // claiming to be doing it.
  if (!recording) {
    switch (mode) {
      case "voice":
        return "Follows your voice once you record";
      case "timed":
        return `Scrolls at ${String(wpm)} words a minute once you record`;
      case "manual":
        return "Manual";
    }
  }
  switch (state.listening) {
    case "unavailable":
      return "No on-device speech model — auto-scrolling. Add the language under Keyboard › Dictation.";
    case "denied":
      return "Speech recognition isn't allowed — auto-scrolling. Allow it in Privacy & Security.";
    case "failed":
      return "Couldn't listen — auto-scrolling.";
    case "starting":
      return "Opening the microphone…";
    default:
      break;
  }
  switch (mode) {
    case "voice":
      return "Following your voice";
    case "timed":
      return `Auto-scrolling at ${String(wpm)} words a minute`;
    case "manual":
      return "Manual";
  }
}
