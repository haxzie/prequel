/**
 * The library's tile: one frame of a recording, composed the way its edit is.
 *
 * The grid used to show a frame of the raw screen track, which is the one
 * picture the finished video never looks like — no background, no padding, no
 * camera, and in a reframed project not even the right shape. This draws the
 * plan instead, through the same `buildRenderPlan` and the same compositor the
 * preview uses, so a tile is a small picture of the video rather than of the
 * capture it started as.
 *
 * Zooms, captions, text and the pointer are deliberately left out. Each needs
 * a track, a bitmap or a font the grid does not load, and none of them is what
 * tells two recordings apart at 220 points across; the composition — background,
 * frame, camera, look — is.
 */
import type { ProjectComposition } from "../../../shared/contract";
import { buildRenderPlan, type Size, type SourceSizes } from "../../../shared/layout";
import { evenSize } from "../../../shared/presets";
import { openPicture, openVideo, QUALITY, release, seek } from "../editor/poster";
import { WebGlCompositor, type Images, type Sources } from "../editor/webgl";

/**
 * How wide a tile's still is written.
 *
 * A tile is about 220 points across, so this is generous at 2× and stays
 * generous on the widest window the grid stretches to. The plan is in output
 * pixels and the compositor scales it once, exactly as the preview does — there
 * is nothing to gain from rendering a 4K frame to throw most of it away.
 */
const WIDTH = 640;

/** Long enough for a local picture to decode, short enough not to stall the grid. */
const IMAGE_TIMEOUT_MS = 5_000;

/**
 * One canvas and one compositor for the whole library.
 *
 * A WebGL2 context per tile would be a dozen of them on the first page, and
 * Chromium drops the oldest once a page holds too many — the tile that lost its
 * context then draws nothing, with no error anywhere. Safe to share because the
 * grid takes one still at a time; see `usePosters`.
 */
let canvas: HTMLCanvasElement | null = null;
let compositor: WebGlCompositor | null = null;

/**
 * Draws one recording's composition as a JPEG data URL, or null.
 *
 * Null rather than throwing, for the reason `capturePoster` answers that way: a
 * tile without a picture is a tile, and a tile that threw is a grid that did
 * not draw.
 */
export async function captureComposition(spec: ProjectComposition): Promise<string | null> {
  let screen: HTMLVideoElement | HTMLImageElement | null = null;
  let camera: HTMLVideoElement | null = null;
  let matte: HTMLVideoElement | null = null;

  try {
    if (spec.screen) {
      // A screenshot's frame is a PNG, and an element asked to demux one fails
      // — which took the whole tile with it, background and all, because a
      // composition with no screen and no camera has nothing to draw. There is
      // nothing to seek: one frame has no moment to look at.
      screen = spec.stillScreen
        ? await openPicture(spec.screen.url)
        : await openVideo(spec.screen.url).then(async (element) => {
            await seek(element, spec.screen!.at);
            return element;
          });
    }

    if (spec.camera) {
      // Its own attempt. A camera that will not decode is a composition with no
      // camera in it, which is worth drawing; giving up here would lose the
      // screen, the background and the frame along with it.
      try {
        camera = await openVideo(spec.camera.url);
        await seek(camera, spec.camera.at);

        if (spec.camera.matteUrl) {
          matte = await openVideo(spec.camera.matteUrl);
          await seek(matte, spec.camera.at);
        }
      } catch (cause) {
        console.warn("[library] a camera would not decode for a tile:", cause);
        release(camera);
        release(matte);
        camera = null;
        matte = null;
      }
    }

    const sizes: SourceSizes = { screen: sizeOf(screen), camera: sizeOf(camera) };
    if (!sizes.screen && !sizes.camera) return null;

    const frame = frameOf(spec, sizes);
    if (frame.width <= 0 || frame.height <= 0) return null;

    const images = await pictures(spec.images);
    const plan = buildRenderPlan(frame, sizes, spec.settings);

    const sources: Sources = {
      screen: sizes.screen ? screen : null,
      camera: sizes.camera ? camera : null,
      // Only with the camera, and only once it has a frame: a mask with no
      // picture under it is nothing to draw, and the exporter treats a matte
      // that is not there the same way — the camera draws whole.
      cameraMatte: sizes.camera && matte?.videoWidth ? matte : null,
    };

    const element = surface();
    const backing = {
      width: WIDTH,
      height: Math.max(1, Math.round((WIDTH * frame.height) / frame.width)),
    };
    element.width = backing.width;
    element.height = backing.height;

    compositor ??= new WebGlCompositor();
    compositor.draw(element, plan, sources, images, backing);

    // Straight after the draw, in the same task. The context is made without
    // `preserveDrawingBuffer`, so the drawing buffer is cleared the moment the
    // browser composites — an `await` between these two lines is a blank tile.
    return element.toDataURL("image/jpeg", QUALITY);
  } catch (cause) {
    console.warn("[library] could not compose a tile:", cause);
    return null;
  } finally {
    // Videos only. An `<img>` holds no decoder and no `src` to tear down — see
    // `openPicture`.
    release(screen instanceof HTMLVideoElement ? screen : null);
    release(camera);
    release(matte);
  }
}

/**
 * The output frame, in pixels.
 *
 * An automatic frame carries no size of its own — it means "the size of the
 * screen track" — and main has no decoded video to measure. So it is filled in
 * here, through the same `evenSize` the editor's own automatic frame uses, or
 * the two would disagree by a pixel on an odd-sized recording.
 */
function frameOf(spec: ProjectComposition, sizes: SourceSizes): Size {
  const recorded = sizes.screen ?? sizes.camera;
  if (!spec.frame.auto || !recorded) return spec.frame;

  return { width: evenSize(recorded.width), height: evenSize(recorded.height) };
}

/** A source's dimensions, or null when it has no frame to draw. */
function sizeOf(source: HTMLVideoElement | HTMLImageElement | null): Size | null {
  if (!source) return null;
  // Either kind, because a screenshot's screen is an `<img>` — see
  // `ProjectComposition.stillScreen`.
  const width = source instanceof HTMLImageElement ? source.naturalWidth : source.videoWidth;
  const height = source instanceof HTMLImageElement ? source.naturalHeight : source.videoHeight;
  return width === 0 || height === 0 ? null : { width, height };
}

/** The shared canvas, made on the first tile. */
function surface(): HTMLCanvasElement {
  canvas ??= document.createElement("canvas");
  return canvas;
}

/**
 * The pictures the plan names, keyed by the path it names them with.
 *
 * A picture that will not load is left out rather than waited for: the plan
 * draws what is in the map and skips what is not, so a missing background costs
 * the background and not the tile.
 */
async function pictures(wanted: ProjectComposition["images"]): Promise<Images> {
  const images: Images = new Map();

  await Promise.all(
    wanted.map(async ({ path, url }) => {
      const image = await load(url);
      if (image) images.set(path, image);
    }),
  );

  return images;
}

function load(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    // Before `src`, or the request is already in flight without it.
    // `prequel-media:` is a different origin, and WebGL *throws* on
    // `texImage2D` of a tainted image — which would take the whole tile down
    // over a background nobody chose.
    image.crossOrigin = "anonymous";

    const timer = window.setTimeout(() => resolve(null), IMAGE_TIMEOUT_MS);
    const done = (value: HTMLImageElement | null) => {
      window.clearTimeout(timer);
      resolve(value);
    };

    image.onload = () => done(image);
    image.onerror = () => done(null);
    image.src = url;
  });
}
