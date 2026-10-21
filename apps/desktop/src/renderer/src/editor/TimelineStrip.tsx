import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
  type RefObject,
} from "react";

import type { MediaTime } from "../../../shared/manifest";
import { MAX_TEXT_TRACKS, type Project, type ZoomSlice } from "../../../shared/project";
import { musicFileOf } from "../../../shared/music";
import { zoomEnvelope, zoomSpans } from "../../../shared/layout";
import { cn } from "../lib/cn";
import { formatTimecode } from "../lib/format";
import { writeTicker } from "../lib/ticker";
import { percent } from "./controls/inputs";
import { Timecode } from "./Timecode";
import {
  CameraIcon,
  CursorIcon,
  FillIcon,
  FisheyeIcon,
  GlassIcon,
  MusicIcon,
  ScreenIcon,
  SpeakerIcon,
  TextIcon,
  TypingIcon,
  ZoomIcon,
} from "./icons";
import { fitZoom, openingZoom, ticks } from "./ruler";
import {
  slicesOf,
  splitPointAt,
  textCopySpan,
  textSpanAt,
  textSplitAt,
  musicSplitAt,
  settingsOf,
  zoomSpanAt,
  zoomSplitAt,
  type EditorAction,
  type EditorState,
} from "./state";
import {
  clickMarks,
  place,
  spanInProject,
  toProjectTime,
  toProjectTimeThrough,
  toSourceTime,
  totalDuration,
  trimmedTo,
  type PlacedSlice,
  type TrimGrab,
} from "./timeline";
import { HEAD_LABEL_W, type EditorPlayback } from "./useEditorPlayback";
import { thumbs, THUMB_WIDTH } from "./filmstrip";
import type { Filmstrip } from "./useFilmstrip";
import { bucketCount, repeated, wavePath } from "./waveform";
import { levelAt, levelY, scaledAudio, waveHeight } from "./volumeLine";
import { barCurve, zoomCeiling } from "./zoomCurve";

const NS_PER_SECOND = 1_000_000_000;

/**
 * How near a bar has to come to an edge before it latches on, in pixels.
 *
 * Six, which is about what a hand holds a drag still to. Much more and a bar
 * cannot be put *near* a neighbour without being put against it, which is the
 * failure a snap has to avoid more than it has to catch every attempt — the
 * one that misses is nudged again, and the one that latches when it was not
 * wanted has to be fought.
 *
 * In pixels rather than in time on purpose: the strip zooms, and a tolerance
 * written in milliseconds would be a different target on screen at every
 * level.
 */
const SNAP_REACH = 6;

/**
 * What one clip's two faders are set to, for the line across it.
 *
 * Resolved rather than read off the overrides: a clip that overrides nothing
 * plays the project's defaults, and a line drawn from an empty override would
 * sit at unity on a project turned down to a quarter.
 *
 * Mute is deliberately not folded in. Reading a muted track as zero would be
 * truer to what comes out of the speakers, and it would make the line
 * destructive: the drag writes both faders back, so one pass over a clip with
 * its microphone switched off would overwrite that microphone's level with
 * zero — and switching it back on afterwards would give silence, with the
 * number it used to hold gone. The line is the fader; the switch is the
 * switch, and it stays in the panel.
 */
function clipAudio(project: Project, sliceId: string): { mic: number; system: number } {
  const { audio } = settingsOf(project, sliceId);

  return { mic: audio.micVolume, system: audio.systemVolume };
}

/**
 * How far the pointer must travel before a press is drawing a zoom out rather
 * than clicking to add one.
 *
 * Without it a click with a pixel of tremor in it would ask for a zoom a pixel
 * long, which is below the shortest one worth having — so the press would be
 * declined and the click would do nothing, on the gesture that has always
 * worked. Four pixels is under a frame's width at any useful timeline scale.
 */
const DRAW_SLOP = 4;

/** Row geometry. */
const RULER_H = 24;
/**
 * Clear space above the ruler's marks.
 *
 * Part of the ruler rather than padding on the strip around it. As padding it
 * was a dozen pixels of nothing between the panel's edge and the first thing
 * that responds — close enough to the ticks to aim at, and dead. Inside the
 * ruler it seeks like the rest of it.
 */
const RULER_PAD = 12;
/** Space under the ruler, so its labels do not sit on top of the clips. */
const TRACK_GAP = 10;

/**
 * The width of the rail down the left of the strip.
 *
 * It holds one glyph per band — what each row *is*, which the rows themselves
 * can only say once something is on them: an empty zoom row and an empty music
 * row are two identical stretches of nothing.
 *
 * The rail is inside the scroller and pinned to its left edge, so it stays put
 * as the strip scrolls sideways. Everything timed sits to the right of it and
 * is scrolled under it, which is why it is opaque — and why the time mapping
 * takes it off a client x before working out where it landed.
 *
 * Sixty-four is three numbers: twenty-four of gutter, the sixteen-pixel glyph,
 * twenty-four more. The two gaps are the same on purpose — the rail is the
 * only column where one of them is the window's edge and the other is the
 * first clip, and a wider left than right read as the strip sagging away from
 * the side of the window.
 *
 * Half of it is thirty-two, which is where the transport's first glyph sits:
 * its row is padded by four and its group by half of one, and the button is
 * seven. That only holds while the strip itself is *not* padded on the left —
 * the padding is in this number instead, which is why the container below
 * carries `pr-4` rather than `px-4`.
 */
const RAIL_W = 64;

/**
 * The bands down the strip, in the order they are drawn, for the rail.
 *
 * The one place the strip's vertical layout is written down as data. The rows
 * themselves still lay themselves out — each one is a different thing — so the
 * heights here have to agree with the markup below, and `TRACK_GAP` between
 * every band is stated once in both. A disagreement is a glyph sitting beside
 * the wrong row, which is visible the moment it happens rather than silent.
 *
 * The text group is the one that varies: it grows a row as rows are used, so
 * its height is asked for rather than stated.
 */
const BANDS: {
  id: string;
  label: string;
  Icon: () => React.JSX.Element;
  height: (textRows: number) => number;
}[] = [
  {
    id: "texts",
    label: "Text",
    Icon: TextIcon,
    height: (rows) => rows * TEXT_H + (rows - 1) * TEXT_GAP,
  },
  { id: "clips", label: "Recording", Icon: ScreenIcon, height: () => CLIP_H },
  { id: "zooms", label: "Zoom", Icon: ZoomIcon, height: () => CLIP_H },
  { id: "music", label: "Audio", Icon: MusicIcon, height: () => MUSIC_H },
];
/**
 * The frame a clip is drawn in, on all four sides.
 *
 * One number rather than a Tailwind `border-y-*`, because the row height below
 * is derived from it. Written as a border width in `style` for the same reason
 * — a utility class and this constant would be two places to change and one
 * would be forgotten.
 *
 * Thinner than the caps on purpose. The two ends are drag targets and have to
 * be wide enough to hit; the top and bottom are only closing the frame, and at
 * the caps' width they took a fifth of the row's height to say so.
 */
const CLIP_EDGE = 2;

/**
 * The height of a filmstrip cell, and so of a clip's *inner* box.
 *
 * The strip's frames are extracted at exactly this size and the sheet is drawn
 * unscaled, so the two have to agree or every cell shows part of its neighbour.
 * Kept separate from the row height below: framing the clip has to take its
 * room from the row rather than from the picture, or every thumbnail is
 * silently cropped by twice the band.
 */
export const CLIP_FRAME_H = 38;

/**
 * The zoom bar's frame, which is thinner than a clip's.
 *
 * Not `CLIP_EDGE`, though it was for a while. A clip's frame is drawn in a
 * purple close to its own fill and reads as the edge of a picture; a zoom's is
 * an opaque light blue around a wash of the same colour, and at the same width
 * that outline is the loudest thing in the row — the bar becomes its border.
 * The two rows still agree on radius, height and ring; they differ here because
 * the same number does not buy the same weight on both.
 */
const ZOOM_EDGE = 1;

/** Clip row height: the picture, plus the band above and below it. */
export const CLIP_H = CLIP_FRAME_H + CLIP_EDGE * 2;

/**
 * A click dot's size, and the least room between two of them.
 *
 * Three pixels is the smallest dot that still reads as round at every scale
 * factor, and the gap is its width and a bit: two dots four pixels apart touch
 * and read as one wide mark, which is the one thing the row must not say — a
 * long press and two clicks have to look different.
 */
const CLICK_DOT = 3;
const CLICK_GAP = 5;

/**
 * A text row's height, and the gap between two of them.
 *
 * Thinner than the clips and the zooms on purpose, where the zoom row is
 * deliberately not: a zoom changes the picture it sits under and reads at its
 * weight, while a title is a line laid over it. Five rows at the clips'
 * height would be more timeline than footage. Tall enough for the handles'
 * grips and a 10px label, and no more.
 */
const TEXT_H = 24;
const TEXT_GAP = 4;

/**
 * The music row's height: the clips' and the zooms'.
 *
 * A title's height was the first answer, on the argument that a bed is a level
 * rather than a shot. It is the wrong one, for the reason the zoom row is not
 * half-height either: the bar carries its own waveform, and a wave in
 * twenty-four pixels with a label over it is a texture rather than a shape
 * anybody can read a song's structure out of. The three tall rows are the ones
 * with something drawn inside them; the titles stay thin because a title is a
 * word and a span.
 */
const MUSIC_H = CLIP_H;

/**
 * Zoom range, in pixels per second.
 *
 * The real floor is the fit zoom, computed per render — see `pxPerSecond`.
 * This one only catches a recording so long that fitting it is finer than two
 * pixels a second.
 */
const MIN_ZOOM = 2;
const MAX_ZOOM = 800;
const ZOOM_STEP = 1.3;

/**
 * How wide one end's hit area is, in pixels.
 *
 * The grip inside it is 2px. A target the size of its own artwork is one the
 * pointer misses, and this is what `HANDLE_ROOM` measures two of.
 */
const HANDLE_WIDTH = 12;

/**
 * How tall the volume line's hit band is, in pixels.
 *
 * The line is a hairline; a target the size of its own artwork is one the
 * pointer misses, which is the same reason `HANDLE_WIDTH` is twelve and the
 * grip inside it is two.
 */
const VOLUME_GRAB = 9;

/**
 * The light that makes a bar read as raised rather than painted on.
 *
 * A wash of white falling off from the top, and a hairline of it along the
 * very top edge. Together they are the one thing a solid rectangle needs to
 * stop looking like a hole: light comes from above, so the top of a raised
 * thing catches it and the bottom does not.
 *
 * A tenth, not a fifth. The wash lifts the whole bar as well as shaping it,
 * and these bars were turned *down* for being the brightest thing on the strip
 * — an emboss that undid that would be trading one complaint for the other.
 *
 * On `::before` rather than as a child, so a bar does not grow an element for
 * a highlight — `rounded-[inherit]` keeps it inside whatever corner the bar
 * has, and being the first child in paint order puts it under the wave and the
 * label rather than over them.
 *
 * Deliberately not on the clips. They are covered by their own filmstrip, so
 * every pixel of this would be behind a photograph — a gradient nobody can see
 * and one more thing on the heaviest row of the strip.
 */
const EMBOSS = [
  // The wash, as the bar's own background-image rather than as a child.
  //
  // It was a `::before` for a long time, and that is what put the glass over
  // the selection ring: an outline is painted with the element, and every
  // descendant is painted after it — so the layer carrying the edges sat on
  // top of the ring and ate its outer pixel, which read as the ring having
  // gone thin. A background-image is part of the element, so the ring lands
  // over it the way it should.
  //
  // `background-color` underneath is untouched: the two are different
  // properties, and the gradient runs to transparent so the fill shows
  // through.
  "bg-gradient-to-b from-white/[0.11] to-transparent to-[65%]",
  // Three lines and a drop, which is what a macOS control wears: a dark
  // hairline all the way round, which is what separates one bar from the next;
  // the lit top edge over it, because light comes from above; a dark line
  // along the bottom, which is the shadow that edge implies; and a short fall
  // under the whole thing, so the bar sits *on* the row.
  //
  // **One string literal per class, however long it gets.** Tailwind scans the
  // source for class names, so a class split across a `+` is two fragments it
  // recognises as neither — no rule is generated, nothing appears on screen,
  // and nothing anywhere says why. That is exactly how this shipped twice
  // looking identical to the version before it.
  "shadow-[inset_0_0_0_1px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.45),inset_0_-1px_0_rgba(0,0,0,0.35),0_1px_3px_rgba(0,0,0,0.45)]",
].join(" ");

/**
 * How wide the level's bubble is, in pixels.
 *
 * Fixed, like `HEAD_LABEL_W`, and for the same reason: the number inside it is
 * rewritten continuously while the line is dragged, and an auto-width box
 * would resize under the pointer as the digits changed. Wide enough for the
 * glyph and the longest reading there is, which is `200%`.
 */
const VOLUME_LABEL_W = 60;

/**
 * How far a bar's own label is held off its ends, in pixels.
 *
 * Clear of the grips. A grip is a 2px line centred in its `HANDLE_WIDTH`, so
 * it occupies the fifth to the seventh pixel of the bar; a label flush to the
 * edge sat on top of it, and the one thing that says an end can be dragged
 * was drawn underneath a chip. Ten leaves three pixels of air either side of
 * the grip, on both ends, on every row.
 */
const LABEL_INSET = 10;

/**
 * The most of a bar one end may take, as a fraction of its width.
 *
 * So a bar always keeps a middle to be picked up by. Half each was the obvious
 * reading of "the ends are grabbable at any width" and it is the wrong one: a
 * bar narrower than two handles became nothing *but* handles, so a zoom at a
 * fitted timeline could be retimed and no longer moved at all. A quarter each
 * leaves half the bar to drag by at every width, which is the half that has to
 * survive — an end can always be reached by zooming the strip in, and a bar
 * that cannot be picked up has nothing to fall back on.
 */
const HANDLE_SHARE = 0.25;

/**
 * Room a bar needs before it is worth drawing grips on, in pixels.
 *
 * Two `HANDLE_WIDTH` handles. Below it the two grips would sit a couple of
 * pixels apart and read as noise rather than as the two ends of something.
 *
 * It no longer decides whether the ends can be *dragged*. They always can:
 * `Handle` takes half the bar at most, so a short bar is tiled by its two ends
 * instead of having them stacked on top of each other, and hovering either end
 * resizes whether or not a grip is drawn there.
 */
const HANDLE_ROOM = 24;

/**
 * The shortest shot the first cut makes, in seconds.
 *
 * Mirrors `MIN_SPAN` in `shared/autoedit.ts`. Held as a number here rather than
 * imported because it is being read for something else entirely — the narrowest
 * bar the zoom row can be asked to draw — and sharing the constant would make
 * the automatic pass's taste a reason to change the strip's scale.
 */
const SHORTEST_SHOT = 2.8;

/**
 * Room a bar needs to be worth having at all, in pixels.
 *
 * Both grips and something between them. A bar exactly as wide as its two
 * handles is all edge and no middle: there is nowhere left to press that means
 * "move this" rather than "retime this end", which is the same trap as two
 * grips on top of each other reached from a pixel further out.
 */
const GRAB_ROOM = HANDLE_ROOM + 12;

/**
 * The finest scale the strip opens at, in pixels per second.
 *
 * It opened fitted, whatever the recording's length, on the reasoning that
 * seeing all of it is the right first view. That is true of the clips and false
 * of everything annotating them: fitting eight minutes into the strip is about
 * two pixels a second, so the shortest shot the first cut makes came out six
 * pixels wide — a bar narrower than either of the two grips on it. Pressing a
 * zoom to move it landed on the end grip and trimmed it instead, and on a long
 * recording that was every zoom in the row.
 *
 * Enough that the shortest of those shots clears `GRAB_ROOM`, which is the width
 * where the row becomes usable rather than merely visible. How much of the
 * recording that leaves in view is the window's business; the whole of it is
 * still one keystroke away, because `fit` is unchanged as the floor for zooming
 * out.
 */
const OPENING_ZOOM = GRAB_ROOM / SHORTEST_SHOT;

/**
 * The blade over one bar: whether a press would cut it, and the cut.
 *
 * Every bar on the strip takes one of these, or null while the pointer is the
 * tool in hand. One prop rather than a boolean beside two callbacks, because it
 * is also what tells the bar to stop selecting, carrying and trimming: three
 * things that must all be off together, and a boolean would let them drift
 * apart one bar at a time.
 */
interface Blade {
  /** Whether a press at this client x would really cut. */
  legal: (clientX: number) => boolean;
  cut: (clientX: number) => void;
}

/**
 * Marks the bar under the pointer as the one a press would cut, or unmarks it.
 *
 * Written straight to the element, as the ghost and the hover line are: a
 * `pointermove` across a clip fires far more often than a frame, and going
 * through state would rebuild every clip, tick and thumbnail to change one
 * outline. The attribute is read by `data-[cut=true]:*` in each bar's own
 * classes, so what being about to be cut *looks* like stays beside the rest of
 * that bar's styling.
 *
 * Only where a cut would really land, which is the whole reason this is not a
 * `hover:` class. `legal` is the rule the reducer applies, so a bar never
 * offers a cut that is then declined — and the stretch where it would be is not
 * a sliver: the floor is three hundred milliseconds on a zoom or a title, which
 * at a zoomed-in strip is a quarter of the window.
 *
 * `shade` is the bar's `CutShade`, slid to the pointer: the ring says which bar
 * this press is talking to, and the wash says which part of it is about to
 * become a second bar.
 */
