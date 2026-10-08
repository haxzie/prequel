/**
 * One screenshot, painted.
 *
 * The only place pixels are drawn for the editor, called twice with the same
 * plan: once for the canvas on screen and once for the full size canvas an
 * export is read off. The two differ by a scale factor and nothing else, which
 * is what makes the preview a promise rather than an impression.
 */
import type { Background } from "@/lib/free-tools/presets";
import {
  buildShotPlan,
  itemBounds,
  strokeWidth,
  textSize,
  type Box,
  type Item,
  type Shot,
} from "@/lib/free-tools/shot";

/** CSS's angle convention, so a swatch and the export sweep the same way. */
function gradient(
  ctx: CanvasRenderingContext2D,
  background: Background,
  width: number,
  height: number,
): CanvasGradient {
  const radians = ((background.angle - 90) * Math.PI) / 180;
  const length = Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians));
  const dx = (Math.cos(radians) * length) / 2;
  const dy = (Math.sin(radians) * length) / 2;

  const fill = ctx.createLinearGradient(
    width / 2 - dx,
    height / 2 - dy,
    width / 2 + dx,
    height / 2 + dy,
  );
  for (const [offset, colour] of background.stops) fill.addColorStop(offset, colour);
  return fill;
}

function roundedPath(ctx: CanvasRenderingContext2D, box: Box, radius: number) {
  const r = Math.min(radius, Math.min(box.width, box.height) / 2);
  ctx.beginPath();

  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(box.x, box.y, box.width, box.height, r);
    return;
  }

  ctx.moveTo(box.x + r, box.y);
  ctx.arcTo(box.x + box.width, box.y, box.x + box.width, box.y + box.height, r);
  ctx.arcTo(box.x + box.width, box.y + box.height, box.x, box.y + box.height, r);
  ctx.arcTo(box.x, box.y + box.height, box.x, box.y, r);
  ctx.arcTo(box.x, box.y, box.x + box.width, box.y, r);
  ctx.closePath();
}

/**
 * A redaction, as pixels rather than as a block.
 *
 * The region is drawn into a tiny offscreen canvas and blown back up, which is
 * the mosaic everyone recognises. A solid rectangle hides the same information
 * and reads as a redacted government document; a blur is reversible often
 * enough to be a bad habit. Pixelating at this ratio throws the detail away.
 */
