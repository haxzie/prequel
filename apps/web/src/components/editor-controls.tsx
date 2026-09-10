import type { CSSProperties, ReactNode } from "react";

/**
 * The desktop app's editor chrome, redrawn for the site.
 *
 * Every measurement here is read off the app rather than chosen: the controls
 * from `apps/desktop/src/renderer/src/editor/controls/inputs.tsx` and
 * `Field.tsx`, the dock from `Inspector.tsx`'s `Rail`, the clip and zoom bars
 * from `TimelineStrip.tsx`. Class strings are the app's own, so a diff between
 * the two files is a real difference rather than two people's idea of the same
 * control.
 *
 * **Nothing here is interactive, and that is the whole difference.** The app's
 * versions take a value, a range and an `onChange`; these take the fill as a
 * fraction and a string to print, because a picture only shows the part of that
 * which is visible. Everything to do with dragging, hover pills, travel timers
 * and override state is gone. What is left is what the control looks like when
 * nobody is touching it.
 *
 * They must be rendered inside `editor-theme`, which is where `--editor-*`,
 * `--slice-*`, `--zoom-*`, `--selected` and `--toggle` are given values. Outside
 * it the utilities resolve to nothing and every surface comes out transparent.
 * `EditorSurface` below is the wrapper that turns it on.
 *
 * These are dark wherever they appear, and that is not a theme decision. The
 * public site has one theme and it is paper; `[data-theme="dark"]` reaches only
 * the signed-in app and the auth pages. A dark editor on a light page is the
 * product shown on the site, not the site responding to a preference.
 *
 * The rule that makes this file worth having: **when a control changes in the
 * app, change it here.** Two implementations of the same control is how a
 * marketing page comes to show a version of the product that shipped a year
 * ago, and it is only ever noticed by somebody who has both open.
 */

/**
 * The height every control in a panel stands at.
 *
 * `CONTROL_H` in the app. The slider set it — it has to hold its own label and
 * reading — and the rest follow so a column of mixed controls has one baseline
 * rather than a step at every change of kind.
 */
const CONTROL_H = "h-7";

/** The gutter glyph, outside the well, on a slider, a toggle or a colour. */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <span className="flex-none text-editor-muted [&_svg]:size-4" aria-hidden>
      {children}
    </span>
  );
}

/**
 * The dark ground everything else here needs.
 *
 * `editor-theme` is a utility rather than a `data-theme`, so it can be turned on
 * for one subtree of a page that is otherwise paper — which is the only way this
 * works, the site having no dark mode for a `data-theme` to answer.
 *
 * `ring-black/20` rather than a token edge. On the paper page it is the shadow
 * that separates a dark panel from white; on the app's own pages, where these
 * would sit on `--bg`, the panel is the lighter of the two and needs no edge at
 * all. One value that is either doing the work or invisible beats two that have
 * to be kept in step.
 */
