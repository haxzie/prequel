/**
 * A still for the library and the share card, taken from the finished file.
 *
 * Not from the preview. The editor's WebGL canvas can produce one — and used to
 * — but only while it is mounted, drawing, and laid out at a non-zero size, and
 * it fails by resolving `null` rather than by throwing. Every one of those
 * conditions held during development and one of them did not hold in practice,
 * which is how recordings reached the library with no thumbnail and nothing in
 * any log to say why.
 *
 * The exported file has none of those conditions. It exists, it is local, and it
 * is exactly what the viewer is going to see.
 */

/**
 * How far in to take the frame.
 *
 * Not the first frame. A recording opens on a click, a menu half-drawn or a
 * window still settling, and often on black — the one moment guaranteed to be
 * unrepresentative is the one an obvious implementation picks.
 */
const AT = 0.25;

/** The widest a poster is written, in pixels. */
const MAX_WIDTH = 1280;

/**
 * JPEG, not PNG.
 *
 * A 2560×1440 PNG of a screen recording runs to several megabytes, and this
 * crosses to the main process as a base64 string inside an IPC message before
 * it is uploaded. At this quality the same frame is tens of kilobytes and no
 * worse to look at behind a play button.
 */
const QUALITY = 0.82;

/** Long enough for a local file to decode, short enough not to hold up a share. */
const TIMEOUT_MS = 5_000;

/**
 * Grabs a representative frame as a JPEG data URL, or null.
 *
 * Null rather than throwing: a missing thumbnail is a worse-looking library
 * entry, and a share that fails because of one would be a much worse outcome
 * than a share with no picture.
 */
export async function capturePoster(url: string, isGif: boolean): Promise<string | null> {
  try {
    const frame = isGif ? await firstGifFrame(url) : await videoFrame(url);
    return frame && draw(frame.source, frame.width, frame.height);
  } catch (cause) {
    console.warn("[poster] could not take a still:", cause);
    return null;
  }
}

interface Frame {
  source: CanvasImageSource;
  width: number;
  height: number;
}

/**
 * Seeks a detached video and waits for a painted frame.
 *
 * Detached on purpose. The dialog is showing this same file, autoplaying and
 * looping, and seeking *that* element to take the still would jump the picture
 * under the user at the moment they pressed Share.
 */
function videoFrame(url: string): Promise<Frame | null> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");

    // `prequel-media:` is a different origin to the page. Without this the
    // canvas is tainted and `toDataURL` throws a `SecurityError` instead of
    // returning anything — the protocol already answers with
    // `Access-Control-Allow-Origin: *`, so the request itself is fine.
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";

    const done = (value: Frame | null) => {
      window.clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      resolve(value);
    };

    const timer = window.setTimeout(() => done(null), TIMEOUT_MS);

    video.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("the export would not decode"));
    };

    video.onloadedmetadata = () => {
      const { duration } = video;
      // A file still being finalised can report Infinity or NaN, and seeking to
      // either leaves the element stuck with no error.
      video.currentTime = Number.isFinite(duration) && duration > 0 ? duration * AT : 0;
    };

    video.onseeked = () => {
      const frame = {
        source: video,
        width: video.videoWidth,
        height: video.videoHeight,
      };

      // `seeked` means the time moved, not that a frame has been painted —
      // drawing here can give a blank canvas. `requestVideoFrameCallback` fires
      // once one is actually available, which is the guarantee this needs.
      if ("requestVideoFrameCallback" in video) {
        video.requestVideoFrameCallback(() => done(frame));
      } else {
        requestAnimationFrame(() => done(frame));
      }
    };

    video.src = url;
  });
}

/** A GIF has no seeking, so its first frame is the only one on offer. */
function firstGifFrame(url: string): Promise<Frame | null> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";

    const timer = window.setTimeout(() => resolve(null), TIMEOUT_MS);

    image.onload = () => {
      window.clearTimeout(timer);
      resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight });
    };

    image.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("the export would not decode"));
    };

    image.src = url;
  });
}

function draw(source: CanvasImageSource, width: number, height: number): string | null {
  if (width === 0 || height === 0) return null;

  const scale = Math.min(1, MAX_WIDTH / width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  const context = canvas.getContext("2d");
  if (!context) return null;

  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", QUALITY);
}
