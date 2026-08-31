/**
 * Where everything goes, worked out once.
 *
 * This is the only place that turns settings into geometry. The canvas preview
 * draws the result; the exporter is *handed* the result and rasterises it
 * without re-deriving anything. That is deliberate — two implementations of
 * "where does the camera sit" is how a preview and an export come to disagree,
 * and the disagreement is only ever noticed after the file is written.
 *
 * So the plan is deliberately dumb: absolute pixels in the output frame, every
 * fit mode and fraction already resolved, nothing left to interpret. What can
 * still differ between the two rasterisers is antialiasing and gradient
 * interpolation — not whether the camera is in the right corner.
 *
 * Pure, and free of any `electron`, Node or DOM import, so the arithmetic is
 * testable on its own.
 */
import type { CursorShape } from "./contract.js";
import type { CursorKind } from "./manifest.js";
import type {
  Background,
  BackgroundSettings,
  CameraShape,
  LayoutSettings,
  SliceSettings,
  ZoomSlice,
} from "./project.js";

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Natural dimensions of the sources being composited. */
export interface SourceSizes {
  screen: Size | null;
  camera: Size | null;
}

export type PlanSource = "screen" | "camera";

/**
 * What the slice before this one was drawn with.
 *
 * A cut between two arrangements is the one moment the composition changes
 * without anything moving, and a camera that teleports across the frame reads
 * as a glitch rather than as an edit. Given this, the camera travels into its
 * new place over the opening of the slice.
 *
 * Only the camera moves. The screen box is also driven by zooms, whose keys are
 * derived from a base rectangle that is fixed for the slice — making that base
 * move means threading it through the follow, the steadying and the reach, and
 * that is a change to the zoom maths rather than an addition beside it.
 *
 * Absent on the first slice, which has nothing to arrive from.
 */
export interface EnterTransition {
  from: SliceSettings;
  /** This slice's own source range, so a move cannot outlast the clip it opens. */
  source: { start: number; end: number };
}

/**
 * A rounded rectangle whose corners are a superellipse.
 *
 * `exponent` 2 is a true ellipse — a circle when the radius reaches half the
 * shorter edge — and 4 is the squircle macOS uses. One number, so the canvas
 * can sample the curve and a shader can evaluate it, without either inventing
 * its own idea of the shape.
 */
export interface Shape {
  radius: number;
  exponent: number;
}

/**
 * One pointer position, already mapped into output pixels.
 *
 * `at` is source time, matching the slice's own range. Mapped here rather than
 * carried as the fraction the manifest stores, so that the rule for "where on
 * screen is the pointer" exists once — the exporter and the preview both just
 * interpolate between two numbers that are already in the frame's coordinates.
 * That is the only reason a moving thing can live in a plan that is otherwise
 * static.
 */
export interface CursorPoint {
  at: number;
  x: number;
  y: number;
  /**
   * How much larger the pointer is here than it would be lying flat.
   *
   * A tilted picture is nearer at one edge than the other, and a pointer drawn
   * one size across all of it sits on top of the frame rather than in it. 1
   * wherever nothing is tilted.
   */
  scale: number;
  /** False where the pointer was outside the visible crop, or off the screen
      entirely. Marked rather than omitted: a hole between two samples would be
      interpolated straight through. */
  visible: boolean;
}

/**
 * One sampled destination rectangle, in output pixels, at a source time.
 *
 * What makes a zoom expressible in a plan that is otherwise static. The easing
 * is already baked into where these land, so both rasterisers only ever lerp
 * five numbers between two keys — no curve, no cursor lookup, no idea that a
 * zoom exists at all.
 *
 * The *destination* rather than the source: a zoom scales the whole picture and
 * lets it run past the edges of the frame, corners and border and all, rather
 * than cropping into the recording and leaving the frame the size it was. The
 * two look completely different — one is a camera pushing in, the other is a
 * still being enlarged.
 *
 * A zoom's keys start and end at the un-zoomed rectangle — a little outside the
 * slice, where its moves happen — which is what makes the gaps between zooms
 * free: interpolating from base to base is base. Two zooms close enough
 * together to move straight from one to the other share one run of keys that
 * never passes through it.
 */
export interface RectKey {
  at: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Corner radius, which grows with the picture rather than staying put. */
  radius: number;
  /**
   * Depth of field: `x`, `y` is what stays sharp in output pixels, `safe` how
   * far around it, and `strength` the widest blur beyond. All zero when nothing
   * is being softened, which is every zoom that does not ask for it.
   */
  focus?: { x: number; y: number; safe: number; strength: number };
  /**
   * How hard the frame darkens towards its edges, 0 to 1.
   *
   * Absent when nothing is being darkened, which is every zoom that does not ask
   * for it — the same shape `focus` takes, so a plan carries neither field for
   * the ordinary case.
   */
  vignette?: number;
  /**
   * The picture's four corners once tilted, as `x, y, w` each — twelve numbers,
   * in the order top-left, top-right, bottom-left, bottom-right.
   *
   * Absent when nothing is tilted, which is every zoom that only pushes in.
   *
   * `w` is the projective *divisor* — proportional to the corner's distance
   * from the eye, so a corner leaning away carries a larger one. Carrying it is
   * what makes this a perspective rather than merely a quadrilateral: a GPU
   * interpolates in clip space, so handing it four screen positions and letting
   * it map the texture across two triangles gives the affine warp early 3D was
   * famous for. With `w` the hardware does the divide per pixel for free.
   *
   * Computed here, like everything else geometric, so the preview and the
   * export cannot disagree about where a corner went — they each receive the
   * answer and draw it.
   */
  quad?: number[];
}

export type PlanItem =
  | { kind: "fill"; rect: Rect; paint: Paint }
  | {
      kind: "shadow";
      rect: Rect;
      shape: Shape;
      blur: number;
      dy: number;
      color: string;
      motion?: RectKey[];
    }
  | {
      kind: "image";
      source: PlanSource;
      /** Region of the source to take, in source pixels. */
      srcRect: Rect;
      /** Where it lands in the output frame, in output pixels. */
      dstRect: Rect;
      shape: Shape;
      mirror: boolean;
      /** Overrides `dstRect` and the shape's radius over time, for a zoom.
          Absent when nothing moves, which is every item but a zoomed screen. */
      motion?: RectKey[];
    }
  | { kind: "stroke"; rect: Rect; shape: Shape; width: number; color: string; motion?: RectKey[] }
  | {
      kind: "cursor";
      /** Image to draw, relative to the session directory. */
      path: string;
      /** Drawn size in output pixels, square. */
      size: number;
      /** Point of the image that lands on the position, as a fraction of it. */
      hotspot: { x: number; y: number };
      points: CursorPoint[];
    }
  | {
      kind: "caption";
      /** Bitmap to draw, relative to the session directory. */
      path: string;
      /**
       * The bitmap's own size in pixels.
       *
       * Carried rather than read off the texture so `captionAt` is arithmetic
       * on plain numbers, and so the two rasterisers cannot disagree about what
       * a word box is measured against.
       */
      bitmap: Size;
      /** Where the whole bitmap lands in the output frame, in output pixels. */
      dstRect: Rect;
      /** The source-time range the cue is on screen for. */
      span: { start: number; end: number };
      /**
       * Empty draws the whole bitmap across the span — the unlit layer.
       * Non-empty draws only the word active at the moment, cropped out of a
       * bitmap laid out identically — the lit layer. Two items rather than one
       * item emitting two draws, so every plan item stays one quad.
       */
      words: CaptionWord[];
    };

/**
 * A cue that has already been laid out and rasterised, ready to be placed.
 *
 * The plan's input, not its output. Text is measured and drawn exactly once —
 * in the renderer, to a PNG per cue — because a line laid out twice is the same
 * class of mistake as a camera positioned twice, and this is what comes back.
 *
 * `size` is a fraction of the frame rather than the bitmap's own pixels: the
 * preview and the export build plans at different resolutions against the same
 * bitmaps, and a box in bitmap pixels would draw the captions at half size in
 * one of them. The *position* is deliberately not baked in, so moving the
 * captions up the frame does not re-rasterise every cue.
 */
export interface RenderedCue {
  at: number;
  end: number;
  /** The flat layer's bitmap, relative to the session directory. */
  path: string;
  /**
   * The lit layer's bitmap, laid out identically in the accent colour, or null
   * for a look that does not light the spoken word.
   */
  litPath: string | null;
  bitmap: Size;
  /** How much of the frame the bitmap covers, as fractions of each edge. */
  size: Size;
  /** Word boxes, in bitmap pixels. Empty for a look with no lit layer. */
  words: CaptionWord[];
}

/** One word's box within a caption bitmap, and when it is the spoken one. */
export interface CaptionWord {
  /** Source time this word becomes the active one. */
  at: number;
  end: number;
  /** The word's box, in bitmap pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** How much larger it is drawn than laid out, about its own centre. */
  scale: number;
}

export type Paint =
  | { kind: "solid"; color: string }
  | { kind: "gradient"; from: string; to: string; angle: number }
  | { kind: "image"; path: string };

export interface RenderPlan {
  frame: Size;
  /** Drawn in order, back to front. */
  items: PlanItem[];
}

/** Superellipse exponent per camera shape. */
const SHAPE_EXPONENT = { circle: 2, squircle: 4, rounded: 2, wide: 2 } as const;

/**
 * Turns settings into a flat list of things to draw.
 *
 * `sources.camera` being null, or the camera being switched off, simply omits
 * it — as does a moment before the camera started, which the caller signals the
 * same way. Nothing here holds a frame that was never recorded.
 */
