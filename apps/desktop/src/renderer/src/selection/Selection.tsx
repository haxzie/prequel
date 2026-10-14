import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode, Ref } from "react";

import type {
  CaptureMode,
  PickerWindow,
  Region,
  SelectionResult,
  SelectionSetup,
  Target,
} from "../../../shared/contract";
import { AreaIcon, ScreenIcon } from "../dock/icons";
import { follow } from "../lib/live";
import { anchorOf, HANDLE_CURSOR, HANDLES, moved, resized, type Handle } from "./resize";
import { sameRegion, smallestAt } from "./shapes";
import { SAME, spaceOf, toPixels, toPoints, type Space } from "./space";

/** Ignore a drag this small — it is a click that wobbled, not a region. */
const MIN_AREA_EDGE = 8;

/** Where the countdown starts, and how long each number is on screen. */
const COUNTDOWN_FROM = 3;
const COUNTDOWN_STEP_MS = 1000;

/** A rectangle in overlay-local CSS pixels. */
type Rect = { x: number; y: number; width: number; height: number };

/**
 * Dark enough to read as modal, light enough to still see what you pick.
 *
 * The plain pointer, because on every mode but one the sheet is not a thing
 * you aim at: screen and window are confirmed from a button on a card, the
 * overlay itself is deliberately not clickable in either, and a crosshair over
 * them promises a drag that does nothing. The same applies once an area is
 * drawn — what is left to do is grab an edge, and the grips carry their own
 * cursors.
 */
const OVERLAY = "fixed inset-0 cursor-default bg-[rgba(6,7,9,0.4)]";

/** The one state the crosshair belongs to: an area waiting to be dragged out. */
const OVERLAY_DRAWING = "fixed inset-0 cursor-crosshair bg-[rgba(6,7,9,0.4)]";

/** How long one outline's appearance lasts, and the gap between them. */
const SHAPE_SWEEP_MS = 620;
const SHAPE_STAGGER_MS = 22;

/**
 * How far into the set the stagger keeps growing.
 *
 * Everything past this appears with the last one. Without a cap the sweep takes
 * as long as the screen is busy, which is backwards — a screen with more on it
 * is one the user is waiting on more impatiently.
 */
const SHAPE_STAGGER_CAP = 18;

/**
 * One rectangle the app found, during the sweep that says so.
 *
 * An outline and nothing else: a fill over forty overlapping rectangles stacks
 * into a wash that says only that something happened, where an outline keeps
 * each one legible as its own shape. Thin, because this is a report and not a
 * selection — what the user is about to get is drawn at twice the weight.
 *
 * Lit rather than coloured in, and only here. The blue is the colour of a
 * choice — it marks the shape under the pointer and the region that has been
 * settled — so forty blue rectangles say forty things are selected. A shine
 * that crosses each outline and leaves says what the sweep is actually for:
 * these were found, and none of them is yours yet.
 */
const SHAPE_FOUND = "pointer-events-none absolute rounded-[5px] foil animate-shape-found";

/** The light that crosses it, and the only thing on screen with any colour. */
const SHAPE_SHEEN = "foil-sheen animate-shape-sheen";

/**
 * The shape under the pointer, which a click would take.
 *
 * The same dimming punch-out the drawn region gets, because it is the same
 * promise — this is what you would get — and reading it any other way would
 * make a clicked shape and a dragged region look like two different things to
 * choose between.
 */
const SHAPE_HOVER =
  "pointer-events-none absolute rounded-md border-2 border-selected bg-selected/10 " +
  "shadow-[0_0_0_9999px_rgba(6,7,9,0.26)]";

/** Its size, in the corner rather than the middle: a shape can be small, and a
    label centred in a 40pt box covers the box. */
const SHAPE_SIZE =
  "absolute -top-[26px] left-0 max-w-full truncate rounded-md bg-selected " +
  "px-2 py-[3px] text-[11px] font-semibold text-white";

/**
 * The outline of what will be recorded.
 *
 * The huge spread shadow punches the dimming back out over this rectangle, so
 * the choice reads as "this is what you get".
 */
const HIGHLIGHT =
  "pointer-events-none absolute rounded-md border-2 border-selected bg-selected/10 " +
  "shadow-[0_0_0_9999px_rgba(6,7,9,0.26)]";

