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
import type { Background, SliceSettings, ZoomSlice } from "./project.js";

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
 * Every zoom's keys start and end at the un-zoomed rectangle, which is what
 * makes the gaps between zooms free: interpolating from base to base is base.
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
): RenderPlan {
  const items: PlanItem[] = [];
  const { layout, background } = settings;

  // The shorter edge is the reference for every fraction, so a setting means
  // the same thing in a landscape frame and a portrait one.
  const unit = Math.min(frame.width, frame.height);
  const full: Rect = { x: 0, y: 0, width: frame.width, height: frame.height };

  items.push({ kind: "fill", rect: full, paint: toPaint(background.background) });

  if (sources.screen) {
    // `cover` fills the frame, and the padding does not apply to it.
    //
    // Insetting first and then filling what was left made "Fill" crop a
    // recording whose shape already matched the frame: the padding is a
    // fraction of the *shorter* edge taken off all four sides, so the box left
    // behind is always wider than the frame it sits in, and filling that box
    // means cropping to a shape nothing was recorded in. A 16:9 screen in a
    // 16:9 frame lost six per cent of its picture and still stopped short of
    // the edges — a crop that bought nothing, which is exactly how it read.
    //
    // The two settings are answers to the same question. `contain` says show
    // all of it, and padding is how much room to leave around it; `cover` says
    // leave no gaps, and there is no room to leave.
    const padding = layout.screenFit === "cover" ? 0 : background.padding * unit;
    const area: Rect = {
      x: padding,
      y: padding,
      width: Math.max(0, frame.width - padding * 2),
      height: Math.max(0, frame.height - padding * 2),
    };

    const { dstRect, srcRect } = place(sources.screen, area, layout);
    const shape: Shape = { radius: background.cornerRadius * unit, exponent: 2 };

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
        rect: {
          x: dstRect.x - spread,
          y: dstRect.y - spread,
          width: dstRect.width + spread * 2,
          height: dstRect.height + spread * 2,
        },
        // The picture's own radius, not the grown rectangle's: what is being
        // drawn is the silhouette, and the bleed is only somewhere to draw it.
        shape,
        blur,
        dy: background.shadowY * unit,
        color: rgba("#000000", background.shadowOpacity),
        ...(shadowMotion.length > 0 ? { motion: shadowMotion } : {}),
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
      items.push(cursorItem(cursor, sources.screen, srcRect, dstRect, unit, motion));
    }

    if (background.borderWidth > 0) {
      items.push({
        kind: "stroke",
        rect: dstRect,
        shape,
        width: background.borderWidth * unit,
        color: background.borderColor,
        ...moving,
      });
    }
  }

  if (sources.camera && layout.cameraVisible) {
    const dstRect = cameraRect(frame, layout, sources.camera);
    const wide = layout.cameraShape === "wide";
    const bubbleShape: Shape = {
      // A circle is the degenerate case of the rounded rect, so there is one
      // code path rather than a special case that could drift from it. The
      // radius is measured off the shorter edge, or a wide bubble's corners
      // would grow with its width and swallow the picture.
      radius: radiusFor(layout.cameraShape, Math.min(dstRect.width, dstRect.height)),
      exponent: SHAPE_EXPONENT[layout.cameraShape],
    };

    // The bubble's own shadow, which is what lifts it off the picture instead
    // of leaving it stuck on like a sticker.
    //
    // Measured against the bubble rather than against the frame. Every other
    // distance here is a fraction of the frame's shorter edge, and the bubble
    // is a fraction of that again — so a blur sized for the screen is one this
    // would vanish into, and a drop sized for the screen would put the shadow
    // out from under it entirely. A small object casts a small tight shadow.
    if (background.shadowOpacity > 0) {
      const bubble = Math.min(dstRect.width, dstRect.height);
      const bubbleBlur = background.shadowBlur * bubble;
      const bubbleSpread = (bubbleBlur / 2) * SHADOW_SPREAD;

      items.push({
        kind: "shadow",
        rect: {
          x: dstRect.x - bubbleSpread,
          y: dstRect.y - bubbleSpread,
          width: dstRect.width + bubbleSpread * 2,
          height: dstRect.height + bubbleSpread * 2,
        },
        shape: bubbleShape,
        blur: bubbleBlur,
        dy: background.shadowY * bubble,
        color: rgba("#000000", background.shadowOpacity * CAMERA_SHADOW),
      });
    }

    items.push({
      kind: "image",
      source: "camera",
      // Every shape but `wide` is a square, and the camera is not — so
      // something has to be trimmed, and taking it from the middle is what
      // keeps a face centred. `wide` keeps the whole frame instead, which is
      // the point of it.
      srcRect: tightened(
        wide
          ? { x: 0, y: 0, width: sources.camera.width, height: sources.camera.height }
          : centreSquare(sources.camera),
        layout.cameraZoom,
      ),
      dstRect,
      shape: bubbleShape,
      mirror: layout.cameraMirror,
    });
  }

  return { frame, items };
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
 * Turns zoom spans into a sampled destination rectangle.
 *
 * The whole feature lives here. Everything downstream — the canvas, the
 * shader — only knows how to interpolate between two rectangles, which is what
 * keeps a zoom from being a second implementation of "where does the picture
 * sit" on the far side of an IPC boundary.
 *
 * Each span opens and closes on the un-zoomed rectangle, so the flat stretches
 * between zooms need no keys at all: interpolating base to base gives base.
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
  const keys: RectKey[] = [];
  const shadow: RectKey[] = [];

  for (const zoom of zooms) {
    const span = zoom.source.end - zoom.source.start;
    if (span <= 0) continue;

    // Both transitions inside the span, and never more than half of it each —
    // a 0.6s ease on a 0.5s zoom would still be arriving when it has to leave.
    const ease = Math.min(zoom.speed * 1_000_000_000, span / 2);
    const steps = Math.max(2, Math.ceil(span / ZOOM_SAMPLE_NS));
    const stepSeconds = span / steps / 1_000_000_000;

    const times = Array.from({ length: steps + 1 }, (_, step) =>
      Math.round(zoom.source.start + (span * step) / steps),
    );

    const level = Math.max(1, zoom.level);

    // How far the shot may look into the scaled picture before it pulls off the
    // area the recording filled. Exactly the clamp `rectFor` used to apply to
    // its own output, rearranged: with `target.x` being `frame.width / 2 -
    // travel.x`, the two bounds on the rectangle are two bounds on the travel.
    // The range comes out `base.width * (level - 1)` wide whatever the frame,
    // and collapses to a point at `level === 1` — an un-zoomed shot has nowhere
    // to pan to, which is correct.
    const bounds = {
      minX: frame.width / 2 - base.x,
      maxX: frame.width / 2 - base.x + base.width * (level - 1),
      minY: frame.height / 2 - base.y,
      maxY: frame.height / 2 - base.y + base.height * (level - 1),
    };

    // What the shot is aimed at, moment by moment — mapped to output pixels
    // here rather than followed as fractions of the capture. Mapping first is
    // what lets the dead zone and the speed limit be stated against the frame,
    // and it stops the steadying being stronger vertically than horizontally on
    // every source that is not square.
    const aims = times.map((at) => {
      const point =
        zoom.target === "region"
          ? { x: zoom.x, y: zoom.y }
          : zoom.target === "typing"
            ? (typingCentre(cursor, at) ?? cursorFraction(cursor, at))
            : cursorFraction(cursor, at);

      return {
        x: ((point.x * source.width - srcRect.x) / srcRect.width) * base.width * level,
        y: ((point.y * source.height - srcRect.y) / srcRect.height) * base.height * level,
      };
    });

    // A region is a fixed point: there is nothing to steady and nothing to
    // catch up with, and putting it through the follow would only make the shot
    // slide onto it after arriving.
    const path =
      zoom.target === "region"
        ? aims.map((aim) => ({
            x: clamp(aim.x, bounds.minX, bounds.maxX),
            y: clamp(aim.y, bounds.minY, bounds.maxY),
          }))
        : followPath(deJitter(aims, stepSeconds), aims, stepSeconds, frame, bounds);

    for (let step = 0; step <= steps; step += 1) {
      const at = rectFor(zoom, times[step]!, path[step]!, ease, frame, base, radius, spread);
      keys.push(at.key);
      shadow.push(at.shadow);
    }
  }

  return { keys, shadow };
}