export function buildRenderPlan(
  frame: Size,
  sources: SourceSizes,
  settings: SliceSettings,
  cursor?: CursorTrack | null,
  zooms?: readonly ZoomSlice[],
  enter?: EnterTransition | null,
  cues?: readonly RenderedCue[],
): RenderPlan {
  const items: PlanItem[] = [];
  const { layout, background } = settings;

  // The shorter edge is the reference for every fraction, so a setting means
  // the same thing in a landscape frame and a portrait one.
  const unit = Math.min(frame.width, frame.height);
  const full: Rect = { x: 0, y: 0, width: frame.width, height: frame.height };

  items.push({ kind: "fill", rect: full, paint: toPaint(background.background) });

  // Where each picture goes, worked out once for both of them. Everything below
  // only fits a source into the box it was given and decides how to dress it.
  const boxes = layoutBoxes(frame, layout, background, sources);

  // Where the camera was a frame ago, on the far side of the cut. Resolved
  // through the same `placement` the drag handles use, so "where was it" and
  // "where is it" cannot be answered by two different pieces of arithmetic.
  const leaving =
    enter && sources.camera
      ? placement(frame, enter.from.layout, enter.from.background, sources, "camera")
      : null;

  if (sources.screen && boxes.screen) {
    const slot = boxes.screen;
    const { dstRect, srcRect } = place(
      sources.screen,
      slot.area,
      slot.fit,
      layout.screenZoom,
      layout.screenOffsetX,
      layout.screenOffsetY,
    );
    const shape: Shape = { radius: background.cornerRadius * unit, exponent: 2 };

    /**
     * The border, which sits *outside* the picture rather than over it.
     *
     * A frame is around a picture, not on top of one: an inset border eats the
     * outer pixels of the recording — a menu bar, the edge of a window — and
     * the wider it is the more of the thing being demonstrated it covers. Outset
     * costs nothing but room in the padding.
     *
     * Which is the one thing to know about it: at zero padding the picture
     * already fills the frame, so there is nowhere outside it to draw and the
     * border falls off the edge. Full bleed and a frame are two different
     * pictures, and the padding slider is what chooses between them.
     */
    const border = background.borderWidth * unit;
    const outer = grow(dstRect, border);
    const outerShape: Shape = { radius: shape.radius + border, exponent: shape.exponent };

    // Room around the shadow for its blur to fall off in, in output pixels.
    // Both rasterisers take it back off again to find the silhouette.
    const blur = background.shadowBlur * unit;
    const spread = (blur / 2) * SHADOW_SPREAD;

    // One track for everything that makes up the picture — the image and the
    // border around it move together, because they are one object — and a
    // second for the shadow, which is the same shape with the bleed around it.
    const { keys: motion, shadow: shadowMotion } = zoomKeys(
      zooms ?? [],
      frame,
      dstRect,
      srcRect,
      sources.screen,
      shape.radius,
      spread,
      cursor,
    );
    const moving = motion.length > 0 ? { motion } : {};

    if (background.shadowOpacity > 0) {
      items.push({
        kind: "shadow",
        // Cast by the picture *and* its border, which are one object standing
        // off the background. A shadow that stopped at the picture would leave
        // the border reading as a ring painted on the wallpaper behind it.
        rect: grow(outer, spread),
        // The silhouette's own radius, not the grown rectangle's: what is being
        // drawn is the shape, and the bleed is only somewhere to draw it.
        shape: outerShape,
        blur,
        dy: background.shadowY * unit,
        color: rgba("#000000", background.shadowOpacity),
        ...(shadowMotion.length > 0
          ? { motion: shadowMotion.map((key) => grownKey(key, border)) }
          : {}),
      });
    }

    items.push({
      kind: "image",
      source: "screen",
      srcRect,
      dstRect,
      shape,
      mirror: false,
      ...moving,
    });

    // After the screen and before the border, so the pointer sits on the
    // picture but not over the frame's own edge.
    if (cursor && layout.cursorVisible) {
      items.push(
        ...cursorItems(
          cursor,
          sources.screen,
          srcRect,
          dstRect,
          unit,
          motion,
          layout.cursorSmoothing,
        ),
      );
    }

    if (border > 0) {
      items.push({
        kind: "stroke",
        // The outer silhouette. Both rasterisers draw a stroke *inside* the
        // shape they are given — the only band a fragment shader can reach,
        // since it cannot paint outside its own quad — so the ring between the
        // picture and this is where the border lands.
        rect: outer,
        shape: outerShape,
        width: border,
        color: rgba(background.borderColor, background.borderOpacity),
        // The picture's own track, pushed out with it: the border is fixed in
        // width, so a zoom moves and resizes it without thickening it.
        ...(motion.length > 0 ? { motion: motion.map((key) => grownKey(key, border)) } : {}),
      });
    }
  }

  if (sources.camera && boxes.camera) {
    const slot = boxes.camera;
    const { dstRect, srcRect } = place(
      sources.camera,
      slot.area,
      slot.fit,
      layout.cameraZoom,
      layout.cameraOffsetX,
      layout.cameraOffsetY,
    );

    /**
     * The bubble's box, shrunk by however far a zoom has pushed in.
     *
     * **It shrinks into the corner it is parked in**, not towards its own
     * centre. A bubble sitting bottom-left is there to keep out of the way, and
     * one that shrinks about its middle walks *away* from the corner as it goes
     * — it gets smaller and less tucked away at the same time, which is the
     * opposite of the point.
     *
     * The size still comes from `place`, because `cover` letterboxes rather
     * than crops once a bubble is zoomed out past its source and the box would
     * otherwise disagree with the picture in it. Only where it lands is decided
     * here.
     */
    const shrunk = (amount: number) => {
      if (amount <= 0) return dstRect;

      const scale = lerp(1, layout.cameraShrinkTo, amount);
      const { width, height } = place(
        sources.camera!,
        boxAt(
          frame,
          layout.cameraX,
          layout.cameraY,
          Math.max(1, layout.cameraWidth * unit * scale),
          Math.max(1, layout.cameraHeight * unit * scale),
        ),
        slot.fit,
        layout.cameraZoom,
        layout.cameraOffsetX,
        layout.cameraOffsetY,
      ).dstRect;

      // Measured against the resting box, so the slack all comes off the far
      // side and the near edges keep the margin they had.
      return {
        x:
          dstRect.x +
          (dstRect.width - width) *
            edgeAnchor(dstRect.x, frame.width - (dstRect.x + dstRect.width)),
        y:
          dstRect.y +
          (dstRect.height - height) *
            edgeAnchor(dstRect.y, frame.height - (dstRect.y + dstRect.height)),
        width,
        height,
      };
    };

    // The camera's own shape, in every arrangement.
    //
    // Not the frame's corner radius, even where the camera is a card beside the
    // screen. The frame — its radius, its border — is the screen recording's,
    // and a picture of a person is not a screenshot: a face is round in this
    // app whatever is next to it, and `cameraShape` is the one control that
    // says how round. A card that followed the screen's radius also meant the
    // Frame panel silently reshaped the camera, which is not what anyone
    // dragging a corner-radius slider is asking for.
    //
    // A circle is the degenerate case of the rounded rect, so there is one code
    // path rather than a special case that could drift from it. The radius is
    // measured off the shorter edge, or a wide camera's corners would grow with
    // its width and swallow the picture.
    const shape: Shape = {
      radius: radiusFor(layout.cameraShape, Math.min(dstRect.width, dstRect.height)),
      exponent: SHAPE_EXPONENT[layout.cameraShape],
    };

    // A shadow measured against the camera itself rather than against the
    // frame, because every other distance here is a fraction of the frame's
    // shorter edge and a bubble is a fraction of that again. A blur sized for
    // the screen is one the bubble would vanish into, and a drop sized for the
    // screen would put the shadow out from under it entirely. A small object
    // casts a small tight shadow. A card is large enough to take the frame's
    // own numbers.
    const against = slot.card ? unit : Math.min(dstRect.width, dstRect.height);
    const blur = background.shadowBlur * against;
    const spread = (blur / 2) * SHADOW_SPREAD;

    // Arriving from wherever the previous slice had it — or from nothing, when
    // that arrangement had no camera at all. Growing out of the middle of where
    // it is going is the one entrance that needs no opacity: a plan item has no
    // alpha, and a rectangle of no size draws nothing on any of the three
    // rasterisers because the quad is degenerate before any fragment work.
    //
    // And shrinking out of the way of a zoom, for a bubble that was asked to.
    // Only a bubble: one of two cards sharing a frame cannot shrink without
    // leaving a hole where it was.
    const presence = zooms && !slot.card && layout.cameraShrinkOnZoom ? zoomPresence(zooms) : [];

    const { keys: motion, shadow: shadowMotion } = cameraKeys(
      (amount) => {
        const rect = shrunk(amount);
        return {
          rect,
          // Measured off the box it is on, not off the resting one: a bubble
          // whose corners stayed put as it shrank would change shape on the way.
          radius: radiusFor(layout.cameraShape, Math.min(rect.width, rect.height)),
        };
      },
      spread,
      presence,
      enter
        ? {
            from: leaving ? reshaped(leaving.dstRect, dstRect) : nothingAt(dstRect),
            radius: leaving ? cameraRadius(reshaped(leaving.dstRect, dstRect), enter.from) : 0,
            start: enter.source.start,
            duration: moveWindow(enter),
          }
        : null,
    );

    const moving = motion.length > 0 ? { motion } : {};

    if (background.shadowOpacity > 0) {
      items.push({
        kind: "shadow",
        rect: {
          x: dstRect.x - spread,
          y: dstRect.y - spread,
          width: dstRect.width + spread * 2,
          height: dstRect.height + spread * 2,
        },
        shape,
        blur,
        dy: background.shadowY * against,
        color: rgba("#000000", background.shadowOpacity * (slot.card ? 1 : CAMERA_SHADOW)),
        ...(shadowMotion.length > 0 ? { motion: shadowMotion } : {}),
      });
    }

    items.push({
      kind: "image",
      source: "camera",
      srcRect,
      dstRect,
      shape,
      mirror: layout.cameraMirror,
      ...moving,
    });

    // No border, in any arrangement. The border belongs to the frame around the
    // screen recording; a stroke around the camera is a ring drawn round
    // somebody's face, which is a different decision from framing a picture and
    // one nobody asked for by dragging the border slider.
  } else if (leaving && enter && sources.camera) {
    // This arrangement has no camera and the one before it did. Without this the
    // bubble is simply gone on the cut, which reads as the camera failing rather
    // than as the composition changing — so it shrinks away into its own middle
    // and the slice draws nothing thereafter.
    //
    // The item's own rectangle is the empty one: `rectAt` holds the last key
    // past the end of the track, so what is drawn for the rest of the slice is
    // nothing either way, and a resting value that could ever draw would be a
    // bubble reappearing at the end of a clip that has no camera in it.
    const gone = nothingAt(leaving.dstRect);
    const radius = cameraRadius(leaving.dstRect, enter.from);
    const against = leaving.card ? unit : Math.min(leaving.dstRect.width, leaving.dstRect.height);
    const blur = enter.from.background.shadowBlur * against;
    const spread = (blur / 2) * SHADOW_SPREAD;

    // Nothing to shrink under a zoom here: this camera is on its way out, and
    // where it is going is nowhere.
    const { keys: motion, shadow: shadowMotion } = cameraKeys(
      () => ({ rect: gone, radius: 0 }),
      spread,
      [],
      {
        from: leaving.dstRect,
        radius,
        start: enter.source.start,
        duration: moveWindow(enter),
      },
    );

    if (motion.length > 0) {
      const shape: Shape = {
        radius,
        exponent: SHAPE_EXPONENT[enter.from.layout.cameraShape],
      };

      if (enter.from.background.shadowOpacity > 0) {
        items.push({
          kind: "shadow",
          rect: gone,
          shape,
          blur,
          dy: enter.from.background.shadowY * against,
          color: rgba(
            "#000000",
            enter.from.background.shadowOpacity * (leaving.card ? 1 : CAMERA_SHADOW),
          ),
          motion: shadowMotion,
        });
      }

      items.push({
        kind: "image",
        source: "camera",
        srcRect: leaving.srcRect,
        dstRect: gone,
        shape,
        mirror: enter.from.layout.cameraMirror,
        motion,
      });
    }
  }

  // Last, so captions sit over everything. A caption behind the camera bubble
  // is a caption nobody can read, and the bubble is the thing that moves.
  items.push(...captionItems(frame, settings.captions, cues));

  return { frame, items };
}

/**
 * Places already-rasterised cues in the frame.
 *
 * One item per cue for the flat layer, plus a second carrying the word boxes
 * for looks that light the spoken word — which is what `PlanItem.Caption`
 * already expects, and why it holds `words` rather than emitting two draws from
 * one item. Both point at bitmaps laid out identically, so the lit word lands
 * exactly over the flat one it replaces.
 */
function captionItems(
  frame: Size,
  captions: SliceSettings["captions"],
  cues: readonly RenderedCue[] | undefined,
): PlanItem[] {
  if (!captions.captionsOn || !cues || cues.length === 0) return [];

  const unit = Math.min(frame.width, frame.height);
  const items: PlanItem[] = [];

  for (const cue of cues) {
    const width = cue.size.width * frame.width;
    const height = cue.size.height * frame.height;
    // A cue that measured to nothing — an empty line, a style with a zero size —
    // would divide by zero in `captionAt`. Skipped rather than clamped, since
    // there is nothing to see either way.
    if (width <= 0 || height <= 0) continue;

    const inset = captions.captionOffset * unit;
    const y =
      captions.captionPlace === "top"
        ? inset
        : captions.captionPlace === "middle"
          ? (frame.height - height) / 2
          : frame.height - height - inset;

    const dstRect: Rect = {
      x: (frame.width - width) / 2,
      // Clamped so a large size or a deep offset cannot push the words off the
      // frame entirely — the one failure that is invisible until the export.
      y: Math.max(0, Math.min(y, frame.height - height)),
      width,
      height,
    };

    const span = { start: cue.at, end: cue.end };

    items.push({ kind: "caption", path: cue.path, bitmap: cue.bitmap, dstRect, span, words: [] });

    if (cue.litPath && cue.words.length > 0) {
      items.push({
        kind: "caption",
        path: cue.litPath,
        bitmap: cue.bitmap,
        dstRect,
        span,
        words: cue.words,
      });
    }
  }

  return items;
}

/**
 * The corner radius the camera has at a given size.
 *
 * Split out because a move needs it twice: once for where the camera is going,
 * which the branch above already computes, and once for where it came from —
 * and the shape it is leaving is the previous slice's, not this one's.
 */
function cameraRadius(rect: Rect, settings: SliceSettings): number {
  return radiusFor(settings.layout.cameraShape, Math.min(rect.width, rect.height));
}

/** How often a zoom is sampled. Fine enough that a straight line between two
    keys is indistinguishable from the curve they were taken off. */
const ZOOM_SAMPLE_NS = 1_000_000_000 / 30;

/**
 * The pointer's own shake, and nothing more, in seconds.
 *
 * A hand on a trackpad is not a camera operator: it overshoots, corrects and
 * trembles, and a shot that reproduces that exactly is unwatchable. This is the
 * time constant of the filter that stands between the two. It only has to
 * swallow the tremble — where the shot goes is settled further down, by
 * something that does not have to run backwards to do it.
 */
const JITTER_SECONDS = 0.15;

/**
 * The still area in the middle of the frame, as a fraction of the distance from
 * the centre to the edge.
 *
 * The one thing that makes a followed zoom watchable. A camera that holds its
 * subject dead centre is not steady, it is glued: every movement of the hand
 * becomes `level` times as much movement of the entire picture, and the frame
 * is never once allowed to rest. Real cameras keep their subject roughly in
 * shot and move when it threatens to leave.
 *
 * A hard edge rather than a ramp. A ramp meant the camera was always answering
 * *something* — a little at a quarter of the way out, more at a half — so the
 * picture was never quite still and the box had no boundary anyone could point
 * at. The step it puts in the target is not a step in the picture: a spring
 * follows the target, and a spring's velocity is continuous even when what it
 * is chasing jumps.
 */
const DEAD_ZONE = 0.28;

/**
 * How far from the middle the pointer may ever get, as the same fraction.
 *
 * The dead zone says when the camera starts moving; this says that it is not
 * allowed to fall so far behind that the thing it is following leaves the shot.
 * Zoomed in, a hand crossing the screen covers `level` times as much picture as
 * it does desk, and a camera held to a dignified speed simply loses it — the
 * pointer walks off the side of the frame and the shot is of nothing.
 *
 * Inside the frame with room to spare, so the pointer is caught before it
 * reaches the edge rather than skidding along it.
 */
const KEEP_IN = 0.82;

/**
 * How long the shot takes to catch up with the pointer, in seconds.
 *
 * Slower than the filter it replaced, and causal rather than run in both
 * directions. Both are affordable for the same reason: with a dead zone the
 * pointer simply sits a little off centre while the camera closes the gap, and
 * nobody reads that as a slow camera. Without one, any lag at all shows up as
 * the pointer sliding out of the middle of the shot — which is why the filter
 * that preceded this had to cheat, and why it moved before the hand did.
 *
 * Quick enough that `KEEP_IN` stays an emergency. A spring chasing a hand at a
 * steady speed settles a fixed distance behind it — twice the speed over the
 * natural frequency — and at three quarters of a second that lag plus the dead
 * zone came to nearly the whole allowance, so an ordinary deliberate move was
 * enough to trip the clamp and be dragged the rest of the way. The clamp is for
 * flicks, not for someone crossing the screen on purpose.
 */
const FOLLOW_SECONDS = 0.45;

/**
 * The fastest the picture may travel, in frame shorter-edges per second.
 *
 * A flick across the screen is someone going somewhere, not something to look
 * at. Unbounded, the camera chases it at whatever speed the hand managed and
 * the whole framing crosses in a few frames — the lurch that makes a followed
 * zoom hard to watch even once the shake is gone.
 *
 * A shorter edge per second is a camera move; a flick is two orders of
 * magnitude past it. Note that this bounds the *picture*, which travels `level`
 * times as far as the hand does, so it bites well before the hand looks fast —
 * that is the point, and the dead zone is what stops it reading as lag.
 */
const MAX_PAN = 0.9;

/**
 * How far past its own silhouette a shadow is drawn, in multiples of the blur.
 *
 * A blurred edge does not stop, it decays — but it was only ever rasterised as
 * far as the shape casting it, and everything inside that shape is hidden under
 * the picture. So the only part of the shadow anyone could see was the last
 * sliver before the geometry ran out, at half opacity, ending on a hard line.
 * That is what made it read as a slab of paint rather than as light.
 *
 * Three sigma is where the tail is under a hundredth of the peak and stopping
 * is no longer something the eye can find.
 *
 * Both rasterisers subtract it back off to recover the silhouette — see
 * `SHADOW_SPREAD` in `webgl.ts` and in `shaders.metal`. Changing it here alone
 * moves the shadow relative to the thing casting it.
 */
export const SHADOW_SPREAD = 3;

/**
 * How much of the picture's shadow the camera bubble gets.
 *
 * Less than the picture's, which is a slab the size of the frame sitting on a
 * background. A bubble is a small thing lying on top of that picture rather
 * than on the backdrop, and a shadow as heavy as the one under the whole shot
 * reads as a hole cut in it.
 */
const CAMERA_SHADOW = 0.7;

/**
 * How long the camera takes to reach its new place, in nanoseconds.
 *
 * Long enough to read as a move rather than a jump, short enough that a two
 * second clip is not still arranging itself halfway through. Capped at half the
 * slice below, for the same reason a zoom's ease is: a move that is still
 * arriving when the clip ends never shows where it was going.
 */
const CAMERA_MOVE_NS = 280_000_000;

/**
 * How decisively a shrinking bubble commits to the edge it is nearest.
 *
 * The anchor is where the bubble already sits between the two edges, pushed
 * out towards the extremes by this much. At 1 it would be the raw fraction,
 * which keeps a bubble's *relative* place and so lets a corner one drift a few
 * pixels away from its corner as it shrinks. At 3 anything sitting clearly
 * nearer one edge pins to that edge exactly, and only a bubble close to the
 * middle blends — where there is no near corner to shrink into, and shrinking
 * about the middle is the right answer anyway.
 *
 * A hard "whichever is nearer" would do the same for a corner and be
 * discontinuous down the middle of the frame: a bubble nudged one pixel across
 * would flip which way it shrank.
 */
const ANCHOR_REACH = 3;

/**
 * Where a shrinking box keeps its edge, 0 holding the near side and 1 the far.
 *
 * `before` and `after` are the gaps to the frame on either side of it.
 */
function edgeAnchor(before: number, after: number): number {
  const total = before + after;
  if (total <= 0) return 0.5;
  return clamp((before / total - 0.5) * ANCHOR_REACH + 0.5, 0, 1);
}

/**
 * How far a shot aimed past its range still travels, as a fraction of the
 * distance it cannot cover.
 *
 * A target near an edge cannot be centred: the picture would have to slide off
 * the frame and leave the background showing behind it. The old answer was to
 * clamp and stop, which is why aiming a zoom at a corner appeared to do nothing
 * at all — the camera had somewhere to be and simply declined to set off.
 *
 * A third of the way is enough for the move to read as going somewhere, while
 * every edge of the picture stays over the area it filled. Zero restores the old
 * behaviour; one uncovers the frame.
 */