/**
 * The same outline once it is drawn, and grabbable.
 *
 * `pointer-events-none` on the drawing one is deliberate: while a drag is in
 * progress the rectangle is under the pointer drawing it, and a box that ate
 * the moves would stop the drag the moment it grew past the cursor. Once
 * settled there is no drag to interrupt, and the body is what moves the region.
 */
const HIGHLIGHT_SETTLED =
  "absolute cursor-move rounded-md border-2 border-selected bg-selected/10 " +
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
  const capture = setup?.capture ?? "video";
  const space = useOverlaySpace(setup);

  /**
   * Confirming, which for a recording means counting down first.
   *
   * A screenshot does not. The three seconds exist to give the camera a
   * warm-up and the user a moment to get ready for something that is about to
   * be filmed — and a still frame is neither: there is no camera to open, and
   * what is on screen now is exactly what is wanted, so a countdown would only
   * be three seconds in which it can change.
   */
  const begin = useCallback(
    (confirmed: Pending) => {
      if (capture === "photo") void window.prequel.selection.choose(confirmed.result);
      else setPending(confirmed);
    },
    [capture],
  );

  // Asked for as well as subscribed to, which for this window is the whole
  // difference between working and not. Every view is a `lazy()` chunk, so this
  // component mounts after the page has loaded — and after main has already
  // pushed the setup at it. Window mode survived that on its next refresh;
  // screen and area push once and never again, so the dropped message left an
  // overlay with nothing on it. `follow` primes and then follows, newest
  // winning, which is what every other window already does.
  useEffect(
    () =>
      follow(() => window.prequel.selection.setup(), window.prequel.selection.onSetup, setSetup),
    [],
  );

  /**
   * The overlay's whole contract, checked rather than assumed.
   *
   * Everything here is drawn by writing a point straight into a CSS pixel — a
   * window's outline, the whole-screen highlight, every shape found on the
   * display. That only works while the two are the same unit, and when they
   * stopped being the same unit nothing failed: the overlay just drew every
   * rectangle nine per cent small for as long as the cause went unnoticed.
   *
   * Broad on purpose. A page zoom is what did it once and is pinned in
   * `createPanel` now, but this catches any reason the viewport and the display
   * disagree — and says so in the log the next person will actually read.
   */
  useEffect(() => {
    if (!setup) return;
    const { innerWidth: w, innerHeight: h } = window;
    if (w === setup.width && h === setup.height) return;

    console.error(
      `[picker] overlay is ${String(w)}×${String(h)} CSS pixels on a ` +
        `${String(setup.width)}×${String(setup.height)} point display ` +
        `(×${(setup.width / w).toFixed(3)}). Every highlight will be drawn at the wrong size.`,
    );
  }, [setup]);

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
      return <AreaSelection setup={setup} space={space} onStart={begin} />;
    case "screen":
      return <ScreenSelection setup={setup} space={space} onStart={begin} />;
    default:
      return <WindowSelection setup={setup} space={space} onStart={begin} />;
  }
}

/**
 * How many display points one CSS pixel of this overlay is worth.
 *
 * Measured rather than assumed. The overlay is created at the display's own
 * bounds, so a viewport that is not the display's size is this renderer
 * measuring in a unit of its own — and every rectangle it hands back, the crop
 * included, is in that unit. `space.ts` has the failure it produced.
 *
 * Followed through resize because a display that changes mode under a live
 * overlay changes one of the two sides of the ratio.
 */