export function EditorSurface({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`editor-theme squircle relative overflow-hidden rounded-2xl bg-editor-bg text-editor-fg ring-1 ring-black/20 ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * A value as a filled bar.
 *
 * The fill *is* the handle: its leading edge is what you drag in the app, and
 * the grip line sits just inside it. There is no separate thumb, which is what
 * lets the control be this tall.
 *
 * The label and the reading sit inside the bar. Three things on two lines became
 * one, and a column that was label / track / number over and over is now a stack
 * of bars — which is what the panel is a list of. The glyph stays outside the
 * track: inside it would slide under the fill and change contrast as the value
 * moved.
 */
export function Slider({
  icon,
  label,
  read,
  value,
  levels = 0,
}: {
  icon: ReactNode;
  label: string;
  /** How the value reads to a person. A fraction is not a useful number. */
  read: string;
  /** The fill, 0 to 1. The app computes this from a value, a min and a max. */
  value: number;
  /**
   * How many intervals the track is stepped into, or 0 for a plain one.
   *
   * The app draws these marks only when the step divides the range into twelve
   * or fewer — captions are one, two or three lines. Above that they stop being
   * landmarks and become a comb, so most sliders take the plain branch.
   */
  levels?: number;
}) {
  const marks =
    levels >= 2 && levels <= 12
      ? Array.from({ length: levels - 1 }, (_, i) => ((i + 1) / levels) * 100)
      : [];

  return (
    <div className="flex items-center gap-2">
      <Glyph>{icon}</Glyph>

      <div className={`group relative flex-1 overflow-hidden rounded-md bg-white/5 ${CONTROL_H}`}>
        {/* Rounded like the track it sits in, so the filled end follows the same
            curve as the rim rather than stopping square inside it. The floor on
            the width keeps that rounded end at zero instead of collapsing into a
            sliver against the left edge. */}
        <div
          className="absolute inset-y-0 left-0 rounded-md bg-white/12"
          style={{ width: `max(0.75rem, ${value * 100}%)` }}
        >
          <span className="absolute top-1/2 right-1.5 h-3.5 w-0.5 -translate-y-1/2 rounded-full bg-white" />
        </div>

        {/* Over the fill, so a mark on the filled side is not swallowed by it,
            and under the words, which are what the row is read by. */}
        {marks.map((at) => (
          <span
            key={at}
            aria-hidden
            className="pointer-events-none absolute top-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2 bg-white/25"
            style={{ left: `${at}%` }}
          />
        ))}

        <div className="pointer-events-none absolute inset-0 flex items-center justify-between gap-2 px-2.5 text-[11px]">
          <span className="truncate text-white">{label}</span>
          <span className="flex-none tabular-nums text-white/70">{read}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * The switch itself, without a row around it.
 *
 * Green when on, white knob either way. Green because "on" is the one state
 * worth reading across a panel of controls; a white knob because it has to stay
 * the same object as it slides.
 *
 * Squared off rather than a pill — everything else in the panel is a rounded
 * rectangle at the same radius, and a capsule among them was the one shape from
 * a different set. The two radii are concentric: the knob's is the track's less
 * the gap between them, 6 − 2 = 4.
 */
export function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative block h-[18px] w-8 flex-none rounded-md ${on ? "bg-toggle" : "bg-white/15"}`}
    >
      <span
        className={`absolute top-0.5 size-3.5 rounded bg-white ${on ? "left-4" : "left-0.5"}`}
      />
    </span>
  );
}

/**
 * A switch on a row of its own, matching a slider's.
 *
 * The whole row is the button in the app, not just the switch: a 28×16 target
 * beside a label that did nothing was the smallest thing in the panel and the
 * one people missed. So the label sits in a well of its own at the slider's
 * height, in white rather than muted — it is a control's own label, not a
 * caption over one.
 */
export function ToggleField({
  icon,
  label,
  on,
}: {
  icon: ReactNode;
  label: string;
  on: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Glyph>{icon}</Glyph>
      <div
        className={`flex flex-1 items-center justify-between gap-2 rounded-md bg-white/5 px-2.5 ${CONTROL_H}`}
      >
        <span className="truncate text-[11px] text-white">{label}</span>
        <Switch on={on} />
      </div>
    </div>
  );
}

/**
 * One row of destinations, marked by a pill.
 *
 * A slot is one option *plus* the 2px beside it, so a whole number of slots
 * lands the pill on an option rather than drifting a gap further along at every
 * step. The app carries a second pill that follows the pointer; there is no
 * pointer here, so what is left is the mark parked on the choice.
 */
export function Segmented({ options, at }: { options: string[]; at: number }) {
  const slot = `calc((100% - 0.25rem - ${options.length - 1} * 0.125rem) / ${options.length})`;

  return (
    <div className="relative flex gap-0.5 rounded-lg bg-white/5 p-0.5" role="radiogroup">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0.5 left-0.5 rounded-md bg-white/12"
        style={{ width: slot, transform: `translateX(calc(${at} * (100% + 0.125rem)))` }}
      />
      {options.map((option, index) => (
        <span
          key={option}
          className={`relative z-10 flex flex-1 items-center justify-center gap-1 rounded-md px-2 text-[11px] whitespace-nowrap ${CONTROL_H} ${
            index === at ? "font-medium text-editor-fg" : "text-editor-muted"
          }`}
        >
          {option}
        </span>
      ))}
    </div>
  );
}

/**
 * A colour: a swatch, a chevron, a divider and the hex.
 *
 * No word in the well. The glyph outside it and the group above carry what it is
 * for, and the well has room for a swatch, a rule and a reading and nothing
 * else. The divider is short of the rims and centred between them — run the full
 * height it meets the well's rounded corners at a tangent, which reads as the
 * control being cut in two rather than divided.
 */
