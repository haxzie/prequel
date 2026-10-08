/**
 * The one place a frame is painted.
 *
 * It takes a plan from `lib/free-tools/layout.ts` and draws it. It derives no
 * position of its own, and that is the rule: the preview a reader approves and
 * the canvas the file is encoded from call this same function with the same
 * plan, so there is no arrangement in which they can disagree.
 */
import type { Rect, RenderPlan } from "@/lib/free-tools/layout";

/** Anything the compositor can draw a rectangle of. */
export type Source = HTMLVideoElement | HTMLCanvasElement | null;

/**
 * Whether a video element has a frame to give.
 *
 * `drawImage` with a video that has not reached `HAVE_CURRENT_DATA` throws in
 * Safari and silently draws nothing in Chrome, which on a hidden tab is a
 * recording that starts with a few black frames. `videoWidth` is the second
 * half of the test: a track that has been stopped keeps a ready state and
 * reports a zero width.
 */
function drawable(source: Source): source is HTMLVideoElement | HTMLCanvasElement {
  if (!source) return false;
  if (source instanceof HTMLCanvasElement) return source.width > 0;
  return source.readyState >= 2 && source.videoWidth > 0;
}

/** The size of whatever a source is currently handing over. */
export function sourceFrame(source: Source): { width: number; height: number } | null {
  if (!drawable(source)) return null;
  if (source instanceof HTMLCanvasElement) return { width: source.width, height: source.height };
  return { width: source.videoWidth, height: source.videoHeight };
}

/**
 * What is under everything, and all that is ever under it.
 *
 * Black, because the only thing this fills now is the bars either side of a
 * recording that does not match its frame, and black bars are what every player
 * and every platform already draws there. There were six gradients and a
 * swatch row; they went with the rest of the look controls.
 */
const GROUND = "#000000";

/**
 * A rounded rectangle path.
 *
 * `ctx.roundRect` has been in every browser that can run these tools since
 * 2023, and the hand-rolled fallback is four arcs for the one that cannot. The
 * radius is clamped to half the shorter edge, because a larger one draws nothing
 * at all in some engines rather than a pill.
 */
function roundedPath(ctx: CanvasRenderingContext2D, rect: Rect) {
  const radius = Math.min(rect.radius, Math.min(rect.width, rect.height) / 2);
  ctx.beginPath();

  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
    return;
  }

  ctx.moveTo(rect.x + radius, rect.y);
  ctx.arcTo(rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + rect.height, radius);
  ctx.arcTo(rect.x + rect.width, rect.y + rect.height, rect.x, rect.y + rect.height, radius);
  ctx.arcTo(rect.x, rect.y + rect.height, rect.x, rect.y, radius);
  ctx.arcTo(rect.x, rect.y, rect.x + rect.width, rect.y, radius);
  ctx.closePath();
}

/**
 * The one shadow left, under the camera bubble.
 *
 * Fixed rather than a control, and only under the bubble: a circle of a face
 * laid straight onto a screen recording of a white document has no edge at all
 * without it. Thrown by filling the rectangle opaquely before the picture goes
 * in, because drawing the video with a shadow set would put one behind every
 * frame it composites, which is both wrong and slow. The fill never shows.
 */
function castShadow(ctx: CanvasRenderingContext2D, rect: Rect, scale: number) {
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
  ctx.shadowBlur = 40 * scale;
  ctx.shadowOffsetY = 12 * scale;
  ctx.fillStyle = "#000000";
  roundedPath(ctx, rect);
  ctx.fill();
  ctx.restore();
}

/** Draw a source inside a rect, clipped to its radius, optionally mirrored. */
function drawInto(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  source: Source,
  mirrored = false,
  crop = false,
) {
  // The predicate on `drawable` is what makes `source` a real image source
  // below. Without it the null branch survives every check and `drawImage`
  // takes a type the compiler cannot vouch for.
  if (!drawable(source)) return;
  const frame = sourceFrame(source);
  if (!frame) return;

  ctx.save();
  roundedPath(ctx, rect);
  ctx.clip();

  if (mirrored) {
    ctx.translate(rect.x * 2 + rect.width, 0);
    ctx.scale(-1, 1);
  }

  if (crop) {
    // The camera bubble is a window onto the middle of the frame: a 16:9 webcam
    // squeezed into a circle is a face stretched tall, which is the one thing
    // nobody forgives. Everything else is `contain` and keeps its edges.
    const scale = Math.max(rect.width / frame.width, rect.height / frame.height);
    const width = frame.width * scale;
    const height = frame.height * scale;
    ctx.drawImage(
      source,
      rect.x + (rect.width - width) / 2,
      rect.y + (rect.height - height) / 2,
      width,
      height,
    );
  } else {
    ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height);
  }

  ctx.restore();
}

/**
 * One frame of the composition, start to finish.
 *
 * Called by the ticker for the recorded canvas and by the same ticker for the
 * preview, which is the same canvas: there is one surface, sized to the output,
 * and CSS scales it down to whatever the layout gives it. Two canvases would be
 * two code paths to the same picture, and the file is the one that matters.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  plan: RenderPlan,
  sources: { screen: Source; camera: Source },
) {
  const { width, height } = plan.frame;

  // The blur radius is in output pixels, so it is scaled against the frame:
  // 40px of blur is a soft lift at 1080p and a smudge at 480p.
  const scale = Math.min(width, height) / 1080;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, width, height);

  if (plan.screen) drawInto(ctx, plan.screen, sources.screen, false, plan.fit === "cover");

  if (plan.camera) {
    castShadow(ctx, plan.camera, scale);
    drawInto(ctx, plan.camera, sources.camera, plan.camera.mirrored, true);
  }
}
