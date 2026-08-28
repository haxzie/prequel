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
 * The widest one frame of a filmstrip is written.
 *
 * A tile is about 220 points across, so this is already generous at 2×. The
 * strip holds `FILMSTRIP_FRAMES` of these side by side and a poster's 1280
 * would make one image several times the size of the still it previews.
 */
const STRIP_FRAME_WIDTH = 480;

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
 * How often a seek is asked whether it has landed.
 *
 * The floor on what one frame costs, so it is kept well under a rendered
 * frame's worth: a filmstrip pays it six times over.
 */
const POLL_MS = 20;

/**
 * Grabs a representative frame as a JPEG data URL, or null.
 *
 * Null rather than throwing: a missing thumbnail is a worse-looking library
 * entry, and a share that fails because of one would be a much worse outcome
 * than a share with no picture.
 */
export async function capturePoster(url: string, isGif: boolean): Promise<string | null> {
  try {
    if (!isGif) return await videoPoster(url);
    const frame = await firstGifFrame(url);
    return frame && draw(frame.source, frame.width, frame.height);
  } catch (cause) {
    console.warn("[poster] could not take a still:", cause);
    return null;
  }
}

/**
 * Frames from across the whole recording, as one wide image.
 *
 * One image rather than `count` of them because of what reads it: the grid
 * flicks between these on a timer, and separate URLs would be separate
 * requests, each able to arrive after the frame that follows it. A strip is
 * shown by moving a background that is already decoded, which cannot tear and
 * cannot arrive late.
 *
 * Null on anything that will not decode, for the same reason `capturePoster`
 * answers that way: a tile without a hover preview is a tile, and a tile that
 * threw is a grid that did not draw.
 */
export async function captureFilmstrip(url: string, count: number): Promise<string | null> {
  let video: HTMLVideoElement | null = null;

  try {
    video = await openVideo(url);
    const { duration, videoWidth, videoHeight } = video;
    // A track still being finalised reports Infinity or NaN, and every seek
    // below would be to a time that does not exist.
    if (!Number.isFinite(duration) || duration <= 0 || videoWidth === 0 || videoHeight === 0) {
      return null;
    }

    const scale = Math.min(1, STRIP_FRAME_WIDTH / videoWidth);
    const width = Math.round(videoWidth * scale);
    const height = Math.round(videoHeight * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width * count;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) return null;

    for (let index = 0; index < count; index += 1) {
      // The middle of each slice rather than its edge: the last frame of a
      // recording is the mouse travelling to the stop button, and the first is
      // whatever was on screen before the take had begun.
      await seek(video, (duration * (index + 0.5)) / count);
      context.drawImage(video, index * width, 0, width, height);
    }

    return canvas.toDataURL("image/jpeg", QUALITY);
  } catch (cause) {
    console.warn("[poster] could not take a filmstrip:", cause);
    return null;
  } finally {
    release(video);
  }
}

interface Frame {
  source: CanvasImageSource;
  width: number;
  height: number;
}

/**
 * Seeks a detached video and draws the frame it lands on.
 *
 * Detached on purpose. The dialog is showing this same file, autoplaying and
 * looping, and seeking *that* element to take the still would jump the picture
 * under the user at the moment they pressed Share.
 *
 * The draw happens before the element is released, which is not incidental:
 * `load()` puts the element back to `HAVE_NOTHING`, and `drawImage` of a video
 * with no current data leaves the canvas exactly as it found it — a poster that
 * is a blank rectangle rather than a missing one.
 */
async function videoPoster(url: string): Promise<string | null> {
  let video: HTMLVideoElement | null = null;

  try {
    video = await openVideo(url);
    const { duration } = video;
    // A file still being finalised can report Infinity or NaN, and seeking to
    // either leaves the element stuck with no error.
    await seek(video, Number.isFinite(duration) && duration > 0 ? duration * AT : 0);
    return draw(video, video.videoWidth, video.videoHeight);
  } finally {
    release(video);
  }
}

/**
 * A detached element with its metadata loaded, ready to be seeked.
 *
 * The `crossOrigin` is the load-bearing line: `prequel-media:` is a different
 * origin to the page, and without it the canvas is tainted and `toDataURL`
 * throws a `SecurityError` instead of returning anything. The protocol already
 * answers with `Access-Control-Allow-Origin: *`, so the request itself is fine.
 */
function openVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");

    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";

    const timer = window.setTimeout(() => reject(new Error("the file would not open")), TIMEOUT_MS);

    video.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("the export would not decode"));
    };

    video.onloadedmetadata = () => {
      window.clearTimeout(timer);
      resolve(video);
    };

    video.src = url;
  });
}

/**
 * Moves the playhead and waits for the frame there to be available.
 *
 * Polled, and driven by no event at all, which is the second half of the same
 * lesson. This waited on `requestVideoFrameCallback` and left the whole library
 * without thumbnails: that callback reports frames **presented to the
 * compositor**, and the element here is deliberately detached — see
 * `videoPoster` — so it is never rendered and never presents one. The callback
 * exists, it is called, and it never fires.
 *
 * `seeked` is no better as the only signal. It is reliable for the first seek
 * of a file and not for the fifth, where a jump into a part that is not
 * buffered can leave the element seeking with no event either way — which is
 * what left the hover strips failing after the posters had been fixed.
 *
 * The two properties answer the question directly: `seeking` is false once the
 * playhead has arrived, and `HAVE_CURRENT_DATA` is Chromium saying there is a
 * frame at that position for `drawImage` to take. Neither can go missing.
 */
function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const ready = window.setInterval(() => {
      if (video.seeking || video.readyState < video.HAVE_CURRENT_DATA) return;
      window.clearInterval(ready);
      window.clearTimeout(timer);
      resolve();
    }, POLL_MS);

    const timer = window.setTimeout(() => {
      window.clearInterval(ready);
      reject(new Error("the seek never landed"));
    }, TIMEOUT_MS);

    // After the poll is armed, not before: this is what sets `seeking`, and an
    // interval started afterwards could miss a seek that lands between the two.
    video.currentTime = time;
  });
}

/** Drops the element's hold on the file. Safe on one that never opened. */
function release(video: HTMLVideoElement | null): void {
  if (!video) return;
  video.onerror = null;
  video.onseeked = null;
  video.removeAttribute("src");
  video.load();
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
