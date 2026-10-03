/**
 * Writing a screenshot's finished composition out as a PNG.
 *
 * The one export in the app that does not go through `prequel-render`, and the
 * reason is the invariant rather than convenience. A still is drawn by the
 * **same compositor the preview draws with**, from the same plan, so there is
 * no second rasteriser for the two to disagree in — which for a single frame is
 * strictly stronger than the arrangement a video has, where the preview's GLSL
 * and the exporter's MSL are hand-kept mirrors.
 *
 * It is also the only thing a still needs. The exporter exists to decode, cut,
 * mix and encode a timeline; a screenshot has none of that, and teaching
 * `AVAssetWriter` to emit one PNG would be a second still-image path through
 * `image.rs`, `plan.rs` and `compositor.rs` for a frame the renderer has
 * already drawn.
 *
 * Off screen and at the output's own size, never the on-screen canvas: the
 * preview is sized to the window times the device ratio and capped at two, so
 * reading it back would hand somebody a 1400px picture of a 3024px shot.
 */
import type { Annotation } from "../../../shared/annotations";
import { paintAnnotations } from "./annotationPaint";
import type { RenderPlan, Size } from "../../../shared/layout";
import { STILL_AT } from "../../../shared/project";
import { WebGlCompositor, type Images, type Sources } from "./webgl";

/**
 * The largest edge a still is written at.
 *
 * WebGL's own limit, which on Apple silicon is 16384 — but asked of the context
 * rather than assumed, because a draw past `MAX_TEXTURE_SIZE` is not an error
 * that surfaces: the framebuffer is incomplete and what comes back is a
 * transparent picture of nothing. Only a composition deliberately scaled up
 * past a 6K shot could reach it.
 */
const SAFE_EDGE = 16384;

/**
 * Draws one plan to a PNG, as bytes.
 *
 * Null when the frame is unusable or the canvas would not encode, having said
 * why: a still that cannot be written is worth reporting, and the caller turns
 * it into a failed export rather than a file.
 */
export async function renderStillPng(
  frame: Size,
  plan: RenderPlan,
  sources: Sources,
  images: Images,
  annotations: readonly Annotation[] = [],
): Promise<Uint8Array | null> {
  const width = Math.round(frame.width);
  const height = Math.round(frame.height);

  if (width <= 0 || height <= 0) {
    console.error(`[still] cannot write a ${String(width)}×${String(height)} picture`);
    return null;
  }
  if (width > SAFE_EDGE || height > SAFE_EDGE) {
    console.error(`[still] ${String(width)}×${String(height)} is past what the GPU will draw`);
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  // Its own compositor, not the preview's. The preview's holds a texture cache
  // keyed by source and a background mid-fade — see `fading` — and drawing a
  // different size through it would evict every texture the loop is about to
  // want back, one frame after the export.
  //
  // A fresh one also means the fade cannot reach the file: `fading` starts null,
  // so the background is drawn as it is rather than halfway from the last one.
  const compositor = new WebGlCompositor();

  try {
    // The backing *is* the frame: there is no device ratio in play, because
    // nothing is being shown on a display.
    compositor.draw(canvas, plan, sources, images, { width, height }, STILL_AT);

    // Copied into a 2D canvas **in this same task**, and that is not tidiness.
    // The context is made without `preserveDrawingBuffer`, so the drawing
    // buffer is cleared the moment the browser composites the frame — and
    // `toBlob` resolves later. Reading it straight off the WebGL canvas comes
    // back fully transparent, with no error anywhere to say why. The preview's
    // own frame grab is synchronous inside its rAF callback for exactly this
    // reason.
    //
    // The copy is also where the marks go: one canvas has one context for its
    // life, so `getContext("2d")` on the WebGL canvas returns null.
    const flat = document.createElement("canvas");
    flat.width = width;
    flat.height = height;

    const context = flat.getContext("2d");
    if (!context) {
      console.error("[still] no 2D context to read the frame into");
      return null;
    }

    context.drawImage(canvas, 0, 0);
    // Over the composition, through the same painter the preview's overlay
    // uses — see `shared/annotations.ts`. One implementation, so what is on
    // screen is what is written.
    paintAnnotations(context, frame, annotations);

    const blob = await new Promise<Blob | null>((resolve) => {
      flat.toBlob(resolve, "image/png");
    });

    if (!blob) {
      console.error("[still] the canvas would not encode a PNG");
      return null;
    }

    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    // The context holds a few textures the size of the shot. Left to the
    // collector they survive until the GPU memory pressure that frees them,
    // which on a machine already holding the preview's copies is exactly when
    // the preview's are evicted instead.
    compositor.dispose();
  }
}
