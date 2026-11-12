// The window frame, drawn rather than cut.
//
// The other three frames are photographs of objects — paper, a stamp, a
// television — and a photograph is the only honest way to get their grain,
// their creases and their worn edges. A Mac window is not an object: it is flat
// fills, a hairline and three discs, every one of which a photograph can only
// make *worse*. The supplied cut-out came back with a soft halo round its edge,
// a blurred title bar and traffic lights with fringes on them, and no amount of
// keying recovers an edge that was never sharp.
//
// So this one is drawn, at macOS's own proportions, with one pixel of analytic
// antialiasing on every edge — the same `clamp(0.5 - d)` coverage from a signed
// distance that `shapeDistance` in the shaders uses, so the corners here are
// the corners the rest of the app draws.
//
// Pure arithmetic and `zlib`: no image library, the same rule
// `make-app-icon.mjs` follows for its mask. Called by `make-frames.mjs`, which
// is what measures the hole and reports it.

/**
 * Points to pixels.
 *
 * Everything below is in macOS points — a 28pt title bar, 12pt lights, a 10pt
 * corner — because those are the numbers the real thing is built from and a
 * window drawn to any others reads as a drawing of a window. Three times, so
 * the art is a little over the size an export ever asks of it.
 */
const PX = 3;

/** A standard title bar, with no toolbar under it. */
const BAR = 28 * PX;

/** The window's own corner. macOS's continuous corner, near enough at this size. */
const RADIUS = 10 * PX;

/**
 * 4 is the squircle, matching the `squircle` utility the app's own UI uses and
 * the exponent `make-app-icon.mjs` cuts the Dock icon with.
 */
const EXPONENT = 4;

/**
 * The chrome left showing beside and below the picture.
 *
 * A real window has none — its content runs to the edge — but this is a frame
 * round a camera, and a hole flush with the plate leaves the picture's own edge
 * doing the window's job. It also has to clear `frameOverlap` in
 * `shared/layout.ts`, which reaches the picture a hundredth of itself in under
 * the plate: with no border to reach into, that would put the camera *outside*
 * the window down both sides.
 */
const BORDER = 8 * PX;

/** The traffic lights: 12pt across, 20pt between centres, 20pt in from the left. */
const LIGHT = 6 * PX;
const LIGHT_GAP = 20 * PX;
const LIGHT_LEFT = 20 * PX;

const LIGHTS = [
  // Sonoma's, sampled off a window rather than off a palette article.
  [0xff, 0x5f, 0x57],
  [0xfe, 0xbc, 0x2e],
  [0x28, 0xc8, 0x40],
];

/** The hole's own corner. Barely anything — a window's content is square. */
const CONTENT_RADIUS = 2 * PX;

/**
 * Signed distance to a superellipse-cornered rectangle, in pixels.
 *
 * Negative inside, positive outside. Verbatim from `shapeDistance` in
 * `editor/webgl.ts` and `shape_distance` in `shaders.metal` — the third copy,
 * and deliberately so: a frame whose corners are a different curve from the
 * ones the compositor draws is a window that stops matching the app the moment
 * it is put beside anything else.
 */
function shapeDistance(px, py, halfW, halfH, radius, exponent) {
  const r = Math.min(radius, halfW, halfH);
  const ax = Math.abs(px);
  const ay = Math.abs(py);

  if (r <= 0) {
    const dx = ax - halfW;
    const dy = ay - halfH;
    return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
  }

  const cx = ax - (halfW - r);
  const cy = ay - (halfH - r);
  if (cx <= 0 || cy <= 0) {
    const dx = ax - halfW;
    const dy = ay - halfH;
    return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
  }

  const value = (cx / r) ** exponent + (cy / r) ** exponent;
  return (value ** (1 / exponent) - 1) * r;
}

/** How much of this pixel a shape covers, from its distance. One pixel of edge. */
const cover = (distance) => Math.min(Math.max(0.5 - distance, 0), 1);