/** Where the picture sits, and how big it is, at one moment of one zoom. */
function rectFor(
  zoom: ZoomSlice,
  at: number,
  travel: Point,
  ease: number,
  frame: Size,
  base: Rect,
  radius: number,
  spread: number,
): { key: RectKey; shadow: RectKey } {
  // How far in, 0 at both edges of the span and 1 through the middle.
  const into = at - zoom.source.start;
  const left = zoom.source.end - at;
  const amount = easeAt(zoom, Math.min(ease > 0 ? into / ease : 1, ease > 0 ? left / ease : 1));
  const level = Math.max(1, zoom.level);

  // Scaled about the aimed point and then centred on it, so the thing being
  // zoomed to ends up in the middle of the frame rather than wherever it
  // happened to be. The picture is free to run past the edges — that is the
  // difference between a camera pushing in and a still being cropped.
  const width = base.width * level;
  const height = base.height * level;

  // `travel` is how far into the scaled picture the shot is looking, in output
  // pixels, and `zoomKeys` has already held it inside the range that keeps the
  // picture over the area it filled. The clamp stays as a guard rather than as
  // the mechanism: doing it here is what used to stop the camera dead at an
  // edge, and a stop is the one thing a smoothed path is supposed to be free of.
  const target = {
    x: clamp(frame.width / 2 - travel.x, base.x + base.width - width, base.x),
    y: clamp(frame.height / 2 - travel.y, base.y + base.height - height, base.y),
  };

  const moved: Rect = {
    x: lerp(base.x, target.x, amount),
    y: lerp(base.y, target.y, amount),
    width: lerp(base.width, width, amount),
    height: lerp(base.height, height, amount),
  };

  // Eased in with the rest of the move, so the picture leans over as it comes
  // forward rather than snapping to an angle the moment the zoom begins.
  // The angle eases in with the move; the depth does not. Easing the distance
  // as well would zoom the lens while the shot travels, which reads as a dolly
  // and is not what anyone asked for by setting an angle.
  const quad = tiltedQuad(moved, zoom.tilt * amount, zoom.yaw * amount, zoom.depth);

  // Eased in with the move, so the surroundings soften as the shot arrives
  // rather than snapping out of focus. Measured against the frame, not the
  // picture, because it is the *viewer's* depth of field.
  const shorter = Math.min(frame.width, frame.height);
  const focus = zoom.blur
    ? {
        x: frame.width / 2,
        y: frame.height / 2,
        safe: zoom.blurSafe * shorter,
        strength: zoom.blurStrength * shorter * amount,
      }
    : undefined;

  // Eased in with the move for the same reason the blur is: a zoom should arrive
  // wearing its vignette rather than the frame darkening before the camera has
  // started travelling.
  const vignette = zoom.vignette * amount;

  // The corners grow with the picture. Left alone they would tighten as it
  // scaled, which reads as the frame changing shape mid-move.
  const grown = lerp(radius, radius * level, amount);

  // The shadow's own rectangle: the same one, with room around it for the blur
  // to fall off in. Projected here rather than inflated afterwards, because a
  // tilted picture's corners are a perspective projection and there is no way
  // to grow four projected corners by a distance in screen pixels — the angles
  // are known at this point and nowhere downstream.
  const bled: Rect = {
    x: moved.x - spread,
    y: moved.y - spread,
    width: moved.width + spread * 2,
    height: moved.height + spread * 2,
  };
  const bledQuad =
    spread > 0 ? tiltedQuad(bled, zoom.tilt * amount, zoom.yaw * amount, zoom.depth) : quad;

  return {
    key: {
      at,
      ...moved,
      radius: grown,
      ...(quad ? { quad } : {}),
      ...(focus ? { focus } : {}),
      ...(vignette > 0 ? { vignette } : {}),
    },
    // No focus and no vignette: neither rasteriser reads them for a shadow, and
    // carrying them would put the depth-of-field twice in every plan.
    shadow: {
      at,
      ...bled,
      radius: grown,
      ...(bledQuad ? { quad: bledQuad } : {}),
    },
  };
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

  return { x: span.x + span.width / 2, y: span.y + span.height / 2 };
}

