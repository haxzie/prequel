import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import type {
  PickerWindow,
  Region,
  SelectionResult,
  SelectionSetup,
  Target,
} from "../../../shared/contract";
import { AreaIcon, ScreenIcon } from "../dock/icons";

/** Ignore a drag this small — it is a click that wobbled, not a region. */
const MIN_AREA_EDGE = 8;

/** Where the countdown starts, and how long each number is on screen. */
const COUNTDOWN_FROM = 3;
const COUNTDOWN_STEP_MS = 1000;

/** A rectangle in overlay-local CSS pixels. */
type Rect = { x: number; y: number; width: number; height: number };

/** Dark enough to read as modal, light enough to still see what you pick. */
const OVERLAY = "fixed inset-0 cursor-crosshair bg-[rgba(6,7,9,0.4)]";

/** The same sheet once a region is drawn: nothing left on it to aim at. */
const OVERLAY_SETTLED = "fixed inset-0 cursor-default bg-[rgba(6,7,9,0.4)]";

/**
 * The outline of what will be recorded.
 *
 * The huge spread shadow punches the dimming back out over this rectangle, so
 * the choice reads as "this is what you get".
 */
const HIGHLIGHT =
  "pointer-events-none absolute rounded-md border-2 border-selected bg-selected/10 " +
  "shadow-[0_0_0_9999px_rgba(6,7,9,0.26)]";

/** White on a white window is invisible, and there is no card behind the text
    to guarantee contrast — so it has to come from the type itself. */
const CARD_SHADOW = "[text-shadow:0_1px_3px_rgba(0,0,0,0.75),0_0_12px_rgba(0,0,0,0.5)]";

/** An icon gets a drop shadow rather than a text shadow: it has to follow the
    alpha rather than the box. */
const GLYPH_SHADOW = "[filter:drop-shadow(0_2px_6px_rgba(0,0,0,0.6))]";

/** What a mode hands up when its Start button is pressed. */
type Pending = { result: SelectionResult; rect: Rect };

export function Selection() {
  const [setup, setSetup] = useState<SelectionSetup | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => window.prequel.selection.onSetup(setSetup), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void window.prequel.selection.cancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!setup) return <div className={OVERLAY} />;

  // Held here rather than inside a mode, because a mode can stop rendering the
  // thing that started the count — the window card disappears the moment the
  // pointer leaves the window — and that would take the countdown with it.
  if (pending) {
    return (
      <Countdown
        rect={pending.rect}
        onDone={() => void window.prequel.selection.choose(pending.result)}
      />
    );
  }

  switch (setup.mode) {
    case "area":
      return <AreaSelection setup={setup} onStart={setPending} />;
    case "screen":
      return <ScreenSelection setup={setup} onStart={setPending} />;
    default:
      return <WindowSelection setup={setup} onStart={setPending} />;
  }
}

/**
 * Counts down to the recording, over the region it is about to capture.
 *
 * Only the number: whatever the card was saying has been read by now, and the
 * point of these three seconds is to get out of the way and let the user get
 * ready.
 */
function Countdown({ rect, onDone }: { rect: Rect; onDone: () => void }) {
  const [remaining, setRemaining] = useState(COUNTDOWN_FROM);

  // Through a ref so a fresh closure from the parent does not restart the tick.
  const finish = useRef(onDone);
  finish.current = onDone;

  useEffect(() => {
    if (remaining <= 0) {
      finish.current();
      return;
    }
    const timer = setTimeout(() => setRemaining((value) => value - 1), COUNTDOWN_STEP_MS);
    return () => clearTimeout(timer);
  }, [remaining]);

  return (
    <div className={OVERLAY}>
      <div
        className={HIGHLIGHT}
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      >
        {remaining > 0 && (
          // Keyed by the number so each one restarts the animation rather than
          // swapping the glyph inside a run that is already halfway through.
          <span
            key={remaining}
            // The centring transform is written as one declaration rather than
            // as translate utilities: the keyframes animate `transform`, and a
            // separate `translate` property would apply on top of them instead
            // of being replaced by them.
            className={
              "pointer-events-none absolute top-1/2 left-1/2 animate-countdown-pop " +
              "[transform:translate(-50%,-50%)] text-[132px] leading-none font-bold " +
              "tabular-nums text-white " +
              "[text-shadow:0_2px_10px_rgba(0,0,0,0.7),0_0_40px_rgba(0,0,0,0.5)]"
            }
            style={{ "--countdown-step": `${COUNTDOWN_STEP_MS}ms` } as CSSProperties}
          >
            {remaining}
          </span>
        )}
      </div>
    </div>
  );
}