function useOverlaySpace(setup: SelectionSetup | null): Space {
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    // Once on mount as well: the overlay mounts after the window is on screen,
    // and the size it had at first render may already be stale.
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const space = useMemo(() => (setup ? spaceOf(setup, viewport) : SAME), [setup, viewport]);

  // Said out loud rather than quietly corrected. The conversion keeps the
  // recording right, but a viewport that is not the size of the display it
  // covers is a state of the machine worth having in the log next to the
  // recording it produced — it is the only trace the state leaves.
  useEffect(() => {
    if (!setup || (Math.abs(space.x - 1) < 0.001 && Math.abs(space.y - 1) < 0.001)) return;
    console.warn(
      `[selection] overlay is ${String(viewport.width)}×${String(viewport.height)} on a ` +
        `${String(setup.width)}×${String(setup.height)} display; regions converted`,
    );
  }, [setup, space, viewport]);

  return space;
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

  // These three seconds are the camera's only warm-up. An `AVCaptureSession`
  // opened when recording starts spends its first second or two settling on an
  // exposure, and writes that darkness into `camera.mp4`; opened now, it is
  // ready by the time there is a frame to keep. Told once, on mount, and not
  // awaited — main decides whether there is a camera to open at all, and the
  // countdown must run at the same speed either way.
  useEffect(() => {
    void window.prequel.selection.countdown();
  }, []);

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
  space,
  onStart,
}: {
  setup: SelectionSetup;
  space: Space;
  onStart: (pending: Pending) => void;
}) {
  const [hovered, setHovered] = useState<PickerWindow | null>(null);

  // Main describes each window in display points; everything here — the
  // pointer, the highlight — is in CSS pixels. Converted once rather than at
  // each use, so a hit test and the outline it lights up can never disagree.
  const windows = useMemo(
    () => setup.windows.map((picked) => ({ ...picked, rect: toPixels(picked.rect, space) })),
    [setup.windows, space],
  );

  // Windows arrive front-to-back — the capture layer sorts them into the window
  // server's own stacking order — so the first match under the cursor is the
  // one actually visible there.
  const windowAt = (x: number, y: number): PickerWindow | null =>
    windows.find(
      ({ rect }) =>
        x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height,
    ) ?? null;

  /**
   * The hovered window, and only that, in state.
   *
   * Holding the pointer instead re-rendered this whole overlay on every
   * `mousemove` — 120 times a second on a trackpad, each one re-rendering the
   * highlight, the card and its screenshot, to move a highlight that is in the
   * same place for the entire time the pointer is over one window. What the
   * user sees changes when they cross from one window to the next, so that is
   * what the state says. This is the surface the app puts up at the start of
   * every recording; it has to feel immediate.
   */
  const onMove = (event: { clientX: number; clientY: number }) => {
    const next = windowAt(event.clientX, event.clientY);
    setHovered((previous) => (previous?.target === next?.target ? previous : next));
  };

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
      onMouseMove={onMove}
      onMouseLeave={() => setHovered(null)}
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
            // From the target rather than from the outline: the outline is in
            // CSS pixels and this is the resolution of the file.
            size={pixelSize(hovered.target.bounds, hovered.target.scaleFactor || setup.scaleFactor)}
            capture={setup.capture}
            onStart={start}
          />
        </div>
      )}
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
  space,
  onStart,
}: {
  setup: SelectionSetup;
  space: Space;
  onStart: (pending: Pending) => void;
}) {
  // The display, in the pixels this overlay draws in — which is the viewport,
  // since the overlay covers exactly this display. Drawn from `setup.width`
  // directly, it outlined nine tenths of the screen under a card that
  // correctly said the whole of it.
  const whole = toPixels({ x: 0, y: 0, width: setup.width, height: setup.height }, space);

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
          size={pixelSize({ width: setup.width, height: setup.height }, setup.scaleFactor)}
          capture={setup.capture}
          onStart={start}
        />
      </div>
    </div>
  );
}