const EDGE_REACH = 0.35;

/**
 * The clamped position, nudged back toward what was actually asked for.
 *
 * A no-op wherever the aim was already in range — which is every interior
 * target, and so most of every recording. It only has anything to say at an
 * edge, which is exactly where the clamp had nothing useful to say.
 */
function reach(value: number, min: number, max: number): number {
  return lerp(clamp(value, min, max), value, EDGE_REACH);
}

/**
 * Turns zoom slices into a sampled destination rectangle.
 *
 * The whole feature lives here. Everything downstream — the canvas, the
 * shader — only knows how to interpolate between two rectangles, which is what
 * keeps a zoom from being a second implementation of "where does the picture
 * sit" on the far side of an IPC boundary.
 *
 * **A slice is where the picture is in close, not where it is travelling.** The
 * moves happen either side of it — see `betweenZooms` — so the track opens and
 * closes on the un-zoomed rectangle a little outside the outermost slices, and
 * the flat stretches between distant zooms still need no keys at all:
 * interpolating base to base gives base.
 */
function zoomKeys(
  zooms: readonly ZoomSlice[],
  frame: Size,
  base: Rect,
  srcRect: Rect,
  source: Size,
  radius: number,
  /** How far the shadow's own track is grown past the picture's. */
  spread: number,
  cursor?: CursorTrack | null,
): { keys: RectKey[]; shadow: RectKey[] } {
  if (zooms.length === 0) return { keys: [], shadow: [] };

  const between = betweenZooms(zooms);
  const stages = stagesFor(zooms, between);
  if (stages.length === 0) return { keys: [], shadow: [] };

  // One list of sample times for every stage, in order, so a stage that blends
  // two zooms can ask both of them about the same instant. Per-zoom grids would
  // not line up: two zooms have different spans and would land their samples in
  // different places, and a move between them would be interpolating one shot
  // against another shot's neighbour.
  const times: number[] = [];
  /** Where each stage's samples begin and end in `times`. */
  const range: { first: number; last: number }[] = [];

  for (const stage of stages) {
    const span = stage.to - stage.from;
    const steps = Math.max(1, Math.ceil(span / ZOOM_SAMPLE_NS));

    // Stages meet exactly, so the first sample of one is the last of the one
    // before. Shared rather than repeated: two keys at the same time is a zero
    // length for anything downstream that divides by the gap between them.
    const first =
      times.length > 0 && times[times.length - 1] === stage.from ? times.length - 1 : times.length;

    for (let step = 0; step <= steps; step += 1) {
      const at = Math.round(stage.from + (span * step) / steps);
      if (times.length > 0 && times[times.length - 1]! >= at) continue;
      times.push(at);
    }

    range.push({ first, last: times.length - 1 });
  }

  // Which samples each zoom has to be able to answer for: its own hold, the
  // move that brings the picture to it, and the move that takes it away.
  const reachOf = zooms.map(() => ({ first: times.length, last: -1 }));
  stages.forEach((stage, index) => {
    for (const which of [stage.fromZoom, stage.toZoom]) {
      if (which === null) continue;
      const seen = reachOf[which]!;
      seen.first = Math.min(seen.first, range[index]!.first);
      seen.last = Math.max(seen.last, range[index]!.last);
    }
  });

  const shots = zooms.map((zoom, index) =>
    shotTrack(zoom, times, reachOf[index]!, frame, base, srcRect, source, radius, cursor),
  );

  const keys: RectKey[] = [];
  const shadow: RectKey[] = [];
  let written = -Infinity;

  stages.forEach((stage, index) => {
    const { first, last } = range[index]!;
    const span = stage.to - stage.from;

    for (let step = first; step <= last; step += 1) {
      const at = times[step]!;
      // Shared boundary samples belong to the stage that reached them first;
      // both stages agree on the picture there, so the second is a duplicate.
      if (at <= written) continue;
      written = at;

      const from = stage.fromZoom === null ? null : shots[stage.fromZoom]!;
      const to = stage.toZoom === null ? null : shots[stage.toZoom]!;
      const u = span > 0 ? (at - stage.from) / span : 1;

      const shot = shotAt(from, to, step, u);
      const pair = keyFor(shot, at, spread);
      keys.push(pair.key);
      shadow.push(pair.shadow);
    }
  });

  return { keys, shadow };
}

/**
 * A cubic bézier's two control points, as the four flat numbers a zoom stores.
 *
 * Named so a shot track can carry the curve every move to or from it is read
 * on, without carrying the whole slice for four numbers.
 */
type Curve = Pick<ZoomSlice, "easeInX" | "easeInY" | "easeOutX" | "easeOutY">;

/** A stretch of the recording's own timeline. */
interface Window {
  from: number;
  to: number;
}

/**
 * What the picture does either side of a zoom.
 *
 * `rest` is the ordinary case: the picture comes forward out of the un-zoomed
 * frame before the slice, and falls back into it after — `out` is the move away
 * from the zoom before this point and `in` the move towards the one after, and
 * either is absent at the ends of the list.
 *
 * `morph` is two zooms close enough together that passing through rest between
 * them would be a flinch rather than a move. The picture goes straight from one
 * to the other.
 */
type Between =
  { kind: "rest"; out: Window | null; in: Window | null } | { kind: "morph"; span: Window };

/**
 * Where every move in and move out sits, given the zooms around it.
 *
 * **The moves are outside the slices.** A slice says "the picture is in close
 * here", start to end, and the travel to and from it happens in the time either
 * side. It used to be the other way round — the span included its transitions —
 * and two things were wrong with that. A two second zoom with a 0.6s speed was
 * only actually in close for 0.8s of it, which is not what the timeline showed.
 * And two zooms back to back both had to pass through rest at the boundary, so
 * cutting from one part of the screen to another pulled all the way out and
 * pushed all the way back in, twice as far as the eye needed to travel.
 *
 * There are `zooms.length + 1` of these, one before each zoom and one after the
 * last.
 */
function betweenZooms(zooms: readonly ZoomSlice[]): Between[] {
  const between: Between[] = [];

  for (let index = 0; index <= zooms.length; index += 1) {
    const before = index > 0 ? zooms[index - 1]! : null;
    const after = index < zooms.length ? zooms[index]! : null;

    // Before the first zoom. The move in reaches back as far as it needs to and
    // no further than the start of the recording — a zoom that opens the take
    // is simply already in close, which is what "no room to travel" means and
    // is not a pop: there is no earlier frame for it to differ from.
    if (!before) {
      const start = after!.source.start;
      between.push({
        kind: "rest",
        out: null,
        in: { from: Math.max(0, start - easeNs(after!)), to: start },
      });
      continue;
    }

    // After the last. Deliberately unclamped: a move that runs past the end of
    // the recording is a move nobody sees, and clamping it would make a zoom
    // that ends on the last frame snap out on the frame before.
    if (!after) {
      const end = before.source.end;
      between.push({ kind: "rest", out: { from: end, to: end + easeNs(before) }, in: null });
      continue;
    }

    const gap = after.source.start - before.source.end;

    // Room for both moves to happen in full, with the picture at rest in
    // between — so they are two separate moves and the gap reads as a gap.
    if (gap >= easeNs(before) + easeNs(after)) {
      between.push({
        kind: "rest",
        out: { from: before.source.end, to: before.source.end + easeNs(before) },
        in: { from: after.source.start - easeNs(after), to: after.source.start },
      });
      continue;
    }

    // Not enough room, so the picture never returns to rest: it travels from one
    // zoom straight to the next. Centred on the middle of the gap and given the
    // gap's own length, so two zooms with a beat between them use it — and when
    // there is no gap at all, borrowed evenly from both slices rather than from
    // whichever happens to come second.
    const width = Math.max(
      gap,
      Math.min(
        easeNs(before),
        easeNs(after),
        // A quarter of a slice from each end at the very most, so a slice with a
        // morph at both ends still spends half its length actually in close.
        (before.source.end - before.source.start) / 2,
        (after.source.end - after.source.start) / 2,
      ),
    );
    const middle = (before.source.end + after.source.start) / 2;
    between.push({
      kind: "morph",
      span: { from: Math.round(middle - width / 2), to: Math.round(middle + width / 2) },
    });
  }

  return between;
}

/** Seconds of travel, as nanoseconds. */
function easeNs(zoom: ZoomSlice): number {
  return Math.max(0, zoom.speed) * 1_000_000_000;
}

/**
 * One stretch of time over which the picture goes from one thing to another.
 *
 * `fromZoom` and `toZoom` are indices into the zoom list, or null for the un-zoomed
 * picture. Equal indices are a hold — the slice itself, where the shot is fully
 * in and only following whatever it is aimed at.
 */
interface Stage {
  from: number;
  to: number;
  fromZoom: number | null;
  toZoom: number | null;
}

/** The whole timeline as moves and holds, in order and meeting exactly. */
function stagesFor(zooms: readonly ZoomSlice[], between: Between[]): Stage[] {
  const stages: Stage[] = [];

  for (let index = 0; index < zooms.length; index += 1) {
    const zoom = zooms[index]!;
    const before = between[index]!;
    const after = between[index + 1]!;

    if (before.kind === "rest" && before.in && before.in.to > before.in.from) {
      stages.push({ from: before.in.from, to: before.in.to, fromZoom: null, toZoom: index });
    }

    // A morph either side eats into the slice, which is the one place the hold
    // is shorter than what the timeline shows. `betweenZooms` caps that bite at
    // a quarter from each end, so this never collapses.
    const holdFrom = before.kind === "morph" ? before.span.to : zoom.source.start;
    const holdTo = after.kind === "morph" ? after.span.from : zoom.source.end;
    stages.push({
      from: holdFrom,
      to: Math.max(holdFrom, holdTo),
      fromZoom: index,
      toZoom: index,
    });

    // Pushed here rather than when the next zoom is reached, so the stages come
    // out in time order without a sort.
    if (after.kind === "morph") {
      stages.push({ from: after.span.from, to: after.span.to, fromZoom: index, toZoom: index + 1 });
    } else if (after.out && after.out.to > after.out.from) {
      stages.push({ from: after.out.from, to: after.out.to, fromZoom: index, toZoom: null });
    }
  }

  return stages;
}

/**
 * How far into a zoom the shot is over time, 0 at rest and 1 fully in.
 *
 * Read off the same stages that place the picture, so nothing else has to work
 * out for itself when a zoom is happening. The camera bubble shrinks on this,
 * and a bubble that decided separately would be pulling back while the picture
 * was still travelling.
 *
 * Deliberately says nothing about `level`. A 4x zoom is not further in than a
 * 2x one as far as this is concerned — it is in, and whatever gets out of its
 * way gets out of the way by the same amount.
 *
 * Opens and closes at 0 like the zoom's own keys, so the stretches between
 * distant zooms need no samples: interpolating 0 to 0 is 0.
 */
function zoomPresence(zooms: readonly ZoomSlice[]): { at: number; amount: number }[] {
  if (zooms.length === 0) return [];

  const stages = stagesFor(zooms, betweenZooms(zooms));
  const track: { at: number; amount: number }[] = [];

  const push = (at: number, amount: number) => {
    // Stages meet exactly, so each one's first sample is the last of the one
    // before, and they agree on the value there.
    if (track.length > 0 && track[track.length - 1]!.at >= at) return;
    track.push({ at, amount });
  };

  for (const stage of stages) {
    const span = stage.to - stage.from;
    const held = stage.fromZoom !== null && stage.toZoom !== null;

    // A hold is fully in throughout, and so is a move from one zoom straight to
    // another — the picture never returns to rest there, so neither does
    // anything following it. Two samples say that; sampling a ten second hold
    // thirty times a second would put three hundred identical keys in the
    // camera's track.
    if (held) {
      push(stage.from, 1);
      push(stage.to, 1);
      continue;
    }

    const zoom = zooms[(stage.fromZoom ?? stage.toZoom)!]!;
    const steps = Math.max(1, Math.ceil(span / ZOOM_SAMPLE_NS));

    for (let step = 0; step <= steps; step += 1) {
      const at = Math.round(stage.from + (span * step) / steps);
      const u = span > 0 ? (at - stage.from) / span : 1;
      // Moving out is the same curve read backwards, which is what it always
      // was — the shot eased on `min(into, left)` rather than on two curves.
      push(at, easeAt(zoom, stage.toZoom === null ? 1 - u : u));
    }
  }

  return track;
}

/** The presence at one instant, interpolated. Zero outside the track. */
function presenceAt(track: { at: number; amount: number }[], at: number): number {
  if (track.length === 0 || at <= track[0]!.at || at >= track[track.length - 1]!.at) return 0;

  let low = 0;
  let high = track.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (track[mid]!.at <= at) low = mid;
    else high = mid;
  }

  const before = track[low]!;
  const after = track[high]!;
  const span = after.at - before.at;
  return span > 0 ? lerp(before.amount, after.amount, (at - before.at) / span) : before.amount;
}

/**
 * Where the picture sits, and what it is wearing, at one instant.
 *
 * Everything a zoom does to the frame, as numbers that can be interpolated —
 * which is what makes a move from one zoom to another the same operation as a
 * move out of one into the un-zoomed frame. There is no "how far in is this
 * zoom" any more; there are two shots and a fraction between them.
 */
interface Shot {
  rect: Rect;
  radius: number;
  rotateX: number;
  rotateY: number;
  perspective: number;
  vignette: number;
  /** Absent when the zoom this came from does not soften anything. */
  focus: { x: number; y: number; safe: number; strength: number } | null;
}

/**
 * One zoom's shots, sampled across every moment it has anything to say about.
 *
 * Both the fully-in shot and the resting one, because a move needs the pair:
 * the resting shot is not simply the base rectangle — its depth of field is
 * focused on the same point, at no strength — and interpolating between the two
 * reproduces the old `amount` arithmetic exactly, to the bit.
 */
interface ShotTrack {
  /** Index in the shared time list this track's arrays start at. */
  first: number;
  /** The zoom's own easing, which every move to or from it is read on. */
  curve: Curve;
  rest: Shot[];
  full: Shot[];
}