/** Hover a window, then record it. */
function WindowSelection({
  setup,
  onStart,
}: {
  setup: SelectionSetup;
  onStart: (pending: Pending) => void;
}) {
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  // Windows arrive front-to-back — the capture layer sorts them into the window
  // server's own stacking order — so the first match under the cursor is the
  // one actually visible there.
  const hovered = useMemo((): PickerWindow | null => {
    if (!pointer) return null;
    return (
      setup.windows.find(
        ({ rect }) =>
          pointer.x >= rect.x &&
          pointer.x <= rect.x + rect.width &&
          pointer.y >= rect.y &&
          pointer.y <= rect.y + rect.height,
      ) ?? null
    );
  }, [setup.windows, pointer]);

  const start = () => {
    if (!hovered) return;
    onStart({
      result: {
        target: hovered.target,
        crop: null,
        label: label(hovered.target),
        start: true,
      },
      rect: hovered.rect,
    });
  };

  return (
    <div
      className={OVERLAY}
      onMouseMove={(event) => setPointer({ x: event.clientX, y: event.clientY })}
      onMouseLeave={() => setPointer(null)}
      // Deliberately not clickable. The overlay covers the whole display, so a
      // click anywhere on it used to choose — including a click meant for a
      // button on top of it, and including one meant for nothing at all. The
      // highlighted window and the Start button are the only things that act.
    >
      {hovered && (
        <div
          className={HIGHLIGHT}
          style={{
            left: hovered.rect.x,
            top: hovered.rect.y,
            width: hovered.rect.width,
            height: hovered.rect.height,
          }}
        >
          <SelectionCard
            icon={
              hovered.icon ? (
                <img className={`mb-2.5 size-[88px] ${GLYPH_SHADOW}`} src={hovered.icon} alt="" />
              ) : (
                <Glyph>
                  <ScreenIcon />
                </Glyph>
              )
            }
            name={hovered.target.appName || hovered.target.title || "Untitled window"}
            detail={hovered.target.appName ? hovered.target.title : undefined}
            size={pixelSize(hovered.rect, hovered.target.scaleFactor || setup.scaleFactor)}
            onStart={start}
          />
        </div>
      )}

      {!hovered && <Hint title="Move over a window" detail="Click to choose · Esc to cancel" />}
    </div>
  );
}

/**
 * Record this whole display.
 *
 * One overlay per display, each offering its own screen — which is what makes a
 * second monitor pickable at all, rather than silently getting whichever one
 * the cursor happened to be on when the mode was chosen.
 */
function ScreenSelection({
  setup,
  onStart,
}: {
  setup: SelectionSetup;
  onStart: (pending: Pending) => void;
}) {
  const whole = { x: 0, y: 0, width: setup.width, height: setup.height };

  const start = () => {
    onStart({
      result: { target: setup.screenTarget, crop: null, label: "Entire screen", start: true },
      rect: whole,
    });
  };

  return (
    // Not clickable either — the Start button below is what confirms.
    <div className={OVERLAY}>
      <div
        className={HIGHLIGHT}
        style={{ left: whole.x, top: whole.y, width: whole.width, height: whole.height }}
      >
        <SelectionCard
          icon={
            <Glyph>
              <ScreenIcon />
            </Glyph>
          }
          name="Entire screen"
          detail={setup.displayLabel}
          size={pixelSize(whole, setup.scaleFactor)}
          onStart={start}
        />
      </div>
    </div>
  );
}

/** Drag out a rectangle, then record just that part of the screen. */
function AreaSelection({
  setup,
  onStart,
}: {
  setup: SelectionSetup;
  onStart: (pending: Pending) => void;
}) {
  const [origin, setOrigin] = useState<Point | null>(null);
  const [current, setCurrent] = useState<Point | null>(null);
  /** The drag is over and the region is waiting to be confirmed. */
  const [settled, setSettled] = useState(false);
  const originRef = useRef<Point | null>(null);
  const currentRef = useRef<Point | null>(null);

  const region = useMemo(() => regionOf(origin, current), [origin, current]);

  const start = useCallback(
    (dragged: Region) => {
      onStart({
        result: {
          target: setup.screenTarget,
          // The region is local to this overlay, which covers exactly this
          // display, and ScreenCaptureKit crops relative to the display's own
          // origin — so these coordinates already line up.
          crop: dragged,
          label: `Area ${Math.round(dragged.width)}×${Math.round(dragged.height)}`,
          start: true,
        },
        rect: dragged,
      });
    },
    [setup.screenTarget, onStart],
  );

  const commit = useCallback(() => {
    const dragged = regionOf(originRef.current, currentRef.current);
    originRef.current = null;

    if (!dragged || dragged.width < MIN_AREA_EDGE || dragged.height < MIN_AREA_EDGE) {
      // Too small to be intentional; let the user try again rather than
      // recording a few stray pixels.
      setOrigin(null);
      setCurrent(null);
      setSettled(false);
      return;
    }

    // Held rather than recorded straight away, so the region can be checked —
    // and redrawn — before it becomes a take.
    setSettled(true);
  }, []);

  return (
    <div
      className={settled ? OVERLAY_SETTLED : OVERLAY}
      onMouseDown={(event) => {
        // Deaf once a region is drawn. This used to start a fresh drag from
        // wherever it landed and clear `settled` on the way — so a press
        // anywhere, including one aimed at the card sitting on top, wiped the
        // selection and left an empty overlay. Escape starts again.
        if (settled) return;

        const point = { x: event.clientX, y: event.clientY };
        // Kept in a ref as well as state: the next mousemove can arrive before
        // React has committed the render, and reading stale state there would
        // drop the drag entirely.
        originRef.current = point;
        currentRef.current = point;
        setOrigin(point);
        setCurrent(point);
      }}
      onMouseMove={(event) => {
        if (settled || !originRef.current) return;
        const point = { x: event.clientX, y: event.clientY };
        currentRef.current = point;
        setCurrent(point);
      }}
      onMouseUp={() => {
        if (!settled) commit();
      }}
    >
      {region && (
        <div
          className={HIGHLIGHT}
          style={{ left: region.x, top: region.y, width: region.width, height: region.height }}
        >
          {settled ? (
            <SelectionCard
              icon={
                <Glyph>
                  <AreaIcon />
                </Glyph>
              }
              name="Selected area"
              size={pixelSize(region, setup.scaleFactor)}
              onStart={() => start(region)}
            />
          ) : (
            <span
              className={
                "absolute -top-[26px] left-0 max-w-full truncate rounded-md bg-accent " +
                "px-2 py-[3px] text-[11px] font-semibold text-white"
              }
            >
              {Math.round(region.width)} × {Math.round(region.height)}
            </span>
          )}
        </div>
      )}

      {!settled && (
        <Hint title="Drag to select an area" detail="Release to confirm · Esc to cancel" />
      )}
    </div>
  );
}