export function ColorField({ icon, hex }: { icon: ReactNode; hex: string }) {
  return (
    <div className="flex items-center gap-2">
      <Glyph>{icon}</Glyph>
      <div
        className={`flex flex-1 items-stretch overflow-hidden rounded-md bg-white/5 ${CONTROL_H}`}
      >
        <span className="flex flex-none items-center gap-1 pr-1.5 pl-2">
          <span className="size-4 rounded-[3px]" style={{ backgroundColor: hex }} aria-hidden />
          {/* After the swatch, not before it: a chevron leads the eye to what it
              opens, and what opens here is the picker the swatch stands for. */}
          <span className="text-editor-muted" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" className="size-3" aria-hidden>
              <path
                d="m6 9 6 6 6-6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </span>
        <span className="my-auto h-[60%] w-px flex-none bg-white/10" aria-hidden />
        <span className="flex min-w-0 flex-1 items-center px-2 font-mono text-[11px] uppercase">
          {hex}
        </span>
      </div>
    </div>
  );
}

/**
 * A control with a label over it, and the glyph in the gutter.
 *
 * `inline` puts the control on the label's own line, which is what a switch
 * wants — a toggle under its label leaves a wide empty gutter and reads as two
 * separate things. With a glyph the control starts 24px in (`ml-6`), so a grid
 * or a map lines up with the bars above and below it.
 */
export function Field({
  icon,
  label,
  inline,
  children,
}: {
  icon?: ReactNode;
  label?: string;
  inline?: boolean;
  children: ReactNode;
}) {
  if (!label) {
    return <div className={`flex gap-1.5 ${inline ? "items-center" : "flex-col"}`}>{children}</div>;
  }

  return (
    <div className={`flex gap-1.5 ${inline ? "items-center" : "flex-col"}`}>
      <span className="flex items-center gap-2">
        {icon ? <Glyph>{icon}</Glyph> : null}
        <span className="flex-1 text-[11px] text-editor-muted">{label}</span>
      </span>
      {icon ? <div className="ml-6">{children}</div> : children}
    </div>
  );
}

/** A group of fields, divided from the next by a rule. The app's `Section`. */
export function Group({ children }: { children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-editor-line px-4 py-4 last:border-b-0">
      {children}
    </section>
  );
}

/** The panel the groups sit in. `w-80`, as the app has it. */
export function Panel({ children }: { children: ReactNode }) {
  return (
    <aside className="flex w-80 flex-none flex-col overflow-hidden border-l border-editor-line bg-editor-veil">
      {children}
    </aside>
  );
}

/** The panel's heading: the glyph, the name, and nothing under it. */
export function PanelHeader({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <header className="relative flex flex-none items-center gap-2.5 px-3 py-2.5">
      <span className="flex-none [&_svg]:size-4" aria-hidden>
        {icon}
      </span>
      <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{title}</p>
    </header>
  );
}

/**
 * The dock beside the panel: `Inspector.tsx`'s `Rail`.
 *
 * A raised surface floating over the board rather than icons lying on it.
 * `self-start` keeps it the height of its own buttons, which is what makes it
 * read as an object placed on the composition rather than a column the window
 * happens to have. `editor-panel` is the app's floating-surface colour, a shade
 * lighter than the panel beside it: the panel is part of the window, the dock
 * sits on top of it.
 *
 * The blue pill marks the category showing. One step is a button and the gap
 * under it, `2.25rem + 0.25rem`. Icons are white whether or not they are the one
 * showing — with no surface behind the rail there is nothing for a muted colour
 * to read against, and a dimmed glyph looks disabled rather than unselected.
 */
export function Rail({ items, at }: { items: { id: string; Icon: () => ReactNode }[]; at: number }) {
  return (
    <nav className="relative my-2 mr-2 flex flex-none flex-col gap-1 self-start rounded-[10px] border border-editor-line bg-editor-panel p-1.5 shadow-[0_1px_6px_rgba(0,0,0,0.3)]">
      <span
        aria-hidden
        className="pointer-events-none absolute top-1.5 left-1.5 size-9 rounded bg-selected"
        style={{ transform: `translateY(calc(${at} * 2.5rem))` }}
      />
      {items.map(({ id, Icon }) => (
        <span
          key={id}
          className="relative z-10 grid size-9 place-items-center rounded text-white [&_svg]:size-[18px]"
        >
          <Icon />
        </span>
      ))}
    </nav>
  );
}

/**
 * The timeline's own measurements, from `TimelineStrip.tsx`.
 *
 * `CLIP_FRAME_H` is the height a filmstrip cell is extracted at, so the row is
 * that plus the frame on either side of it. Framing the clip takes its room from
 * the row rather than from the picture, or every thumbnail is silently cropped.
 */
export const CLIP_FRAME_H = 38;
const CLIP_EDGE = 2;
export const CLIP_H = CLIP_FRAME_H + CLIP_EDGE * 2;
/** Space between the clip row and the zoom row under it. */
export const TRACK_GAP = 10;
const ZOOM_EDGE = 1;

