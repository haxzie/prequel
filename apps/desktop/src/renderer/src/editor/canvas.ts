/**
 * Draws a `RenderPlan` to a 2D context.
 *
 * Deliberately dumb about geometry. Every rectangle it draws was decided in
 * `shared/layout.ts` and arrives in absolute output pixels, so this file
 * contains none of its own — that is what keeps it agreeing with the exporter,
 * which rasterises the same plan.
 *
 * What it is *not* dumb about is cost. A plan repaints the whole frame, and
 * most of that frame is identical from one video frame to the next: the
 * background, and the blurred shadow behind the screen. Redrawing those sixty
 * times a second is what makes a preview with two video sources crawl, so they
 * are rendered once into a cached layer and blitted.
 */
import {
  cursorAt,
  rectAt,
  type Paint,
  type PlanItem,
  type PlanSource,
  type Rect,
  type RectKey,
  type RenderPlan,
  type Shape,
} from "../../../shared/layout";

/** What the plan's `source` names resolve to. Null when there is no frame. */
export type Sources = Record<PlanSource, CanvasImageSource | null>;

/** Background images, already loaded and keyed by their stored path. */
export type Images = Map<string, CanvasImageSource>;

/** The canvas's real pixel size, which is the display size — not the output's. */
export interface Backing {
  width: number;
  height: number;
}

/**
 * Draws plans, reusing everything it can between frames.
 *
 * Stateful because the cache is: held across frames and rebuilt only when the
 * static half of the plan actually changes.
 */
export class PreviewCompositor {
  private layer: HTMLCanvasElement | null = null;
  private signature = "";

  draw(
    context: CanvasRenderingContext2D,
    plan: RenderPlan,
    sources: Sources,
    images: Images,
    backing: Backing,
    /** Source time, for the one item in a plan that moves. */
    at = 0,
  ): void {
    if (backing.width <= 0 || backing.height <= 0 || plan.frame.width <= 0) return;

    // The plan is in output pixels; the canvas is the size it is displayed at.
    // Scaling here rather than rendering at output resolution is the single
    // biggest saving available: a 1080p plan shown in a 900px pane is nearly
    // five times the pixels, and at 4K it is eighteen.
    const scale = backing.width / plan.frame.width;

    // Everything up to the first video frame is the static half. In practice
    // that is the background fill and the shadow — the gradient and the blur,
    // which are the two most expensive things here and the two that do not
    // change between video frames.
    //
    // Unless they move. A zoom animates the shadow along with the picture it
    // sits under, and a cached shadow would stay the size it was while
    // everything above it grew.
    const split = plan.items.findIndex(
      (item) => item.kind === "image" || ("motion" in item && item.motion !== undefined),
    );
    const staticItems = split === -1 ? plan.items : plan.items.slice(0, split);
    const dynamic = split === -1 ? [] : plan.items.slice(split);

    this.refreshLayer(staticItems, images, backing, scale);

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, backing.width, backing.height);
    if (this.layer) context.drawImage(this.layer, 0, 0);

    context.setTransform(scale, 0, 0, scale, 0, 0);
    for (const item of dynamic) drawItem(context, item, sources, images, at);
    context.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Rebuilds the cached layer, but only when something in it changed. */
  private refreshLayer(items: PlanItem[], images: Images, backing: Backing, scale: number): void {
    // Stringified rather than compared field by field: the plan is rebuilt from
    // scratch every frame, so identity tells us nothing, and this is a handful
    // of small objects. The image keys are in it because a background that
    // finishes loading has to invalidate the layer that drew without it.
    const signature = JSON.stringify({ items, backing, keys: [...images.keys()] });
    if (signature === this.signature && this.layer) return;

    const layer = this.layer ?? document.createElement("canvas");
    if (layer.width !== backing.width) layer.width = backing.width;
    if (layer.height !== backing.height) layer.height = backing.height;

    const context = layer.getContext("2d");
    if (!context) return;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, backing.width, backing.height);
    context.setTransform(scale, 0, 0, scale, 0, 0);