/**
 * What you get if you record this, drawn in the middle of it.
 *
 * Inside the highlight rather than at a fixed spot on screen, so the answer is
 * attached to the thing being answered about — with several overlapping
 * windows, a hint pinned to the bottom of the display leaves you guessing which
 * one it describes.
 */
function SelectionCard({
  icon,
  name,
  detail,
  size,
  onStart,
}: {
  icon: ReactNode;
  name: string;
  detail?: string;
  size: string;
  onStart: () => void;
}) {
  return (
    // The overlay owns the click, so the card must not eat hover tracking —
    // the Start button re-enables pointer events for itself.
    <div
      className={
        "pointer-events-none absolute top-1/2 left-1/2 flex max-w-[min(80%,340px)] " +
        "[transform:translate(-50%,-50%)] flex-col items-center gap-1 text-center " +
        `text-white ${CARD_SHADOW}`
      }
    >
      {icon}

      <div className="max-w-full truncate text-[17px] font-semibold" title={name}>
        {name}
      </div>
      {detail && (
        <div className="max-w-full truncate text-[13px]" title={detail}>
          {detail}
        </div>
      )}

      <div className="mt-0.5 text-xs tabular-nums">{size}</div>

      <button
        type="button"
        className={
          "pointer-events-auto mt-4 flex h-[34px] items-center gap-[7px] rounded-lg " +
          "bg-[#e5484d] px-4 text-[13px] font-semibold whitespace-nowrap text-white " +
          "shadow-[0_4px_14px_rgba(0,0,0,0.45)] [text-shadow:none] hover:brightness-[1.12]"
        }
        // A press must not begin a new area drag underneath the card.
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          // The overlay treats a click anywhere as "choose this", so this must
          // not count twice — and it means something stronger.
          event.stopPropagation();
          onStart();
        }}
      >
        <span className="size-2.5 rounded-full bg-white" />
        Start recording
      </button>
    </div>
  );
}

/** The stand-in when a window has no icon of its own, and the icon for a mode
    that is not a window at all. */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <span
      className={`mb-2.5 grid size-[88px] place-items-center text-white ${GLYPH_SHADOW} [&_svg]:size-[62px]`}
    >
      {children}
    </span>
  );
}

interface Point {
  x: number;
  y: number;
}

/**
 * The recorded resolution, not the on-screen point size.
 *
 * This is the number that ends up in the file, and on a Retina display the two
 * differ by a factor of two — exactly the sort of surprise worth answering
 * before the recording rather than after it.
 */
function pixelSize(rect: { width: number; height: number }, scaleFactor: number): string {
  const scale = scaleFactor || 1;
  return `${Math.round(rect.width * scale)} × ${Math.round(rect.height * scale)}`;
}

/** The rectangle spanned by two corners, in either drag direction. */
function regionOf(a: Point | null, b: Point | null): Region | null {
  if (!a || !b) return null;
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

function Hint({ title, detail }: { title: string; detail: string }) {
  return (
    <div
      className={
        "pointer-events-none fixed bottom-16 left-1/2 flex max-w-[70vw] flex-col items-center " +
        "gap-0.5 [transform:translateX(-50%)] rounded-xl bg-[rgba(20,21,24,0.92)] px-[18px] " +
        "py-2.5 text-[#f2f3f5] shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-[20px]"
      }
    >
      <strong className="max-w-full truncate text-[13px]">{title}</strong>
      <span className="text-[11px] opacity-65">{detail}</span>
    </div>
  );
}

function label(target: Target): string {
  const title = target.title || "Untitled window";
  return target.appName ? `${target.appName} — ${title}` : title;
}