/**
 * One clip on the strip.
 *
 * Two solid steps of the same purple rather than one pair dimmed: the fill says
 * "this is selected", and the ring says "the pointer is talking to this one",
 * which are different questions. The ring is an `outline` and not a border,
 * because an outline is painted after the element's children — so it runs across
 * the two handle bands instead of stopping short of them, and the clip reads as
 * one ringed shape rather than a body with two bare caps.
 */
export function Clip({
  width,
  selected = false,
  children,
}: {
  /** Share of the strip, 0 to 1. */
  width: number;
  selected?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={`group relative min-w-1 overflow-hidden rounded-lg border outline-2 -outline-offset-2 ${
        selected
          ? "border-slice-edge-active bg-slice-fill-active outline-slice-ring"
          : "border-slice-edge bg-slice-fill outline-transparent"
      }`}
      style={{ width: `${width * 100}%`, borderWidth: CLIP_EDGE }}
    >
      {children}
    </div>
  );
}

/**
 * One zoom span, on the row under the clips.
 *
 * A wash inside an opaque outline, filling in a step louder when selected — a
 * clip is opaque either way because it carries a filmstrip, so it says the same
 * thing with a step between two purples; a zoom has nothing behind it, so it
 * says it with a step in how see-through it is. Its frame is thinner than a
 * clip's: the same width in this light blue makes the bar become its border.
 */
export function ZoomBar({
  left,
  width,
  selected = false,
}: {
  left: number;
  width: number;
  selected?: boolean;
}) {
  return (
    <div
      className={`group absolute inset-y-0 flex items-center justify-center overflow-hidden rounded-lg border border-zoom-edge px-3.5 outline-2 -outline-offset-2 ${
        selected ? "bg-zoom-fill/45 outline-zoom-ring" : "bg-zoom-fill/25 outline-transparent"
      }`}
      style={{ left: `${left * 100}%`, width: `${width * 100}%`, borderWidth: ZOOM_EDGE }}
    >
      <Handle edge="start" selected={selected} />
      <Handle edge="end" selected={selected} />
    </div>
  );
}

/**
 * A trim grip at one end of a bar.
 *
 * Drawn in the bar's own edge colour rather than white: white on a purple clip
 * and on an amber zoom was the same white, so the grip read as a third thing
 * laid over the bar rather than as the end of it. Only shown while the bar is
 * selected, which is when the app shows it at rest.
 */
function Handle({ edge, selected }: { edge: "start" | "end"; selected: boolean }) {
  return (
    <span
      aria-hidden
      className={`absolute inset-y-0 grid w-3 place-items-center ${edge === "start" ? "left-0" : "right-0"}`}
    >
      <span
        className={`h-1/2 w-0.5 rounded-full bg-zoom-edge ${selected ? "opacity-100" : "opacity-0"}`}
      />
    </span>
  );
}

/**
 * The playhead, with the time on it.
 *
 * `w-0.5` and `-ml-px` so the line straddles the instant rather than starting at
 * it. The bubble is `--indicator-deep` with white on it, which is the pair the
 * app uses; the notch under it is the same colour, drawn as a triangle.
 */
export function Playhead({ at, read }: { at: number; read: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-y-0 z-10 -ml-px w-0.5 bg-indicator-deep"
      style={{ left: `${at * 100}%` }}
    >
      <span className="absolute top-0 left-1/2 h-5 -translate-x-1/2 rounded-full bg-indicator-deep px-1.5 text-center text-[11px] leading-5 font-medium tabular-nums text-white">
        {read}
      </span>
      <span
        className="absolute top-5 left-1/2 h-[7px] w-3 -translate-x-1/2 bg-indicator-deep"
        style={{ clipPath: "polygon(0 0, 100% 0, 50% 100%)" } as CSSProperties}
      />
    </span>
  );
}

/**
 * The strip's ruler.
 *
 * `RULER_H` of marks with `RULER_PAD` of clear space above them — part of the
 * ruler rather than padding on the strip, because in the app that space seeks
 * like the rest of it. Ticks hang from the top edge so every one starts on the
 * same line and the row reads as a scale rather than a row of stubs; labels sit
 * under their own tick, because a label above the mark it belongs to reads as
 * belonging to the one before.
 */
export const RULER_H = 24;
const RULER_PAD = 12;