/** Drag out a rectangle, or click one the app already found. */
function AreaSelection({
  setup,
  space,
  onStart,
}: {
  setup: SelectionSetup;
  space: Space;
  onStart: (pending: Pending) => void;
}) {
  const [origin, setOrigin] = useState<Point | null>(null);
  const [current, setCurrent] = useState<Point | null>(null);
  /**
   * The shape under the pointer, and only that, in state.
   *
   * The same reasoning as the window picker's `hovered`: holding the pointer
   * instead would re-render this overlay on every `mousemove`, 120 times a
   * second, to move a highlight that is in the same place for as long as the
   * pointer is over one shape. What the user sees changes when they cross from
   * one to the next, so that is what the state says.
   */
  const [hoveredShape, setHoveredShape] = useState<Region | null>(null);
  /** The settled region, once it can be moved and resized away from the drag. */
  const [adjusted, setAdjusted] = useState<Region | null>(null);
  /** The drag is over and the region is waiting to be confirmed. */
  const [settled, setSettled] = useState(false);
  const originRef = useRef<Point | null>(null);
  const currentRef = useRef<Point | null>(null);
  /** A pending flush of `currentRef` into state. See the mousemove handler. */
  const frame = useRef(0);
  /** The bubble at the pointer, moved by hand rather than by a render. */
  const cursorHint = useRef<HTMLDivElement>(null);
  /**
   * Where the pointer was last seen, so a fresh set of shapes can be judged
   * against it without waiting for the pointer to move.
   *
   * The screen is rescanned while the picker is up, because the screen moves —
   * and the hover is otherwise only recomputed on a `mousemove`. Hold the mouse
   * still over a view that scrolls and the highlight would stay on the
   * rectangle that content used to occupy, which looks exactly like the picker
   * being wrong about where things are.
   */
  const pointer = useRef<Point | null>(null);

  // Nothing to flush once the component is gone, and a `setState` after unmount
  // is a warning in the console of an overlay nobody can open again.
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const drawn = useMemo(() => regionOf(origin, current), [origin, current]);

  // Main finds the shapes in display points; this overlay draws and hit-tests
  // in CSS pixels. Converted once, so an outline lands on the thing it names
  // and a shape that is clicked settles into the same unit a dragged region
  // does — `start` below converts the two back together.
  const shapes = useMemo(
    () => setup.shapes.map((shape) => toPixels(shape, space)),
    [setup.shapes, space],
  );

  // Written on every move, including the ones the rectangle's own update
  // coalesces away: a bubble that moved at a frame's resolution while the
  // pointer moved at the trackpad's would lag behind the crosshair it is
  // attached to, which is the one thing it must not do.
  const followPointer = (x: number, y: number) => {
    const node = cursorHint.current;
    if (!node) return;
    node.style.transform = `translate3d(${x + CURSOR_HINT_OFFSET.x}px, ${y + CURSOR_HINT_OFFSET.y}px, 0)`;
    node.style.opacity = "1";
  };

  const start = useCallback(
    (dragged: Region) => {
      // ScreenCaptureKit crops in points, relative to the display's own origin,
      // and this overlay covers exactly that display — so the only thing
      // between the two is the unit the rectangle was drawn in.
      const crop = toPoints(dragged, space);

      onStart({
        result: {
          target: setup.screenTarget,
          crop,
          label: `Area ${Math.round(crop.width)}×${Math.round(crop.height)}`,
          start: true,
        },
        rect: dragged,
      });
    },
    [setup.screenTarget, space, onStart],
  );

  /**
   * `shape` is whatever is under the pointer where it was released, which is
   * what a click means. Taken from the release rather than from the hover
   * state: the overlay opens under a pointer that may never move, and
   * `mousemove` has nothing to say about where it already was — so a click
   * straight onto a shape would have chosen nothing.
   */
  const commit = useCallback((shape: Region | null) => {
    const dragged = regionOf(originRef.current, currentRef.current);
    originRef.current = null;

    if (!dragged || dragged.width < MIN_AREA_EDGE || dragged.height < MIN_AREA_EDGE) {
      // A press that went nowhere, which is a click — and over a shape the app
      // found, a click means that shape. This is the whole interaction: drag
      // for a region of your own, click for one that is already there, and no
      // mode to be in or switch between.
      setAdjusted(shape);
      setOrigin(null);
      setCurrent(null);
      // Settled on it, so the card and the grips come up and it can be nudged
      // before it becomes a take — exactly as a dragged region can. A click
      // that landed on nothing settles nothing.
      setSettled(shape !== null);
      return;
    }

    // Held rather than recorded straight away, so the region can be checked —
    // and redrawn — before it becomes a take.
    setSettled(true);
  }, []);

  /**
   * The grip being dragged, and where the pointer was when it was taken.
   *
   * A ref rather than state: this is read on every mousemove, and a render per
   * move to store a value the move itself provides is the thing the frame
   * coalescing below exists to avoid.
   */
  const grip = useRef<{ handle: Handle; from: Point; rect: Region } | null>(null);

  const region = adjusted ?? drawn;

  /**
   * Nothing is being drawn, adjusted or confirmed.
   *
   * Which is the only state the shapes belong in. Once there is a region on
   * screen it is the answer, and outlines offering others would be the picker
   * arguing with itself.
   */
  const idle = !settled && !origin;

  /**
   * Whether the sweep has already played.
   *
   * Once only, for the life of this overlay. It answers "the app has looked at
   * your screen", which is a thing that happened once — replaying it on every
   * stray click would turn a one-off report into a flicker.
   */
  const [swept, setSwept] = useState(false);
  useEffect(() => {
    if (shapes.length === 0) return;
    const timer = setTimeout(
      () => setSwept(true),
      SHAPE_SWEEP_MS + SHAPE_STAGGER_MS * Math.min(shapes.length, SHAPE_STAGGER_CAP),
    );
    return () => clearTimeout(timer);
  }, [shapes]);

  const shapeAt = (x: number, y: number) => smallestAt(shapes, x, y);

  // Re-judged whenever the shapes change, from wherever the pointer already is.
  // Only while idle: once a region is drawn or settled it is the answer, and a
  // rescan must not move what the user has already chosen.
  useEffect(() => {
    if (!idle) return;
    const at = pointer.current;
    const next = at ? smallestAt(shapes, at.x, at.y) : null;
    setHoveredShape((previous) => (sameRegion(previous, next) ? previous : next));
  }, [shapes, idle]);

  const onGrip = useCallback(
    (handle: Handle) => (event: ReactMouseEvent) => {
      const from = { x: event.clientX, y: event.clientY };
      // From state, never from the drawing refs. `commit` clears `originRef` on
      // its way to settling, so reading the region back out of the refs here
      // returned null for every grip and each one silently did nothing.
      const rect = adjusted ?? drawn;
      if (!rect) return;

      // The overlay is listening for moves on the sheet, and the sheet is
      // underneath these grips. Without this the press also reaches it.
      event.stopPropagation();
      event.preventDefault();
      grip.current = { handle, from, rect };
    },
    [adjusted, drawn],
  );

  return (
    <div
      className={settled ? OVERLAY : OVERLAY_DRAWING}
      onMouseDown={(event) => {
        // Deaf once a region is drawn. This used to start a fresh drag from
        // wherever it landed and clear `settled` on the way — so a press
        // anywhere, including one aimed at the card sitting on top, wiped the
        // selection and left an empty overlay. Escape starts again, and the
        // grips above adjust what is there.
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
        followPointer(event.clientX, event.clientY);
        pointer.current = { x: event.clientX, y: event.clientY };

        // Only while there is nothing else going on. Once a drag is under way
        // the region being drawn is the answer, and a shape lighting up under
        // it would be offering a second one.
        if (!settled && !originRef.current && !grip.current) {
          const next = shapeAt(event.clientX, event.clientY);
          setHoveredShape((previous) => (sameRegion(previous, next) ? previous : next));
        }

        const held = grip.current;
        if (held) {
          const point = { x: event.clientX, y: event.clientY };
          const bounds = { width: window.innerWidth, height: window.innerHeight };

          // From the rectangle the grip was taken on, not from the last frame:
          // accumulating deltas drifts, and a resize that drifts is one that
          // ends up a pixel or two off whatever it was aimed at.
          setAdjusted(
            held.handle === "move"
              ? moved(held.rect, { x: point.x - held.from.x, y: point.y - held.from.y }, bounds)
              : resized(held.rect, held.handle, point, bounds),
          );
          return;
        }

        if (settled || !originRef.current) return;
        currentRef.current = { x: event.clientX, y: event.clientY };

        // Coalesced to a frame. A trackpad delivers moves at twice the refresh
        // rate, and each one re-rendered the overlay and the card to redraw a
        // rectangle that is only painted sixty times a second anyway. The ref
        // above still takes every event, so the region `commit` reads is the
        // one the pointer actually finished on rather than the last one that
        // happened to be painted.
        if (frame.current) return;
        frame.current = requestAnimationFrame(() => {
          frame.current = 0;
          setCurrent(currentRef.current);
        });
      }}
      onMouseUp={(event) => {
        if (grip.current) {
          grip.current = null;
          return;
        }
        if (!settled) commit(shapeAt(event.clientX, event.clientY));
      }}
    >
      {/* Under everything else, so the rectangle being drawn and the card on it
          are never behind a shape outline. */}
      {idle && !swept && <ShapesFound shapes={shapes} />}

      {idle && hoveredShape && (
        <div
          className={SHAPE_HOVER}
          style={{
            left: hoveredShape.x,
            top: hoveredShape.y,
            width: hoveredShape.width,
            height: hoveredShape.height,
          }}
        >
          <span className={SHAPE_SIZE}>
            {pixelSize(toPoints(hoveredShape, space), setup.scaleFactor)}
          </span>
        </div>
      )}

      {region && (
        <div
          className={settled ? HIGHLIGHT_SETTLED : HIGHLIGHT}
          style={{
            left: region.x,
            top: region.y,
            width: region.width,
            height: region.height,
          }}
          // The body moves the region. Only once settled: while drawing, the
          // rectangle is under the pointer that is drawing it.
          onMouseDown={settled ? onGrip("move") : undefined}
        >
          {settled && <Grips onGrip={onGrip} />}

          {settled ? (
            <SelectionCard
              icon={
                <Glyph>
                  <AreaIcon />
                </Glyph>
              }
              name="Selected area"
              size={pixelSize(toPoints(region, space), setup.scaleFactor)}
              capture={setup.capture}
              onStart={() => start(region)}
            />
          ) : (
            <span
              className={
                "absolute -top-[26px] left-0 max-w-full truncate rounded-md bg-accent " +
                "px-2 py-[3px] text-[11px] font-semibold text-white"
              }
            >
              {Math.round(toPoints(region, space).width)} ×{" "}
              {Math.round(toPoints(region, space).height)}
            </span>
          )}
        </div>
      )}

      {/* Only before the drag. Once the rectangle exists it carries its own
          size badge at the pointer end, and two labels chasing one crosshair
          is one too many. */}
      {idle && <CursorHint ref={cursorHint} shapes={shapes.length > 0} />}
    </div>
  );
}