function shotTrack(
  zoom: ZoomSlice,
  times: number[],
  covers: { first: number; last: number },
  frame: Size,
  base: Rect,
  srcRect: Rect,
  source: Size,
  radius: number,
  cursor?: CursorTrack | null,
): ShotTrack {
  const at = times.slice(covers.first, covers.last + 1);
  const level = Math.max(1, zoom.level);

  // Nominal rather than measured. The samples are evenly spaced inside a stage
  // and only step slightly at the joins between stages, and the filters below
  // want a rate rather than an exact interval.
  const stepSeconds = ZOOM_SAMPLE_NS / 1_000_000_000;

  // How far the shot may look into the scaled picture before it pulls off the
  // area the recording filled. Exactly the clamp `rectFor` used to apply to its
  // own output, rearranged: with `target.x` being `frame.width / 2 - travel.x`,
  // the two bounds on the rectangle are two bounds on the travel. The range
  // comes out `base.width * (level - 1)` wide whatever the frame, and collapses
  // to a point at `level === 1` — an un-zoomed shot has nowhere to pan to.
  const bounds = {
    minX: frame.width / 2 - base.x,
    maxX: frame.width / 2 - base.x + base.width * (level - 1),
    minY: frame.height / 2 - base.y,
    maxY: frame.height / 2 - base.y + base.height * (level - 1),
  };

  // What the shot is aimed at, moment by moment — mapped to output pixels here
  // rather than followed as fractions of the capture. Mapping first is what lets
  // the dead zone and the speed limit be stated against the frame, and it stops
  // the steadying being stronger vertically than horizontally on every source
  // that is not square.
  const aims = at.map((when) => {
    const point =
      zoom.target === "region"
        ? { x: zoom.x, y: zoom.y }
        : zoom.target === "typing"
          ? (typingCentre(cursor, when) ?? cursorFraction(cursor, when))
          : cursorFraction(cursor, when);

    return {
      x: ((point.x * source.width - srcRect.x) / srcRect.width) * base.width * level,
      y: ((point.y * source.height - srcRect.y) / srcRect.height) * base.height * level,
    };
  });

  // A region is a fixed point: there is nothing to steady and nothing to catch
  // up with, and putting it through the follow would only make the shot slide
  // onto it after arriving.
  const path =
    zoom.target === "region"
      ? aims.map((aim) => ({
          x: reach(aim.x, bounds.minX, bounds.maxX),
          y: reach(aim.y, bounds.minY, bounds.maxY),
        }))
      : followPath(deJitter(aims, stepSeconds), aims, stepSeconds, frame, bounds).map((point) => ({
          x: reach(point.x, bounds.minX, bounds.maxX),
          y: reach(point.y, bounds.minY, bounds.maxY),
        }));

  const shorter = Math.min(frame.width, frame.height);
  const width = base.width * level;
  const height = base.height * level;

  const rest: Shot[] = [];
  const full: Shot[] = [];

  for (let step = 0; step < at.length; step += 1) {
    const travel = path[step]!;
    const aim = aims[step]!;

    // `travel` is how far into the scaled picture the shot is looking, in output
    // pixels, and where the picture has to sit to put that point in the middle.
    //
    // Taken as given rather than clamped again. The bounds above decide how far
    // a shot may look — including how far past the covering range an edge target
    // is allowed to reach, which is the whole of `EDGE_REACH` — and a second
    // clamp here would quietly undo that decision.
    const moved: Rect = {
      x: frame.width / 2 - travel.x,
      y: frame.height / 2 - travel.y,
      width,
      height,
    };

    /**
     * Where the subject is on screen, which is where the sharp patch belongs.
     *
     * Built from `aim`, not from the rectangle's middle. `followPath` steadies
     * the shot, so it lags a moving cursor by design, and `reach` deliberately
     * leaves an edge target short of centre. In both cases the thing being
     * looked at is somewhere other than the middle of the frame — and a depth of
     * field focused on the middle regardless is focused on whatever the subject
     * has just left.
     */
    const focused = (rect: Rect) => ({
      x: rect.x + (width > 0 ? (aim.x / width) * rect.width : 0),
      y: rect.y + (height > 0 ? (aim.y / height) * rect.height : 0),
    });

    full.push({
      rect: moved,
      radius: radius * level,
      rotateX: zoom.rotateX,
      rotateY: zoom.rotateY,
      perspective: zoom.perspective,
      vignette: zoom.vignette,
      focus: zoom.blur
        ? {
            ...focused(moved),
            safe: zoom.blurSafe * shorter,
            strength: zoom.blurStrength * shorter,
          }
        : null,
    });

    rest.push({
      rect: base,
      radius,
      rotateX: 0,
      rotateY: 0,
      // The zoom's own, not a neutral value. Moving to and from rest must not
      // change the eye distance — the angle is what eases, and easing the
      // distance as well would zoom the lens while the shot travels, which reads
      // as a dolly and is not what anyone asked for by setting an angle.
      perspective: zoom.perspective,
      vignette: 0,
      focus: zoom.blur ? { ...focused(base), safe: zoom.blurSafe * shorter, strength: 0 } : null,
    });
  }

  return { first: covers.first, curve: zoom, rest, full };
}

/**
 * The picture at one sample of one stage.
 *
 * Four cases, all of them the same blend: into a zoom from rest, out of one back
 * to rest, held fully in, or straight from one zoom to another.
 */
function shotAt(from: ShotTrack | null, to: ShotTrack | null, step: number, u: number): Shot {
  // Held. The shot is fully in and only following what it is aimed at.
  if (from && to && from === to) return from.full[step - from.first]!;

  // Moving in. The curve is read forwards, so it leaves rest slowly or quickly
  // exactly as the control says.
  if (!from && to) {
    const track = to;
    const index = step - track.first;
    return blend(track.rest[index]!, track.full[index]!, easeAt(track.curve, u));
  }

  // Moving out, and the same curve read backwards — which is what it always
  // was: the old code eased on `min(into, left)`, so the exit was the entry in
  // reverse rather than a second curve.
  if (from && !to) {
    const index = step - from.first;
    return blend(from.rest[index]!, from.full[index]!, easeAt(from.curve, 1 - u));
  }

  // Straight from one zoom to the next, on the arriving zoom's curve: it is the
  // shot being moved into, and how a move *arrives* is what is being felt.
  const a = from!;
  const b = to!;
  return blend(a.full[step - a.first]!, b.full[step - b.first]!, easeAt(b.curve, u));
}

function blend(from: Shot, to: Shot, t: number): Shot {
  const focus =
    from.focus || to.focus
      ? {
          // A zoom that softens nothing still has a place for the sharp patch —
          // the same one, at no strength — so a move between one that blurs and
          // one that does not fades rather than switching.
          x: lerp(from.focus?.x ?? to.focus!.x, to.focus?.x ?? from.focus!.x, t),
          y: lerp(from.focus?.y ?? to.focus!.y, to.focus?.y ?? from.focus!.y, t),
          safe: lerp(from.focus?.safe ?? to.focus!.safe, to.focus?.safe ?? from.focus!.safe, t),
          strength: lerp(from.focus?.strength ?? 0, to.focus?.strength ?? 0, t),
        }
      : null;

  return {
    rect: {
      x: lerp(from.rect.x, to.rect.x, t),
      y: lerp(from.rect.y, to.rect.y, t),
      width: lerp(from.rect.width, to.rect.width, t),
      height: lerp(from.rect.height, to.rect.height, t),
    },
    radius: lerp(from.radius, to.radius, t),
    rotateX: lerp(from.rotateX, to.rotateX, t),
    rotateY: lerp(from.rotateY, to.rotateY, t),
    perspective: lerp(from.perspective, to.perspective, t),
    vignette: lerp(from.vignette, to.vignette, t),
    focus,
  };
}

/** The two keys one shot produces: the picture, and the shadow under it. */
function keyFor(shot: Shot, at: number, spread: number): { key: RectKey; shadow: RectKey } {
  const quad = rotatedQuad(shot.rect, shot.rotateX, shot.rotateY, shot.perspective);

  // The shadow's own rectangle: the same one, with room around it for the blur
  // to fall off in. Projected here rather than inflated afterwards, because a
  // tilted picture's corners are a perspective projection and there is no way to
  // grow four projected corners by a distance in screen pixels — the angles are
  // known at this point and nowhere downstream.
  const bled: Rect = {
    x: shot.rect.x - spread,
    y: shot.rect.y - spread,
    width: shot.rect.width + spread * 2,
    height: shot.rect.height + spread * 2,
  };
  const bledQuad =
    spread > 0 ? rotatedQuad(bled, shot.rotateX, shot.rotateY, shot.perspective) : quad;

  return {
    key: {
      at,
      ...shot.rect,
      radius: shot.radius,
      ...(quad ? { quad } : {}),
      ...(shot.focus ? { focus: shot.focus } : {}),
      ...(shot.vignette > 0 ? { vignette: shot.vignette } : {}),
    },
    // No focus and no vignette: neither rasteriser reads them for a shadow, and
    // carrying them would put the depth-of-field twice in every plan.
    shadow: {
      at,
      ...bled,
      radius: shot.radius,
      ...(bledQuad ? { quad: bledQuad } : {}),
    },
  };
}

/**
 * The camera's whole track: arriving after a cut, and shrinking under a zoom.
 *
 * One function because a plan item carries one `motion`, so these cannot be two
 * tracks that each write it. Either alone is the common case — a cut with no
 * zoom under it, or a zoom with nothing to arrive from — and each reduces to
 * exactly the keys it produced when they were separate.
 *
 * Position, size and corner radius only — the crop, the shape's exponent, the
 * mirror and the border are the incoming slice's from the first frame. The
 * picture moves; its dressing does not cross-fade, because a plan item carries
 * one source rectangle and one exponent and there is nowhere for a second to
 * live. Where two arrangements crop the camera differently, the opening frame
 * of the move therefore shows the arriving crop rather than the departing one.
 *
 * `from` is deliberately not the rectangle the previous slice actually drew —
 * see `reshaped`. Feeding that in directly would mean a box of one shape
 * showing a crop of another, and the picture would be visibly stretched for the
 * length of the move. Every face in every recording, on every cut.
 */
function cameraKeys(
  /** Where the bubble rests, and how round it is, at a given shrink. */
  resting: (amount: number) => { rect: Rect; radius: number },
  /** Room the shadow needs around the picture at rest, in output pixels. */
  spread: number,
  /** How far a zoom has pushed in over time. Empty when nothing shrinks. */
  presence: { at: number; amount: number }[],
  /** The cut this slice opens on, if the camera has somewhere to arrive from. */
  enter: { from: Rect; radius: number; start: number; duration: number } | null,
): { keys: RectKey[]; shadow: RectKey[] } {
  const settled = resting(0);

  // Nothing to say when nothing moves. Two arrangements that leave the camera
  // exactly where it was — `over-full` and `over-padded` both float it at the
  // same fractions — would otherwise carry a track of identical keys.
  const still =
    !enter ||
    enter.duration <= 0 ||
    (enter.from.x === settled.rect.x &&
      enter.from.y === settled.rect.y &&
      enter.from.width === settled.rect.width &&
      enter.from.height === settled.rect.height &&
      enter.radius === settled.radius);

  if (still && presence.length === 0) return { keys: [], shadow: [] };

  // Both tracks in one list of times, because a plan item carries one `motion`
  // and the two would otherwise be writing over each other. Sampled where each
  // has something to say: the arrival on its own short window, the shrink
  // wherever a zoom is moving.
  const times: number[] = [];
  if (!still && enter) {
    const steps = Math.max(2, Math.ceil(enter.duration / ZOOM_SAMPLE_NS));
    for (let step = 0; step <= steps; step += 1) {
      times.push(Math.round(enter.start + (enter.duration * step) / steps));
    }
  }
  for (const sample of presence) times.push(sample.at);
  times.sort((a, b) => a - b);

  const keys: RectKey[] = [];
  const shadow: RectKey[] = [];
  // What the full spread belongs to, so a picture that is half its final size
  // casts half the shadow. A small object casts a small tight shadow — the same
  // rule the camera's own shadow is sized by when it is a bubble — and without
  // it a camera shrinking away leaves a blur behind after the picture has gone.
  const full = Math.min(settled.rect.width, settled.rect.height);

  let written = -Infinity;
  for (const at of times) {
    if (at <= written) continue;
    written = at;

    const held = resting(presenceAt(presence, at));
    let rect = held.rect;
    let radius = held.radius;

    // Arriving *at wherever the shrink has it*, rather than at its full size:
    // a cut into a slice that is already zoomed would otherwise put the bubble
    // down at full size and shrink it a frame later.
    if (!still && enter && at <= enter.start + enter.duration) {
      const t = easeOut((at - enter.start) / enter.duration);
      rect = {
        x: lerp(enter.from.x, rect.x, t),
        y: lerp(enter.from.y, rect.y, t),
        width: lerp(enter.from.width, rect.width, t),
        height: lerp(enter.from.height, rect.height, t),
      };
      radius = lerp(enter.radius, radius, t);
    }

    keys.push({ at, ...rect, radius });

    const grown = full > 0 ? spread * (Math.min(rect.width, rect.height) / full) : 0;
    shadow.push({
      at,
      x: rect.x - grown,
      y: rect.y - grown,
      width: rect.width + grown * 2,
      height: rect.height + grown * 2,
      radius,
    });
  }

  return { keys, shadow };
}

/**
 * The departing box, restated in the arriving box's proportions.
 *
 * A plan item shows one crop, and a crop always has its destination's aspect
 * ratio — `place` derives the two together, under both fits. So a move that
 * lerped the previous slice's actual rectangle into this one's would spend the
 * whole transition drawing a wide crop inside a square box, or the reverse:
 * the picture stretches, worst at the midpoint, and it is a face it is
 * stretching.
 *
 * Same centre and same *area* as the box being left, so the move reads as the
 * picture changing shape rather than as it changing size. What is given up is
 * that the opening frame is not pixel-identical to the closing frame of the
 * slice before — it is the same picture, the same size, in the same place, in
 * the shape it is on its way to.
 */
function reshaped(previous: Rect, target: Rect): Rect {
  const area = previous.width * previous.height;
  const targetArea = target.width * target.height;

  if (area <= 0 || targetArea <= 0) return { ...previous, width: 0, height: 0 };

  const scale = Math.sqrt(area / targetArea);
  const width = target.width * scale;
  const height = target.height * scale;

  return {
    x: previous.x + previous.width / 2 - width / 2,
    y: previous.y + previous.height / 2 - height / 2,
    width,
    height,
  };
}

/** A rectangle of nothing, in the middle of one that is there. */
function nothingAt(rect: Rect): Rect {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: 0, height: 0 };
}

/**
 * Ease-out cubic.
 *
 * Leaves immediately and settles, which is what arriving somewhere should read
 * as. An ease that also started slowly would spend the first frames of the
 * clip looking like the cut simply had not happened yet.
 */
function easeOut(t: number): number {
  const clamped = clamp(t, 0, 1);
  return 1 - (1 - clamped) ** 3;
}

/** How long a move gets in a slice, which is never more than half of it. */
function moveWindow(enter: EnterTransition): number {
  return Math.min(CAMERA_MOVE_NS, Math.max(0, enter.source.end - enter.source.start) / 2);
}

/**
 * The middle of the focused text area at a moment, if there was one.
 *
 * Held from the last sample rather than interpolated: focus does not slide from
 * one field to the next, it moves, and easing between two of them would send
 * the shot through everything in between. The smoothing pass afterwards is what
 * turns that step into a move.
 *
 * Null wherever nothing was focused, which is most of a recording and all of
 * one made without the Accessibility grant — the caller falls back to the
 * pointer, so a `typing` zoom is never worse than a `cursor` one.
 */
function typingCentre(cursor: CursorTrack | null | undefined, at: number): Point | null {
  const spans = cursor?.typing;
  if (!spans?.length || at < spans[0]!.at) return null;

  let low = 0;
  let high = spans.length;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (spans[mid]!.at <= at) low = mid;
    else high = mid;
  }

  const span = spans[low]!;
  // Stale after a while: a field focused a minute ago says nothing about where
  // the interesting part of the picture is now.
  if (at - span.at > TYPING_STALE_NS) return null;

  // A field the size of the picture is not a field, it is the page. An editor,
  // a terminal, a note — the focused element is one `AXTextArea` filling the
  // window, and its middle is the middle of the frame however far up the corner
  // the caret actually is. Aiming there parks the shot dead centre and stops it
  // following the pointer, which is the one thing this is documented never to
  // do. Wide and short is still worth having: a chat box across the foot of a
  // window says nothing about *where* along it, and everything about how far
  // down.
  if (span.width > TYPING_MAX_SPAN && span.height > TYPING_MAX_SPAN) return null;

  return { x: span.x + span.width / 2, y: span.y + span.height / 2 };
}

/** How long a focused field stays the answer after it was last seen. */
const TYPING_STALE_NS = 3_000_000_000;