function aim(
  blade: Blade | null,
  event: PointerEvent<HTMLElement>,
  shade: RefObject<HTMLSpanElement | null>,
) {
  const lands = blade?.legal(event.clientX) ?? false;
  event.currentTarget.dataset.cut = lands ? "true" : "false";

  const element = shade.current;
  if (!element) return;
  if (!lands) {
    element.style.opacity = "0";
    return;
  }

  // Less `clientLeft`, which is the bar's own left border. `inset-0` on the
  // wash resolves against the *padding* box and `getBoundingClientRect`
  // measures the *border* box, so without this the seam sits a border's width
  // to the right of the cut it is drawing — two pixels on a clip and one on
  // the other rows. Small enough to look like nothing, and plainly visible the
  // moment the seam lands on the playhead and the two fail to line up.
  //
  // The cut itself was never off: that comes from `timeAt`, which measures
  // from the scroller. This is only where the mark is drawn.
  const bar = event.currentTarget;

  // `transform`, not `left`: this runs on every move of the pointer across a
  // bar, and a layout write next to the layout read above thrashes the frame —
  // the same rule the editor's own loop follows. The wash is the bar's full
  // width and slides right, so what shows is the part after the cut; the rest
  // hangs over the end and is clipped by the bar's `overflow-hidden`.
  element.style.transform = `translate3d(${String(event.clientX - bar.getBoundingClientRect().left - bar.clientLeft)}px, 0, 0)`;
  element.style.opacity = "1";
}

/**
 * The part of a bar a cut would separate off, washed in the cut colour.
 *
 * The second half rather than the first, and rather than a line at the cut: a
 * line says where, and this says what — the piece that is about to become its
 * own clip, zoom or title, which is the thing somebody aiming is actually
 * choosing. Looking right is what every bar on the strip already does; the
 * first half is the part that stays where it is.
 *
 * A wash and a bar down the join. The fill is faint enough that the filmstrip,
 * the wave and the label all stay readable under it — what is being previewed
 * is a division, not a deletion — and the join carries the weight instead.
 *
 * The join is a bar rather than the hairline border it started as, and it is
 * centred on the cut rather than drawn down one side of the wash. A hairline
 * is the same width as the hover line standing on top of it and read as part
 * of it; this reads as a seam between two pieces, which is what it is. It runs
 * the full height of the bar, so the division goes all the way through rather
 * than stopping short of the frame it is dividing.
 *
 * In `--cut-deep`, which is the hover line's own red rather than the wash's.
 * The line standing at the pointer and this seam are the same mark — one drawn
 * the height of the strip and one the height of the bar — and two reds a shade
 * apart touching would read as two marks that happen to meet. It is also the
 * red dark enough to carry white, which the dots need.
 *
 * Three dots down it, white and see-through. Six pixels of flat colour is a
 * block, and the seam wants the weight without the mass — the dots are the
 * same grammar as a grip, which is the right one: this is the handle of the
 * cut, the part the eye lands on and the pointer is holding.
 *
 * Over the playhead rather than under it: where a cut lands on the head, the
 * one the press acts on is this, and a head painted across the seam cut a
 * notch in it and left it looking broken. `z-20` clears the head's `z-10`, and
 * it is on this element and not the seam inside it because `will-change` makes
 * this one a stacking context of its own — a z-index nested in it could never
 * reach past the head.
 *
 * All of it is one element, so the single `transform` `aim` writes carries the
 * wash, the seam and the dots together: positioned from there rather than from
 * a render, for the reason the zoom ghost and the hover line are.
 */
function CutShade({ ref }: { ref: RefObject<HTMLSpanElement | null> }) {
  return (
    <span
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-20 bg-cut/20 opacity-0"
      style={{ willChange: "transform, opacity" }}
    >
      {/* Centred on the cut, which is this element's own left edge: half of it
          lies over the piece that stays and half over the piece that comes
          away, so the seam belongs to neither. */}
      <span className="absolute inset-y-0 left-0 flex w-1.5 -translate-x-1/2 flex-col items-center justify-center gap-[3px] rounded-full bg-cut-deep">
        {[0, 1, 2].map((dot) => (
          <span key={dot} className="size-[2px] flex-none rounded-full bg-white/70" />
        ))}
      </span>
    </span>
  );
}

/**
 * The edit, as a strip.
 *
 * One row: screen, camera and both audio tracks were recorded together and are
 * cut together, so they are one clip rather than four kept in step by hand.
 * Independent tracks are what the model leaves room for, not what exists today.
 */
