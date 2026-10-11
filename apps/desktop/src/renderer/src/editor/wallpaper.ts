/**
 * Drawing a pattern background, and getting it beside the recording.
 *
 * The renderer is the only side of the app that can rasterise anything — main
 * has no canvas and the Rust compositor only ever reads pictures — so the
 * drawing happens here and crosses to main as PNG bytes. What lands in the
 * session directory is an ordinary picture, and from there a drawn background
 * is indistinguishable from a downloaded one: the preview samples the file and
 * the exporter rasterises the file, so the two cannot disagree about what the
 * mat looks like.
 *
 * Via a `data:` URL rather than a `blob:` one. The editor's CSP is
 * `img-src 'self' data: prequel-media:` — a blob URL is refused, and the
 * failure is an `onerror` with no message on a picture that simply never
 * appears.
 */
import {
  wallpaperFile,
  wallpaperSvg,
  type WallpaperCatalogue,
  type WallpaperSpec,
} from "../../../shared/wallpapers";

export interface Size {
  width: number;
  height: number;
}

/** The drawing as something an `<img>` or a CSS `background-image` can take. */
export function wallpaperUrl(
  spec: WallpaperSpec,
  size: Size,
  catalogue?: WallpaperCatalogue,
): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    wallpaperSvg(spec, size, catalogue),
  )}`;
}

async function rasterise(url: string, size: Size): Promise<ArrayBuffer> {
  const picture = new Image();
  picture.width = size.width;
  picture.height = size.height;

  await new Promise<void>((resolve, reject) => {
    picture.onload = () => resolve();
    picture.onerror = () => reject(new Error("the drawing could not be decoded"));
    picture.src = url;
  });

  const canvas = new OffscreenCanvas(size.width, size.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context");

  context.drawImage(picture, 0, 0, size.width, size.height);

  // PNG rather than JPEG. Every style here is line art on a flat fill, which
  // is the one thing JPEG is worst at — a hairline comes back with a halo
  // round it — and it is also the thing PNG packs to almost nothing.
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return blob.arrayBuffer();
}

/**
 * Makes sure the recording holds this pattern at this size, and answers with
 * the file name the project should point at.
 *
 * Null when it could not be written, and the caller then leaves the background
 * that is already working alone — the same thing picking a wallpaper that
 * fails to download does.
 */
export async function ensureWallpaper(
  dir: string,
  spec: WallpaperSpec,
  size: Size,
  catalogue: WallpaperCatalogue,
): Promise<string | null> {
  const width = Math.max(2, Math.round(size.width));
  const height = Math.max(2, Math.round(size.height));
  const file = wallpaperFile(spec, { width, height }, catalogue.version);

  try {
    const bytes = await rasterise(wallpaperUrl(spec, { width, height }, catalogue), {
      width,
      height,
    });
    const result = await window.prequel.editor.wallpapers.write(dir, file, bytes);
    return result.ok && result.value ? file : null;
  } catch (cause) {
    console.warn(`[editor] could not draw ${file}:`, cause);
    return null;
  }
}