/**
 * How much of the frame a focused field may cover in *both* directions and
 * still be worth aiming at.
 *
 * Half. A field that wide and that tall has its middle within a quarter-frame
 * of the centre wherever it sits, which is no better than not aiming at all.
 */
const TYPING_MAX_SPAN = 0.5;

/**
 * Takes the shake out of a path without moving it.
 *
 * A one-pole filter run forwards and then backwards. Forwards alone lags — the
 * path would trail the pointer by the length of the filter — and running it
 * both ways cancels that lag exactly, at the cost of needing the whole path up
 * front. Which is fine: it is all known before a frame is drawn, and this is
 * the reason a zoom is baked into the plan rather than evaluated live.
 *
 * Short on purpose, and no longer the only filter in the chain. Cancelling lag
 * in both directions means the output also moves *before* the input does, and
 * at the time constant this used to run at — three times the current one, with
 * nothing else steadying the shot — the camera drifted towards a flick half a
 * second before the hand made it. That pre-echo reads as the picture floating
 * for no reason. Following is `followPath`'s job now, and it is causal.
 */
function deJitter(path: Point[], stepSeconds: number): Point[] {
  if (path.length < 3 || stepSeconds <= 0) return path;

  // The fraction of the gap closed per step, from the time constant.
  const alpha = 1 - Math.exp(-stepSeconds / JITTER_SECONDS);

  // Seeded with the average of the samples the filter would have taken that
  // long to absorb, rather than with the first one. A one-pole filter started
  // on a single sample carries that sample's error until it settles, and run
  // both ways that lands the error at *both* ends of the path — the first
  // frames of a shot, which is exactly when the camera is deciding where to
  // point and the only time a viewer is watching it decide.
  const warm = Math.max(1, Math.min(path.length, Math.round(JITTER_SECONDS / stepSeconds)));

  const pass = (input: Point[]): Point[] => {
    const out: Point[] = [];
    const seed = input.slice(0, warm);
    let x = seed.reduce((total, point) => total + point.x, 0) / seed.length;
    let y = seed.reduce((total, point) => total + point.y, 0) / seed.length;

    for (const point of input) {
      x += (point.x - x) * alpha;
      y += (point.y - y) * alpha;
      out.push({ x, y });
    }
    return out;
  };

  return pass(pass(path).reverse()).reverse();
}

/**
 * The camera: a soft frame, a damped follow and a speed limit.
 *
 * Everything is in output pixels of picture travel, and the arithmetic in
 * `rectFor` makes that convenient — the aimed point lands in the middle of the
 * frame when the picture has travelled exactly as far as the aim, so the
 * difference between the two *is* the pointer's offset from the centre of the
 * frame. The dead zone and the speed limit can therefore be stated in the units
 * a viewer judges them in, with no mapping.
 *
 * Sequential, and therefore stateful, but still a pure function of the span: it
 * starts from the span's own first sample and steps over fixed times, so the
 * preview and the export get identical keys out of it.
 */
function followPath(
  aims: readonly Point[],
  /**
   * The pointer as it will actually be drawn, before the shake was taken out.
   *
   * The follow steers by the steadied path, because a tremble is not a reason
   * to move the camera. But "the pointer must stay in the shot" is about the
   * pointer a viewer can see, and steadying moves it — over a flick the two are
   * hundreds of pixels apart for a third of a second, which is exactly the
   * moment the guarantee is needed. Checking the smoothed one instead is a
   * guarantee about a position nothing ever draws.
   */
  drawn: readonly Point[],
  stepSeconds: number,
  frame: Size,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
): Point[] {
  const first = aims[0];
  if (!first || stepSeconds <= 0) return [...aims];

  // Measured against each edge separately, so the box the pointer is free to
  // move in has the frame's own proportions rather than being a square that
  // reaches the sides of a landscape frame long before its top and bottom.
  const still = { x: (DEAD_ZONE * frame.width) / 2, y: (DEAD_ZONE * frame.height) / 2 };
  const keep = { x: (KEEP_IN * frame.width) / 2, y: (KEEP_IN * frame.height) / 2 };
  // The shorter edge, like every other distance in this file, so a pan is the
  // same speed in a landscape frame and a portrait one.
  const reach = MAX_PAN * Math.min(frame.width, frame.height) * stepSeconds;

  // Opens already framed rather than travelling in from wherever the last shot
  // left off — the picture is un-zoomed at the start of the span anyway, so
  // there is nothing on screen to catch up from and a lot to be wrong about.
  let x = clamp(first.x, bounds.minX, bounds.maxX);
  let y = clamp(first.y, bounds.minY, bounds.maxY);
  let vx = 0;
  let vy = 0;

  const out: Point[] = [];

  for (const [step, aim] of aims.entries()) {
    const targetX = clamp(x + past(aim.x - x, still.x), bounds.minX, bounds.maxX);
    const targetY = clamp(y + past(aim.y - y, still.y), bounds.minY, bounds.maxY);

    const wasX = x;
    const wasY = y;

    [x, vx] = damp(x, vx, targetX, stepSeconds, FOLLOW_SECONDS);
    [y, vy] = damp(y, vy, targetY, stepSeconds, FOLLOW_SECONDS);

    // On the move as a whole rather than per axis: a diagonal flick is not
    // licence to travel half again as fast as a straight one.
    const travelled = Math.hypot(x - wasX, y - wasY);
    if (travelled > reach) {
      const scale = reach / travelled;
      x = wasX + (x - wasX) * scale;
      y = wasY + (y - wasY) * scale;
      // Held back too, or the spring integrates against the limit for as long
      // as the flick lasts and then arrives carrying speed it never used.
      vx *= scale;
      vy *= scale;
    }

    // And then the one thing that is not negotiable: the pointer stays in the
    // shot. The speed limit is what a camera *should* do, this is what it must
    // do — a hand can cross the screen faster than any watchable pan, and the
    // choice there is between a camera that hurries and a shot of the wrong
    // part of the screen. Held inside the pannable range as well, or catching
    // the pointer would pull the picture off the area it filled; where the two
    // disagree the pointer is at the edge of the recording and on screen
    // anyway.
    const sprungX = x;
    const sprungY = y;
    const real = drawn[step] ?? aim;
    x = clamp(hold(x, real.x, keep.x), bounds.minX, bounds.maxX);
    y = clamp(hold(y, real.y, keep.y), bounds.minY, bounds.maxY);

    // Where a clamp moved the camera, the spring's own idea of how fast it was
    // going is no longer true. Left alone it carries that speed for as long as
    // the clamp is holding and then spends it all at once when it lets go,
    // which is a lurch arriving after the thing that caused it.
    if (x !== sprungX) vx = (x - wasX) / stepSeconds;
    if (y !== sprungY) vy = (y - wasY) / stepSeconds;

    out.push({ x, y });
  }

  return out;
}

/**
 * How far outside the still area the pointer has got, and nothing while it is
 * inside.
 *
 * The camera's whole reason to move. Aiming at this rather than at the pointer
 * is what stops the shot re-centring after every excursion: it moves exactly
 * far enough to put the pointer back on the boundary and then has nothing left
 * to do, so wherever the pointer settles inside the box is where the picture
 * stays.
 */
function past(error: number, half: number): number {
  if (Math.abs(error) <= half) return 0;
  return error - Math.sign(error) * half;
}

/**
 * The camera, brought forward far enough that the pointer is no further than
 * `half` from the middle of the frame.
 *
 * Never moves it away from the pointer, only towards — a camera that is already
 * close enough is left exactly where the follow put it.
 */
function hold(value: number, aim: number, half: number): number {
  return clamp(value, aim - half, aim + half);
}

/**
 * One step of a critically damped spring, as its exact solution rather than an
 * integration of it — so it is stable at any step length and never overshoots.
 *
 * A spring rather than the one-pole filter this file used to follow with,
 * because a filter's velocity jumps the moment its target does, and the target
 * here moves every time the pointer crosses the dead zone. Each jump is small;
 * one per frame is a stutter.
 *
 * `seconds` is the caller's rather than this file's: the camera and the pointer
 * both want a spring, and want it tuned an order of magnitude apart — half a
 * second behind reads as a camera following a hand, and as a broken pointer.
 */
function damp(
  value: number,
  velocity: number,
  target: number,
  stepSeconds: number,
  seconds: number,
): [number, number] {
  const w = 2 / seconds;
  const gap = value - target;
  const rate = velocity + w * gap;
  const decay = Math.exp(-w * stepSeconds);

  return [target + (gap + rate * stepSeconds) * decay, (velocity - rate * w * stepSeconds) * decay];
}

/** The pointer's position at a moment, as a fraction of the captured frame. */
function cursorFraction(cursor: CursorTrack | null | undefined, at: number): Point {
  const samples = cursor?.samples;
  if (!samples?.length) return { x: 0.5, y: 0.5 };

  if (at <= samples[0]!.at) return samples[0]!;
  const last = samples[samples.length - 1]!;
  if (at >= last.at) return last;

  let low = 0;
  let high = samples.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (samples[mid]!.at <= at) low = mid;
    else high = mid;
  }

  const a = samples[low]!;
  const b = samples[high]!;
  const span = b.at - a.at;
  const t = span > 0 ? (at - a.at) / span : 0;

  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

interface Point {
  x: number;
  y: number;
}

/**
 * How far the eye is from the picture, in multiples of its longer edge.
 *
 * The only free parameter in a perspective projection, and it is what separates
 * a lens from a caricature: close in, a modest tilt splays the near edge
 * violently. Far enough back to read as a long lens looking at a screen.
 */
const EYE_DISTANCE = 2.6;

/**
 * The range `perspective` picks the eye distance from.
 *
 * `FAR_EYE` is far enough that a tilt reads as an orthographic lean — the near
 * and far edges stay near enough the same length to look like a slab turned on
 * its side. `NEAR_EYE` is close enough for the same angle to splay violently,
 * which is a look people want and could not previously reach at any angle.
 *
 * Their midpoint is `EYE_DISTANCE`, so `depth: 0.5` is exactly what every
 * existing project was drawn at — pinned by a test, because the arithmetic is
 * easy to get wrong in a way that still produces a picture. A symmetric
 * expression around `EYE_DISTANCE` is how this was first written, and at a
 * plausible `FAR_EYE` it put the eye *behind* the picture.
 */
const FAR_EYE = 4;
const NEAR_EYE = 1.2;

/**
 * The picture's corners after a tilt, in output pixels with their divisors.
 *
 * Rotated about its own centre — pitch first, then yaw — and projected. The
 * rounded corners are deliberately *not* handled here: both rasterisers
 * evaluate the shape in the picture's own flat space and let the projection
 * carry it, which is what keeps a tilted frame's corners round instead of
 * sheared.
 *
 * Returns undefined when there is nothing to tilt, so an ordinary zoom stays
 * four numbers rather than sixteen.
 */
function rotatedQuad(
  rect: Rect,
  rotateX: number,
  rotateY: number,
  perspective: number,
): number[] | undefined {
  if (Math.abs(rotateX) < 0.01 && Math.abs(rotateY) < 0.01) return undefined;

  const pitch = (rotateX * Math.PI) / 180;
  const swing = (rotateY * Math.PI) / 180;
  // Near at 1, far at 0. Interpolated in eye distance rather than in field of
  // view: distance is what the projection below actually divides by, and going
  // through an angle would only be the same number with a trigonometric step
  // in front of it.
  const eye = FAR_EYE + (NEAR_EYE - FAR_EYE) * clamp(perspective, 0, 1);
  const distance = Math.max(rect.width, rect.height) * eye;

  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const halfWidth = rect.width / 2;
  const halfHeight = rect.height / 2;

  const out: number[] = [];

  // Top-left, top-right, bottom-left, bottom-right — the order the vertex id
  // walks a triangle strip.
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const x = sx! * halfWidth;
    const y = sy! * halfHeight;

    // Yaw about the vertical axis, then pitch about the horizontal one.
    const xa = x * Math.cos(swing);
    const za = -x * Math.sin(swing);

    const ya = y * Math.cos(pitch) - za * Math.sin(pitch);
    const zb = y * Math.sin(pitch) + za * Math.cos(pitch);

    // A corner behind the eye has no projection. Clamped rather than dropped:
    // the tilt range does not reach it, and a picture that vanishes at an
    // extreme is worse than one that flattens.
    const perspective = Math.max(distance - zb, distance * 0.2);
    // How much nearer things look bigger. Multiplies the position.
    const magnify = distance / perspective;

    // The third number is the *divisor*, not the magnification — it has to be
    // proportional to the corner's distance from the eye, because that is what
    // a GPU divides the varyings by. Storing the magnification instead inverts
    // the correction: the picture still has the right outline, but the image
    // inside it bends the wrong way across the diagonal where the two triangles
    // meet. That reads as a crease rather than as a tilt.
    out.push(cx + xa * magnify, cy + ya * magnify, perspective / distance);
  }

  return out;
}

/**
 * Where a point on the picture lands once the picture is tilted.
 *
 * The rational bilinear the four corners define — perspective-correct, which an
 * ordinary bilinear is not: on a tilted plane the middle of the texture is not
 * the middle of the quad, and interpolating the corners directly puts the
 * pointer visibly off whatever it is pointing at.
 *
 * `scale` falls out of the same sum. It is the local magnification, so a
 * pointer near the leading edge is drawn larger than one at the far edge, which
 * is what makes it read as lying on the picture rather than over it.
 */
function onPlane(quad: readonly number[], u: number, v: number): Point & { scale: number } {
  const weights = [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v];

  let x = 0;
  let y = 0;
  let total = 0;

  for (let corner = 0; corner < 4; corner += 1) {
    // Divided by the corner's own divisor, which is what makes this projective
    // rather than merely bilinear.
    const share = weights[corner]! / Math.max(quad[corner * 3 + 2]!, 1e-6);
    x += quad[corner * 3]! * share;
    y += quad[corner * 3 + 1]! * share;
    total += share;
  }

  if (total <= 0) return { x: 0, y: 0, scale: 1 };
  return { x: x / total, y: y / total, scale: total };
}

/**
 * A zoom's easing curve, evaluated at `t`.
 *
 * A cubic bézier through (0,0) and (1,1) with the zoom's two control points, so
 * it is the curve CSS `cubic-bezier()` describes and the control draws. The
 * first point shapes the entry, the second the exit.
 *
 * The x components have to be inverted before y can be read, because the curve
 * is parametric — `t` here is progress along the *ramp*, not along the curve's
 * own parameter, and the two only coincide for a straight x. Solved rather than
 * approximated with a lookup: this runs 30 times per zoom second at plan time,
 * not per frame, so the handful of iterations costs nothing measurable.
 *
 * The default control points make x(u) reduce to exactly u, and y to
 * 3t² − 2t³ — the `smoothstep` this replaced, to the bit.
 */
export function easeAt(
  curve: { easeInX: number; easeInY: number; easeOutX: number; easeOutY: number },
  t: number,
): number {
  const x = clamp(t, 0, 1);
  // The ends are exact by definition, and solving for them wastes iterations on
  // the two values that matter most.
  if (x === 0 || x === 1) return x;

  const u = bezierParameterAt(curve.easeInX, curve.easeOutX, x);
  return bezierAt(curve.easeInY, curve.easeOutY, u);
}

/** One component of a cubic bézier from 0 to 1, at parameter `u`. */
function bezierAt(c1: number, c2: number, u: number): number {
  const v = 1 - u;
  return 3 * v * v * u * c1 + 3 * v * u * u * c2 + u * u * u;
}