export function drawWindowFrame() {
  // The hole, and the plate worked outwards from it. Its proportions are the
  // one free choice here: close to 7:6, which is a window rather than a
  // letterbox and sits a face comfortably.
  const holeWidth = 320 * PX;
  const holeHeight = 278 * PX;

  const width = holeWidth + BORDER * 2;
  const height = holeHeight + BAR + BORDER;
  const hole = { x: BORDER, y: BAR, width: holeWidth, height: holeHeight };

  // Straight alpha, not premultiplied: that is what the decoders on both sides
  // hand their shaders, and what every other frame's PNG carries.
  const rgba = new Uint8ClampedArray(width * height * 4);

  /** Lays a colour over what is already there, by coverage. */
  const over = (at, [r, g, b], alpha) => {
    if (alpha <= 0) return;
    const was = rgba[at + 3] / 255;
    const now = alpha + was * (1 - alpha);
    if (now <= 0) return;
    // Straight-alpha source-over: the usual premultiplied form, divided back
    // out. Blending straight values directly washes an edge towards whatever
    // was under it, which on the outermost pixel of the plate is nothing.
    for (let c = 0; c < 3; c += 1) {
      const under = rgba[at + c];
      rgba[at + c] = (under * was * (1 - alpha) + [r, g, b][c] * alpha) / now;
    }
    rgba[at + 3] = now * 255;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const cx = x + 0.5;
      const cy = y + 0.5;

      const plate = shapeDistance(
        cx - width / 2,
        cy - height / 2,
        width / 2,
        height / 2,
        RADIUS,
        EXPONENT,
      );
      const inside = cover(plate);
      if (inside <= 0) continue;

      // The chrome. Lit from above, like everything else in the app — flat, it
      // reads as a grey rectangle rather than as a surface.
      const down = cy / height;
      const shade = 0xf7 - 0x11 * down;
      over(at, [shade, shade, shade + 2], inside);

      // The bevel along the top edge, and the hairline all the way round.
      // Both are a pixel wide and both are what make a window read as crisp at
      // any size: without the hairline the plate dissolves into a light
      // background, and without the bevel it has no thickness at all.
      over(at, [255, 255, 255], cover(Math.abs(plate + 1.0) - 0.5) * 0.85 * (1 - down) * inside);
      over(at, [0, 0, 0], cover(Math.abs(plate + 0.5) - 0.5) * 0.16 * inside);

      // The lights, in the middle of the bar.
      for (let index = 0; index < LIGHTS.length; index += 1) {
        const lx = LIGHT_LEFT + LIGHT + index * LIGHT_GAP;
        const away = Math.hypot(cx - lx, cy - BAR / 2);
        const disc = cover(away - LIGHT) * inside;
        if (disc <= 0) continue;
        over(at, LIGHTS[index], disc);
        // A rim a shade darker than the fill, so a light sits in the bar
        // rather than on top of it.
        over(at, [0, 0, 0], cover(Math.abs(away - LIGHT + 0.75) - 0.75) * 0.14 * inside);
      }

      // The bezel round the content: one dark hairline just outside the hole.
      // Drawn as the band between the hole and the hole grown by a pixel, so
      // punching the hole below cannot eat it.
      const content = shapeDistance(
        cx - (hole.x + hole.width / 2),
        cy - (hole.y + hole.height / 2),
        hole.width / 2,
        hole.height / 2,
        CONTENT_RADIUS,
        2,
      );
      over(at, [0, 0, 0], cover(Math.abs(content + 1.0) - 1.0) * 0.22 * inside);

      // And the hole itself. Taken out of the alpha rather than painted over,
      // because what goes behind it is the camera.
      const open = cover(content);
      if (open > 0) {
        rgba[at + 3] *= 1 - open;
        if (rgba[at + 3] <= 0) {
          rgba[at] = 0;
          rgba[at + 1] = 0;
          rgba[at + 2] = 0;
        }
      }
    }
  }

  return { width, height, rgba };
}