export function TimelineStrip({
  state,
  dispatch,
  media,
  peaks,
  musicPeaks,
  onAddMusic,
  filmstrip,
  framesPending,
  cameraSpans,
  captionRange,
  clicks,
}: {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  media: EditorPlayback;
  /** The recording's audio, for the clips to draw. Null while it decodes. */
  peaks: Float32Array | null;
  /**
   * Each music file's own peaks, by name — see `useMusicPeaks`.
   *
   * Per file rather than merged onto the session's clock, as the recording's
   * are: a bed draws the stretch of its *file* between its offset and its end,
   * and where that sits on the timeline is a different question.
   */
  musicPeaks: ReadonlyMap<string, Float32Array>;
  /**
   * Lays a bed at this project time, with whichever track is the default.
   *
   * A callback rather than an action, because the file has to be in the
   * recording before the reducer can be told about it — fetching or copying it
   * is main's, and the editor is what knows how to ask. Absent while there is
   * no track to lay, which is a machine that has never been online *and* has
   * had nothing imported.
   */
  onAddMusic?: (at: MediaTime) => void;
  /** Frame thumbnails for the whole recording, or null while they are built. */
  filmstrip: Filmstrip | null;
  /** Whether a sheet is still coming — see `FilmstripState`. */
  framesPending: boolean;
  /**
   * Source time the camera covers, one span per take that recorded one.
   *
   * A list rather than one span because a recording can be extended, and a take
   * recorded without a camera leaves a gap: a single span across the whole
   * recording would promise footage two of its clips do not have.
   */
  cameraSpans: readonly { start: MediaTime; end: MediaTime }[];
  /**
   * The footage under the words selected in the captions editor, in source
   * time, or null when none are. Drawn over the clips so the text and the
   * timeline are visibly the same thing.
   */
  captionRange: { start: MediaTime; end: MediaTime } | null;
  /**
   * Every press the recording saw, in source time.
   *
   * Times alone: where each one landed in the frame is the zooms' business,
   * and the strip only asks when. Empty for a recording made without the
   * Accessibility grant, and for every one made before the tap existed.
   */
  clicks: readonly MediaTime[];
}) {
  // Memoised on the slices, not rebuilt per render: `place` hands back new
  // objects every call, and this strip re-renders on every preview drag. Fresh
  // identities would miss each `Clip`'s filmstrip memo and every callback
  // below that closes over `placed`, every time.
  const slices = slicesOf(state.project);
  const placed = useMemo(() => place(slices), [slices]);

  /**
   * How far in the picture goes over the recording, and the top of the scale
   * every bar on the zoom row is drawn against.
   *
   * Once for the row rather than once per bar: the ceiling is the row's own
   * deepest zoom, so a bar worked out on its own would be measuring against
   * itself and every bar would come out full height.
   */
  const envelope = useMemo(() => zoomEnvelope(state.project.zooms), [state.project.zooms]);
  const ceiling = useMemo(() => zoomCeiling(envelope), [envelope]);
  /** Each zoom's whole life, the moves included — what a bar draws. */
  const reaches = useMemo(() => zoomSpans(state.project.zooms), [state.project.zooms]);
  const edited = totalDuration(placed);

  /** The blade is in hand, so every bar on the strip cuts instead of moving. */
  const slicing = state.timelineTool === "slice";

  /** The edge being dragged, and how long the edit was when it was picked up. */
  const [trim, setTrim] = useState<{
    sliceId: string;
    edge: "start" | "end";
    span: MediaTime;
  } | null>(null);

  /**
   * Length the strip is drawn against, held still while an edge is dragged.
   *
   * At the fit zoom the strip is always exactly as wide as the edit, so a trim
   * that shortens the edit also stretches what is left back out to fill the
   * same room: the clip's edge stays pinned where it was, the frames slide
   * about underneath it and the ruler renumbers itself — the cursor moves and
   * nothing appears to follow it. Freezing the length for the drag lets the
   * edge travel with the pointer and leaves the ruler still; the strip refits
   * when the drag ends.
   *
   * Never *below* the edit, or a clip pulled out past the length the strip
   * started at would overflow the row, and flex would shrink every clip to make
   * it fit — the same rescale, arriving all at once.
   */
  const duration = Math.max(trim?.span ?? edited, edited);

  /**
   * Room the frozen length is holding open, which a head trim takes in front of
   * its clip.
   *
   * Trimming a head is the one edit whose clip cannot move to meet the pointer:
   * slices are laid end to end, so a clip's start is wherever the one before it
   * finished, and shortening the head only pulls the clip's *far* edge inwards.
   * Dragging right and watching the wrong end come towards you is the part that
   * read as broken. The edit shrinks by exactly what the head lost, so putting
   * that much space in front of the clip stands it still and lets its start edge
   * travel with the pointer. It closes up when the drag ends and the strip refits.
   */
  const slack = duration - edited;

  const scroller = useRef<HTMLDivElement>(null);
  /**
   * The scrollport's left edge in viewport coordinates.
   *
   * Held rather than measured in `timeAt`, which runs on every `pointermove`
   * across the strip and on every frame of a drag. The edge only moves when the
   * strip is laid out again, and the `ResizeObserver` below already knows when
   * that happens; `scrollLeft` still has to be read live, because scrolling is
   * exactly what it is there to track.
   */
  const edge = useRef(0);
  const ghost = useRef<HTMLDivElement>(null);
  /** The hover line. Positioned straight on the element — see `showShadow`. */
  const shadow = useRef<HTMLDivElement>(null);
  /** The hover line's own timecode. Written by `showShadow`. */
  const shadowTime = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  /** Null means "nobody has chosen a zoom yet" — see `OPENING_ZOOM`. */
  const [zoom, setZoom] = useState<number | null>(null);

  // Measured rather than assumed: the fit zoom depends on how much room the
  // window is giving the timeline, which changes as the inspector and the
  // window itself resize.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;

    const measure = () => {
      setWidth(element.clientWidth);
      // Cached here as well as on pointer entry, because this fires for the
      // changes that actually move the strip sideways — the inspector opening,
      // the window resizing — and those can happen with the pointer already
      // inside it.
      edge.current = element.getBoundingClientRect().left;
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Against the room the rail leaves, not the whole scrollport: the strip has
  // to *fit* in what is left, or fitting it would leave the last second of the
  // recording permanently under the rail.
  const timelineWidth = Math.max(0, width - RAIL_W);
  const fit = fitZoom(duration, timelineWidth);
  // Never below fit. Zooming out past it cannot shrink the strip — the content
  // is already as narrow as the visible width — so the only thing a smaller
  // number changed was the ruler, which went on choosing its tick interval for
  // a zoom the layout was not using and ended up with no ticks inside the
  // recording at all. An empty ruler over a full-width strip.
  const pxPerSecond = Math.max(zoom ?? openingZoom(duration, timelineWidth, OPENING_ZOOM), fit);
  const contentWidth = Math.max(timelineWidth, (duration / NS_PER_SECOND) * pxPerSecond);

  // What a snap is worth here. Pixels on the way in, because what the hand is
  // doing is aiming at a line on screen; nanoseconds on the way out, because
  // that is what the edit is in — see `snappedStart`.
  const snap = (SNAP_REACH / pxPerSecond) * NS_PER_SECOND;

  // Pushed in on change rather than measured inside the playback loop, which
  // would have to flush layout to read them — every frame, while also writing
  // `scrollLeft`.
  const { setTrackMetrics } = media;
  useEffect(
    () => setTrackMetrics(contentWidth, width, RAIL_W),
    [setTrackMetrics, contentWidth, width],
  );

  // One stable callback rather than an inline arrow: a fresh identity each
  // render makes React tear the ref down and set it up again every time, and a
  // detached ref is a frame where the playback loop has no scroller to follow
  // the head with. Stable only because `media` is memoised — this depends on
  // it, so it was a fresh identity every render until it was.
  const attachScroller = useCallback(
    (element: HTMLDivElement | null) => {
      scroller.current = element;
      // Handed to the playback loop too, which scrolls it to follow the head.
      media.scrollerRef(element);
    },
    [media],
  );

  const timeAt = useCallback(
    (clientX: number): MediaTime => {
      const element = scroller.current;
      if (!element || contentWidth <= 0) return 0;

      // The rail comes off: it is pinned to the scrollport's left edge, so the
      // first pixel of *timeline* is `RAIL_W` into the content.
      const into = clientX - edge.current - RAIL_W + element.scrollLeft;
      return Math.min(Math.max(0, into / contentWidth), 1) * duration;
    },
    [contentWidth, duration],
  );

  const changeZoom = useCallback(
    (factor: number) => {
      setZoom((current) => {
        // Clamped on the way in as well as on the way out, or zooming out would
        // bank a number below fit that the next few zooms in had to climb back
        // through before anything moved.
        const floor = Math.max(fitZoom(duration, width), MIN_ZOOM);
        const from = Math.max(current ?? floor, floor);
        return Math.min(Math.max(from * factor, floor), MAX_ZOOM);
      });
    },
    [duration, width],
  );

  // Pinch and ⌘-scroll zoom, which is what a trackpad user reaches for first.
  // Non-passive, because the browser's own page zoom has to be prevented.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      changeZoom(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [changeZoom]);

  // Zooms are stored in *source* time, like everything else that describes the
  // recording; the strip measures project time. Cutting the composite shifts
  // one against the other, so the two conversions are kept here rather than
  // being re-derived at each use.
  const sourceAt = useCallback(
    // `toSourceTime` rather than a second copy of the same arithmetic. The copy
    // that used to live here matched slices half-open and fell through to the
    // raw project time when nothing matched — and the far right of the strip is
    // exactly that case, because the last clip ends there. It handed back a
    // *project* time as though it were a *source* time, short by however much
    // had been cut away, so dragging a zoom's end handle to the end of a cut
    // recording moved it backwards instead of out to the end of the take.
    (project: MediaTime): MediaTime => toSourceTime(placed, project) ?? project,
    [placed],
  );

  /**
   * A source span as the strip draws it, or null when none of it survives.
   *
   * `spanInProject` rather than `projectAt` on each end, and this is the
   * difference between an outline that shows and one that does not: `projectAt`
   * answers null for a moment that was cut away, so on a recording trimmed down
   * to fragments an outline whose far end happened to land in removed footage
   * vanished entirely. The union across the clips is what a real bar is placed
   * by, and an outline has to be placed by the same thing or it is promising a
   * span the editor would not draw.
   */
  const toStrip = useCallback(
    (source: { start: MediaTime; end: MediaTime }) => spanInProject(placed, source),
    [placed],
  );

  const projectAt = useCallback(
    // A zoom over a stretch that has been cut away has nowhere to be drawn.
    (source: MediaTime): MediaTime | null => toProjectTimeThrough(placed, source),
    [placed],
  );

  /**
   * The zoom being drawn out in the empty part of the row, if any.
   *
   * A ref rather than state, for the reason `showGhost` gives: what a drag
   * changes is an outline, and going through state would rebuild every clip,
   * tick and thumbnail on every `pointermove` to move it. `drawn` is whether
   * the pointer has travelled far enough to mean a span rather than a click.
   */
  const draw = useRef<{ at: MediaTime; x: number; drawn: boolean } | null>(null);

  /**
   * Draws the outline of the zoom a click would add — or of the one being drawn
   * out — and hides it.
   *
   * Written straight to the element rather than held in state: `pointermove`
   * fires far more often than a frame, and re-rendering the strip on each one
   * would rebuild every clip and ruler tick to move an outline.
   *
   * `zoomSpanAt` is the rule the reducer applies, so the ghost cannot offer a
   * zoom that is then declined — over an existing one, or in a gap too small to
   * hold it, nothing is drawn and nothing happens.
   */
  const showGhost = useCallback(
    (clientX: number | null) => {
      const element = ghost.current;
      if (!element) return;

      // Anchored to the press while a zoom is being drawn out, and to the
      // pointer otherwise. Both go through `zoomSpanAt`, so the outline is the
      // span that will actually be laid down rather than the rectangle the
      // pointer happens to have swept — a drag that runs back over the zoom
      // behind it stops where the zoom will.
      const drawing = draw.current;
      const pointer = clientX === null ? null : sourceAt(timeAt(clientX));
      const span =
        drawing === null
          ? pointer === null
            ? null
            : zoomSpanAt(state.project, pointer)
          : drawing.drawn && pointer !== null
            ? zoomSpanAt(state.project, drawing.at, pointer)
            : zoomSpanAt(state.project, drawing.at);
      const drawn = span === null ? null : toStrip(span);

      if (drawn === null) {
        element.style.opacity = "0";
        return;
      }
      const { start: from, end: to } = drawn;

      element.style.left = `${(from / Math.max(duration, 1)) * 100}%`;
      element.style.width = `${((to - from) / Math.max(duration, 1)) * 100}%`;
      element.style.opacity = "1";
    },
    [state.project, sourceAt, toStrip, timeAt, duration],
  );

  /**
   * Moves the hover line, and points the preview at the same moment.
   *
   * Written straight to the element, for the reason `showGhost` is: `pointermove`
   * fires far more often than a frame, and going through state would rebuild
   * every clip, tick and thumbnail to move a one-pixel line.
   *
   * Nothing happens during playback. The preview is already showing frames as
   * fast as it can, and a second indicator racing the playhead reads as two
   * playheads disagreeing.
   */
  const showShadow = useCallback(
    (clientX: number | null) => {
      const element = shadow.current;
      if (!element) return;

      if (clientX === null || media.playing) {
        element.style.opacity = "0";
        media.setHover(null);
        return;
      }

      const at = timeAt(clientX);
      // Through the same mapping the playhead uses, so the two line up exactly
      // rather than being a pixel apart at the same moment.
      const x = (at / Math.max(duration, 1)) * contentWidth;

      element.style.transform = `translate3d(${String(x)}px, 0, 0)`;
      element.style.opacity = "1";

      // The label, clamped to the content the way the playhead's is: centred on
      // the line, except at the ends of the strip where half of it would be cut
      // off by the scroller. The two corners it comes to rest against are
      // squared, so a bubble stopped at the edge reads as having arrived rather
      // than as having been sliced.
      const label = shadowTime.current;
      if (label) {
        const half = HEAD_LABEL_W / 2;
        const nudge = Math.min(Math.max(x, half), Math.max(contentWidth - half, half)) - x;

        label.style.transform = `translate3d(calc(-50% + ${String(nudge)}px), 0, 0)`;
        label.style.borderRadius =
          nudge > 0 ? "0 999px 999px 0" : nudge < 0 ? "999px 0 0 999px" : "999px";
        label.textContent = formatTimecode(at);
      }

      media.setHover(at);
    },
    [media, timeAt, duration, contentWidth],
  );

  // Playback starting has to clear it: the line was put there by a pointer that
  // has not moved since, so nothing else would take it down.
  useEffect(() => {
    if (media.playing) showShadow(null);
  }, [media.playing, showShadow]);

  /**
   * The right-click menu, and what it was opened on.
   *
   * Held here rather than on each bar so only one can ever be open — two menus
   * over one timeline is a click that lands on whichever was rendered last.
   * Positioned in client coordinates because it is `fixed`: the strip scrolls,
   * and a menu anchored inside it would travel with the content under it.
   */
  const [menu, setMenu] = useState<
    | { x: number; y: number; kind: "clip"; sliceId: string; at: MediaTime }
    | { x: number; y: number; kind: "zoom"; zoomId: string }
    | { x: number; y: number; kind: "text"; textId: string }
    | { x: number; y: number; kind: "music"; musicId: string }
    | null
  >(null);

  /**
   * Which rows of texts to show: every row that exists, and one spare above
   * — the row a text goes on to sit over the ones below. Only while there is
   * room for another, and rendered top-down so the spare is furthest from the
   * clips and the first row is nearest.
   */
  const textRows = Math.min(state.project.texts.length + 1, MAX_TEXT_TRACKS);

  /** The group of text rows, measured for a vertical drag. */
  const textGroup = useRef<HTMLDivElement>(null);

  /**
   * Which row a client y is over, for a bar being dragged between rows.
   *
   * Measured live rather than held: the group grows by a row when a bar
   * lands on the spare one, and the rows below it move down. Held to the
   * rows that exist, so a drag past the top lands on the spare row and one
   * past the bottom on the first.
   */
  /**
   * The outline of the copy an option-drag would leave, and its words.
   *
   * Written straight to the elements, as the zoom ghost is: a drag is a
   * stream of moves, and re-rendering the strip on each to move an outline
   * would rebuild every clip and tick. Placed by `textCopySpan`, which is
   * the rule the reducer applies, so the outline never promises a copy the
   * drop then declines — over another text, or past the last row, nothing
   * is drawn and nothing lands.
   */
  const copyGhost = useRef<HTMLDivElement>(null);
  const copyGhostLabel = useRef<HTMLSpanElement>(null);

  const showCopy = useCallback(
    (copy: { textId: string; start: MediaTime; track: number; label: string } | null) => {
      const element = copyGhost.current;
      if (!element) return;

      // Project time already, like the text ghost's — `textCopySpan` measures a
      // text's length on the finished edit's clock, so there is nothing to
      // cross. Putting it through `toStrip` as well read those numbers as
      // source times and quietly found no clip covering them.
      const span = copy && textCopySpan(state.project, copy.textId, copy.start, copy.track);
      const from = span?.start ?? null;
      const to = span?.end ?? null;
      if (!copy || from === null || to === null) {
        element.style.opacity = "0";
        return;
      }

      element.style.top = `${String((textRows - 1 - copy.track) * (TEXT_H + TEXT_GAP))}px`;
      element.style.left = `${String((from / Math.max(duration, 1)) * 100)}%`;
      element.style.width = `${String(((to - from) / Math.max(duration, 1)) * 100)}%`;
      element.style.opacity = "1";
      if (copyGhostLabel.current) copyGhostLabel.current.textContent = copy.label;
    },
    [state.project, duration, textRows],
  );

  const trackAt = useCallback(
    (clientY: number): number => {
      const element = textGroup.current;
      if (!element) return 0;
      const rect = element.getBoundingClientRect();
      const row = Math.floor((clientY - rect.top) / (TEXT_H + TEXT_GAP));
      return Math.max(0, Math.min(textRows - 1, textRows - 1 - row));
    },
    [textRows],
  );

  /**
   * The clip being carried, and the gap it would drop into.
   *
   * `before` is the id of the clip it would land in front of, or null for the
   * end — the same shape `moveSlice` takes, so what the row draws and what the
   * reducer is told can never be two different answers.
   */
  const [carrying, setCarrying] = useState<{ sliceId: string; before: string | null } | null>(null);
  /** Where the press landed, so a click is not mistaken for a drag. */
  const pressed = useRef<{ sliceId: string; clientX: number } | null>(null);

  /**
   * Where a press on the empty music row landed, or null.
   *
   * Held from the press rather than read off the release, so a release that
   * merely *ended* over the row — the end of a trim on one of its bars — lays
   * nothing down. See the row itself.
   */
  const addAt = useRef<MediaTime | null>(null);

  /**
   * Which gap a pointer at `clientX` is over.
   *
   * By midpoint rather than by edge: a clip is dropped *in front of* whichever
   * one the pointer has not yet passed the middle of, which is what makes the
   * line land where the eye expects when the pointer is inside a clip rather
   * than between two.
   */
  const gapAt = (clientX: number): string | null => {
    const at = timeAt(clientX);
    for (const slice of placed) {
      if (at < slice.timelineStart + slice.duration / 2) return slice.id;
    }
    return null;
  };

  const onClipDrag = (slice: PlacedSlice, event: PointerEvent<HTMLDivElement>) => {
    const from = pressed.current;
    if (!from || from.sliceId !== slice.id) return;
    // Past a threshold, or every click that wobbles a pixel becomes a reorder
    // the user did not ask for.
    if (!carrying && Math.abs(event.clientX - from.clientX) < REORDER_SLOP) return;

    const before = gapAt(event.clientX);
    // Only on a change: this runs on every move of the pointer, and setting the
    // same gap again would re-render the whole row sixty times a second.
    setCarrying((held) =>
      held?.sliceId === slice.id && held.before === before ? held : { sliceId: slice.id, before },
    );
  };

  const onClipDrop = () => {
    pressed.current = null;
    if (!carrying) return;
    dispatch({ type: "moveSlice", sliceId: carrying.sliceId, before: carrying.before });
    setCarrying(null);
  };

  const onClipPointerDown = (slice: PlacedSlice, event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    media.onInteract();

    // Captured on the clip itself, so the drag keeps receiving moves once the
    // pointer has left it — which it does immediately, because reordering means
    // travelling over the neighbours.
    event.currentTarget.setPointerCapture(event.pointerId);
    pressed.current = { sliceId: slice.id, clientX: event.clientX };

    // Picking a clip up and scrubbing inside one are two different asks, and
    // which one this is depends on whether the clip was already the one being
    // edited.
    //
    // A clip that was not: to its start. Editing a clip means watching it from
    // the beginning — landing wherever the pointer happened to be means judging
    // a change against an arbitrary frame, and it costs the start of the clip,
    // which is where most changes are actually visible.
    //
    // The clip already held: to where it was pressed. Once it is the one being
    // edited, every press on it is a request to look at that moment of it, and
    // snapping back to the start makes the clip the one part of the timeline
    // that cannot be scrubbed by clicking.
    const held = slice.id === state.selectedSliceId;

    dispatch({ type: "select", sliceId: slice.id });
    media.playback.seek(held ? timeAt(event.clientX) : slice.timelineStart);
  };

  return (
    // Padded on the right to match the transport above it, and not on the left:
    // the gutter that side is inside `RAIL_W`, so the glyphs line up with the
    // transport's own and the rail's veil reaches the window's edge rather than
    // leaving four pixels of scrolling timeline beside it.
    <div className="flex flex-none flex-col bg-editor-veil pr-4 pb-4" data-panel="timeline">
      <div
        ref={attachScroller}
        // The cursor on the whole scrollport rather than on the bars: the blade
        // is what the hand is holding over the timeline, and a pointer that
        // turned back into an arrow between two clips would read as the tool
        // having been put down.
        className={cn(
          "no-scrollbar relative overflow-x-auto overflow-y-hidden",
          slicing && "cursor-blade",
        )}
        // Once per hover rather than per move — see `edge`.
        onPointerEnter={(event) => {
          edge.current = event.currentTarget.getBoundingClientRect().left;
        }}
        onPointerMove={(event) => showShadow(event.clientX)}
        // `pointerleave` rather than `pointerout`, which also fires on the way
        // into a child and would blink the line off over every clip.
        onPointerLeave={() => showShadow(null)}
      >
        {/* Pressing anywhere that is not a clip, a zoom or one of their handles
            seeks. Those three stop the event; everything else — the bands above
            and below the clips, the empty end of a row, the stretch of the zoom
            row where no zoom will fit — used to be dead, and there is more of it
            than there is of the strip. A timeline that ignores a press has no
            way of saying why, so it reads as the app having missed the click. */}
        <div
          className="relative flex"
          style={{ width: RAIL_W + contentWidth }}
          onPointerDown={(event) => {
            media.onInteract();
            media.playback.seek(timeAt(event.clientX));
          }}
        >
          {/* Pinned to the scrollport's left edge while the strip scrolls under
              it. `sticky` on a flex item rather than an absolute overlay: an
              absolute one would cover the first `RAIL_W` of timeline, and the
              start of a recording is exactly the part nobody can afford to
              lose. Opaque, so what passes behind it is hidden rather than
              showing through the glyphs. */}
          <div
            className="sticky left-0 z-20 flex-none bg-editor-veil"
            style={{ width: RAIL_W }}
            // A press on the rail is not a seek. Without this it falls through
            // to the strip, which maps it to a negative time and clamps it —
            // so clicking a glyph sent the playhead to zero.
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div style={{ height: RULER_H + RULER_PAD }} />
            {BANDS.map((band) => (
              <Fragment key={band.id}>
                <div style={{ height: TRACK_GAP }} />
                <div
                  className="grid place-items-center text-editor-muted [&_svg]:size-4"
                  style={{ height: band.height(textRows) }}
                  title={band.label}
                  aria-hidden
                >
                  <band.Icon />
                </div>
              </Fragment>
            ))}
          </div>

          <div className="relative flex-none" style={{ width: contentWidth }}>
            <Ruler
              duration={duration}
              pxPerSecond={pxPerSecond}
              onSeek={(clientX) => {
                media.onInteract();
                media.playback.seek(timeAt(clientX));
              }}
            />

            <div style={{ height: TRACK_GAP }} />

            {/* Text rows, highest first, so the row nearest the clips is the
              first and a text drawn on the spare row above lands over the
              others in the frame too. The bars are not inside the rows: they
              sit in one layer over the group, placed by row, so a bar dragged
              onto another row moves rather than being torn down and remade
              under a pointer that has captured it. */}
            <div className="relative" ref={textGroup}>
              {Array.from({ length: textRows }, (_, index) => textRows - 1 - index).map((track) => (
                <Fragment key={track}>
                  <TextRow
                    track={track}
                    empty={(state.project.texts[track]?.slices.length ?? 0) === 0}
                    spare={track === state.project.texts.length}
                    invite={track === 0 || (state.project.texts[track - 1]?.slices.length ?? 0) > 0}
                    width={timelineWidth}
                    duration={duration}
                    spanAt={(at, to) => textSpanAt(state.project, track, at, to)}
                    slicing={slicing}
                    timeAt={timeAt}
                    onInteract={media.onInteract}
                    dispatch={dispatch}
                  />
                  {track > 0 && <div style={{ height: TEXT_GAP }} />}
                </Fragment>
              ))}

              <div className="pointer-events-none absolute inset-0">
                <div
                  ref={copyGhost}
                  className={cn(
                    "pointer-events-none absolute flex items-center overflow-hidden rounded-md px-2",
                    "border border-dashed border-title-ring/80 bg-title-fill/20 opacity-0 transition-opacity duration-75",
                  )}
                  style={{ height: TEXT_H, borderWidth: ZOOM_EDGE }}
                >
                  <span
                    ref={copyGhostLabel}
                    className="truncate text-[11px] font-medium text-white/80"
                  />
                </div>

                {state.project.texts.flatMap((row, track) =>
                  row.slices.map((text) => {
                    // Its own width on the strip, not the surviving part of a
                    // source span: a text is measured in the finished video, so
                    // it begins where its anchor lands and runs for as long as it
                    // runs — across a cut if that is where it reaches.
                    const from = toProjectTime(placed, text.at);
                    if (from === null) return null;
                    const to = from + text.length;

                    return (
                      <TextBar
                        key={text.id}
                        top={(textRows - 1 - track) * (TEXT_H + TEXT_GAP)}
                        left={(from / Math.max(duration, 1)) * 100}
                        width={((to - from) / Math.max(duration, 1)) * 100}
                        pixels={((to - from) / Math.max(duration, 1)) * contentWidth}
                        selected={text.id === state.selectedTextId}
                        blade={
                          slicing
                            ? {
                                legal: (clientX) =>
                                  textSplitAt(state.project, text.id, timeAt(clientX)) !== null,
                                cut: (clientX) => {
                                  media.onInteract();
                                  dispatch({
                                    type: "splitText",
                                    textId: text.id,
                                    at: timeAt(clientX),
                                  });
                                },
                              }
                            : null
                        }
                        label={text.fields.map((field) => field.text).join(" — ")}
                        start={from}
                        timeAt={timeAt}
                        trackAt={trackAt}
                        onSelect={() => {
                          media.onInteract();
                          dispatch({ type: "selectText", textId: text.id });
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setMenu({
                            x: event.clientX,
                            y: event.clientY,
                            kind: "text",
                            textId: text.id,
                          });
                        }}
                        onBeginEdit={() => dispatch({ type: "beginEdit" })}
                        onMove={(start, onto) =>
                          dispatch({ type: "moveText", textId: text.id, start, track: onto, snap })
                        }
                        onDrop={() => dispatch({ type: "tidyTexts" })}
                        onCopyPreview={(over) =>
                          showCopy(
                            over && {
                              textId: text.id,
                              ...over,
                              label: text.fields.map((field) => field.text).join(" — "),
                            },
                          )
                        }
                        onCopy={(start, onto) => {
                          showCopy(null);
                          dispatch({ type: "copyText", textId: text.id, start, track: onto });
                        }}
                        onTrim={(edge, clientX) =>
                          dispatch({
                            type: "trimText",
                            textId: text.id,
                            edge,
                            at: timeAt(clientX),
                          })
                        }
                      />
                    );
                  }),
                )}
              </div>
            </div>

            <div style={{ height: TRACK_GAP }} />

            <div className="flex gap-px" style={{ height: CLIP_H }}>
              {placed.map((slice) => (
                <Fragment key={slice.id}>
                  {slack > 0 && trim?.edge === "start" && trim.sliceId === slice.id && (
                    <div
                      className="flex-none"
                      style={{ width: `${String((slack / Math.max(duration, 1)) * 100)}%` }}
                    />
                  )}
                  {carrying !== null && carrying.before === slice.id && <DropLine />}
                  <Clip
                    slice={slice}
                    duration={duration}
                    peaks={peaks}
                    filmstrip={filmstrip}
                    framesPending={framesPending}
                    contentWidth={contentWidth}
                    cameraSpans={cameraSpans}
                    clicks={clicks}
                    selected={slice.id === state.selectedSliceId}
                    carried={carrying?.sliceId === slice.id}
                    blade={
                      slicing
                        ? {
                            legal: (clientX) =>
                              splitPointAt(state.project, timeAt(clientX)) !== null,
                            cut: (clientX) => {
                              media.onInteract();
                              dispatch({ type: "split", at: timeAt(clientX) });
                            },
                          }
                        : null
                    }
                    // The clip's own levels, resolved: its overrides over the
                    // project's defaults, which is what it actually plays at.
                    audio={clipAudio(state.project, slice.id)}
                    onVolume={(level, from) =>
                      dispatch({
                        type: "setSliceAudio",
                        sliceId: slice.id,
                        ...scaledAudio(from.mic, from.system, level),
                      })
                    }
                    onDrag={(event) => onClipDrag(slice, event)}
                    onDrop={onClipDrop}
                    onPointerDown={(event) => onClipPointerDown(slice, event)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      // The source time under the pointer, so Split here means
                      // *here* — the same conversion a click on the ruler makes.
                      setMenu({
                        x: event.clientX,
                        y: event.clientY,
                        kind: "clip",
                        sliceId: slice.id,
                        at: sourceAt(timeAt(event.clientX)) ?? 0,
                      });
                    }}
                    onBeginEdit={(edge) => {
                      dispatch({ type: "beginEdit" });
                      setTrim({ sliceId: slice.id, edge, span: edited });
                    }}
                    onEndEdit={() => setTrim(null)}
                    onTrim={(edge, source) =>
                      dispatch({ type: "trimSlice", sliceId: slice.id, edge, source })
                    }
                  />
                </Fragment>
              ))}
              {carrying !== null && carrying.before === null && <DropLine />}
            </div>

            <div style={{ height: TRACK_GAP }} />

            {/* Zooms, on their own row and the same height as the clips: a row
              half the size reads as less important than the thing it is
              changing, which is backwards. */}
            <div
              className="relative"
              style={{ height: CLIP_H }}
              // Nothing is drawn or added while the blade is held. A row that
              // offered to add a zoom where the pointer is, under a cursor that
              // says it is about to cut one, is the row contradicting itself —
              // and the press below would lay a zoom down rather than cut the one
              // being aimed at.
              onPointerMove={(event) => {
                if (slicing) return;
                const drawing = draw.current;
                if (drawing && !drawing.drawn && Math.abs(event.clientX - drawing.x) >= DRAW_SLOP) {
                  drawing.drawn = true;
                }
                showGhost(event.clientX);
              }}
              // Not while a zoom is being drawn out: the pointer is captured, so
              // the drag continues over the bars and past the ends of the row,
              // and taking the outline down there would hide the one thing
              // saying how long the zoom is going to be.
              onPointerLeave={() => {
                if (!draw.current) showGhost(null);
              }}
              // The press is one edge of the zoom; the release is the other, and
              // a press that never travels is the click this row has always
              // taken. Nothing is added until then, so a drag is one thing in the
              // undo history rather than an add followed by a resize.
              //
              // Deliberately let through to the strip, which seeks: the playhead
              // belongs on the zoom being added, and where the gap is too small
              // to hold one the press has to still do something.
              onPointerDown={(event) => {
                if (slicing) return;
                draw.current = {
                  at: sourceAt(timeAt(event.clientX)),
                  x: event.clientX,
                  drawn: false,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerUp={(event) => {
                const drawing = draw.current;
                draw.current = null;
                if (!drawing) return;

                event.currentTarget.releasePointerCapture(event.pointerId);
                media.onInteract();
                dispatch({
                  type: "addZoom",
                  at: drawing.at,
                  ...(drawing.drawn ? { to: sourceAt(timeAt(event.clientX)) } : {}),
                });
                // The zoom itself is now drawn where the outline was, and the
                // project this closure can see is the one from before it existed
                // — so the outline would sit exactly on top of the new bar until
                // the pointer moved again.
                showGhost(null);
              }}
              onPointerCancel={() => {
                draw.current = null;
                showGhost(null);
              }}
            >
              {/* Stuck to the left edge of the scrollport and as wide as it, so
                the invitation stays in the middle of what is on screen however
                far the timeline is scrolled. */}
              {state.project.zooms.length === 0 && (
                <div
                  className="pointer-events-none sticky z-10 flex h-full items-center justify-center"
                  // Held clear of the rail rather than at the scrollport's own
                  // edge: `sticky` pins to the scroller, and the rail is the
                  // first forty pixels of it.
                  style={{ left: RAIL_W, width: timelineWidth }}
                >
                  <span className="flex items-center gap-1.5 rounded-lg border border-dashed border-white/15 px-3 py-1.5 text-[11px] text-editor-muted [&_svg]:size-3.5">
                    <ZoomIcon />
                    Click or drag to add a zoom effect
                  </span>
                </div>
              )}

              <ZoomGhost ref={ghost} />

              {state.project.zooms.map((zoom, index) => {
                // The whole span, not its two edges asked about separately. An
                // automatic zoom is placed against the recording and a later cut
                // can remove the moment it starts on — which used to leave the
                // bar undrawn while the zoom still occupied its source range, so
                // those seconds took clicks and did nothing at all.
                const span = spanInProject(placed, zoom.source);
                if (span === null) return null;
                const { start: from, end: to } = span;

                return (
                  <Zoom
                    key={zoom.id}
                    left={(from / Math.max(duration, 1)) * 100}
                    width={((to - from) / Math.max(duration, 1)) * 100}
                    room={((to - from) / NS_PER_SECOND) * pxPerSecond}
                    selected={zoom.id === state.selectedZoomId}
                    blade={
                      slicing
                        ? {
                            legal: (clientX) =>
                              zoomSplitAt(state.project, sourceAt(timeAt(clientX))) !== null,
                            cut: (clientX) => {
                              media.onInteract();
                              dispatch({ type: "splitZoom", at: sourceAt(timeAt(clientX)) });
                            },
                          }
                        : null
                    }
                    target={zoom.target}
                    method={zoom.method}
                    level={zoom.level}
                    curve={barCurve(envelope, reaches[index]!, ceiling)}
                    sourceAt={(clientX) => sourceAt(timeAt(clientX))}
                    timeAt={(clientX) => timeAt(clientX)}
                    start={from}
                    onSelect={() => {
                      media.onInteract();
                      dispatch({ type: "selectZoom", zoomId: zoom.id });
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setMenu({
                        x: event.clientX,
                        y: event.clientY,
                        kind: "zoom",
                        zoomId: zoom.id,
                      });
                    }}
                    onBeginEdit={() => dispatch({ type: "beginEdit" })}
                    onMove={(start) => dispatch({ type: "moveZoom", zoomId: zoom.id, start, snap })}
                    onTrim={(edge, clientX) =>
                      dispatch({
                        type: "trimZoom",
                        zoomId: zoom.id,
                        edge,
                        source: sourceAt(timeAt(clientX)),
                      })
                    }
                  />
                );
              })}
            </div>

            <div style={{ height: TRACK_GAP }} />

            {/* The music row, under the zooms and above the caption band.

              Last of the four, because it is the only one that is not about
              the picture: the clips are the footage, the zooms and the titles
              change what is seen, and this is what is heard underneath all of
              it.

              One `TRACK_GAP` above it, like every other band on the strip. It
              went in without one at first and the row read as part of the zoom
              row rather than as a row of its own — four bands with three gaps
              between them, one of which was missing.

              Pressing an empty stretch lays a bed down, the way the zoom and
              text rows do — with the default track, because a bed needs a file
              and a click that opened a file dialog out of an empty row would
              be a press with a sheet on the end of it. Which song it is is
              then one press away, in the panel the new bed opens.

              Not a drag, though. The other two rows draw a span out because
              their length is the whole of what is being asked for; a bed's
              length comes from the song, and the first thing anybody does to
              one is trim it anyway. */}
            <div
              className="relative"
              style={{ height: MUSIC_H }}
              // Where the press landed, and only a press that landed *here*.
              //
              // A bar stops the event, so this never fires for one — but the
              // release at the end of a drag on a bar's handle does bubble up
              // here, and acting on that release laid a fresh bed down every
              // time a bed was trimmed. It went into the nearest gap, which is
              // nowhere near the handle being dragged, so it read as a bed
              // appearing out of nothing.
              onPointerDown={(event) => {
                addAt.current = timeAt(event.clientX);
              }}
              onPointerUp={() => {
                const at = addAt.current;
                addAt.current = null;
                if (at === null || slicing || !onAddMusic) return;
                onAddMusic(at);
              }}
              // The system can take a gesture — a three-finger swipe over the
              // trackpad — and the release never arrives. Without this the
              // next release anywhere on the row would lay a bed at a position
              // the pointer left minutes ago.
              onPointerCancel={() => {
                addAt.current = null;
              }}
              onPointerLeave={() => {
                addAt.current = null;
              }}
            >
              {state.project.music.length === 0 && (
                <div
                  className="pointer-events-none sticky z-10 flex h-full items-center justify-center"
                  // Held clear of the rail rather than at the scrollport's own
                  // edge: `sticky` pins to the scroller, and the rail is the
                  // first forty pixels of it.
                  style={{ left: RAIL_W, width: timelineWidth }}
                >
                  <span className="flex items-center gap-1.5 rounded-lg border border-dashed border-white/15 px-3 py-1.5 text-[11px] text-editor-muted [&_svg]:size-3.5">
                    <MusicIcon />
                    Add Audio for background music
                  </span>
                </div>
              )}

              {state.project.music.map((bed) => {
                // Already in project time at both ends — see `MusicSlice`. No
                // `spanInProject` here, which is the whole difference between
                // this row and the two above it.
                const pixels = (bed.length / Math.max(duration, 1)) * contentWidth;

                return (
                  <MusicBar
                    key={bed.id}
                    left={(bed.at / Math.max(duration, 1)) * 100}
                    width={(bed.length / Math.max(duration, 1)) * 100}
                    pixels={pixels}
                    selected={bed.id === state.selectedMusicId}
                    muted={bed.muted || bed.volume <= 0}
                    blade={
                      slicing
                        ? {
                            legal: (clientX) =>
                              musicSplitAt(state.project, bed.id, timeAt(clientX)) !== null,
                            cut: (clientX) => {
                              media.onInteract();
                              dispatch({
                                type: "splitMusic",
                                musicId: bed.id,
                                at: timeAt(clientX),
                              });
                            },
                          }
                        : null
                    }
                    volume={bed.volume}
                    onVolume={(volume) =>
                      dispatch({ type: "setMusic", musicId: bed.id, patch: { volume } })
                    }
                    label={musicFileOf(state.project.musicFiles, bed)?.label ?? bed.file}
                    // The stretch of the *file* the bar shows, which is not where
                    // it sits on the timeline: the wave has to move under the bar
                    // as the left edge is dragged, because that is what trimming
                    // a bed does — see `trimMusic`.
                    peaks={musicPeaks.get(bed.file) ?? null}
                    from={bed.offset}
                    to={bed.offset + bed.length}
                    repeat={bed.repeat}
                    start={bed.at}
                    timeAt={timeAt}
                    onSelect={() => {
                      media.onInteract();
                      dispatch({ type: "selectMusic", musicId: bed.id });
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setMenu({
                        x: event.clientX,
                        y: event.clientY,
                        kind: "music",
                        musicId: bed.id,
                      });
                    }}
                    onBeginEdit={() => dispatch({ type: "beginEdit" })}
                    onMove={(at) => dispatch({ type: "moveMusic", musicId: bed.id, at, snap })}
                    onTrim={(edge, clientX) =>
                      dispatch({ type: "trimMusic", musicId: bed.id, edge, at: timeAt(clientX) })
                    }
                  />
                );
              })}
            </div>

            <div style={{ height: TRACK_GAP }} />

            <CaptionBand
              span={captionRange && spanInProject(placed, captionRange)}
              duration={duration}
            />
            <Shadow ref={shadow} labelRef={shadowTime} />
            <Playhead ref={media.playheadRef} labelRef={media.headTimeRef} />
          </div>
        </div>
      </div>

      {menu && (
        <>
          {/* Click-away, over everything — the same shape the frame bar's menu
              uses. `contextMenu` closes it too, so a second right-click
              somewhere else does not leave two open. */}
          <div
            className="fixed inset-0 z-40"
            onPointerDown={() => setMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu(null);
            }}
          />
          <ul
            role="menu"
            className={
              "fixed z-50 w-40 rounded-lg border border-editor-line bg-editor-panel p-1 " +
              "shadow-[0_8px_28px_rgba(0,0,0,0.5)]"
            }
            // Client coordinates, because this is `fixed`: the strip scrolls
            // under it and an anchored menu would ride away with the content.
            style={{ left: menu.x, top: menu.y }}
          >
            {menu.kind === "clip" ? (
              <>
                <MenuItem
                  label="Split here"
                  onClick={() => {
                    dispatch({ type: "split", at: menu.at });
                    setMenu(null);
                  }}
                />
                <MenuItem
                  danger
                  label="Delete clip"
                  onClick={() => {
                    dispatch({ type: "deleteSlice", sliceId: menu.sliceId });
                    setMenu(null);
                  }}
                />
              </>
            ) : menu.kind === "zoom" ? (
              <>
                <MenuItem
                  label="Duplicate"
                  onClick={() => {
                    dispatch({ type: "duplicateZoom", zoomId: menu.zoomId });
                    setMenu(null);
                  }}
                />
                <MenuItem
                  danger
                  label="Delete zoom"
                  onClick={() => {
                    dispatch({ type: "deleteZoom", zoomId: menu.zoomId });
                    setMenu(null);
                  }}
                />
              </>
            ) : menu.kind === "text" ? (
              <>
                <MenuItem
                  label="Duplicate"
                  onClick={() => {
                    dispatch({ type: "duplicateText", textId: menu.textId });
                    setMenu(null);
                  }}
                />
                <MenuItem
                  danger
                  label="Delete text"
                  onClick={() => {
                    dispatch({ type: "deleteText", textId: menu.textId });
                    setMenu(null);
                  }}
                />
              </>
            ) : (
              /* No Duplicate. A second copy of a bed would land on top of the
                 first, and the row holds one bed at a time — so the row would
                 either refuse it or put it somewhere nobody pointed at. */
              <MenuItem
                danger
                label="Delete audio"
                onClick={() => {
                  dispatch({ type: "deleteMusic", musicId: menu.musicId });
                  setMenu(null);
                }}
              />
            )}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * One row of a right-click menu.
 *
 * `danger` is muted until reached for, the way the inspector's delete is: a red
 * row sitting in an open menu shouts before anybody has decided anything.
 */
function MenuItem({
  label,
  danger,
  onClick,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        role="menuitem"
        className={cn(
          "w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors",
          danger ? "hover:bg-cut/20 hover:text-cut" : "hover:bg-white/10",
        )}
        onClick={onClick}
      >
        {label}
      </button>
    </li>
  );
}

function Ruler({
  duration,
  pxPerSecond,
  onSeek,
}: {
  duration: MediaTime;
  pxPerSecond: number;
  onSeek: (clientX: number) => void;
}) {
  const marks = ticks(duration, pxPerSecond);

  return (
    <div
      // Always seeks, whatever the tool is — a ruler that cut would be a trap.
      // No bottom rule: the gap below already separates it from the clips, and
      // a line as well boxes the ruler in rather than letting the ticks read as
      // marks on the timeline itself.
      className="relative cursor-default select-none"
      style={{ height: RULER_H + RULER_PAD }}
      onPointerDown={(event) => {
        // Stops the strip underneath seeking to the same place a second time.
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        onSeek(event.clientX);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) onSeek(event.clientX);
      }}
    >
      {/* The marks sit in the lower part of the box; the space above them is
          the same control, just empty. */}
      <div className="absolute inset-x-0 bottom-0" style={{ height: RULER_H }}>
        {marks.map((mark) => (
          <div
            key={mark.at}
            className="absolute inset-y-0"
            style={{ left: `${(mark.at / Math.max(duration, 1)) * 100}%` }}
          >
            {/* Hung from the top edge, so every tick starts on the same line
                and the ruler reads as a scale rather than a row of stubs. The
                minors were dots for a while — the same rhythm without the comb
                — but a dot has no top to hang from, so the two kinds sat on
                different lines and the row lost the scale it is there to be. */}
            <div
              className={cn(
                "absolute top-0 w-px",
                mark.major ? "h-2.5 bg-white/25" : "h-1.5 bg-white/12",
              )}
            />

            {/* Under its own tick rather than beside it at the top: a label
                above the mark it belongs to reads as belonging to the one
                before. */}
            {mark.label && (
              <span className="absolute bottom-0 left-1 text-[9px] leading-none tabular-nums text-editor-muted">
                {mark.label}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The playhead, with the time on it.
 *
 * The playback loop rewrites this element's `transform` once per frame, so it
 * follows the clock without a React render — and without a reflow, which is
 * what `left` would have cost.
 *
 * `will-change` is declared so the compositor gives it a layer up front rather
 * than promoting it on the first move, which shows as a stutter right as
 * playback starts.
 */
/**
 * The footage under the words selected in the captions editor.
 *
 * The full height of the strip rather than the clip row alone, and a sibling
 * of the playhead for exactly that reason. It marks a stretch of *time*, the
 * way the playhead marks an instant of it — the ruler above and the zooms
 * below are on that same clock, so stopping the band at the clips would make
 * the selection look like a property of one row.
 *
 * In the cut colour rather than the zoom's or the clip's: pressing Delete on
 * the selection is the one thing it enables, and that removes the footage.
 * Blue would read as a zoom about to be added. Under the playhead, which has
 * to stay legible across it, and taking no pointer events, so it changes
 * nothing about what a press on the strip does.
 *
 * Square, with an edge down each side and none across. The two sides are the
 * moments the cut would land on, and a rounded corner pulls the fill away
 * from them at exactly the point the eye is reading the time off the ruler.
 */
function CaptionBand({
  span,
  duration,
}: {
  span: { start: MediaTime; end: MediaTime } | null;
  duration: MediaTime;
}) {
  if (span === null) return null;

  return (
    <div
      className="pointer-events-none absolute inset-y-0 z-[5] border-x border-cut/60 bg-cut/20"
      style={{
        left: `${String((span.start / Math.max(duration, 1)) * 100)}%`,
        width: `${String(((span.end - span.start) / Math.max(duration, 1)) * 100)}%`,
      }}
    />
  );
}

function Playhead({
  ref,
  labelRef,
}: {
  ref: (element: HTMLElement | null) => void;
  labelRef: (element: HTMLElement | null) => void;
}) {
  return (
    <div
      ref={ref}
      // The label's own blue rather than the brighter one, so the head reads as
      // a single object — a line in one blue with a bubble in another on top of
      // it is two marks that happen to touch.
      className="pointer-events-none absolute inset-y-0 left-0 z-10 -ml-px w-0.5 bg-indicator-deep"
      style={{ willChange: "transform" }}
    >
      {/* The time, rather than the triangle that used to sit here. The head is
          where the eye already is while scrubbing, and a marker that only says
          "here" spends that attention on something the line has already said —
          the readout it sends you looking for is at the far end of the
          transport.

          Its own `transform`, written by the same loop: the label is centred on
          the line and clamped to the content, because the timeline scrolls and
          a label centred on a head at zero would be cut in half by the
          scroller's edge. The width is fixed for the same reason it is tabular
          — a label that resized as the digits changed would shimmy around the
          line it is meant to mark.

          White on `--indicator-deep` rather than near-black on `--indicator`:
          white over the bright blue is 2.9:1, the pairing the palette warns
          about for `--export`, so the label takes the blue a few steps down and
          reaches 5.4:1. The line keeps the bright one — a marker has to be
          found before it has to be read. */}
      <Timecode
        elementRef={labelRef}
        initial="0:00.00"
        className="absolute top-0 left-1/2 h-5 rounded-full bg-indicator-deep text-center text-[11px] leading-5 font-medium tabular-nums text-white"
        style={{
          width: HEAD_LABEL_W,
          transform: "translate3d(-50%, 0, 0)",
          willChange: "transform",
        }}
      />

      {/* The tail, hanging off the label onto the line.
          
          A sibling of the label rather than a child of it. That began as a
          hard constraint — the loop wrote the time with `textContent`, which
          would have taken any child of that span with it on the first frame —
          and `Timecode` writes cells now, so it is only the better place: a
          tail should point at the *line*, and the label is nudged sideways by
          half its own width, so the line never leaves it.

          Curved rather than a triangle: the sides ease out of the label's own
          rounded edge, where a straight taper reads as a second shape stuck
          underneath it. */}
      <svg
        aria-hidden
        viewBox="0 0 12 7"
        className="pointer-events-none absolute top-5 left-1/2 h-[7px] w-3 -translate-x-1/2 text-indicator-deep"
      >
        <path d="M0 0C3.2 0 4.4 7 6 7C7.6 7 8.8 0 12 0Z" fill="currentColor" />
      </svg>
    </div>
  );
}

/**
 * The hover line: where the preview is looking, without having gone there.
 *
 * Deliberately not the playhead's own shape. It is thinner, has no handle at the
 * top, and now a hue of its own — the difference that matters is "this is a
 * look, not a position", and two lines a shade apart left the user hunting for
 * which one the edit would act on. Red separates them at a glance where dimming
 * only made this one look like a faded playhead.
 *
 * The same red as a cut, which is the one thing to watch here: that colour
 * means destructive elsewhere in this row. It reads as a pointer rather than a
 * mark because it is one pixel wide, follows the cursor and vanishes with it.
 * Drawn under the playhead so the real one wins when they meet.
 *
 * Line and label share `--cut-deep` so the two are one object, the way the
 * playhead's are — a line in one red under a bubble in another is two marks
 * that happen to touch.
 */
function Shadow({
  ref,
  labelRef,
}: {
  ref: RefObject<HTMLDivElement | null>;
  labelRef: RefObject<HTMLSpanElement | null>;
}) {
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-y-0 left-0 z-0 w-px bg-cut-deep opacity-0"
      style={{ willChange: "transform, opacity" }}
      aria-hidden="true"
    >
      {/* The playhead's label in the other colour, and for the same reason: the
          eye is already at the line, and the number it wants is otherwise at
          the far end of the transport. Where the head's says where you *are*,
          this says where you would be — so it has to be legible at a glance and
          unmistakable for the head sitting beside it.

          Written by `showShadow` rather than from a render: it changes on every
          `pointermove` across the strip. */}
      <span
        ref={labelRef}
        className="absolute top-0 left-1/2 h-5 rounded-full bg-cut-deep text-center text-[11px] leading-5 font-medium tabular-nums text-white"
        style={{ width: HEAD_LABEL_W, transform: "translate3d(-50%, 0, 0)" }}
      />

      {/* Centred on the line rather than hung off the label, for the reason the
          playhead's is: the label is nudged sideways at the ends of the strip
          and the line is not, and a tail should point at the line. */}
      <svg
        viewBox="0 0 12 7"
        className="absolute top-5 left-1/2 h-[7px] w-3 -translate-x-1/2 text-cut-deep"
      >
        <path d="M0 0C3.2 0 4.4 7 6 7C7.6 7 8.8 0 12 0Z" fill="currentColor" />
      </svg>
    </div>
  );
}

/**
 * How far a press has to travel before it is a reorder rather than a click.
 *
 * A clip is pressed to select it and to scrub inside it, and a pointer that
 * moves a pixel while a finger lifts is still a click. Without this every such
 * press ended somewhere in the order.
 */
const REORDER_SLOP = 6;

/** Where a carried clip would land. */
function DropLine() {
  return (
    <div
      aria-hidden
      // Negative margins so it sits *in* the gap rather than widening the row:
      // the clips are laid out by percentage of the duration, and a line that
      // took width of its own would shorten every one of them while it showed.
      className="z-10 -mx-px w-0.5 flex-none rounded-full bg-selected"
    />
  );
}

function Clip({
  slice,
  duration,
  peaks,
  filmstrip,
  framesPending,
  contentWidth,
  cameraSpans,
  clicks,
  selected,
  blade,
  audio,
  onVolume,
  onPointerDown,
  onDrag,
  onDrop,
  carried,
  onContextMenu,
  onTrim,
  onBeginEdit,
  onEndEdit,
}: {
  slice: PlacedSlice;
  duration: MediaTime;
  peaks: Float32Array | null;
  filmstrip: Filmstrip | null;
  /** Whether a sheet is still coming — see `FilmstripState`. */
  framesPending: boolean;
  /** The strip's full width in pixels, which is what the zoom actually sets. */
  contentWidth: number;
  cameraSpans: readonly { start: MediaTime; end: MediaTime }[];
  /** Every press the recording saw, in source time — see `clickMarks`. */
  clicks: readonly MediaTime[];
  selected: boolean;
  /** The blade, while it is held: a press cuts the clip instead of taking it
      up, and the two grips go with the gesture they belonged to. */
  blade: Blade | null;
  /**
   * This clip's two track volumes, resolved — its own overrides over the
   * project's defaults.
   *
   * Both, because the line shows the louder and moves them together; see
   * `scaledAudio` for why it is not simply the one number.
   */
  audio: { mic: number; system: number };
  /**
   * The line has been dragged to a level. Both tracks move with it.
   *
   * `from` is the pair as they were when the drag started, not as they are
   * now. Scaling against the live values compounds: dragged to silence, the
   * ratio between the two is gone, and dragging back up brings them up equal
   * — a balance set in the panel, lost to one gesture that looked reversible.
   */
  onVolume: (level: number, from: { mic: number; system: number }) => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  /** The body is being dragged along the row, to put the clip somewhere else. */
  onDrag: (event: PointerEvent<HTMLDivElement>) => void;
  onDrop: () => void;
  /** True while this clip is the one being carried. */
  carried: boolean;
  /** Right-clicked, with the pointer's position so a menu can open under it. */
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
  /** An edge has been dragged to a source time. Clamping is the reducer's job. */
  onTrim: (edge: "start" | "end", source: MediaTime) => void;
  /** A drag is beginning, so its stream of trims is one step to undo. */
  onBeginEdit: (edge: "start" | "end") => void;
  /** The drag is over, so the strip can go back to following the edit. */
  onEndEdit: () => void;
}) {
  /**
   * Where the drag started. Null between drags.
   *
   * A ref rather than state: this is written on `pointerdown` and read on every
   * `pointermove`, and re-rendering the clip to record where a gesture began
   * would rebuild its filmstrip and wave for no visible change.
   */
  const grabbed = useRef<TrimGrab | null>(null);

  /** The two levels as the volume drag found them — see `onVolume`. */
  const before = useRef(audio);

  /** The wash over the part a cut would separate off — see `CutShade`. */
  const shade = useRef<HTMLSpanElement>(null);

  const grab = (edge: "start" | "end") => (event: PointerEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    grabbed.current = {
      source: slice.source[edge],
      clientX: event.clientX,
      // The strip's scale, taken now and held for the drag — see `trimmedTo`.
      perPixel: contentWidth > 0 ? duration / contentWidth : 0,
    };
    onBeginEdit(edge);
  };

  const move = (edge: "start" | "end") => (event: PointerEvent<HTMLSpanElement>) => {
    const from = grabbed.current;
    if (from === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.stopPropagation();
    onTrim(edge, trimmedTo(from, event.clientX));
  };

  // `pointercancel` as well as `pointerup`: a drag that leaves through a
  // gesture the system claims — a three-finger swipe over the trackpad — gets
  // no `pointerup` at all, and the strip would stay frozen at the length it had
  // when the drag began until the next one released it.
  const release = () => {
    if (grabbed.current === null) return;
    grabbed.current = null;
    onEndEdit();
  };

  // Rebuilt only when the clip's own span moves — trimming an edge, or a cut
  // that gives it a new range. Zooming and scrolling do not touch it: the path
  // is drawn in a unit box and the SVG stretches it, so the work of resizing
  // stays in the compositor rather than coming back through React.
  const wave = useMemo(
    () => (peaks === null ? "" : wavePath(peaks, slice.source.start, slice.source.end)),
    [peaks, slice.source.start, slice.source.end],
  );

  // The clip's width in real pixels, which is the only thing the zoom changes
  // about the strip. Derived rather than measured: reading it off the element
  // would need a layout flush per clip per zoom step, and the number is already
  // known — a clip's share of `contentWidth`.
  const widthPx = duration > 0 ? (slice.duration / duration) * contentWidth : 0;
  // Room for a chip and something beside it — the same threshold the three bar
  // rows use, so every row on the strip loses its chips at the same width.
  const roomy = widthPx >= 110;

  // Recomputed on zoom, which is the point: more room means more frames. Cheap
  // enough to do in render — it is one loop over the columns that will be drawn,
  // and it produces no images, only offsets into a sheet that already exists.
  const strip = useMemo(
    () => (filmstrip === null ? [] : thumbs(slice, widthPx, filmstrip.cadence)),
    [filmstrip, slice, widthPx],
  );

  // Thinned against the clip's current width, so zooming in parts a cluster
  // into the presses it was made of rather than redrawing the same dot wider.
  const marks = useMemo(
    () => clickMarks(clicks, slice, widthPx, CLICK_GAP),
    [clicks, slice, widthPx],
  );

  // Overlap rather than "was a camera recorded": a clip trimmed to the first
  // moments of the take can sit entirely before the camera opened, and an icon
  // promising footage that is not in this clip is worse than no icon.
  const hasCamera = cameraSpans.some(
    (span) => slice.source.start < span.end && slice.source.end > span.start,
  );

  return (
    <div
      className={cn(
        "group relative min-w-1 overflow-hidden rounded-lg border",
        "transition-[background-color,border-color,outline-color]",
        // Two solid steps of the same purple, not one pair dimmed — see
        // `--slice-fill`. This is what says "selected"; the ring below says
        // "the pointer is talking to this one", and they are different
        // questions. Hover deliberately does *not* take the active pair: it
        // already draws the full ring, and brightening the fill as well would
        // make a hovered clip identical to the selected one.
        selected
          ? "border-slice-edge-active bg-slice-fill-active"
          : "border-slice-edge bg-slice-fill",
        // `outline` rather than `border` or `ring` because an outline is
        // painted after the element's children — so it runs across the two
        // handle bands instead of stopping short of them, and the clip reads
        // as one ringed shape rather than a body with two bare caps.
        //
        // Hover and selection are drawn identically, deliberately. The ring is
        // the answer to "which clip is this pointer talking to", and a dimmer
        // version of it for hover made that answer arrive in two strengths for
        // no difference the user acts on.
        // `outline-transparent` belongs to the unselected branch, not beside
        // the width. Both it and `outline-slice-ring` are plain `outline-color`
        // utilities of equal specificity, so which one wins is decided by the
        // order Tailwind emits them in its own stylesheet and not by the order
        // they are written here — and it emitted the transparent one last. The
        // selected clip lost its ring outright, while hover kept one, because
        // `hover:` adds a pseudo-class and outranks them both. Nothing about
        // the class list looked wrong.
        // The offset is the outline's full width, not half of it.
        // `outline-offset` moves the *outline edge*, and the ring is painted
        // outward from there — so at `-1` with a 2px outline a pixel of it
        // lands outside the box. Between clips that overhang is invisible, it
        // falls on the neighbour; on the first and last it lands outside the
        // scroller's content box, where `overflow-x` clips it, and the ring
        // came out cut off down the two edges of the screen and nowhere else.
        // At `-2` it ends flush with the box and is wholly inside it.
        "outline-2 -outline-offset-2",
        // With the blade in hand the ring answers a different question, so it
        // is a branch rather than another class in the list: not "which clip is
        // the pointer talking to" but "will this press cut here". Red, as the
        // caption band's is, because the answer is destructive — and dark again
        // the moment the pointer is somewhere a cut would be declined.
        //
        // Hover is deliberately dropped with it: a ring that said "this can be
        // picked up" under a cursor that says it is about to cut would be the
        // clip offering a gesture it no longer takes. An attribute selector
        // outranks the bare class beside it, so which of the two wins is
        // specificity rather than the order Tailwind emits them — see the note
        // above about exactly that going wrong.
        blade
          ? "outline-transparent data-[cut=true]:outline-cut"
          : selected
            ? "outline-slice-ring"
            : "outline-transparent hover:outline-slice-ring",
        // Lifted, so the row shows which clip the drop line belongs to. The
        // clip stays where it is rather than following the pointer: it is the
        // *order* being chosen, and a clip dragged free of the row would have
        // to invent a width for a gap that does not exist yet.
        carried && "opacity-40",
      )}
      style={{
        width: `${(slice.duration / Math.max(duration, 1)) * 100}%`,
        // All four sides, so the clip reads as a framed picture. It used to be
        // the top and bottom only, which was invisible while the caps covered
        // the sides at rest — now that they fade out, a 1px side against a 2px
        // top reads as a rendering fault. Set here rather than as a border
        // utility so `CLIP_EDGE` stays the one place the thickness lives: the
        // row height is derived from it.
        borderWidth: CLIP_EDGE,
      }}
      // The blade's three handlers in place of the gesture's, rather than
      // beside it: a press that both cut the clip and picked it up would
      // reorder the halves it had just made.
      onPointerDown={(event) => {
        if (!blade) {
          onPointerDown(event);
          return;
        }
        // Stops the strip underneath seeking to the cut as well as making it.
        // The playhead staying put is what lets several cuts be made in a row
        // without the preview jumping to each one.
        event.stopPropagation();
        blade.cut(event.clientX);
      }}
      onPointerMove={(event) => {
        if (blade) aim(blade, event, shade);
        else onDrag(event);
      }}
      onPointerUp={blade ? undefined : onDrop}
      // `pointerleave` rather than `pointerout`, which fires on the way into a
      // child too and would blink the ring off over the clip's own handles.
      onPointerLeave={blade ? (event) => aim(null, event, shade) : undefined}
      // A drag the system claims mid-gesture gets no `pointerup`, and the row
      // would keep showing a drop line for a clip nobody is holding.
      onPointerCancel={blade ? undefined : onDrop}
      onContextMenu={onContextMenu}
    >
      {/* The recording's frames, as the clip's own backdrop.

          One sheet for the whole take, shifted per column — so zooming changes
          how many of these there are and never asks for another decode. Each is
          a plain div rather than an `img`: the sheet is one image the browser has
          already decoded once, and `background-position` picks a frame out of it
          without a second copy per thumbnail.

          Behind everything else, and dimmed hard: this is orientation, not
          content. At full strength it competes with the wave and makes the
          label unreadable over a bright frame. */}
      {filmstrip !== null &&
        strip.map((thumb) => (
          <div
            key={thumb.x}
            className="pointer-events-none absolute top-0 opacity-35"
            style={{
              left: thumb.x,
              width: THUMB_WIDTH,
              height: "100%",
              backgroundImage: `url(${filmstrip.sheet})`,
              // The sheet's own size, unscaled. Cells were cropped to exactly
              // this box when they were drawn, so any scaling here would both
              // resample the frame and put the sprite offsets out of step with
              // it — the strip would show slivers of two frames per cell.
              backgroundSize: "auto",
              backgroundPosition: `-${String(thumb.index * THUMB_WIDTH)}px 0`,
              backgroundRepeat: "no-repeat",
            }}
            aria-hidden="true"
          />
        ))}

      {/* Standing in for the frames until there are some.
          A band of light rather than a grid of grey boxes: the clip is already a
          shape with a fill and a border, so what is missing is the picture inside
          it and not the clip. The same sheen the export's still carries while it
          renders, and the same reason — it says "this is still arriving" without
          laying anything out. The sheet is now built only after the preview has
          revealed, so this is on screen long enough to be worth drawing. */}
      {filmstrip === null && framesPending && (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-1/3 animate-sheen bg-gradient-to-r from-transparent via-white/10 to-transparent motion-reduce:hidden"
          aria-hidden="true"
        />
      )}

      {/* The clip's audio, standing on its floor.
          `preserveAspectRatio="none"` is the whole trick: the path is built
          once in a 0–1 box and the browser stretches it to whatever width the
          zoom has given the clip, so scrubbing the zoom does not rebuild a
          path per clip per frame. `vectorEffect` is deliberately absent — this
          is a fill, and nothing here is stroked. */}
      {wave && (
        <svg
          // `w-full` rather than `inset-x-0`: an SVG is a replaced element with
          // an intrinsic aspect ratio, and an absolutely positioned replaced
          // element with `left`/`right` but no width does not stretch between
          // them — CSS resolves the width from the ratio and anchors it left.
          // The wave then draws into a box as wide as it is tall, bunched in
          // the corner, with `preserveAspectRatio` never getting a say.
          className="pointer-events-none absolute bottom-0 left-0 w-full text-wave opacity-40"
          // As tall as the volume line is high. The line is the ceiling of the
          // sound, so the wave under it has to be drawn against that ceiling —
          // a clip pulled down to a quarter whose wave kept its full height
          // would be a bar saying two different things about the same number.
          style={{ height: `${String(waveHeight(Math.max(audio.mic, audio.system)))}%` }}
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d={wave} fill="currentColor" />
        </svg>
      )}

      {/* A dot for every press the recording saw, along the top of the footage.

          The raw signal the first cut was built from, which is why it is on the
          clip and not on the zoom row: a zoom is a decision and can be moved or
          deleted, while a press is something that happened to this footage and
          travels with it through every trim and cut.

          Along the top because the bottom is the waveform's and the middle is
          the label's — and because the top edge is where the eye already is when
          it is reading the ruler above. Thinned by `clickMarks`; a cluster is one
          dot until the zoom gives it room to be several.

          `clamp` so a press in the clip's first or last frames still draws a
          whole dot: the dot is centred on its moment, the clip clips what
          overflows, and a half dot against the frame reads as a rendering fault
          rather than as a click right at the cut. */}
      {marks.length > 0 &&
        marks.map((fraction) => (
          <span
            key={fraction}
            className="pointer-events-none absolute -translate-x-1/2 rounded-full bg-slice-ring/80"
            style={{
              left: `clamp(${String(CLICK_DOT)}px, ${String(fraction * 100)}%, calc(100% - ${String(CLICK_DOT)}px))`,
              top: CLICK_DOT,
              width: CLICK_DOT,
              height: CLICK_DOT,
            }}
            aria-hidden="true"
          />
        ))}

      {/* The chip and how long the clip runs — the shape every other bar on
          the strip wears, so four rows of different things read as four of one
          kind. Centred and held off both ends by `LABEL_INSET`, like the rest.

          The chip is darker here than on the flat bars. Those are one colour
          and a quarter-black square reads against them; this one sits over
          frames of somebody's recording, which can be any colour at all, so it
          carries its own contrast rather than borrowing the bar's.

          The screen glyph is always the one in the chip — a take without one
          is not something this app records — and the camera appears beside the
          words when there is one, which is the only part that is news.

          Nothing is `truncate`d away before the chip: on a clip too narrow for
          the words the glyph is what is left, and it is the half that still
          says what the row holds. */}
      <div
        className="pointer-events-none absolute inset-0 flex items-center gap-1.5 text-[11px] font-medium text-white"
        style={{ paddingInline: LABEL_INSET }}
      >
        {roomy && (
          <span className="grid size-6 flex-none place-items-center rounded-lg bg-black/40 [&_svg]:size-3.5">
            <ScreenIcon />
          </span>
        )}
        {!roomy && (
          <span className="flex-none [&_svg]:size-3">
            <ScreenIcon />
          </span>
        )}
        {hasCamera && (
          <span className="flex-none [&_svg]:size-3">
            <CameraIcon />
          </span>
        )}
        <span className="truncate tabular-nums">{formatTimecode(slice.duration)}</span>
      </div>

      {/* No line while the blade is out: the two gestures are both a press on
          the body of the clip, and the one that cuts has to win. */}
      {!blade && (
        <VolumeLine
          level={Math.max(audio.mic, audio.system)}
          colour="bg-slice-ring"
          onBegin={() => (before.current = audio)}
          onChange={(level) => onVolume(level, before.current)}
        />
      )}

      {/* Shown with the pointer, not at rest. The clip is already framed on
          every side, so a cap is a trim target rather than the edge itself —
          and one drawn permanently put a heavy block at both ends of every
          clip in the row, saying "this can be dragged" about all of them at
          once. They stay grabbable while invisible; see `Handle`.

          Gone with the blade in hand: a grip is twelve pixels of the clip
          where a press resizes rather than cuts, and
          the two ends of a clip are exactly where somebody aiming a blade means
          to land. */}
      {!blade && (
        <>
          <Handle
            edge="start"
            grip="bg-slice-edge-active"
            selected={selected}
            onPointerDown={grab("start")}
            onPointerMove={move("start")}
            onRelease={release}
          />
          <Handle
            edge="end"
            grip="bg-slice-edge-active"
            selected={selected}
            onPointerDown={grab("end")}
            onPointerMove={move("end")}
            onRelease={release}
          />
        </>
      )}

      {/* Last, so it washes over the frames, the wave and the label alike
          rather than sliding under them. Only with the blade in hand: it is
          one element, but one per clip on a row of fifty is fifty. */}
      {blade && <CutShade ref={shade} />}
    </div>
  );
}

/**
 * A draggable end of a clip or a zoom.
 *
 * A grip and a hit area, and no plate behind it. A solid band was here for a
 * while so that the edge and the handle would be one shape; what it actually
 * did was put a heavy block at both ends of every bar in the row, competing
 * with the frame that already says where the bar ends.
 *
 * Wide enough to grab, and wider than it looks: the grip is 2px and this is
 * 12px, because a target the size of its own artwork is one the pointer misses.
 *
 * **The hit area is the edge, not the artwork.** The grip is drawn only where a
 * bar is wide enough to carry one without the two meeting in the middle — see
 * `grips` — and an end that draws nothing is still grabbed by hovering it. The
 * two were one decision before, so a zoom shorter than 36 pixels had no way to
 * be retimed at all: no grips, no targets, and no length field anywhere else in
 * the editor to reach for.
 */
/**
 * The level line across a clip or a bed, dragged up and down.
 *
 * Where every editor people arrive from puts volume: on the thing itself,
 * rather than only in a panel. The panel's faders still exist and are the only
 * way to set the two tracks of a clip apart — see `scaledAudio` — and this is
 * the coarse one, for "that is too loud" while looking at the strip.
 *
 * Drawn at rest only when the level is not unity. A quiet clip has to *look*
 * quiet, and a line across every bar on the timeline all the time would be a
 * second horizon on a row that already has a waveform. Hovering brings it up
 * whatever the level, which is what makes it findable.
 *
 * The hit band is thicker than the line and is what takes the press. It stops
 * the event: the bar underneath picks itself up when pressed, and a drag meant
 * for the level would otherwise carry the whole clip sideways.
 */
function VolumeLine({
  level,
  colour,
  onBegin,
  onChange,
}: {
  /** 0 to `MAX_LEVEL`, where 1 is the sound as it was recorded. */
  level: number;
  /** The bar's own edge colour, so the line reads as part of it. */
  colour: string;
  /**
   * A drag is starting, so the edit before it is the one undo comes back to.
   *
   * Only where the change is banked at all. A bed's level is, and without this
   * a drag of the line and a drag of the panel's fader would coalesce into one
   * step; a clip's volumes are an appearance setting and are not banked, like
   * every other setting on a clip.
   */
  onBegin?: () => void;
  onChange: (level: number) => void;
}) {
  const box = useRef<HTMLSpanElement>(null);
  /** The bubble, moved by hand — see `follow`. */
  const bubble = useRef<HTMLSpanElement>(null);
  /** Where the pointer last was, for the frame the bubble appears on. */
  const at = useRef(0);
  /** The sliding readout, written to rather than rendered — see `Timecode`. */
  const readout = useRef<HTMLElement | null>(null);
  /**
   * The bar's box, read once a gesture rather than once a move.
   *
   * `getBoundingClientRect` flushes layout, and this used to be called twice
   * per `pointermove` — once to turn the pointer into a level, once to place
   * the bubble — in between two writes to the DOM. A layout read next to a
   * layout write is the one thing the editor's own rules say never to do in a
   * loop, and a trackpad sends moves at 120 a second.
   *
   * Safe to hold for the length of a drag: the pointer is captured, so nothing
   * can scroll the strip under it, and the bar itself cannot move while it is
   * being dragged. Re-read on every hover move, where there is one read and no
   * write and the strip may well have scrolled since.
   */
  const bar = useRef<DOMRect | null>(null);
  /**
   * The level waiting to be committed, and the frame that will commit it.
   *
   * One edit per frame rather than one per move. Each one rewrites the project
   * and re-renders the strip — the clip's filmstrip columns are recomputed,
   * the waves are rebuilt — and at 120 moves a second that is twice the work
   * anybody can see, which is what made the drag feel like it was catching.
   */
  const pending = useRef<number | null>(null);
  const frame = useRef(0);

  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);

  /** The bar's box, from the cache while a drag holds it. */
  const barBox = (): DOMRect | null => {
    if (bar.current) return bar.current;

    const rect = box.current?.parentElement?.getBoundingClientRect() ?? null;
    return rect;
  };

  const levelFrom = (clientY: number, rect: DOMRect): number =>
    levelAt(rect.height > 0 ? (clientY - rect.top) / rect.height : 0);

  const commit = () => {
    frame.current = 0;
    const level = pending.current;
    pending.current = null;
    if (level !== null) onChange(level);
  };

  /** Holds the newest level for the next frame, and asks for one. */
  const queue = (next: number) => {
    pending.current = next;
    frame.current ||= requestAnimationFrame(commit);
  };

  // Nothing left in flight when the bar goes — a frame that fires after the
  // clip it belonged to has been cut would write a level onto a slice that is
  // no longer there.
  useEffect(
    () => () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    },
    [],
  );

  /**
   * Puts the bubble over the pointer, on the line.
   *
   * Written straight to the element rather than through state, for the reason
   * the strip's own hover line is: `pointermove` fires far more often than a
   * frame, and a render per move would rebuild the clip's filmstrip and wave
   * to move a label.
   *
   * Client coordinates, because the bubble is `fixed`. Every bar on the strip
   * is `overflow-hidden` — it has a filmstrip and a wave to keep inside itself
   * — and a bubble positioned within one would be cut off by it: there is not
   * room above the line for a label and its tail at any level below about
   * three-quarters. Fixed is also what the timeline's context menu does, and
   * for the same reason.
   *
   * The y is worked out from the bar's box and the level rather than read off
   * the band, which moves as the level changes — and reading a box that is
   * mid-move is a read of where it was a frame ago.
   */
  const follow = (clientX: number, rect: DOMRect | null, shown: number) => {
    at.current = clientX;

    const element = bubble.current;
    if (!element || !rect) return;

    element.style.left = `${String(clientX)}px`;
    element.style.top = `${String(rect.top + levelY(shown) * rect.height)}px`;
  };

  const showing = dragging || hovering;

  // Placed the moment it appears, not on the next move. The pointer entering
  // is what mounts it, and the ref is still null inside that handler — so
  // without this the bubble draws once at wherever the layout happened to put
  // it, which is the left-hand end of the bar, and only snaps to the pointer
  // if the pointer moves again.
  useLayoutEffect(() => {
    if (showing) follow(at.current, barBox(), level);
  });

  // The level, into the readout. Through `writeTicker` because the digits are
  // a column of ten that slides, and a column cannot be re-rendered into place
  // — the component owns the DOM under it and asks to be written to instead.
  //
  // An *ordinary* effect, deliberately. `Timecode` registers its writer in one
  // of these, and React runs a child's effects before its parent's — so a
  // layout effect here runs first, finds no writer, and falls back to setting
  // `textContent`. That replaces the column of digits with a text node: the
  // reading then shows the level it had when it opened and never changes
  // again, because every later write goes to cells that are no longer in the
  // document. Nothing throws; the number simply stops moving.
  useEffect(() => {
    if (readout.current) writeTicker(readout.current, percent(level));
  }, [level]);

  return (
    <span
      ref={box}
      className={cn(
        "absolute inset-x-0 z-10 flex cursor-ns-resize items-center",
        // Only while the pointer is on the bar, or holding the line. A line
        // across every bar at rest is a second horizon on a row that already
        // has a waveform, and the wave is drawn to the level anyway — a quiet
        // clip still looks quiet with nothing to hover.
        "opacity-0 transition-opacity group-hover:opacity-100",
        showing && "opacity-100",
      )}
      // Centred on the level by arithmetic rather than by `-translate-y-1/2`.
      // A transform on this span would make it the containing block for the
      // `fixed` bubble inside it — which stops being viewport-relative and
      // starts being clipped by the bar's `overflow-hidden`, so the reading
      // simply never appears. Nothing says so; it is just not there.
      style={{
        top: `calc(${String(levelY(level) * 100)}% - ${String(VOLUME_GRAB / 2)}px)`,
        height: VOLUME_GRAB,
      }}
      onPointerLeave={() => setHovering(false)}
      onPointerDown={(event) => {
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        // The one read of the gesture. See `bar`.
        bar.current = box.current?.parentElement?.getBoundingClientRect() ?? null;
        setDragging(true);
        onBegin?.();
      }}
      onPointerMove={(event) => {
        // The move rather than the enter. `pointerenter` is one event at the
        // edge of the band, and a React state update hung off it is lost the
        // moment anything re-renders the bar under a pointer that has not
        // moved since — which the hover itself causes, because the preview
        // follows it. A move is sent continuously and puts it back.
        setHovering(true);

        const rect = barBox();
        if (!event.currentTarget.hasPointerCapture(event.pointerId) || !rect) {
          follow(event.clientX, rect, level);
          return;
        }

        event.stopPropagation();
        const next = levelFrom(event.clientY, rect);
        // The bubble goes with the pointer now rather than a frame later: it
        // is a DOM write of two numbers, and waiting for the commit would
        // leave the label trailing the line it is pinned to.
        follow(event.clientX, rect, next);
        queue(next);
      }}
      onPointerUp={() => {
        bar.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        bar.current = null;
        setDragging(false);
      }}
    >
      <span className={cn("pointer-events-none h-px w-full", colour)} />

      {/* The reading, on the line under the pointer.

          The playhead's shape and the playhead's size — a pill with a tail
          curving out of its own edge, twenty pixels tall, its digits sliding
          as they change. It answers the same kind of question in the same
          place, and a second kind of bubble on one strip is a second thing to
          learn. Near-black rather than the playhead's blue: that blue is the
          playhead's identity, and this one has to sit over a purple clip and a
          teal bed without becoming either.

          Fixed width, for the reason the playhead's label has one: the number
          is rewritten continuously while the line is dragged, and a box that
          resized as the digits changed would shimmy around the pointer it is
          meant to be pinned to.

          Always mounted, and hidden by opacity. It has to animate *out* as
          well as in, and an element React has already removed cannot.
          `pointer-events-none` throughout, so an invisible one over the strip
          catches nothing. */}
      <span
        ref={bubble}
        className={cn(
          "pointer-events-none fixed z-50 origin-bottom -translate-x-1/2 -translate-y-full pb-[7px]",
          // Out of the line and back into it: the box's bottom edge is the tip
          // of the tail, which sits on the line, so scaling about it is the
          // bubble growing out of the line rather than appearing over it.
          "transition-[opacity,transform] duration-150 ease-out",
          showing ? "scale-100 opacity-100" : "scale-75 opacity-0",
        )}
      >
        <span
          className="flex h-5 items-center justify-center gap-1 rounded-full bg-black/85 text-[11px] leading-5 font-medium tabular-nums text-white [&_svg]:size-3 [&_svg]:text-white/70"
          style={{ width: VOLUME_LABEL_W }}
        >
          <SpeakerIcon />
          {/* The playhead's own readout, so the digits turn rather than
              swapping — see `Timecode`. Written through `writeTicker` from the
              effect below rather than rendered, because that is the one way in
              that a sliding column understands. */}
          <Timecode
            elementRef={(element) => {
              readout.current = element;
            }}
            initial={percent(level)}
          />
        </span>

        {/* The tail, hanging off the pill onto the line. Curved rather than
            a triangle: the sides ease out of the pill's own rounded edge,
            where a straight taper reads as a second shape stuck underneath
            it. The playhead's own path, at the playhead's size. */}
        <svg
          aria-hidden
          viewBox="0 0 12 7"
          className="absolute bottom-0 left-1/2 h-[7px] w-3 -translate-x-1/2 text-black/85"
        >
          <path d="M0 0C3.2 0 4.4 7 6 7C7.6 7 8.8 0 12 0Z" fill="currentColor" />
        </svg>
      </span>
    </span>
  );
}

function Handle({
  edge,
  grip,
  grips = true,
  room,
  selected,
  onPointerDown,
  onPointerMove,
  onRelease,
}: {
  edge: "start" | "end";
  /**
   * The bar's own edge colour, as a background class.
   *
   * White for both used to be the same white on a purple clip and an amber
   * zoom, so the grip read as a third thing laid over the bar rather than as
   * the end of it. Matching the outline it interrupts makes it part of the
   * frame that already says where the bar stops.
   *
   * The *active* edge in both states, not the one the bar happens to be
   * wearing: a grip only shows when the bar is selected or under the pointer,
   * and drawing it in the resting colour at exactly the moments the bar is not
   * resting made it the faintest thing on the bar it had just been summoned to.
   */
  grip: string;
  /**
   * Whether this end draws its grip, as opposed to merely being one.
   *
   * A judgement about crowding and nothing else: two 2px lines a few pixels
   * apart read as noise rather than as two ends. What it must never decide is
   * whether the end can be dragged.
   */
  grips?: boolean;
  /**
   * How wide the bar comes out, in pixels, where the caller knows.
   *
   * The target takes `HANDLE_SHARE` of it at most, so the two ends of a short
   * bar never overlap each other and never meet in the middle: half the bar is
   * always left to pick it up by, and the end drawn second stops winning every
   * press — which is what made a drag at a short zoom trim it instead.
   */
  room?: number;
  selected: boolean;
  onPointerDown: (event: PointerEvent<HTMLSpanElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLSpanElement>) => void;
  /** The drag ended, however it ended. Absent on the zoom row, which has
      nothing held open for the length of a drag to put back. */
  onRelease?: () => void;
}) {
  return (
    <span
      className={cn(
        "absolute inset-y-0 grid cursor-ew-resize place-items-center",
        edge === "start" ? "left-0" : "right-0",
      )}
      style={{
        width: room === undefined ? HANDLE_WIDTH : Math.min(HANDLE_WIDTH, room * HANDLE_SHARE),
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onRelease}
      onPointerCancel={onRelease}
    >
      {/* Faded rather than unmounted, and the hit area around it never fades at
          all: an edge that only becomes grabbable once it is visible is one the
          first drag at it always misses. */}
      {grips && (
        <span
          className={cn(
            "h-1/2 w-0.5 rounded-full transition-opacity",
            grip,
            selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        />
      )}
    </span>
  );
}

/**
 * The zoom a click would add, under the pointer.
 *
 * Dashed and translucent so it reads as a proposal rather than as something
 * already there. Positioned by hand rather than through React — see `showGhost`.
 *
 * Labelled, because an empty dashed box under the pointer reads as a hover
 * highlight — something the row is doing — rather than as the thing a click
 * puts there. The label is laid out the way a zoom's own is, so a click
 * replaces the outline with a bar of the same shape carrying the same glyph,
 * and the only thing that changes is that it is now solid. Truncated for the
 * reason the bar's is: fitted into a gap half a second wide, the outline is a
 * few pixels across and the words have to fall away rather than spill over
 * the zooms either side.
 */
/**
 * One row of texts.
 *
 * The zoom row's press-and-drag, with its own ghost and its own draw ref: the
 * strip has one zoom row and several of these, and a ghost shared between
 * rows would draw the outline on whichever row rendered last.
 */
function TextRow({
  track,
  empty,
  spare,
  invite,
  width,
  duration,
  spanAt,
  slicing,
  timeAt,
  onInteract,
  dispatch,
}: {
  track: number;
  /** Whether the row holds no text, so it can say what it is for. */
  empty: boolean;
  /** The row above every existing one, which a press makes real. */
  spare: boolean;
  /** Whether to say what the row is for when it is empty. The first row
      always does; a spare row only once the row under it holds something,
      or five invitations would stack up over an empty timeline. */
  invite: boolean;
  width: number;
  duration: MediaTime;
  spanAt: (at: MediaTime, to?: MediaTime) => { start: MediaTime; end: MediaTime } | null;
  /** The blade is in hand, so the row adds nothing — the same reason the zoom
      row stops offering one. The bars over it do the cutting. */
  slicing: boolean;
  /** Project time under a client x. A text is measured on the edit's clock,
      so this is the only one it ever asks about — see `TextSlice`. */
  timeAt: (clientX: number) => MediaTime;
  onInteract: () => void;
  dispatch: Dispatch<EditorAction>;
}) {
  const ghost = useRef<HTMLDivElement>(null);
  const draw = useRef<{ at: MediaTime; x: number; drawn: boolean } | null>(null);

  const showGhost = (clientX: number | null) => {
    const element = ghost.current;
    if (!element) return;

    const drawing = draw.current;
    const pointer = clientX === null ? null : timeAt(clientX);
    const span =
      drawing === null
        ? pointer === null
          ? null
          : spanAt(pointer)
        : drawing.drawn && pointer !== null
          ? spanAt(drawing.at, pointer)
          : spanAt(drawing.at);
    // Straight onto the strip, with no crossing. `spanAt` is `textSpanAt`,
    // which answers in project time because that is the clock a text's length
    // is measured on — putting it through `spanInProject` as well read the
    // numbers as source times, went looking for clips that happened to cover
    // them, and on a reordered or heavily cut edit found none. The outline then
    // hid itself, which is exactly what it looks like when a feature is
    // missing rather than mismeasured.
    if (span === null) {
      element.style.opacity = "0";
      return;
    }
    const { start: from, end: to } = span;

    element.style.left = `${String((from / Math.max(duration, 1)) * 100)}%`;
    element.style.width = `${String(((to - from) / Math.max(duration, 1)) * 100)}%`;
    element.style.opacity = "1";
  };

  return (
    <div
      className="relative"
      style={{ height: TEXT_H }}
      data-text-row={track}
      onPointerMove={(event) => {
        if (slicing) return;
        const drawing = draw.current;
        if (drawing && !drawing.drawn && Math.abs(event.clientX - drawing.x) >= DRAW_SLOP) {
          drawing.drawn = true;
        }
        showGhost(event.clientX);
      }}
      onPointerLeave={() => {
        if (!draw.current) showGhost(null);
      }}
      onPointerDown={(event) => {
        if (slicing) return;
        draw.current = { at: timeAt(event.clientX), x: event.clientX, drawn: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerUp={(event) => {
        const drawing = draw.current;
        draw.current = null;
        if (!drawing) return;

        event.currentTarget.releasePointerCapture(event.pointerId);
        onInteract();
        dispatch({
          type: "addText",
          track,
          at: drawing.at,
          ...(drawing.drawn ? { to: timeAt(event.clientX) } : {}),
        });
        showGhost(null);
      }}
      onPointerCancel={() => {
        draw.current = null;
        showGhost(null);
      }}
    >
      {empty && invite && (
        <div
          className="pointer-events-none sticky z-10 flex h-full items-center justify-center"
          style={{ left: RAIL_W, width }}
        >
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-md border border-dashed border-white/15 px-2.5 py-0.5 text-[10px] text-editor-muted [&_svg]:size-3",
              // The spare row is quieter than the first: it is an offer of
              // a second layer, not the first thing to do.
              spare && track > 0 && "opacity-60",
            )}
          >
            <TextIcon />
            {track === 0 ? "Click or drag to add text" : "Add a text over the others"}
          </span>
        </div>
      )}

      <div
        ref={ghost}
        className={cn(
          "pointer-events-none absolute inset-y-0 flex items-center overflow-hidden rounded px-2.5",
          "border border-dashed border-title-ring/70 bg-title-fill/15 opacity-0 transition-opacity duration-75",
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5 text-[10px] text-white/85 [&_svg]:size-3 [&_svg]:flex-none">
          <TextIcon />
          <span className="truncate">Add Text</span>
        </span>
      </div>
    </div>
  );
}

/** One text on its row: `Zoom`, thinner, labelled with its first line. */
function TextBar({
  top,
  left,
  width,
  pixels,
  selected,
  blade,
  label,
  start,
  timeAt,
  trackAt,
  onSelect,
  onContextMenu,
  onMove,
  onDrop,
  onCopyPreview,
  onCopy,
  onTrim,
  onBeginEdit,
}: {
  /** Where the bar's row sits in the group, in pixels from its top. */
  top: number;
  left: number;
  width: number;
  /** How wide the bar is on screen, so the glyph can step aside for the
      words when there is not room for both. */
  pixels: number;
  selected: boolean;
  /** The blade, while it is held: a press cuts the title in two instead of
      sliding it, and the grips and the option-drag go with it. */
  blade: Blade | null;
  label: string;
  start: MediaTime;
  /** Project time under a client x. A text is measured on the edit's clock,
      so this is the only one it ever asks about — see `TextSlice`. */
  timeAt: (clientX: number) => MediaTime;
  /** The row under a client y, so a drag can carry the bar between rows. */
  trackAt: (clientY: number) => number;
  onSelect: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
  /** Slid to `start`, and onto `track` where that differs from its own. */
  onMove: (start: MediaTime, track: number) => void;
  /** The drag ended, so the rows it emptied can go. */
  onDrop: () => void;
  /** An option-drag is over `start` on `track`; null when it has ended. */
  onCopyPreview: (over: { start: MediaTime; track: number } | null) => void;
  /** An option-drag let go: a copy lands there, or nowhere. */
  onCopy: (start: MediaTime, track: number) => void;
  onTrim: (edge: "start" | "end", clientX: number) => void;
  onBeginEdit: () => void;
}) {
  const grab = useRef<MediaTime | null>(null);
  /**
   * Whether this drag is copying rather than moving.
   *
   * Decided at the press, as the preview decides an option-pan: the key
   * held when the bar was picked up is what the gesture means, and a copy
   * that turned into a move halfway would leave the original where the
   * ghost had been.
   */
  const copying = useRef(false);
  /** The wash over the part a cut would separate off — see `CutShade`. */
  const shade = useRef<HTMLSpanElement>(null);
  // The words are what tell two bars apart; the glyph only says "text", which
  // the row's colour already does. So on a bar with room for one of the two,
  // it is the words. Below ~10 px a second at a fitted minute a three-second
  // text is sixty pixels, and that is a word and a half.
  const roomy = pixels >= 110;

  const grabEdge = () => (event: PointerEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onBeginEdit();
  };

  const moveEdge = (edge: "start" | "end") => (event: PointerEvent<HTMLSpanElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.stopPropagation();
    onTrim(edge, event.clientX);
  };

  return (
    <div
      className={cn(
        // Tighter than a zoom's padding: the grip is a two-pixel line centred
        // in its twelve, and the words can start just inside it.
        //
        // `pointer-events-auto`: the layer these sit in lets every press
        // through to the rows beneath, and a bar has to catch its own.
        "group pointer-events-auto absolute overflow-hidden rounded-md",
        "transition-[background-color,outline-color]",
        EMBOSS,
        // Solid and unframed, like the zoom and the bed below it: three rows of
        // bars that are three kinds of thing read as three kinds through their
        // colour, and an outline on one of the three only says that that row is
        // different in some way nobody can name.
        selected ? "bg-title-fill" : "bg-title-fill/85",
        "outline-2 -outline-offset-2",
        // The blade's ring in place of the selection's, as a clip's is — see
        // the note on `Clip`.
        blade
          ? "outline-transparent data-[cut=true]:outline-cut"
          : selected
            ? "outline-title-ring"
            : "outline-transparent hover:outline-title-ring/40",
        !blade && "cursor-grab active:cursor-grabbing",
      )}
      style={{ top, height: TEXT_H, left: `${String(left)}%`, width: `${String(width)}%` }}
      onContextMenu={onContextMenu}
      onPointerDown={(event) => {
        // Stops the strip underneath seeking on a press meant for the bar.
        event.stopPropagation();
        // The blade instead of the whole gesture, as a clip's press is: no
        // selection, no grab, and no pointer capture — the press is over as
        // soon as the cut is made.
        if (blade) {
          blade.cut(event.clientX);
          return;
        }
        onSelect();
        grab.current = timeAt(event.clientX) - start;
        copying.current = event.altKey;
        event.currentTarget.setPointerCapture(event.pointerId);
        // A copy is one step on its own when it lands; only a move streams.
        if (!copying.current) onBeginEdit();
        else event.currentTarget.style.cursor = "copy";
      }}
      onPointerMove={(event) => {
        if (blade) {
          aim(blade, event, shade);
          return;
        }
        if (grab.current === null) return;
        // With option held the bar stays put and the outline of the copy
        // travels instead — where it would land, not where the pointer is.
        if (copying.current) {
          onCopyPreview({
            start: timeAt(event.clientX) - grab.current,
            track: trackAt(event.clientY),
          });
          return;
        }
        // Straight to the reducer, on every move, the way a zoom bar's drag
        // goes. A text is measured on the strip's own clock now, so there is
        // no crossing to defer and nothing to gain by holding the row change
        // back until release — which is what a pixel slide did, and it made
        // a bar dragged to another row appear to stay on its old one until
        // the pointer came up.
        onMove(timeAt(event.clientX) - grab.current, trackAt(event.clientY));
      }}
      onPointerLeave={blade ? (event) => aim(null, event, shade) : undefined}
      onPointerUp={(event) => {
        if (grab.current !== null) {
          if (copying.current) {
            onCopy(timeAt(event.clientX) - grab.current, trackAt(event.clientY));
            event.currentTarget.style.cursor = "";
          } else {
            onMove(timeAt(event.clientX) - grab.current, trackAt(event.clientY));
            onDrop();
          }
        }
        grab.current = null;
        copying.current = false;
      }}
      onPointerCancel={(event) => {
        if (copying.current) onCopyPreview(null);
        event.currentTarget.style.cursor = "";
        // A gesture the system takes — a three-finger swipe over the trackpad
        // — gets no `pointerup`, so the rows the drag emptied have to be tidied
        // here too or an empty row stays in the strip until the next edit.
        if (grab.current !== null && !copying.current) onDrop();
        grab.current = null;
        copying.current = false;
      }}
    >
      {/* The chip and the words — a bed's shape and a zoom's, on a row half
          their height.

          The chip is `size-5` rather than `size-6`, which is the one number
          that differs: at the bars' own size it would be the whole row with
          nothing above or below it, and a chip that fills its bar reads as a
          button rather than as a label on one. Its radius is scaled with it
          rather than shared — a `rounded-lg` on a smaller square is a rounder
          chip, and the three have to look like one chip at three sizes.
          Everything else — the dark square, the glyph inside it, the words
          beside it — is the same.

          The words are truncated: they are the one thing that tells two bars
          on a row apart, and they degrade a letter at a time on a short bar
          without changing the row's height. */}
      <span
        className="pointer-events-none absolute inset-0 flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-white [&_svg]:flex-none"
        style={{ paddingInline: LABEL_INSET }}
      >
        {roomy && (
          <span className="grid size-5 flex-none place-items-center rounded-[7px] bg-black/25 [&_svg]:size-3">
            <TextIcon />
          </span>
        )}
        <span className="truncate">{label.replace(/\n+/g, " ")}</span>
      </span>

      {/* Gone with the blade in hand, for the reason a clip's are: the ends of
          a bar are where a cut is aimed, and a grip there resizes instead.

          `room`, like the zoom row's: a short text bar had its two targets
          stacked, so a press anywhere on it trimmed the end. */}
      {!blade && (
        <>
          <Handle
            edge="start"
            grip="bg-title-edge"
            grips={pixels >= GRAB_ROOM}
            room={pixels}
            selected={selected}
            onPointerDown={grabEdge()}
            onPointerMove={moveEdge("start")}
          />
          <Handle
            edge="end"
            grip="bg-title-edge"
            grips={pixels >= GRAB_ROOM}
            room={pixels}
            selected={selected}
            onPointerDown={grabEdge()}
            onPointerMove={moveEdge("end")}
          />
        </>
      )}

      {blade && <CutShade ref={shade} />}
    </div>
  );
}

/**
 * One bed on the music row.
 *
 * `TextBar` with less on it. Two of the things a title's bar can do are
 * missing, and each for a reason rather than for want of writing them:
 *
 * - **No rows.** There is one music row, because one bed at a time is what a
 *   bed is — two songs over one moment is not something any control in the
 *   editor could put right.
 * - **No option-drag copy.** A copy would land on top of the original on a row
 *   that holds one bar per moment.
 *
 * It does take the blade. That was written off at first on the grounds that
 * the two halves play the same song back to back, so the cut cannot be heard —
 * which is true and beside the point: a cut is made for what comes after it,
 * and the halves can then be deleted, moved or levelled apart. It also made
 * this the one row on the strip that ignored a tool the cursor said was in
 * hand, which reads as broken rather than as deliberate.
 *
 * What it keeps is the pair of handles, and they do more here than on the rows
 * above: the left one takes the song's own offset with it — see `trimMusic`.
 */
function MusicBar({
  left,
  width,
  pixels,
  selected,
  muted,
  blade,
  volume,
  onVolume,
  label,
  peaks,
  from,
  to,
  repeat,
  start,
  timeAt,
  onSelect,
  onContextMenu,
  onMove,
  onTrim,
  onBeginEdit,
}: {
  left: number;
  width: number;
  /** How wide the bar is on screen, so the glyph can step aside for the name. */
  pixels: number;
  selected: boolean;
  /** Muted, or at zero: drawn faint, because it is on the row and silent. */
  muted: boolean;
  /** The blade, while it is held: a press cuts the bed in two instead of
      picking it up, and the grips and the level line go with it. */
  blade: Blade | null;
  /** The bed's own level, for the line across it. */
  volume: number;
  /** A drag of the line, in the same 0–2 the panel's fader uses. */
  onVolume: (volume: number) => void;
  /** The song's name, which is what tells two beds apart. */
  label: string;
  /** The file's own peaks, from its own zero. Null until they are made. */
  peaks: Float32Array | null;
  /** The stretch of the file the bar shows, in the file's own time. */
  from: MediaTime;
  to: MediaTime;
  /** Whether the file starts again where it runs out, which the wave shows. */
  repeat: boolean;
  start: MediaTime;
  /** Project time under a client x. A bed is measured on the edit's clock at
      both ends, so this is the only question it ever asks. */
  timeAt: (clientX: number) => MediaTime;
  onSelect: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onMove: (at: MediaTime) => void;
  onTrim: (edge: "start" | "end", clientX: number) => void;
  onBeginEdit: () => void;
}) {
  const grab = useRef<MediaTime | null>(null);
  /** The wash over the part a cut would separate off — see `CutShade`. */
  const shade = useRef<HTMLSpanElement>(null);
  const roomy = pixels >= 110;

  const grabEdge = () => (event: PointerEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onBeginEdit();
  };

  const moveEdge = (edge: "start" | "end") => (event: PointerEvent<HTMLSpanElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.stopPropagation();
    onTrim(edge, event.clientX);
  };

  // Rebuilt only when the stretch of the file on show moves — a trim, or the
  // song being swapped. Zooming and scrolling do not touch it: the path is
  // drawn in a unit box and the SVG stretches it, which is the same bargain a
  // clip's wave makes. A bed that repeats has its file tiled first, so the
  // wave past the end of the song is the song again — exactly what will be
  // heard there.
  const wave = useMemo(
    () =>
      peaks === null
        ? ""
        : wavePath(
            repeat ? repeated(peaks, bucketCount(to)) : peaks,
            from,
            to,
            undefined,
            // The average rather than the loudest of each step — see
            // `wavePath`. A song has a beat every half second, and taking the
            // peak draws every one of them at the same height.
            "mean",
          ),
    [peaks, from, to, repeat],
  );

  return (
    <div
      className={cn(
        "group absolute inset-y-0 overflow-hidden rounded-lg",
        "transition-[background-color,outline-color]",
        EMBOSS,
        // Solid, where the zoom and title bars are a wash inside an outline.
        // Those two sit *over* the picture and have to stay see-through; a bed
        // is not over anything, and the row reads as a thing you can pick up
        // rather than as a highlight on an empty row.
        selected ? "bg-music-fill" : "bg-music-fill/85",
        "outline-2 -outline-offset-2",
        // The blade's ring in place of the selection's, as a clip's is — see
        // the note on `Clip`.
        blade
          ? "outline-transparent data-[cut=true]:outline-cut"
          : selected
            ? "outline-music-ring"
            : "outline-transparent hover:outline-music-ring/50",
        !blade && "cursor-grab active:cursor-grabbing",
        // Faint rather than hidden or struck through: the bar still says where
        // the music would be, which is what somebody needs to see before
        // turning it back on.
        muted && "opacity-50",
      )}
      style={{ left: `${String(left)}%`, width: `${String(width)}%` }}
      onContextMenu={onContextMenu}
      onPointerDown={(event) => {
        // Stops the strip underneath seeking on a press meant for the bar.
        event.stopPropagation();
        // The blade instead of the whole gesture, as a clip's press is: no
        // selection, no grab, and no pointer capture — the press is over as
        // soon as the cut is made.
        if (blade) {
          blade.cut(event.clientX);
          return;
        }
        onSelect();
        grab.current = timeAt(event.clientX) - start;
        event.currentTarget.setPointerCapture(event.pointerId);
        onBeginEdit();
      }}
      onPointerMove={(event) => {
        if (blade) {
          aim(blade, event, shade);
          return;
        }
        if (grab.current === null) return;
        onMove(timeAt(event.clientX) - grab.current);
      }}
      onPointerLeave={blade ? (event) => aim(null, event, shade) : undefined}
      onPointerUp={(event) => {
        if (grab.current !== null) onMove(timeAt(event.clientX) - grab.current);
        grab.current = null;
      }}
      onPointerCancel={() => {
        grab.current = null;
      }}
    >
      {/* The song, standing on the bar's floor.

          The same filled curve a clip draws, in white over the solid fill
          rather than in the row's own colour — a lighter teal on teal is the
          same colour twice, which is the trap the zoom curve fell into.

          `preserveAspectRatio="none"` is the whole trick: the path is built
          once in a 0–1 box and the browser stretches it to whatever width the
          zoom has given the bar, so scrubbing the zoom does not rebuild a path
          per bar per frame. */}
      {wave && (
        <svg
          className="pointer-events-none absolute bottom-0 left-0 w-full text-white/35"
          // Against the bed's own line, for the reason a clip's wave is — see
          // `waveHeight`.
          style={{ height: `${String(waveHeight(volume))}%` }}
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d={wave} fill="currentColor" />
        </svg>
      )}

      {/* The chip and the name, along the top. The wave owns the bottom, and a
          name laid over one is legible in the quiet passages and not in the
          loud ones.

          The chip is what makes the bar say *what kind of thing* it is at a
          glance, with the name saying which one — a glyph inline with the
          words read as a bullet point. Darker than the fill rather than
          lighter: it is a hole in the bar, not a light on it. */}
      <span
        className="pointer-events-none absolute inset-0 flex min-w-0 items-center gap-2 text-[11px] font-medium text-white [&_svg]:size-3.5 [&_svg]:flex-none"
        style={{ paddingInline: LABEL_INSET }}
      >
        {roomy && (
          <span className="grid size-6 flex-none place-items-center rounded-lg bg-black/25 text-white/90">
            <MusicIcon />
          </span>
        )}
        <span className="truncate">{label}</span>
      </span>

      {/* Gone with the blade in hand, all three: the level line is nine pixels
          of the bar where a press changes the volume, and the grips are twelve
          at each end where one resizes — and the ends are exactly where
          somebody aiming a blade means to land. A clip's grips go for the same
          reason. */}
      {!blade && (
        <>
          <VolumeLine
            level={volume}
            colour="bg-music-ring"
            onBegin={onBeginEdit}
            onChange={onVolume}
          />

          <Handle
            edge="start"
            grip="bg-music-edge"
            grips={pixels >= GRAB_ROOM}
            room={pixels}
            selected={selected}
            onPointerDown={grabEdge()}
            onPointerMove={moveEdge("start")}
          />
          <Handle
            edge="end"
            grip="bg-music-edge"
            grips={pixels >= GRAB_ROOM}
            room={pixels}
            selected={selected}
            onPointerDown={grabEdge()}
            onPointerMove={moveEdge("end")}
          />
        </>
      )}

      {blade && <CutShade ref={shade} />}
    </div>
  );
}

function ZoomGhost({ ref }: { ref: RefObject<HTMLDivElement | null> }) {
  return (
    <div
      ref={ref}
      className={cn(
        "pointer-events-none absolute inset-y-0 flex items-center justify-center overflow-hidden rounded px-3.5",
        "border border-dashed border-zoom-ring/70 bg-zoom-fill/15 opacity-0 transition-opacity duration-75",
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-[10px] text-white/85 [&_svg]:size-3 [&_svg]:flex-none">
        <ZoomIcon />
        <span className="truncate">Add Zoom</span>
      </span>
    </div>
  );
}

/**
 * One zoom span.
 *
 * Draggable along the row as well as trimmable: where a zoom happens is the
 * thing most often wrong about it, and re-cutting both edges to move it a
 * second is not how anyone thinks about that.
 */
function Zoom({
  left,
  width,
  room,
  selected,
  blade,
  target,
  method,
  level,
  curve,
  start,
  sourceAt,
  timeAt,
  onSelect,
  onContextMenu,
  onMove,
  onTrim,
  onBeginEdit,
}: {
  left: number;
  width: number;
  /** How wide the bar actually comes out, in pixels, which decides whether it
      has room for grips — see `GRAB_ROOM`. */
  room: number;
  selected: boolean;
  /** The blade, while it is held: a press cuts the zoom in two instead of
      picking it up, and the grips go with the drag they belonged to. */
  blade: Blade | null;
  /** What the zoom follows, which is the one thing about it worth seeing from
      the strip — the level and the speed only mean anything next to a picture. */
  target: ZoomSlice["target"];
  /**
   * How far in this zoom goes, as the shape drawn inside the bar.
   *
   * Handed down rather than worked out here: the height is measured against
   * the deepest zoom on the row, which is a question about the row. See
   * `barCurve`.
   */
  curve: { line: string; area: string };
  /** Whether it is a camera move or a lens. Shown in place of what it follows,
      not beside it: the two glyphs would not fit on a short bar, and which of
      the two methods a bar is matters more than where it is aimed. */
  method: ZoomSlice["method"];
  /** How far in. The one number about a zoom worth reading from the strip —
      how long it runs is already its width. */
  level: number;
  /** Where the bar begins on the *edit*, which is what the grab offset is
      measured against — see `timeAt`. */
  start: MediaTime;
  /** Source time under a client x, so a drag can be measured in the timeline's
      own units rather than in pixels that mean different things at each zoom. */
  sourceAt: (clientX: number) => MediaTime;
  /**
   * Where the pointer is on the *edit*, which is what a move is measured in.
   *
   * A zoom is stored against the recording and drawn against the edit, and the
   * two run at different rates wherever a cut has taken something out. A drag
   * has to preserve what is on screen — see `moveZoom` — so it is read, grabbed
   * and reported here in project time, and turned back into source time once,
   * in the reducer, where the clips are.
   */
  timeAt: (clientX: number) => MediaTime;
  onSelect: () => void;
  /** Right-clicked, with the pointer's position so a menu can open under it. */
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onMove: (start: MediaTime) => void;
  onTrim: (edge: "start" | "end", clientX: number) => void;
  /** A drag is beginning, so its stream of moves or trims is one step to undo. */
  onBeginEdit: () => void;
}) {
  /** Distance from the zoom's start to where it was picked up, in source time. */
  const grab = useRef<MediaTime | null>(null);
  /** The wash over the part a cut would separate off — see `CutShade`. */
  const shade = useRef<HTMLSpanElement>(null);
  // Room for a chip and something beside it. The same threshold a bed uses, so
  // the two rows lose their chips at the same width rather than one row's bars
  // going bare while the other's are still dressed.
  const roomy = room >= 110;

  const grabEdge = (edge: "start" | "end") => (event: PointerEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onBeginEdit();
  };

  const moveEdge = (edge: "start" | "end") => (event: PointerEvent<HTMLSpanElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.stopPropagation();
    onTrim(edge, event.clientX);
  };

  return (
    <div
      className={cn(
        "group absolute inset-y-0 overflow-hidden rounded-lg",
        "transition-[background-color,outline-color]",
        EMBOSS,
        // Solid, like the bars on the two rows below it.
        //
        // It was a wash inside an outline for a long time, on the argument
        // that a zoom sits *over* the picture and a solid block the length of
        // a shot pulls the eye off the filmstrip above it. What changed is
        // what is inside the bar: the curve is now drawn in white rather than
        // in a lighter amber, so it reads against a solid fill — and once it
        // does, a translucent zoom beside a solid title and a solid bed is the
        // one row that looks unfinished.
        //
        // A step between two solids says which one is held, the way a clip
        // does, rather than a step in how see-through it is.
        selected ? "bg-zoom-fill" : "bg-zoom-fill/85",
        // Split the same way a clip's is, and for the same reason — see the
        // outline note on `Clip`. This row had the identical bug.
        "outline-2 -outline-offset-2",
        // The blade's ring in place of the selection's, as a clip's is — see
        // the note on `Clip`.
        blade
          ? "outline-transparent data-[cut=true]:outline-cut"
          : selected
            ? "outline-zoom-ring"
            : "outline-transparent hover:outline-zoom-ring/40",
        !blade && "cursor-grab active:cursor-grabbing",
      )}
      style={{ left: `${left}%`, width: `${width}%` }}
      onContextMenu={onContextMenu}
      onPointerDown={(event) => {
        // Stops the row underneath adding a second zoom on top of this one.
        event.stopPropagation();
        // The blade instead of the whole gesture, as a clip's press is.
        if (blade) {
          blade.cut(event.clientX);
          return;
        }
        onSelect();
        // How far into the bar it was picked up, on the edit's clock — see
        // `timeAt`. In source time this offset is wrong the moment the bar
        // covers a cut, because the bar's two ends are then further apart on
        // the recording than they are on screen.
        grab.current = timeAt(event.clientX) - start;
        event.currentTarget.setPointerCapture(event.pointerId);
        onBeginEdit();
      }}
      onPointerMove={(event) => {
        if (blade) {
          aim(blade, event, shade);
          return;
        }
        if (grab.current === null) return;
        onMove(timeAt(event.clientX) - grab.current);
      }}
      onPointerLeave={blade ? (event) => aim(null, event, shade) : undefined}
      onPointerUp={() => {
        grab.current = null;
      }}
    >
      {/* How far in this zoom goes, behind everything else in the bar.
          Stretched to the bar by `preserveAspectRatio`, so it costs nothing
          when the strip is zoomed and nothing when the bar is retimed.

          The flat top is the hold, which is what a zoom's span is. It climbs
          or falls only where a neighbour is close enough to morph, because
          that move genuinely eats into this slice — see `betweenZooms`. */}
      {curve.area && (
        <svg
          // White rather than `--zoom-edge`, which was a lighter amber chosen
          // to carry against a wash of the same hue. Over a solid fill it is
          // the same colour twice and the curve disappears — the one thing in
          // the bar that says how far in the shot goes.
          className="pointer-events-none absolute inset-0 h-full w-full text-white"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          aria-hidden
        >
          {/* The fill alone. `barCurve` still draws the outline — the tests
              read the shape's heights off it — but the bar does not: a stroked
              edge on this one and a plain fill on the wave below it made two
              rows that are the same idea look like two different ones. At a
              third opacity the shape reads on its own, which is the weight the
              bed's wave carries. */}
          <path d={curve.area} fill="currentColor" fillOpacity={0.35} stroke="none" />
        </svg>
      )}

      {/* The chip and the reading, along the top — the shape a bed wears, so
          the three rows of bars read as three of the same kind of thing.

          Truncated rather than wrapped: a zoom half a second long is a few
          pixels wide at a fitted timeline, and its label has to degrade to
          nothing without changing the row's height. The chip goes first,
          because it is the part that still says "zoom" when there is no room
          left for the number.

          Centred when there is no chip. A bar a few pixels wide has its one
          glyph in the middle of it, which is where the eye goes on something
          that small — the same reading the row had before it had chips. */}
      <span
        className={cn(
          "pointer-events-none absolute inset-0 flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-white",
          !roomy && "justify-center",
          "[&_svg]:size-3 [&_svg]:flex-none",
        )}
        // Held off both ends, so neither grip is drawn under the label — see
        // `LABEL_INSET`. A bar too narrow for a chip keeps a little of it: the
        // glyph is centred, but the grips still need somewhere to be.
        style={{ paddingInline: roomy ? LABEL_INSET : 4 }}
      >
        {roomy ? (
          <span className="grid size-6 flex-none place-items-center rounded-lg bg-black/25 [&_svg]:size-3.5">
            <ZoomIcon />
          </span>
        ) : (
          <ZoomIcon />
        )}
        {method === "loupe" ? (
          <GlassIcon />
        ) : method === "fisheye" ? (
          <FisheyeIcon />
        ) : target === "cursor" ? (
          <CursorIcon />
        ) : target === "typing" ? (
          <TypingIcon />
        ) : (
          <FillIcon />
        )}
        <span className="truncate tabular-nums">{level.toFixed(1)}×</span>
      </span>

      {/* Both ends, at every width. The grips are drawn only where there is
          room for two of them with bar left between — below that they read as
          noise — but the ends stay grabbable without them: a zoom drawn a few
          pixels wide had no grips, no targets and no length field anywhere
          else, so a shot made a touch too short could only be deleted and
          drawn again.

          `room` is what keeps them off each other and off the middle. Each
          takes a quarter of the bar at most, so the one drawn second no longer
          covers the first and there is always half a bar left to drag the
          whole zoom by.

          Never with the blade in hand: the ends of the bar are where a cut is
          aimed, and a grip there would trim instead. */}
      {!blade && (
        <>
          <Handle
            edge="start"
            grip="bg-zoom-edge"
            grips={room >= GRAB_ROOM}
            room={room}
            selected={selected}
            onPointerDown={grabEdge("start")}
            onPointerMove={moveEdge("start")}
          />
          <Handle
            edge="end"
            grip="bg-zoom-edge"
            grips={room >= GRAB_ROOM}
            room={room}
            selected={selected}
            onPointerDown={grabEdge("end")}
            onPointerMove={moveEdge("end")}
          />
        </>
      )}

      {blade && <CutShade ref={shade} />}
    </div>
  );
}