/** Its slope, which is what makes Newton's method worth using here. */
function bezierSlopeAt(c1: number, c2: number, u: number): number {
  const v = 1 - u;
  return 3 * v * v * c1 + 6 * v * u * (c2 - c1) + 3 * u * u * (1 - c2);
}

/**
 * The parameter at which the curve's x reaches `x`.
 *
 * Newton's method, falling back to bisection. Newton alone is not safe: with the
 * control points at an end the slope goes to zero, and a division by it throws
 * the guess outside the curve entirely — which reads as a zoom that jumps rather
 * than as a slightly wrong ease.
 */
function bezierParameterAt(x1: number, x2: number, x: number): number {
  let u = x;

  for (let step = 0; step < 8; step += 1) {
    const slope = bezierSlopeAt(x1, x2, u);
    if (Math.abs(slope) < 1e-6) break;

    const error = bezierAt(x1, x2, u) - x;
    if (Math.abs(error) < 1e-6) return u;

    u -= error / slope;
    if (u < 0 || u > 1) break;
  }

  let low = 0;
  let high = 1;
  // Twenty halvings put the answer inside a millionth, well under a pixel of
  // movement at any zoom level.
  for (let step = 0; step < 20; step += 1) {
    const mid = (low + high) / 2;
    if (bezierAt(x1, x2, mid) < x) low = mid;
    else high = mid;
  }

  return (low + high) / 2;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Where text was being typed, as the manifest records it. */
export interface TypingSpan {
  at: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The pointer track as the manifest records it: fractions of the frame. */
export interface CursorTrack {
  /**
   * One image per pointer the style ships, relative to the session directory.
   *
   * Images rather than settings: which pointer is on screen at a moment is a
   * property of the recording, and the tone is the choice. `arrow` is always
   * there and is what any kind the style has no image for is drawn as — which
   * is every kind but the hand, for a style that ships only those two.
   */
  shapes: { arrow: CursorShape } & Partial<Record<CursorKind, CursorShape>>;
  /** Press times, in source time, for the click animation. */
  clicks?: readonly number[];
  /**
   * `kind` is absent wherever the pointer was the arrow, and on every recording
   * made before the shape was sampled at all. `hand` is what those recordings
   * carry instead, and is read only as a fallback — see `cursorKind`.
   */
  samples: readonly { at: number; x: number; y: number; kind?: CursorKind; hand?: boolean }[];
  /** Size setting, as a fraction of the frame's shorter edge. */
  size: number;
  /** Seconds of stillness before it hides, or null to leave it on screen. */
  hideAfter: number | null;
  /**
   * Focused text areas, for a zoom that follows typing.
   *
   * Carried on the cursor track because a `typing` zoom needs both: the field
   * when there is one, and the pointer for the stretches — most of a recording
   * — where nothing is focused.
   */
  typing?: readonly TypingSpan[];
  /**
   * Stretches somebody was typing through, or nothing to leave the pointer on
   * screen while they do.
   *
   * The setting is resolved into this by the caller, the way `hideAfter` is: a
   * track with no spans and a track the user asked to keep the pointer through
   * are the same thing to draw, and neither is worth a second field.
   */
  keys?: readonly { start: number; end: number }[];
}

/**
 * Turns sampled pointer fractions into output-pixel positions.
 *
 * The mapping is the same one the screen image gets: a fraction of the captured
 * frame becomes a source pixel, and a source pixel inside the crop becomes an
 * output pixel. Doing it here is what keeps the exporter from having to know
 * anything about crops or fits — it receives positions already in the frame and
 * only interpolates between them.
 *
 * A sample outside the crop is marked invisible rather than clamped. Clamping
 * would park the pointer against the edge of the picture and hold it there,
 * which reads as a bug rather than as a pointer that has left.
 */
/**
 * How long a press takes to dip and come back, in nanoseconds.
 *
 * Short enough to read as a press rather than a pulse, long enough to survive
 * being sampled: at 30fps this is five or six frames, which is the least a
 * movement can occupy and still be seen rather than glimpsed.
 */
const CLICK_NS = 180 * 1_000_000;

/**
 * How far the pointer shrinks at the bottom of a press.
 *
 * Small on purpose. The pointer is already the thing being watched, and a dip
 * deep enough to be obvious on its own reads as the pointer jumping rather than
 * as a click — the cue people actually recognise is the *timing*, not the size.
 */
const CLICK_DEPTH = 0.82;

/**
 * Points sampled across a press.
 *
 * The dip has to be written into the track as points, because both rasterisers
 * interpolate `scale` linearly between whichever two they land between. A press
 * with only its ends sampled is a press that never happened — and the pointer
 * is usually *still* while it is clicked, so there is rarely a natural sample
 * anywhere inside the window to borrow.
 *
 * Nine points is one every 22ms, which is finer than a 60fps export asks for.
 */
const CLICK_STEPS = 8;

/**
 * The scale a press contributes at a moment, or 1 outside one.
 *
 * Down quickly and back more slowly, because that is the shape of a press: the
 * button gives at once and the finger comes off at its own pace. A symmetric
 * dip reads as a wobble.
 *
 * Overlapping presses — a double-click is two within a few tens of
 * milliseconds — take the deepest rather than multiplying. Multiplying would
 * make the second click of a pair visibly deeper than the first, which is the
 * opposite of what happened.
 */
export function pressScale(clicks: readonly number[] | undefined, at: number): number {
  if (!clicks?.length) return 1;

  let deepest = 1;

  for (const click of clicks) {
    const t = (at - click) / CLICK_NS;
    if (t < 0 || t > 1) continue;

    // Rising to 1 at a third of the way through, then easing back to 0.
    const DOWN = 1 / 3;
    const phase = t < DOWN ? t / DOWN : 1 - (t - DOWN) / (1 - DOWN);
    // Smoothstep on each leg, so the turn at the bottom is not a corner.
    const eased = phase * phase * (3 - 2 * phase);

    deepest = Math.min(deepest, 1 - (1 - CLICK_DEPTH) * eased);
  }

  return deepest;
}

/**
 * How far behind the recorded pointer the drawn one runs at the top of the
 * slider, in seconds.
 *
 * The spring's time constant. Anything longer stops reading as the hand that
 * made the recording — it arrives after the click it was going to, which is the
 * one thing a smoothed pointer must never do.
 */
const SMOOTH_SECONDS = 0.12;

/**
 * How often the smoothed path is written down, in nanoseconds.
 *
 * The output cadence rather than the capture's, because the corners being taken
 * out are the ones the plan's own straight lines put in: knots left where the
 * samples already were would join up into the same polyline.
 */
const SMOOTH_STEP = 16_666_666;

/**
 * The longest span the smoothing steps through, in nanoseconds.
 *
 * A gap longer than this is a parked pointer — the capture writes a sample only
 * when it moves — and stepping through it would fill in the very gap
 * `withIdleGaps` reads as stillness. Half a second is the shortest auto-hide
 * the control offers, so no gap that could hide a pointer is ever filled.
 */
const SMOOTH_MAX_SPAN = 500_000_000;

/**
 * The recorded path with the sampling taken back out of it.
 *
 * The track is written from the video callback, so it is sampled at 30 Hz at
 * best and not at all while the screen holds still — a pointer crossing a
 * static window is a hundred pixels further on by the next sample. Drawn the
 * way the plan draws it, every sample is then a corner and every span a dash at
 * one constant speed, which is the stepping this exists to take out.
 *
 * A critically damped spring chasing the recorded path, evaluated at the output
 * cadence: it rounds the corners, fills in what the capture never saw, and
 * cannot overshoot into a wobble the hand never made. Done here rather than in
 * either rasteriser, so the export draws the same path the preview does without
 * a line of Rust — the same reasoning as `withIdleGaps`.
 */
function smoothPath(samples: CursorTrack["samples"], strength: number): CursorTrack["samples"] {
  const seconds = SMOOTH_SECONDS * clamp(strength, 0, 1);
  if (seconds <= 0 || samples.length < 2) return samples;

  // How long the spring is given to arrive once the pointer stops. Four time
  // constants is well inside a pixel of the target, and stopping there is what
  // leaves the rest of a parked pointer's gap in the track.
  const settle = seconds * 4 * 1_000_000_000;

  const out = [samples[0]!];
  let x = samples[0]!.x;
  let y = samples[0]!.y;
  let vx = 0;
  let vy = 0;

  for (let index = 1; index < samples.length; index += 1) {
    const from = samples[index - 1]!;
    const to = samples[index]!;
    const span = to.at - from.at;

    // Two samples at one moment is a broken manifest rather than a span, and
    // dividing a step across it would put a NaN in every point after it.
    if (span <= 0) {
      out.push({ ...to, x, y });
      continue;
    }

    // A park is stepped through only as far as the settle; a span short enough
    // to be movement, all the way.
    const stepped = span > SMOOTH_MAX_SPAN ? Math.min(span, settle) : span;
    const steps = Math.max(1, Math.ceil(stepped / SMOOTH_STEP));
    const stepSeconds = stepped / steps / 1_000_000_000;

    for (let step = 1; step <= steps; step += 1) {
      const at = from.at + (stepped * step) / steps;
      // Aimed at where the recording says the pointer was *at this moment*, not
      // at the sample ending the span: a spring pulled straight to the next
      // sample arrives in jerks, and the jerks are what is being smoothed.
      const u = (at - from.at) / span;
      [x, vx] = damp(x, vx, from.x + (to.x - from.x) * u, stepSeconds, seconds);
      [y, vy] = damp(y, vy, from.y + (to.y - from.y) * u, stepSeconds, seconds);

      // The shape steps at the sample that recorded it, so a point inside the
      // span still belongs to the sample it started from.
      const recorded = step === steps && stepped === span ? to : from;
      out.push({ ...recorded, at: Math.round(at), x, y });
    }

    // The far end of a park, exactly as recorded, and the spring put back on it
    // rather than left wherever the settle reached — otherwise a pointer that
    // sat still for a minute starts its next move from a stale position and
    // takes the whole park's worth of lag with it.
    if (stepped < span) {
      out.push(to);
      x = to.x;
      y = to.y;
      vx = 0;
      vy = 0;
    }
  }

  // And the end of the track, which has no next sample to settle against: left
  // here, the last frames of a recording hold the pointer wherever the spring
  // had got to rather than where the hand actually stopped — a stop is where
  // the eye looks, and it is the one place the lag would be read as an error.
  //
  // Nothing to settle when the recording ends on a park: the spring was put
  // back on that sample already, and knots repeating it would do nothing but
  // push the auto-hide's own clock later.
  const end = samples[samples.length - 1]!;
  const settleSeconds = SMOOTH_STEP / 1_000_000_000;
  for (let step = 1; (x !== end.x || y !== end.y) && step * SMOOTH_STEP <= settle; step += 1) {
    [x, vx] = damp(x, vx, end.x, settleSeconds, seconds);
    [y, vy] = damp(y, vy, end.y, settleSeconds, seconds);
    out.push({ ...end, at: end.at + step * SMOOTH_STEP, x, y });
  }

  return out;
}

function cursorItems(
  cursor: CursorTrack,
  source: Size,
  srcRect: Rect,
  dstRect: Rect,
  unit: number,
  motion: readonly RectKey[],
  smoothing: number,
): PlanItem[] {
  // Smoothed once, up front, and read as the track from here down: the points
  // are written at the smoothed path's own moments, and nothing below this line
  // needs to know the recording was sampled at a different rate.
  const path: CursorTrack = { ...cursor, samples: smoothPath(cursor.samples, smoothing) };

  // Sampled wherever *either* moves. The pointer's own samples are written
  // only when it moves, so a pointer held still through a zoom has two points
  // a second apart — and interpolating its screen position between them would
  // slide it across the picture while the picture was itself moving. Adding a
  // point at every motion key keeps the two in step.
  const times = new Set(path.samples.map((sample) => sample.at));
  for (const key of motion) times.add(key.at);

  // And across every press. The pointer is usually held still while it is
  // clicked, so its own samples are seconds apart there and the dip would be
  // interpolated straight through — the animation would exist in the plan and
  // never be drawn.
  for (const click of path.clicks ?? []) {
    for (let step = 0; step <= CLICK_STEPS; step++) {
      times.add(Math.round(click + (CLICK_NS * step) / CLICK_STEPS));
    }
  }

  const points: ShapedPoint[] = [...times]
    .sort((a, b) => a - b)
    .map((at) => {
      const point = cursorFraction(path, at);
      const px = point.x * source.width;
      const py = point.y * source.height;

      // Through the picture's rectangle *at this moment*, not the un-zoomed
      // one. Mapping the pointer with a still rectangle while the picture
      // moves under it is what put it somewhere the thing it was pointing at
      // was not — and the further a zoom went, the further out it was.
      const rect = rectAt(motion, at, dstRect, 0);
      const u = (px - srcRect.x) / srcRect.width;
      const v = (py - srcRect.y) / srcRect.height;

      // On the tilted plane when there is one, so the pointer leans with the
      // picture instead of floating flat above it — and, when a tilt is steep,
      // instead of being placed clean off the frame.
      const placed = rect.quad
        ? onPlane(rect.quad, u, v)
        : { x: rect.x + u * rect.width, y: rect.y + v * rect.height, scale: 1 };

      return {
        at,
        x: placed.x,
        y: placed.y,
        // Folded into the scale the plan already carries, rather than added to
        // it as a field of its own. Both rasterisers multiply the pointer's
        // size by this one number — `compositor.rs` and `webgl.ts`, a line each
        // — so a press drawn this way cannot come out differently in the
        // preview and the export.
        scale: placed.scale * pressScale(path.clicks, at),
        visible:
          px >= srcRect.x &&
          px <= srcRect.x + srcRect.width &&
          py >= srcRect.y &&
          py <= srcRect.y + srcRect.height,
        kind: cursorKind(path, at),
      };
    });

  // Typing first, then stillness. A pointer hidden for typing is also, by then,
  // a pointer that has not moved — running the idle pass over the result lets
  // one long stretch of writing produce one hidden span rather than two
  // overlapping ones.
  const quiet = withTypingGaps(points, path.keys, unit);
  const timed = path.hideAfter === null ? quiet : withIdleGaps(quiet, path.hideAfter);
  const size = Math.max(1, path.size * unit);

  // The image each point is drawn with, which is not the kind it was recorded
  // as: a style that ships no I-beam draws the arrow there, so those points
  // belong to the arrow rather than to an item with no texture behind it.
  const shapeFor = (kind: CursorKind): CursorShape => path.shapes[kind] ?? path.shapes.arrow;

  return splitByShape(timed, shapeFor).map(({ shape, points: drawn }) => ({
    kind: "cursor" as const,
    path: shape.path,
    size,
    hotspot: shape.hotspot,
    points: drawn,
  }));
}

/** A point plus the pointer the system was showing there. Never leaves this file. */
type ShapedPoint = CursorPoint & { kind: CursorKind };

/** The point a plan carries, without the kind that chose its image. */
function plain(point: ShapedPoint): CursorPoint {
  return {
    at: point.at,
    x: point.x,
    y: point.y,
    scale: point.scale,
    visible: point.visible,
  };
}

/**
 * Which pointer the system was showing at a moment.
 *
 * A step, not a ramp: half an arrow and half an I-beam is not a cursor. The
 * shape holds from the sample that recorded it until the next one, which is
 * exactly what the capture side wrote — it forces a sample whenever the shape
 * changes, so a change is never further away than the sample that carries it.
 *
 * `hand` is the fallback for recordings made before the kind was a kind. Read
 * here and nowhere else, which is what keeps the migration to one line.
 */
function cursorKind(cursor: CursorTrack, at: number): CursorKind {
  const samples = cursor.samples;
  if (!samples.length) return "arrow";

  const of = (sample: { kind?: CursorKind; hand?: boolean }): CursorKind =>
    sample.kind ?? (sample.hand ? "hand" : "arrow");

  if (at <= samples[0]!.at) return of(samples[0]!);

  let low = 0;
  let high = samples.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (samples[mid]!.at <= at) low = mid;
    else high = mid;
  }

  return of(samples[high]!.at <= at ? samples[high]! : samples[low]!);
}

/**
 * One track, split into the points each image is responsible for.
 *
 * An item per image rather than one item that picks a texture per frame, for
 * the reason a lit caption is its own item: every plan item stays one quad, and
 * neither rasteriser learns that a pointer has shapes.
 *
 * Every point goes into every track, visible only in the one drawing it. That
 * is not redundancy — `cursorAt` interpolates between a track's own consecutive
 * points, so a track holding only the points it draws would slide its pointer
 * straight across the span where another image had it.
 *
 * The handover is the whole difficulty. Marking a point invisible in one list
 * and visible in the other leaves *both* lists with an invisible end to the
 * span they share — and `cursorAt` draws nothing across a span with an
 * invisible end — so the pointer blinks out for a sample's width every time it
 * crosses a link. The outgoing image therefore gets one extra visible point a
 * nanosecond short of the swap, the same trick `withIdleGaps` uses: it finishes
 * its span, the incoming one starts, and nothing is ever missing or doubled.
 */
function splitByShape(
  points: readonly ShapedPoint[],
  shapeFor: (kind: CursorKind) => CursorShape,
): { shape: CursorShape; points: CursorPoint[] }[] {
  const used = new Map<string, CursorShape>();
  for (const point of points) {
    const shape = shapeFor(point.kind);
    used.set(shape.path, shape);
  }

  const only = used.size <= 1 ? [...used.values()][0] : null;

  // One item, one texture, one quad — which is every recording made before the
  // pointer's shape was sampled, and most made since. Answered here rather than
  // falling out of the general case below, because the general case gives every
  // track a point for every sample: with one image that would be the same track
  // it already was, at several times the size.
  if (only) return points.length === 0 ? [] : [{ shape: only, points: points.map(plain) }];

  const tracks = new Map(
    [...used].map(([path, shape]) => [path, { shape, points: [] as CursorPoint[] }]),
  );

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    const previous = points[index - 1];
    const path = shapeFor(point.kind).path;
    const before = previous ? shapeFor(previous.kind).path : path;

    // Skipped when the two are already a nanosecond apart, which `withIdleGaps`
    // makes possible: the marker would land on or before its predecessor, and
    // an out-of-order point breaks the binary search that reads it back.
    if (previous && before !== path && point.at - 1 > previous.at) {
      tracks.get(before)!.points.push({ ...plain(point), at: point.at - 1 });
    }

    for (const [trackPath, track] of tracks) {
      track.points.push({ ...plain(point), visible: point.visible && trackPath === path });
    }
  }

  return [...tracks.values()];
}

