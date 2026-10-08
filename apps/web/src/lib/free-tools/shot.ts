/**
 * A screenshot being edited: what is in it, where everything sits, and what is
 * under the pointer.
 *
 * Pure. No canvas, no DOM, no browser API, so the whole of the editor's
 * geometry can be reasoned about on its own. The same split the recorder's
 * `layout.ts` makes, and for the same reason: there are two consumers, the
 * canvas on screen and the full size canvas the export is drawn into, and a
 * position worked out twice is a position that can differ between what was
 * approved and what was saved.
 *
 * **Every coordinate here is in image space**: pixels of the uploaded
 * screenshot, with 0,0 at its top left. Not output pixels, and not screen
 * pixels. That is what lets the padding be dragged, the frame be re-proportioned
 * and the export be written at full size with every arrow still pointing at the
 * thing it was put on.
 */

export type Point = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };

/** What the pointer does on the canvas. */
export type Tool = "move" | "arrow" | "rect" | "highlight" | "redact" | "text";

/** An annotation, in image space. */
export type Item =
  | { id: string; kind: "arrow"; from: Point; to: Point; colour: string }
  | { id: string; kind: "rect"; box: Box; colour: string }
  | { id: string; kind: "highlight"; box: Box; colour: string }
  | { id: string; kind: "redact"; box: Box }
  | { id: string; kind: "text"; at: Point; text: string; colour: string };

/**
 * The ground the screenshot sits on.
 *
 * Padding, radius and the shadow are fractions of the image's shorter edge
 * rather than pixel counts, so the look survives a 400 pixel favicon and a 5K
 * screenshot without being set twice.
 */
export type ShotLook = {
  backgroundId: string;
  /** 0 to 0.2 of the shorter edge. */
  padding: number;
  /** 0 to 0.08 of the shorter edge. */
  radius: number;
  /** 0 to 1. */
  shadow: number;
};

export type Shot = {
  /** The uploaded image's own size, which is the resolution everything exports at. */
  image: { width: number; height: number };
  look: ShotLook;
  items: Item[];
};

/** Where the screenshot and the frame around it end up, in output pixels. */
export type ShotPlan = {
  /** The whole exported image. */
  frame: { width: number; height: number };
  /** The screenshot inside it. Always square to the frame. */
  picture: Box & { radius: number };
  /** Blur radius for the drop shadow, already in output pixels. */
  shadow: number;
};

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * The output, resolved into pixels.
 *
 * The frame is the image plus its padding on all four sides, so the screenshot
 * is never scaled and never cropped: an export is the original pixels with a
 * border around them. Scaling the source to fit a fixed frame is the other way
 * to do this and it costs the one thing a screenshot cannot spare, which is the
 * legibility of small text.
 */
export function buildShotPlan(shot: Shot): ShotPlan {
  const { width, height } = shot.image;
  const shorter = Math.min(width, height);
  const padding = Math.round(clamp(shot.look.padding, 0, 0.2) * shorter);

  return {
    frame: { width: width + padding * 2, height: height + padding * 2 },
    picture: {
      x: padding,
      y: padding,
      width,
      height,
      radius: clamp(shot.look.radius, 0, 0.08) * shorter,
    },
    shadow: clamp(shot.look.shadow, 0, 1) * shorter * 0.08,
  };
}

/** A box from two corners, in any order, so a drag can go any direction. */
export function boxFrom(a: Point, b: Point): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** How wide a stroke is drawn, in image pixels. */
export function strokeWidth(image: { width: number; height: number }): number {
  // A fraction of the image rather than a constant: three pixels is a bold line
  // on a 600 pixel crop and a hairline on a 5K screenshot, and an arrow that
  // vanishes on a Retina capture is the commonest fault in tools like this.
  return Math.max(2, Math.round(Math.min(image.width, image.height) / 220));
}

/** How tall text is drawn, in image pixels. */
export function textSize(image: { width: number; height: number }): number {
  return Math.max(14, Math.round(Math.min(image.width, image.height) / 22));
}

/** The box an item occupies, for hit testing and for the selection outline. */
export function itemBounds(item: Item, image: { width: number; height: number }): Box {
  const pad = strokeWidth(image) * 3;

  switch (item.kind) {
    case "arrow":
      return inflate(boxFrom(item.from, item.to), pad);
    case "rect":
    case "highlight":
    case "redact":
      return inflate(item.box, pad / 2);
    case "text": {
      const size = textSize(image);
      // Width is estimated rather than measured, because measuring needs a
      // canvas and this file has none. 0.58em per character is close enough for
      // a hit box on a sans face, and the box is only ever used to pick the
      // item up.
      return {
        x: item.at.x - pad / 2,
        y: item.at.y - size,
        width: item.text.length * size * 0.58 + pad,
        height: size * 1.4,
      };
    }
  }
}

function inflate(box: Box, by: number): Box {
  return {
    x: box.x - by,
    y: box.y - by,
    width: box.width + by * 2,
    height: box.height + by * 2,
  };
}

export function inside(box: Box, at: Point): boolean {
  return at.x >= box.x && at.x <= box.x + box.width && at.y >= box.y && at.y <= box.y + box.height;
}

/**
 * The item under the pointer, topmost first.
 *
 * Reversed, because the array is painted in order and the last one drawn is the
 * one on top. Picking the first match in array order means clicking a shape and
 * selecting the one buried underneath it.
 */
export function itemAt(
  items: Item[],
  at: Point,
  image: { width: number; height: number },
): Item | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item && inside(itemBounds(item, image), at)) return item;
  }
  return null;
}

/** Move an item by a delta, whatever shape it is. */
export function moveItem(item: Item, dx: number, dy: number): Item {
  switch (item.kind) {
    case "arrow":
      return {
        ...item,
        from: { x: item.from.x + dx, y: item.from.y + dy },
        to: { x: item.to.x + dx, y: item.to.y + dy },
      };
    case "text":
      return { ...item, at: { x: item.at.x + dx, y: item.at.y + dy } };
    default:
      return { ...item, box: { ...item.box, x: item.box.x + dx, y: item.box.y + dy } };
  }
}

/**
 * Keep an item inside the screenshot.
 *
 * Dragging an annotation off the edge is easy and silently destructive: it is
 * still in the file, still exported, and invisible until somebody opens the PNG
 * and finds an arrow pointing in from the padding.
 */
export function clampItem(item: Item, image: { width: number; height: number }): Item {
  const limit = (point: Point): Point => ({
    x: clamp(point.x, 0, image.width),
    y: clamp(point.y, 0, image.height),
  });

  switch (item.kind) {
    case "arrow":
      return { ...item, from: limit(item.from), to: limit(item.to) };
    case "text":
      return { ...item, at: limit(item.at) };
    default: {
      const box = item.box;
      return {
        ...item,
        box: {
          ...box,
          x: clamp(box.x, 0, Math.max(0, image.width - box.width)),
          y: clamp(box.y, 0, Math.max(0, image.height - box.height)),
        },
      };
    }
  }
}