    for (const item of items) drawItem(context, item, { screen: null, camera: null }, images, 0);

    this.layer = layer;
    this.signature = signature;
  }
}

function drawItem(
  context: CanvasRenderingContext2D,
  item: PlanItem,
  sources: Sources,
  images: Images,
  at: number,
): void {
  switch (item.kind) {
    case "fill":
      context.save();
      context.fillStyle = paintStyle(context, item.paint, item.rect, images);
      context.fillRect(item.rect.x, item.rect.y, item.rect.width, item.rect.height);
      context.restore();
      break;

    case "shadow": {
      // Drawn as a filled shape behind the real one rather than with the
      // context's shadow properties, so the blur lands somewhere predictable
      // rather than depending on what is painted next.
      const moved = moving(item, at);
      context.save();
      context.filter = `blur(${item.blur / 2}px)`;
      context.fillStyle = item.color;
      path(context, moved.rect, moved.shape, item.dy);
      context.fill();
      context.restore();
      break;
    }

    case "image": {
      const source = sources[item.source];
      // Nothing to draw is a normal state, not a failure: the camera has no
      // frame before it opened, and holding its first one would misrepresent
      // the take.
      if (!source) break;

      // A zoom moves and scales the whole picture over time. Absent on
      // everything that does not move, which is every item but a zoomed screen.
      const { rect: dst, shape } = moving(item, at);

      context.save();
      path(context, dst, shape);
      context.clip();

      if (item.mirror) {
        // Flipped about the destination's own centre, so mirroring does not
        // also move the image across the frame.
        context.translate(dst.x * 2 + dst.width, 0);
        context.scale(-1, 1);
      }

      context.drawImage(
        source,
        item.srcRect.x,
        item.srcRect.y,
        item.srcRect.width,
        item.srcRect.height,
        dst.x,
        dst.y,
        dst.width,
        dst.height,
      );
      context.restore();
      break;
    }

    case "stroke": {
      const moved = moving(item, at);
      context.save();
      context.strokeStyle = item.color;
      context.lineWidth = item.width;
      // Inset by half the width so the stroke sits inside the rectangle it
      // traces rather than straddling its edge.
      path(context, inset(moved.rect, item.width / 2), moved.shape, 0, item.width / 2);
      context.stroke();
      context.restore();
      break;
    }

    case "cursor": {
      const image = images.get(item.path);
      // The image is loaded like any other; before it arrives there is simply
      // no pointer, which is a frame or two at open rather than a failure.
      if (!image) break;

      const point = cursorAt(item.points, at);
      // Null means the pointer had left the recorded area. Not drawn at all,
      // rather than parked against the edge of the picture.
      if (!point) break;

      context.drawImage(
        image,
        point.x - item.hotspot.x * item.size,
        point.y - item.hotspot.y * item.size,
        item.size,
        item.size,
      );
      break;
    }
  }
}

/**
 * An item's rectangle and shape at a moment.
 *
 * The three pieces of the picture — its shadow, the image, its border — carry
 * the same motion track, because they are one object. Without a track this is
 * the item's own geometry, which is every item in a plan with no zoom in it.
 */
function moving(
  item: Extract<PlanItem, { motion?: RectKey[] }>,
  at: number,
): { rect: Rect; shape: Shape } {
  const rect = "rect" in item ? item.rect : item.dstRect;
  if (!item.motion) return { rect, shape: item.shape };

  const key = rectAt(item.motion, at, rect, item.shape.radius);
  return {
    rect: { x: key.x, y: key.y, width: key.width, height: key.height },
    shape: { radius: key.radius, exponent: item.shape.exponent },
  };
}

/**
 * Traces a superellipse-cornered rectangle.
 *
 * `exponent` 2 is an ellipse — a circle once the radius reaches half the
 * shorter edge — and 4 is the squircle. CSS `corner-shape: squircle` has no
 * canvas equivalent, so the curve is sampled here and evaluated analytically in
 * the exporter's shader. One parameter, two rasterisers, no drift.
 */