/**
 * How long the pointer stays out of the way after the last press of a run.
 *
 * Long enough that a pause between words does not flash it back on — the spans
 * themselves already hold a run together through a second of thought, and this
 * covers the end of one. Short enough that reaching for the mouse finds the
 * pointer already there.
 */
const TYPING_TAIL_NS = 400_000_000;

/**
 * How fast the pointer has to be going to stay on screen through typing, in
 * fractions of the frame's shorter edge per second.
 *
 * The escape hatch, and the reason this is not simply "hidden between these two
 * times". A pointer that vanishes while it is travelling reads as a dropped
 * frame, and somebody who types with one hand while moving the mouse with the
 * other is owed the pointer they are moving. About twenty pixels a second in a
 * 1080-tall frame: a parked pointer's drift is orders of magnitude under it,
 * and the slowest deliberate move is orders over.
 */
const TYPING_STILL_RATE = 0.02;

/**
 * Hides the pointer through the stretches somebody was typing.
 *
 * Expressed as invisible points rather than as a rule either rasteriser has to
 * know about, exactly as `withIdleGaps` is: a span with an invisible end draws
 * nothing, so the export gets this without a line of Rust.
 *
 * Held markers at both edges for the same reason that function needs them, and
 * it is the whole difficulty here. A parked pointer has *no points* between the
 * sample it stopped at and the one it moved off — that gap is what says it was
 * parked — so marking points invisible would hide nothing at all through the
 * one case this exists for. The edges are written in instead: the pointer is
 * held where it was, disappears a nanosecond later, and comes back at the far
 * end.
 */
function withTypingGaps<T extends CursorPoint>(
  points: T[],
  keys: readonly { start: number; end: number }[] | undefined,
  unit: number,
): T[] {
  if (!keys?.length || points.length < 2) return points;

  const hidden = hiddenSpans(points, keys, TYPING_STILL_RATE * unit);
  if (hidden.length === 0) return points;

  const out: T[] = [];
  let index = 0;
  let open = false;

  /** The pointer's own place at a moment, as a point to write in. */
  const held = (at: number, like: T, visible: boolean): T => {
    const place = cursorAt(points, at)!;
    return { ...like, at, x: place.x, y: place.y, scale: place.scale, visible };
  };

  for (const point of points) {
    // Every edge that falls at or before this point, in order — both of them
    // for a stretch that begins and ends inside one gap, which is what a pointer
    // parked through a paragraph looks like.
    while (index < hidden.length) {
      const span = hidden[index]!;
      if (!open && span.from <= point.at) {
        out.push(held(span.from - 1, point, true));
        // Not when the point itself is the edge: it is about to be pushed
        // invisible at exactly this moment anyway.
        if (point.at > span.from) out.push(held(span.from, point, false));
        open = true;
        continue;
      }
      if (open && span.to <= point.at) {
        out.push(held(span.to, point, true));
        open = false;
        index += 1;
        continue;
      }
      break;
    }

    out.push(open ? { ...point, visible: false } : point);
  }

  return out;
}

/**
 * The stretches to hide, from the spans that were typed through.
 *
 * Two things happen here. Overlapping windows are merged — the tail on one span
 * can reach into the next — and each is cut short wherever the pointer set off,
 * which is the escape that keeps a pointer being moved on screen.
 */
function hiddenSpans(
  points: readonly CursorPoint[],
  keys: readonly { start: number; end: number }[],
  still: number,
): { from: number; to: number }[] {
  const windows: { from: number; to: number }[] = [];
  for (const span of keys) {
    const last = windows[windows.length - 1];
    if (last && span.start <= last.to) last.to = Math.max(last.to, span.end + TYPING_TAIL_NS);
    else windows.push({ from: span.start, to: span.end + TYPING_TAIL_NS });
  }

  const hidden: { from: number; to: number }[] = [];
  let index = 0;

  for (const window of windows) {
    // Nothing to take off the picture: the pointer had already left it.
    if (cursorAt(points, window.from) === null) continue;

    // The last point at or before the window opens. Walks forward once across
    // the whole track, because both lists are in order.
    while (index + 1 < points.length && points[index + 1]!.at <= window.from) index += 1;

    let to = window.to;
    for (let step = index; step + 1 < points.length && points[step]!.at < window.to; step += 1) {
      const a = points[step]!;
      const b = points[step + 1]!;
      if (b.at <= window.from || b.at <= a.at) continue;

      // Measured across the whole segment, not per frame: while the pointer is
      // parked the two ends of its gap are seconds apart, and the drift between
      // them is orders of magnitude under this.
      if (Math.hypot(b.x - a.x, b.y - a.y) / ((b.at - a.at) / 1_000_000_000) > still) {
        to = Math.max(window.from, a.at);
        break;
      }
    }

    if (to > window.from) hidden.push({ from: window.from, to });
  }

  return hidden;
}

/**
 * Hides the pointer wherever it sat still longer than `seconds`.
 *
 * Expressed as points rather than as a rule either rasteriser has to know
 * about: the track is only sampled when the pointer *moves*, so a long gap
 * between two samples is exactly a pointer that was parked. Two markers into
 * that gap — one holding it in place until the timeout, one invisible just
 * after — and `cursorAt` does the rest, because a span with an invisible end
 * already draws nothing. The exporter gets the behaviour without a line of
 * Rust.
 */
function withIdleGaps<T extends CursorPoint>(points: T[], seconds: number): T[] {
  const timeout = Math.max(0, seconds) * 1_000_000_000;
  const out: T[] = [];

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    out.push(point);

    const next = points[index + 1];
    // The last sample gets the same treatment: nothing follows it, so without
    // this the pointer sits on screen for the rest of the recording.
    if (next && next.at - point.at <= timeout) continue;

    out.push({ ...point, at: point.at + timeout });
    out.push({ ...point, at: point.at + timeout + 1, visible: false });
  }

  return out;
}

/**
 * The destination rectangle and radius at a moment.
 *
 * Mirrors `rect_at` in `crates/prequel-render/src/plan.rs`. Linear between
 * keys, because the curve is already in where the keys are.
 */
export function rectAt(
  keys: readonly RectKey[],
  at: number,
  fallback: Rect,
  fallbackRadius: number,
): RectKey {
  const base = { at, ...fallback, radius: fallbackRadius };
  if (keys.length === 0) return base;

  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  if (at <= first.at) return first;
  if (at >= last.at) return last;

  let low = 0;
  let high = keys.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (keys[mid]!.at <= at) low = mid;
    else high = mid;
  }

  const a = keys[low]!;
  const b = keys[high]!;
  const span = b.at - a.at;
  const t = span > 0 ? (at - a.at) / span : 0;

  // The quad rides along. Interpolating twelve numbers between two projections
  // is not the same as projecting the interpolated angle, but at a thirtieth of
  // a second apart the difference is far below a pixel — and it keeps both
  // rasterisers ignorant of what a tilt even is.
  const quad =
    a.quad && b.quad && a.quad.length === b.quad.length
      ? a.quad.map((value, index) => lerp(value, b.quad![index]!, t))
      : (b.quad ?? a.quad);

  const focus =
    a.focus && b.focus
      ? {
          x: lerp(a.focus.x, b.focus.x, t),
          y: lerp(a.focus.y, b.focus.y, t),
          safe: lerp(a.focus.safe, b.focus.safe, t),
          strength: lerp(a.focus.strength, b.focus.strength, t),
        }
      : (b.focus ?? a.focus);

  // Treated as zero where a key does not carry it, rather than falling back to
  // the other key's value: the field is absent because there is no vignette
  // there, so holding the neighbour's would darken a frame that asked not to be.
  const vignette = lerp(a.vignette ?? 0, b.vignette ?? 0, t);

  return {
    at,
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    width: lerp(a.width, b.width, t),
    height: lerp(a.height, b.height, t),
    radius: lerp(a.radius, b.radius, t),
    ...(quad ? { quad } : {}),
    ...(focus ? { focus } : {}),
    ...(vignette > 0 ? { vignette } : {}),
  };
}

/**
 * What a caption item draws at a moment, or null if it draws nothing.
 *
 * The second piece of arithmetic that exists on both sides, after `cursorAt`,
 * and for the same reason: a plan cannot hold a rectangle per output frame.
 * `caption_at` in `crates/prequel-render/src/plan.rs` mirrors it, and the two
 * are pinned together by fixtures that are deliberately identical.
 *
 * `src` comes back in bitmap pixels; normalising it against the texture is the
 * caller's job, since only the caller knows what it bound.
 */
export function captionAt(
  item: Extract<PlanItem, { kind: "caption" }>,
  at: number,
): { src: Rect; dst: Rect } | null {
  const { bitmap, dstRect, span, words } = item;

  // Half-open, so a cue ending exactly where the next begins does not draw
  // both for one frame.
  if (at < span.start || at >= span.end) return null;

  if (words.length === 0) {
    return {
      src: { x: 0, y: 0, width: bitmap.width, height: bitmap.height },
      dst: dstRect,
    };
  }

  // Nothing between words: the gap is silence, and lighting the word either
  // side of it through the gap reads as the highlight lagging the voice.
  const word = words.find((candidate) => at >= candidate.at && at < candidate.end);
  if (!word) return null;

  if (bitmap.width <= 0 || bitmap.height <= 0) return null;

  // The bitmap maps onto `dstRect` whole, so a box inside it maps by the same
  // two factors. Nothing is re-derived: this is the one mapping, and it is the
  // same arithmetic on the other side.
  const sx = dstRect.width / bitmap.width;
  const sy = dstRect.height / bitmap.height;

  const width = word.width * sx * word.scale;
  const height = word.height * sy * word.scale;

  return {
    src: { x: word.x, y: word.y, width: word.width, height: word.height },
    // Grown about its own centre, so a pop swells the word in place rather
    // than pushing it down and to the right.
    dst: {
      x: dstRect.x + word.x * sx - (width - word.width * sx) / 2,
      y: dstRect.y + word.y * sy - (height - word.height * sy) / 2,
      width,
      height,
    },
  };
}

/**
 * Where the pointer is at a moment, or null if it is not on screen.
 *
 * Shared by both rasterisers through the plan rather than by being written
 * twice: the canvas calls this per frame and the exporter's mirror of it is
 * pinned by a golden-pixel test. Linear between samples, because the track is
 * sampled at 30 Hz and playback is not.
 */
export function cursorAt(
  points: readonly CursorPoint[],
  at: number,
): { x: number; y: number; scale: number } | null {
  if (points.length === 0) return null;

  // Before the first sample the pointer had not moved yet, so it was wherever
  // the first sample says — not absent.
  if (at <= points[0]!.at) return points[0]!.visible ? points[0]! : null;

  const last = points[points.length - 1]!;
  if (at >= last.at) return last.visible ? last : null;

  let low = 0;
  let high = points.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (points[mid]!.at <= at) low = mid;
    else high = mid;
  }

  const a = points[low]!;
  const b = points[high]!;
  // Either end being off screen makes the span between them off screen: the
  // pointer left somewhere in there, and guessing where is worse than not
  // drawing it for one sample's width of time.
  if (!a.visible || !b.visible) return null;

  const span = b.at - a.at;
  const t = span > 0 ? (at - a.at) / span : 0;

  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    scale: a.scale + (b.scale - a.scale) * t,
  };
}

/**
 * What each picture is given: an area of the frame, and how it fills it.
 *
 * The one place an arrangement becomes geometry. Everything downstream only
 * fits a source into the box it is handed, so adding a layout is adding an arm
 * to the switch below and nothing else.
 */
export interface Slot {
  area: Rect;
  /**
   * `contain` shows all of the source inside the area and leaves gaps where the
   * shapes disagree; `cover` fills the area and crops the overflow.
   *
   * `cover` wherever the area was worked out *from* the source's own shape —
   * the two then agree exactly at zoom 1, and zooming in crops rather than
   * spilling the picture over its neighbour.
   */
  fit: "contain" | "cover";
  /**
   * Dressed as a card — the frame's corner radius, the border, and a shadow
   * measured against the frame. False makes the camera a bubble instead: its
   * own shape, and a shadow measured against itself.
   *
   * The screen is always a card. There is nothing for it to float over.
   */
  card: boolean;
}

/** How wide the source is per unit of height. 1 for anything degenerate. */
function aspectOf(source: Size | null | undefined): number {
  if (!source || source.width <= 0 || source.height <= 0) return 1;
  return source.width / source.height;
}