/**
 * Every rectangle the app found, drawn once, as it finds them.
 *
 * The answer to "is this thing working". The shapes arrive a moment after the
 * overlay does — they take a screenshot and a walk over it — so without this
 * the only sign anything happened is that the pointer now sometimes lights
 * something up, which is a feature nobody discovers. One sweep over the screen
 * says what was found and where, and then gets out of the way.
 *
 * Staggered from the top left, which is the order they are read in, rather than
 * from the pointer: the pointer is wherever the user left it and a wave
 * spreading from it reads as a reaction to them rather than as a scan. Capped
 * because the delay is cumulative — past a couple of dozen the last outline
 * would arrive long after anybody stopped watching.
 *
 * Whether it has run is the caller's to remember, not this component's: it is
 * unmounted the moment a drag starts, and a press that went nowhere brings it
 * straight back — so a flag held in here would replay the whole sweep every
 * time somebody clicked on an empty part of the screen.
 */
function ShapesFound({ shapes }: { shapes: Region[] }) {
  // Sorted into reading order for the stagger only. `shapes` itself has to stay
  // largest first — that is what makes the smallest shape under the pointer the
  // last match — so this sorts a copy.
  const order = [...shapes].sort((a, b) => a.y + a.x - (b.y + b.x));

  return (
    <>
      {order.map((shape, index) => (
        <span
          key={`${String(shape.x)},${String(shape.y)},${String(shape.width)},${String(shape.height)}`}
          className={SHAPE_FOUND}
          style={
            {
              left: shape.x,
              top: shape.y,
              width: shape.width,
              height: shape.height,
              "--shape-delay": `${String(Math.min(index, SHAPE_STAGGER_CAP) * SHAPE_STAGGER_MS)}ms`,
            } as CSSProperties
          }
        >
          <span className={SHAPE_SHEEN} />
        </span>
      ))}
    </>
  );
}