function path(
  context: CanvasRenderingContext2D,
  rect: Rect,
  shape: Shape,
  dy = 0,
  shrinkRadius = 0,
): void {
  const { x, width, height } = rect;
  const y = rect.y + dy;
  const radius = Math.max(0, Math.min(shape.radius - shrinkRadius, width / 2, height / 2));

  context.beginPath();

  if (radius <= 0) {
    context.rect(x, y, width, height);
    context.closePath();
    return;
  }

  if (shape.exponent === 2) {
    // The common case, and the one the platform draws best.
    context.roundRect(x, y, width, height, radius);
    context.closePath();
    return;
  }

  // Enough samples that the curve reads as smooth at any size a preview is
  // shown at, without making the path expensive to fill per frame.
  const steps = 24;
  const corners: [number, number, number, number][] = [
    [x + width - radius, y + radius, 1, -1],
    [x + width - radius, y + height - radius, 1, 1],
    [x + radius, y + height - radius, -1, 1],
    [x + radius, y + radius, -1, -1],
  ];

  let first = true;
  for (const [cx, cy, sx, sy] of corners) {
    for (let step = 0; step <= steps; step += 1) {
      const t = (step / steps) * (Math.PI / 2);
      // |cos|^(2/n) and |sin|^(2/n) trace the superellipse quadrant.
      const px = cx + sx * radius * Math.cos(t) ** (2 / shape.exponent);
      const py = cy + sy * radius * Math.sin(t) ** (2 / shape.exponent);

      if (first) {
        context.moveTo(px, py);
        first = false;
      } else {
        context.lineTo(px, py);
      }
    }
  }

  context.closePath();
}

function paintStyle(
  context: CanvasRenderingContext2D,
  paint: Paint,
  rect: Rect,
  images: Images,
): string | CanvasGradient | CanvasPattern {
  switch (paint.kind) {
    case "solid":
      return paint.color;

    case "gradient": {
      // Angle measured clockwise from straight up, matching CSS, so a value
      // copied from a design reads the same here.
      const radians = ((paint.angle - 90) * Math.PI) / 180;
      const half = Math.max(rect.width, rect.height) / 2;
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;

      const gradient = context.createLinearGradient(
        cx - Math.cos(radians) * half,
        cy - Math.sin(radians) * half,
        cx + Math.cos(radians) * half,
        cy + Math.sin(radians) * half,
      );
      gradient.addColorStop(0, paint.from);
      gradient.addColorStop(1, paint.to);
      return gradient;
    }

    case "image": {
      const image = images.get(paint.path);
      // Not loaded yet, or missing. A flat neutral is better than a transparent
      // hole that shows the editor's own chrome through the frame.
      if (!image) return "#1c1e22";

      const pattern = context.createPattern(image, "no-repeat");
      if (!pattern) return "#1c1e22";

      // Scaled to cover, so a wallpaper fills the frame rather than tiling or
      // sitting in one corner at its native size.
      const size = imageSize(image);
      const scale = Math.max(rect.width / size.width, rect.height / size.height);
      const matrix = new DOMMatrix()
        .translateSelf(
          rect.x + (rect.width - size.width * scale) / 2,
          rect.y + (rect.height - size.height * scale) / 2,
        )
        .scaleSelf(scale);
      pattern.setTransform(matrix);
      return pattern;
    }
  }
}

function imageSize(image: CanvasImageSource): { width: number; height: number } {
  if (image instanceof HTMLImageElement) {
    return { width: image.naturalWidth, height: image.naturalHeight };
  }
  if (image instanceof HTMLVideoElement) {
    return { width: image.videoWidth, height: image.videoHeight };
  }
  const sized = image as { width: number; height: number };
  return { width: sized.width, height: sized.height };
}

function inset(rect: Rect, by: number): Rect {
  return {
    x: rect.x + by,
    y: rect.y + by,
    width: Math.max(0, rect.width - by * 2),
    height: Math.max(0, rect.height - by * 2),
  };
}

/** True once a video element has a frame worth drawing. */
export function isReady(element: HTMLVideoElement | null): boolean {
  return element !== null && element.readyState >= 2 && element.videoWidth > 0;
}