function pixelate(ctx: CanvasRenderingContext2D, from: Box, to: Box) {
  const cells = Math.max(4, Math.round(to.width / 14));
  const rows = Math.max(3, Math.round((cells * to.height) / Math.max(1, to.width)));

  const small = document.createElement("canvas");
  small.width = cells;
  small.height = rows;
  const tiny = small.getContext("2d");
  if (!tiny) return;

  // `from` is in device pixels and `to` is in the current transform's. The
  // source rectangle of `drawImage` is read off the bitmap and is not
  // transformed, which is the one asymmetry in the whole API and the reason
  // these are two arguments rather than one.
  tiny.drawImage(ctx.canvas, from.x, from.y, from.width, from.height, 0, 0, cells, rows);

  ctx.save();
  // Off, or the blow-up is a smooth smear that still carries the shapes of the
  // letters underneath it.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, cells, rows, to.x, to.y, to.width, to.height);
  ctx.restore();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  item: Extract<Item, { kind: "arrow" }>,
  width: number,
) {
  const angle = Math.atan2(item.to.y - item.from.y, item.to.x - item.from.x);
  const head = width * 4.5;

  ctx.save();
  ctx.strokeStyle = item.colour;
  ctx.fillStyle = item.colour;
  ctx.lineWidth = width;
  ctx.lineCap = "round";

  // The shaft stops short of the point, so the line does not show through the
  // head's notch at the tip.
  ctx.beginPath();
  ctx.moveTo(item.from.x, item.from.y);
  ctx.lineTo(item.to.x - Math.cos(angle) * head * 0.6, item.to.y - Math.sin(angle) * head * 0.6);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(item.to.x, item.to.y);
  ctx.lineTo(item.to.x - Math.cos(angle - 0.4) * head, item.to.y - Math.sin(angle - 0.4) * head);
  ctx.lineTo(item.to.x - Math.cos(angle + 0.4) * head, item.to.y - Math.sin(angle + 0.4) * head);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * The composition, start to finish.
 *
 * `scale` is the only difference between the preview and the export: everything
 * below is in output pixels and the context is scaled once at the top. Drawing
 * the preview from a second set of numbers is how an arrow lands somewhere else
 * in the file than it does on screen.
 */
export function paintShot(
  ctx: CanvasRenderingContext2D,
  shot: Shot,
  image: CanvasImageSource,
  background: Background | null,
  scale: number,
  selected?: string | null,
) {
  const plan = buildShotPlan(shot);

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, plan.frame.width, plan.frame.height);

  if (background) {
    ctx.fillStyle = gradient(ctx, background, plan.frame.width, plan.frame.height);
    ctx.fillRect(0, 0, plan.frame.width, plan.frame.height);
  }

  // The shadow is cast by an opaque fill of the picture's own shape, before the
  // picture goes in. Drawing the image with a shadow set would cast one behind
  // every pixel of it.
  if (plan.shadow > 0) {
    ctx.save();
    ctx.shadowColor = `rgba(0, 0, 0, ${0.45 * shot.look.shadow})`;
    ctx.shadowBlur = plan.shadow;
    ctx.shadowOffsetY = plan.shadow * 0.35;
    ctx.fillStyle = "#000000";
    roundedPath(ctx, plan.picture, plan.picture.radius);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  roundedPath(ctx, plan.picture, plan.picture.radius);
  ctx.clip();
  ctx.drawImage(image, plan.picture.x, plan.picture.y, plan.picture.width, plan.picture.height);

  // Annotations are in image space, so the context moves to the picture's
  // corner and everything below is drawn in the coordinates the editor stores.
  // They stay inside the clip, which is what keeps a highlighter stroke from
  // running out over the padding.
  ctx.translate(plan.picture.x, plan.picture.y);

  const width = strokeWidth(shot.image);
  const size = textSize(shot.image);

  for (const item of shot.items) {
    switch (item.kind) {
      case "redact":
        // Read back off the canvas rather than off the source image, so a
        // redaction laid over a highlight hides both.
        pixelate(
          ctx,
          {
            x: (item.box.x + plan.picture.x) * scale,
            y: (item.box.y + plan.picture.y) * scale,
            width: item.box.width * scale,
            height: item.box.height * scale,
          },
          item.box,
        );
        break;

      case "highlight":
        ctx.save();
        // Multiply, so the text under a highlighter stays readable. A flat
        // translucent fill greys the words out instead of colouring the paper.
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = item.colour;
        ctx.globalAlpha = 0.45;
        ctx.fillRect(item.box.x, item.box.y, item.box.width, item.box.height);
        ctx.restore();
        break;

      case "rect":
        ctx.save();
        ctx.strokeStyle = item.colour;
        ctx.lineWidth = width;
        roundedPath(ctx, item.box, width);
        ctx.stroke();
        ctx.restore();
        break;

      case "arrow":
        drawArrow(ctx, item, width);
        break;

      case "text":
        ctx.save();
        ctx.font = `600 ${size}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
        ctx.textBaseline = "alphabetic";
        // A dark halo under the letters. Text dropped on a screenshot lands on
        // whatever is there, and one colour is unreadable on half of them.
        ctx.lineJoin = "round";
        ctx.lineWidth = size * 0.22;
        ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
        ctx.strokeText(item.text, item.at.x, item.at.y);
        ctx.fillStyle = item.colour;
        ctx.fillText(item.text, item.at.x, item.at.y);
        ctx.restore();
        break;
    }
  }

  // The selection, last and only on screen. `selected` is never passed when the
  // export is drawn, which is the whole of how the marching rectangle is kept
  // out of the file.
  if (selected) {
    const item = shot.items.find((candidate) => candidate.id === selected);
    if (item) {
      const bounds = itemBounds(item, shot.image);
      ctx.save();
      ctx.strokeStyle = "#4296fc";
      ctx.lineWidth = Math.max(1, width / 2);
      ctx.setLineDash([width * 2, width * 1.5]);
      ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
      ctx.restore();
    }
  }

  ctx.restore();
}