export function Ruler({ seconds, major = 5 }: { seconds: number; major?: number }) {
  const marks = Array.from({ length: seconds + 1 }, (_, at) => ({
    at,
    major: at % major === 0,
    label: at % major === 0 ? `${Math.floor(at / 60)}:${String(at % 60).padStart(2, "0")}` : null,
  }));

  return (
    <div className="relative" style={{ height: RULER_H + RULER_PAD }}>
      <div className="absolute inset-x-0 bottom-0" style={{ height: RULER_H }}>
        {marks.map((mark) => (
          <div
            key={mark.at}
            className="absolute inset-y-0"
            style={{ left: `${(mark.at / seconds) * 100}%` }}
          >
            <div
              className={`absolute top-0 w-px ${mark.major ? "h-2.5 bg-white/25" : "h-1.5 bg-white/12"}`}
            />
            {mark.label ? (
              <span className="absolute bottom-0 left-1 text-[9px] leading-none tabular-nums text-editor-muted">
                {mark.label}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The strip the ruler and the rows sit in. `TimelineStrip`'s own container.
 */
export function Strip({ children }: { children: ReactNode }) {
  return <div className="flex flex-none flex-col bg-editor-veil px-4 pb-4">{children}</div>;
}

/**
 * A clip's audio, standing on its floor.
 *
 * Ported from `editor/waveform.ts` so the shape is the app's and not a row of
 * bars: peaks smoothed with a three-tap pass weighted towards the sample itself
 * (so a transient still lifts the wave rather than being averaged away), then
 * closed into a filled shape curved through the midpoints between successive
 * points. A cubic through every point overshoots on a sharp rise, and an
 * overshoot here means the wave leaves the top of the box.
 *
 * Drawn in a 0–1 box and stretched by `preserveAspectRatio="none"`, which is
 * what lets one path serve a clip at any width.
 */
const WAVE_FLOOR = 0.04;

export function wavePath(peaks: number[]): string {
  if (peaks.length < 2) return "";

  const eased = peaks.map((_, i) => {
    const before = peaks[Math.max(0, i - 1)]!;
    const after = peaks[Math.min(peaks.length - 1, i + 1)]!;
    return before * 0.25 + peaks[i]! * 0.5 + after * 0.25;
  });

  const points: [number, number][] = eased.map((h, i) => [
    i / (eased.length - 1),
    1 - Math.max(h, WAVE_FLOOR),
  ]);

  const at = ([x, y]: [number, number]) => `${x.toFixed(4)},${y.toFixed(4)}`;
  const mid = (a: [number, number], b: [number, number]): [number, number] => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
  ];

  let path = `M0.0000,1.0000L${at(points[0]!)}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    path += `Q${at(points[i]!)} ${at(mid(points[i]!, points[i + 1]!))}`;
  }
  path += `L${at(points[points.length - 1]!)}L1.0000,1.0000Z`;
  return path;
}

/** The wave as the clip draws it: bottom three fifths, `--wave` at 40%. */
export function Wave({ peaks }: { peaks: number[] }) {
  return (
    <svg
      className="pointer-events-none absolute bottom-0 left-0 h-3/5 w-full text-wave opacity-40"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={wavePath(peaks)} fill="currentColor" />
    </svg>
  );
}

/**
 * The row along a clip's top: what it holds, and how long it runs.
 *
 * Up here because the wave owns the bottom, and a label over a wave is legible
 * in the quiet passages and not in the loud ones. Padded clear of the edge bands
 * rather than tucked to the box — the bands are opaque, so a smaller inset does
 * not crowd the glyph, it buries it.
 */
export function ClipLabel({ icons, read }: { icons: ReactNode; read: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-1.5 px-3.5 py-1 text-white/70">
      <span className="flex flex-none items-center gap-1 [&_svg]:size-3">{icons}</span>
      <span className="truncate text-[10px] leading-none tabular-nums">{read}</span>
    </div>
  );
}

/**
 * The filmstrip behind a clip, from a still.
 *
 * The app draws one sprite sheet of extracted frames, shifted per column. There
 * is no sheet here, so each cell is the same capture at `background-size: cover`
 * — which is what a filmstrip of a recording that holds still actually looks
 * like. Dimmed to the app's own 35%: this is orientation, not content, and at
 * full strength it competes with the wave and makes the label unreadable.
 */
export function Filmstrip({ src, cells = 14 }: { src: string; cells?: number }) {
  return (
    <span className="pointer-events-none absolute inset-0 flex gap-px opacity-35" aria-hidden>
      {Array.from({ length: cells }, (_, i) => (
        <span
          key={i}
          className="min-w-0 flex-1 bg-cover bg-center"
          style={{ backgroundImage: `url(${src})` }}
        />
      ))}
    </span>
  );
}