/**
 * How wide a bubble of a given shape wants to be, per unit of height.
 *
 * The shape's *only* remaining say in geometry, and it is exercised once — when
 * the shape control writes `cameraWidth`. Deriving the width here on every
 * frame instead is what would make a resized bubble snap back to a square.
 */
export function shapeAspect(shape: CameraShape, source?: Size | null): number {
  return shape === "wide" ? aspectOf(source) : 1;
}

/**
 * A box of a given size about a centre, kept wholly inside the frame.
 *
 * Clamped rather than allowed off the edge: dragging is how these are
 * positioned, and a picture half off the edge in the preview would be half off
 * the edge in the export too — a state worth making unreachable rather than one
 * to explain afterwards. A box wider than the frame degrades to flush left
 * rather than to a negative range.
 */
function boxAt(frame: Size, cx: number, cy: number, width: number, height: number): Rect {
  return {
    x: clamp(cx * frame.width, width / 2, Math.max(width / 2, frame.width - width / 2)) - width / 2,
    y:
      clamp(cy * frame.height, height / 2, Math.max(height / 2, frame.height - height / 2)) -
      height / 2,
    width,
    height,
  };
}

/** The frame inset on all four sides. Never negative. */
function inset(frame: Size, by: number): Rect {
  return {
    x: by,
    y: by,
    width: Math.max(0, frame.width - by * 2),
    height: Math.max(0, frame.height - by * 2),
  };
}

/**
 * The shape the camera is guaranteed in a shared frame, as width over height.
 *
 * A share of the row is the wrong thing to promise. Matching the screen's
 * height means the camera's *height* is already decided, so what is left over
 * is a width — and a 16:9 recording beside a camera eats almost all of it. At
 * eighteen per cent of the row the camera came out around 0.39 wide per unit
 * tall: a slit, with a face cropped down to a nose.
 *
 * So the promise is a shape instead. The camera may be no narrower than two
 * thirds in a column and no wider than two to one in a row, and where that
 * cannot be had beside a screen at full height, the pair shrinks until it can.
 * Losing some of the frame's height is the cheaper mistake — the alternative
 * spends it on a picture too thin to show a face.
 */
const CAMERA_COLUMN = 2 / 3;
const CAMERA_ROW = 2;

/**
 * Where both pictures go.
 *
 * Deliberately the only function that reads `layout.preset`. The plan builder,
 * the preview's hit-testing and the picker's thumbnails all call this, so there
 * is one answer to "where is the camera" and it cannot be disagreed with.
 */
/**
 * Whether the camera floats over the screen rather than sharing the frame.
 *
 * The one place this is decided. `layoutBoxes` sets `Slot.card` from it and the
 * inspector greys out the shrink controls by it, so a control cannot offer
 * something the plan then declines to do — the same reason `zoomSpanAt` is
 * shared between the timeline's ghost and the reducer that accepts it.
 *
 * `custom` is arrived at from both kinds of arrangement and remembers which in
 * `cameraCard`; every other arrangement decides for itself.
 */
export function cameraFloats(layout: LayoutSettings): boolean {
  switch (layout.preset) {
    case "over-full":
    case "over-padded":
      return true;
    case "custom":
      return !layout.cameraCard;
    default:
      return false;
  }
}

export function layoutBoxes(
  frame: Size,
  layout: LayoutSettings,
  background: BackgroundSettings,
  sources: SourceSizes,
): { screen: Slot | null; camera: Slot | null } {
  const unit = Math.min(frame.width, frame.height);
  const gap = background.padding * unit;
  const padded = inset(frame, gap);
  const whole: Rect = { x: 0, y: 0, width: frame.width, height: frame.height };

  // The camera wherever the arrangement leaves it free to be placed. `card` is
  // the arrangement's to decide everywhere but `custom`, which is arrived at
  // from both kinds and has to be told which it came from — so it is asked of
  // `cameraFloats` rather than spelled out again here.
  const free = (): Slot => ({
    area: boxAt(
      frame,
      layout.cameraX,
      layout.cameraY,
      Math.max(1, layout.cameraWidth * unit),
      Math.max(1, layout.cameraHeight * unit),
    ),
    fit: "cover",
    card: !cameraFloats(layout),
  });

  // Hidden by the toggle, or because the arrangement has no room for it. The
  // `camera-*` arrangements ignore the toggle: the camera is the whole picture
  // there, and the arrangement is how it gets turned off.
  const withCamera = layout.cameraVisible && sources.camera !== null;

  switch (layout.preset) {
    // Padding does not apply to a full-bleed picture.
    //
    // Insetting first and then filling what was left made "Fill" crop a
    // recording whose shape already matched the frame: the padding is a
    // fraction of the *shorter* edge taken off all four sides, so the box left
    // behind is always wider than the frame it sits in, and filling that box
    // means cropping to a shape nothing was recorded in. A 16:9 screen in a
    // 16:9 frame lost six per cent of its picture and still stopped short of
    // the edges — a crop that bought nothing, which is exactly how it read.
    case "over-full":
      return {
        screen: { area: whole, fit: "cover", card: true },
        camera: withCamera ? free() : null,
      };

    case "over-padded":
      return {
        screen: { area: padded, fit: "contain", card: true },
        camera: withCamera ? free() : null,
      };

    case "screen-full":
      return { screen: { area: whole, fit: "cover", card: true }, camera: null };

    case "screen-padded":
      return { screen: { area: padded, fit: "contain", card: true }, camera: null };

    case "camera-full":
      return { screen: null, camera: { area: whole, fit: "cover", card: true } };

    case "camera-padded":
      return { screen: null, camera: { area: padded, fit: "contain", card: true } };

    case "beside":
    case "stacked": {
      if (!withCamera) {
        return { screen: { area: padded, fit: "contain", card: true }, camera: null };
      }
      const [screen, camera] = matched(padded, gap, aspectOf(sources.screen), layout.preset);
      return {
        screen: { area: screen, fit: "cover", card: true },
        camera: { area: camera, fit: "cover", card: true },
      };
    }

    case "split":
    case "split-stacked": {
      if (!withCamera) {
        return { screen: { area: padded, fit: "contain", card: true }, camera: null };
      }
      const [screen, camera] = halves(padded, gap, layout.preset === "split");
      return {
        screen: { area: screen, fit: "cover", card: true },
        camera: { area: camera, fit: "cover", card: true },
      };
    }

    // Both boxes exactly as they were dragged, and the camera dressed the way
    // it was in whichever arrangement this was reached from. Anything else
    // changes the camera's shape the moment the *screen* is dragged.
    case "custom":
      return {
        screen: {
          area: boxAt(
            frame,
            layout.screenX,
            layout.screenY,
            Math.max(1, layout.screenWidth * unit),
            Math.max(1, layout.screenHeight * unit),
          ),
          fit: "cover",
          card: true,
        },
        camera: withCamera ? free() : null,
      };
  }
}

/**
 * Where one picture ends up, without building a whole plan for it.
 *
 * The preview needs this to know what was clicked on, and needs it to be the
 * *same* rectangle the plan draws — hit-testing against a second guess is how a
 * handle comes to sit somewhere the picture is not. Null when the arrangement
 * has no place for that source, or the source has not opened yet.
 */
export function placement(
  frame: Size,
  layout: LayoutSettings,
  background: BackgroundSettings,
  sources: SourceSizes,
  which: PlanSource,
): (Slot & { dstRect: Rect; srcRect: Rect }) | null {
  const source = sources[which];
  const slot = layoutBoxes(frame, layout, background, sources)[which];
  if (!source || !slot) return null;

  const fitted =
    which === "screen"
      ? place(
          source,
          slot.area,
          slot.fit,
          layout.screenZoom,
          layout.screenOffsetX,
          layout.screenOffsetY,
        )
      : place(
          source,
          slot.area,
          slot.fit,
          layout.cameraZoom,
          layout.cameraOffsetX,
          layout.cameraOffsetY,
        );

  // The slot comes back with it, because what an offset *means* depends on the
  // fit: under `cover` it moves the crop window through the source, and under
  // `contain` there is no window to move and it slides the picture inside its
  // area instead. A dragger that assumed one of the two would push the picture
  // the wrong way in half the arrangements.
  return { ...slot, ...fitted };
}

/**
 * Two boxes sharing an area, one edge matched to the other's.
 *
 * The screen keeps its own proportions and the camera takes what is left, which
 * is what puts a 16:9 recording beside a portrait crop of a webcam. Where what
 * is left would be thinner than `CAMERA_COLUMN` (or, stacked, wider than
 * `CAMERA_ROW`), the pair shrinks off its matched edge until the camera has the
 * shape it was promised — both stay the same height as each other throughout,
 * and the pair stays centred in the area.
 *
 * The screen is still the prominent one: at a 16:9 recording and these limits
 * it takes about seven tenths of the row. That falls out of the arithmetic
 * rather than being asked for, because it is the screen's own proportions doing
 * it — a squarer recording gets a squarer split, which is the honest answer.
 */
function matched(
  area: Rect,
  gap: number,
  screenAspect: number,
  preset: "beside" | "stacked",
): [Rect, Rect] {
  if (preset === "beside") {
    const room = Math.max(0, area.width - gap);
    // Full height first, and only give it up if the leftover is too thin.
    let height = area.height;
    if (height * screenAspect + height * CAMERA_COLUMN > room) {
      height = room / (screenAspect + CAMERA_COLUMN);
    }

    const screenWidth = height * screenAspect;
    const y = area.y + (area.height - height) / 2;
    // The camera takes everything left rather than exactly `CAMERA_COLUMN`, so
    // a narrow recording hands it the surplus instead of leaving a hole.
    return [
      { x: area.x, y, width: screenWidth, height },
      { x: area.x + screenWidth + gap, y, width: Math.max(0, room - screenWidth), height },
    ];
  }

  const room = Math.max(0, area.height - gap);
  let width = area.width;
  if (width / screenAspect + width / CAMERA_ROW > room) {
    width = room / (1 / screenAspect + 1 / CAMERA_ROW);
  }

  const screenHeight = width / screenAspect;
  const x = area.x + (area.width - width) / 2;
  return [
    { x, y: area.y, width, height: screenHeight },
    { x, y: area.y + screenHeight + gap, width, height: Math.max(0, room - screenHeight) },
  ];
}

/** An area cut in two down the middle, or across it, with the gap between. */
function halves(area: Rect, gap: number, sideBySide: boolean): [Rect, Rect] {
  if (sideBySide) {
    const width = Math.max(0, area.width - gap) / 2;
    return [
      { x: area.x, y: area.y, width, height: area.height },
      { x: area.x + width + gap, y: area.y, width, height: area.height },
    ];
  }

  const height = Math.max(0, area.height - gap) / 2;
  return [
    { x: area.x, y: area.y, width: area.width, height },
    { x: area.x, y: area.y + height + gap, width: area.width, height },
  ];
}

/**
 * Where a picture lands, and which part of it is shown.
 *
 * Both at once, because they are one decision. Working them out separately is
 * how the two came to disagree: the destination was handed the whole padded
 * area under `cover` while the source window was clamped to the pixels that
 * actually exist, and a window of one shape drawn into a rectangle of another
 * is a stretched picture.
 *
 * The invariant this exists to hold: the source window and the destination
 * always have the same aspect ratio. Nothing here may return a pair that does
 * not, whatever the fit, the zoom or the shape of the frame.
 *
 * One fitter for both sources. The camera used to reach its crop through a
 * centre-square and a tighten instead — a second implementation that happened
 * to agree, right up until a bubble stopped being square.
 */
function place(
  source: Size,
  area: Rect,
  fit: "contain" | "cover",
  zoomLevel: number,
  offsetX: number,
  offsetY: number,
): { dstRect: Rect; srcRect: Rect } {
  const whole: Rect = { x: 0, y: 0, width: source.width, height: source.height };
  if (area.width <= 0 || area.height <= 0) {
    return { dstRect: { ...area, width: 0, height: 0 }, srcRect: whole };
  }

  const zoom = Math.max(0.05, zoomLevel);

  // `contain` shows all of it, letterboxed: the whole source, scaled to fit.
  if (fit !== "cover") {
    const scale = Math.min(area.width / source.width, area.height / source.height) * zoom;
    const width = source.width * scale;
    const height = source.height * scale;

    return {
      dstRect: {
        x: area.x + (area.width - width) / 2 + offsetX * area.width,
        y: area.y + (area.height - height) / 2 + offsetY * area.height,
        width,
        height,
      },
      srcRect: whole,
    };
  }

  // `cover` fills the area and lets the crop take the overflow, which is what
  // makes a 16:9 recording usable in a vertical frame at all.
  const scale = Math.max(area.width / source.width, area.height / source.height) * zoom;
  let windowWidth = area.width / scale;
  let windowHeight = area.height / scale;

  // There is no more source than there is. Both sides are divided by the same
  // factor, so the window keeps the area's shape and the shortfall is taken out
  // of how much of the frame gets filled — never out of the picture's
  // proportions. Zooming out past the point where the whole source is on show
  // therefore letterboxes, which is the honest answer: the pixels to fill the
  // rest were never recorded.
  const overflow = Math.max(windowWidth / source.width, windowHeight / source.height, 1);
  windowWidth /= overflow;
  windowHeight /= overflow;

  const width = area.width / overflow;
  const height = area.height / overflow;

  return {
    dstRect: {
      x: area.x + (area.width - width) / 2,
      y: area.y + (area.height - height) / 2,
      width,
      height,
    },
    // Clamped so an offset cannot walk the window off the edge of the source
    // and start sampling nothing.
    srcRect: {
      x: clamp(
        (source.width - windowWidth) / 2 + offsetX * source.width,
        0,
        source.width - windowWidth,
      ),
      y: clamp(
        (source.height - windowHeight) / 2 + offsetY * source.height,
        0,
        source.height - windowHeight,
      ),
      width: windowWidth,
      height: windowHeight,
    },
  };
}

/** Corner radius per shape, off the bubble's shorter edge. */
function radiusFor(shape: CameraShape, edge: number): number {
  if (shape === "rounded") return edge * 0.18;
  // Modest, because the point of `wide` is the whole picture — a heavy round
  // starts eating the corners of what it was chosen to show.
  if (shape === "wide") return edge * 0.12;
  return edge / 2;
}

function toPaint(background: Background): Paint {
  switch (background.kind) {
    case "solid":
      return { kind: "solid", color: background.color };
    case "gradient":
      return {
        kind: "gradient",
        from: background.from,
        to: background.to,
        angle: background.angle,
      };
    case "image":
      return { kind: "image", path: background.path };
  }
}

/** `#rrggbb` plus an alpha, as an `rgba()` both rasterisers can read. */
/** A rectangle grown outwards on every edge. */
function grow(rect: Rect, by: number): Rect {
  return {
    x: rect.x - by,
    y: rect.y - by,
    width: rect.width + by * 2,
    height: rect.height + by * 2,
  };
}

/**
 * One key of a track, grown the same way — corner radius included.
 *
 * The radius has to grow with it or the ring changes width round the corners as
 * the picture moves: an outward offset of a rounded rectangle is a rounded
 * rectangle whose radius is larger by the offset, and anything else is a
 * different curve running beside the picture's own.
 */
function grownKey(key: RectKey, by: number): RectKey {
  return { ...key, ...grow(key, by), radius: key.radius + by };
}

function rgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16) || 0;
  const g = parseInt(value.slice(2, 4), 16) || 0;
  const b = parseInt(value.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