/** How long a focused field stays the answer after it was last seen. */
const TYPING_STALE_NS = 3_000_000_000;

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

    [x, vx] = damp(x, vx, targetX, stepSeconds);
    [y, vy] = damp(y, vy, targetY, stepSeconds);

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
 */
function damp(
  value: number,
  velocity: number,
  target: number,
  stepSeconds: number,
): [number, number] {
  const w = 2 / FOLLOW_SECONDS;
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
 * The range `depth` picks the eye distance from.
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
function tiltedQuad(rect: Rect, tilt: number, yaw: number, depth: number): number[] | undefined {
  if (Math.abs(tilt) < 0.01 && Math.abs(yaw) < 0.01) return undefined;

  const pitch = (tilt * Math.PI) / 180;
  const swing = (yaw * Math.PI) / 180;
  // Near at 1, far at 0. Interpolated in eye distance rather than in field of
  // view: distance is what the projection below actually divides by, and going
  // through an angle would only be the same number with a trigonometric step
  // in front of it.
  const eye = FAR_EYE + (NEAR_EYE - FAR_EYE) * clamp(depth, 0, 1);
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
    const depth = Math.max(distance - zb, distance * 0.2);
    // How much nearer things look bigger. Multiplies the position.
    const magnify = distance / depth;

    // The third number is the *divisor*, not the magnification — it has to be
    // proportional to the corner's distance from the eye, because that is what
    // a GPU divides the varyings by. Storing the magnification instead inverts
    // the correction: the picture still has the right outline, but the image
    // inside it bends the wrong way across the diagonal where the two triangles
    // meet. That reads as a crease rather than as a tilt.
    out.push(cx + xa * magnify, cy + ya * magnify, depth / distance);
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
  /** Image to draw, relative to the session directory. */
  path: string;
  hotspot: { x: number; y: number };
  /** Press times, in source time, for the click animation. */
  clicks?: readonly number[];
  samples: readonly { at: number; x: number; y: number }[];
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
function cursorItem(
  cursor: CursorTrack,
  source: Size,
  srcRect: Rect,
  dstRect: Rect,
  unit: number,
  motion: readonly RectKey[],
): PlanItem {
  // Sampled wherever *either* moves. The pointer's own samples are written
  // only when it moves, so a pointer held still through a zoom has two points
  // a second apart — and interpolating its screen position between them would
  // slide it across the picture while the picture was itself moving. Adding a
  // point at every motion key keeps the two in step.
  const times = new Set(cursor.samples.map((sample) => sample.at));
  for (const key of motion) times.add(key.at);

  const points: CursorPoint[] = [...times]
    .sort((a, b) => a - b)
    .map((at) => {
      const point = cursorFraction(cursor, at);
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
        scale: placed.scale,
        visible:
          px >= srcRect.x &&
          px <= srcRect.x + srcRect.width &&
          py >= srcRect.y &&
          py <= srcRect.y + srcRect.height,
      };
    });

  return {
    kind: "cursor",
    path: cursor.path,
    size: Math.max(1, cursor.size * unit),
    hotspot: cursor.hotspot,
    points: cursor.hideAfter === null ? points : withIdleGaps(points, cursor.hideAfter),
  };
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
function withIdleGaps(points: CursorPoint[], seconds: number): CursorPoint[] {
  const timeout = Math.max(0, seconds) * 1_000_000_000;
  const out: CursorPoint[] = [];

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
 * Where the screen recording lands, and which part of it is shown.
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
 */
function place(
  source: Size,
  area: Rect,
  layout: SliceSettings["layout"],
): { dstRect: Rect; srcRect: Rect } {
  const whole: Rect = { x: 0, y: 0, width: source.width, height: source.height };
  if (area.width <= 0 || area.height <= 0) {
    return { dstRect: { ...area, width: 0, height: 0 }, srcRect: whole };
  }

  const zoom = Math.max(0.05, layout.screenZoom);

  // `contain` shows all of it, letterboxed: the whole source, scaled to fit.
  if (layout.screenFit !== "cover") {
    const scale = Math.min(area.width / source.width, area.height / source.height) * zoom;
    const width = source.width * scale;
    const height = source.height * scale;

    return {
      dstRect: {
        x: area.x + (area.width - width) / 2 + layout.screenOffsetX * area.width,
        y: area.y + (area.height - height) / 2 + layout.screenOffsetY * area.height,
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
        (source.width - windowWidth) / 2 + layout.screenOffsetX * source.width,
        0,
        source.width - windowWidth,
      ),
      y: clamp(
        (source.height - windowHeight) / 2 + layout.screenOffsetY * source.height,
        0,
        source.height - windowHeight,
      ),
      width: windowWidth,
      height: windowHeight,
    },
  };
}

/**
 * The camera bubble, centred on a fraction of the frame.
 *
 * Clamped so it always stays wholly inside: dragging is how it is positioned,
 * and a bubble half off the edge in the preview would be half off the edge in
 * the export too — which is a state worth making unreachable rather than one to
 * explain afterwards.
 */
export function cameraRect(
  frame: Size,
  layout: SliceSettings["layout"],
  /** The camera's own dimensions. Only consulted for the `wide` shape. */
  source?: Size | null,
): Rect {
  // `cameraSize` is the bubble's *height*, whatever its shape. Switching a
  // circle to `wide` then keeps it the size it was and grows it sideways,
  // rather than shrinking the face to fit the same square.
  const height = Math.max(1, layout.cameraSize * Math.min(frame.width, frame.height));
  const width = height * cameraAspect(layout, source);

  return {
    x:
      clamp(layout.cameraX * frame.width, width / 2, Math.max(width / 2, frame.width - width / 2)) -
      width / 2,
    y:
      clamp(
        layout.cameraY * frame.height,
        height / 2,
        Math.max(height / 2, frame.height - height / 2),
      ) -
      height / 2,
    width,
    height,
  };
}

/** How much wider than tall the bubble is. 1 for everything but `wide`. */
export function cameraAspect(layout: SliceSettings["layout"], source?: Size | null): number {
  if (layout.cameraShape !== "wide" || !source || source.height <= 0) return 1;
  return source.width / source.height;
}

/** Corner radius per shape, off the bubble's shorter edge. */
function radiusFor(shape: SliceSettings["layout"]["cameraShape"], edge: number): number {
  if (shape === "rounded") return edge * 0.18;
  // Modest, because the point of `wide` is the whole picture — a heavy round
  // starts eating the corners of what it was chosen to show.
  if (shape === "wide") return edge * 0.12;
  return edge / 2;
}

/**
 * Crops in on the middle of a rectangle.
 *
 * About its centre, so tightening the shot keeps a face where it was rather
 * than walking it towards a corner.
 */
function tightened(rect: Rect, zoom: number): Rect {
  const scale = Math.max(1, zoom);
  if (scale === 1) return rect;

  const width = rect.width / scale;
  const height = rect.height / scale;

  return {
    x: rect.x + (rect.width - width) / 2,
    y: rect.y + (rect.height - height) / 2,
    width,
    height,
  };
}

function centreSquare(source: Size): Rect {
  const edge = Math.min(source.width, source.height);
  return {
    x: (source.width - edge) / 2,
    y: (source.height - edge) / 2,
    width: edge,
    height: edge,
  };
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