/**
 * The eight grips on a settled area.
 *
 * Drawn as boxes bigger than they look: the visible dot is 10px, the target is
 * 20px and centred on the same point, because a 10px corner is a hard thing to
 * hit and missing one starts nothing at all — the sheet under it is deaf while
 * a region is settled.
 *
 * On the edges as well as the corners. Corners alone means every adjustment
 * changes two dimensions, and "make it a bit wider" is the common one.
 */
function Grips({ onGrip }: { onGrip: (handle: Handle) => (event: ReactMouseEvent) => void }) {
  return (
    <>
      {HANDLES.map((handle) => {
        const at = anchorOf(handle);
        return (
          <span
            key={handle}
            onMouseDown={onGrip(handle)}
            className="absolute z-10 grid size-5 place-items-center"
            style={{
              left: `${at.x * 100}%`,
              top: `${at.y * 100}%`,
              transform: "translate(-50%, -50%)",
              cursor: HANDLE_CURSOR[handle],
            }}
          >
            <span className="size-2.5 rounded-[2px] border border-black/40 bg-white shadow-sm" />
          </span>
        );
      })}
    </>
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
/**
 * What the confirm button says, and the dot beside it.
 *
 * A red dot and "Start recording" is what a record button looks like
 * everywhere, and putting it on a screenshot would be the one word in the flow
 * that is wrong — somebody who pressed it would be waiting for a stop button
 * that is never coming. The screenshot's is the same button in the same place,
 * saying what it does.
 */
const CONFIRM: Record<CaptureMode, { label: string; dot: string }> = {
  video: { label: "Start recording", dot: "rounded-full bg-white" },
  // A square rather than a circle: the shutter's own shape, and the one thing
  // that distinguishes the two buttons at a glance when the words are read
  // second.
  photo: { label: "Take screenshot", dot: "rounded-[3px] bg-white" },
};

function SelectionCard({
  icon,
  name,
  detail,
  size,
  capture,
  onStart,
}: {
  icon: ReactNode;
  name: string;
  detail?: string;
  size: string;
  capture: CaptureMode;
  onStart: () => void;
}) {
  const confirm = CONFIRM[capture];
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
          // A pill, like the dock's own controls: this button and the bar that
          // replaces it the moment it is pressed are the same object as far as
          // anybody using them is concerned, and a rounded square handing over
          // to a pill reads as two apps.
          "pointer-events-auto mt-4 flex h-[34px] items-center gap-[7px] rounded-full " +
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
        <span className={`size-2.5 ${confirm.dot}`} />
        {confirm.label}
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

/**
 * "Drag to select an area", pinned to the pointer until the drag starts.
 *
 * The only instruction the overlay gives, and it replaced a panel pinned to
 * the bottom of the display — which said the same thing where nobody was
 * looking. The pointer is at the corner the drag is about to start from, and
 * on a large display that is most of a screen away from the bottom edge.
 *
 * Positioned by writing `transform` straight to the node on every mousemove
 * rather than through React state. A pointer delivers moves at twice the
 * refresh rate and this is one of two things on screen that track it; the
 * other is the rectangle, which is coalesced to a frame because it re-renders
 * the card as well. A style write is not worth a render to begin with.
 *
 * Square on the top-left corner and rounded on the other three, which is what
 * points it at the pointer. A tail was tried and is the obvious thing — it is
 * also 9px of rotated square hanging off a 20px bubble, and at that size it
 * reads as a chip of the corner broken off rather than as a tail.
 *
 * Hidden until the first move, because that is when there is a position to put
 * it at: the overlay opens wherever the pointer already was and no event has
 * said where that is. A bubble parked at the top-left corner until the pointer
 * twitched would be worse than one that arrives a frame late.
 */
const CURSOR_HINT =
  "pointer-events-none fixed top-0 left-0 z-10 rounded-lg rounded-tl-none bg-selected " +
  "px-2 py-1 text-[11px] font-semibold whitespace-nowrap text-white opacity-0 " +
  "shadow-[0_4px_16px_rgba(0,0,0,0.4)]";

/** Where the bubble sits relative to the pointer: below and to the right, so
    the square corner lands beside the crosshair and the bubble is clear of
    the rectangle the drag draws down and right from it. */
const CURSOR_HINT_OFFSET = { x: 14, y: 14 };

function CursorHint({ ref, shapes }: { ref: Ref<HTMLDivElement>; shapes: boolean }) {
  return (
    <div className={CURSOR_HINT} ref={ref}>
      {/* Only once there is something to click. On a screen where nothing was
          found — or before the scan has answered — offering a click that does
          nothing is worse than the instruction that has always been here. */}
      {shapes ? "Click a shape, or drag an area" : "Drag to select an area"}
    </div>
  );
}

function label(target: Target): string {
  const title = target.title || "Untitled window";
  return target.appName ? `${target.appName} — ${title}` : title;
}
