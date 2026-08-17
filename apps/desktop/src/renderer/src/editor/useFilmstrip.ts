/**
 * Extracting a recording's frames into one sprite sheet for the timeline.
 *
 * Runs once per recording and produces a single image covering the whole take,
 * which every clip then reads its own span out of — the same arrangement
 * `useWaveforms` has, and for the same reason: doing it per clip would decode
 * the same file again on every cut.
 *
 * **The video element here is deliberately its own.** The four elements the
 * editor plays from are driven at 60 Hz by `useEditorPlayback`, and
 * `syncElement` corrects each of them towards the master clock on every frame.
 * Seeking one of those for a thumbnail would fight that loop, and worse:
 * `currentTime =` drops `readyState` to 1 for the two or three frames the
 * decoder takes, which is exactly what made a cut flash the background. A
 * thumbnail pass over a live element would strobe the preview for as long as it
 * ran. So this opens its own element, off the DOM, and the playback loop never
 * learns about it.
 */
import { useEffect, useState } from "react";

import type { TrackMedia } from "../../../shared/contract";
import type { MediaTime } from "../../../shared/manifest";
import { cadence, frameTime, MAX_FRAMES, THUMB_WIDTH, type Cadence } from "./filmstrip";

/** How long one seek is given before the strip gives up on that frame. */
const SEEK_TIMEOUT_MS = 3000;

export interface Filmstrip {
  /** The sheet, as a data URL: `count` cells in one row. */
  sheet: string;
  /** Cell height in CSS pixels — the row height it was asked for. */
  height: number;
  cadence: Cadence;
}

/**
 * A sprite sheet for the screen track, or null until there is one.
 *
 * Null rather than an empty sheet while extracting, so a clip can tell "still
 * working" from "this recording has no frames to show" and draw nothing rather
 * than a row of empty boxes that would then be replaced.
 */
export function useFilmstrip(
  media: TrackMedia[],
  duration: MediaTime,
  cellHeight: number,
): Filmstrip | null {
  const [strip, setStrip] = useState<Filmstrip | null>(null);

  // Keyed on the URL rather than the array: `media` is a fresh array on every
  // render of the editor, and depending on it directly would re-extract the
  // whole recording each time.
  const screen = media.find((track) => track.kind === "screen");
  const url = screen?.url ?? "";

  useEffect(() => {
    if (url === "" || duration <= 0) {
      setStrip(null);
      return;
    }

    // The editor can be closed, or another recording opened into the same
    // window, while a long take is still being walked through.
    let live = true;
    const video = document.createElement("video");

    void build(video, url, duration, cellHeight, () => live)
      .then((built) => {
        if (live) setStrip(built);
      })
      .catch((cause) => {
        // A strip is decoration. A recording whose frames cannot be read still
        // has a timeline, and the clips simply draw without one.
        console.warn("[editor] could not build the filmstrip:", cause);
      });

    return () => {
      live = false;
      // Releases the decoder rather than waiting for collection: this element
      // holds a 4K decode pipeline open, and a few of them left behind is real
      // memory.
      video.removeAttribute("src");
      video.load();
    };
  }, [url, duration, cellHeight]);

  return strip;
}

/** Walks the recording once, drawing each frame into the sheet. */
async function build(
  video: HTMLVideoElement,
  url: string,
  duration: MediaTime,
  cellHeight: number,
  live: () => boolean,
): Promise<Filmstrip | null> {
  video.src = url;
  // Same reason the on-screen elements carry it: `prequel-media:` is a different
  // origin, and a tainted element poisons any attempt to read pixels back off it
  // — which is the entire purpose of this one.
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.preload = "auto";

  await once(video, "loadedmetadata");
  if (!live() || video.videoWidth === 0) return null;

  const plan = cadence(duration);
  const height = Math.max(1, Math.round(cellHeight));

  const canvas = document.createElement("canvas");
  canvas.width = THUMB_WIDTH * Math.min(plan.count, MAX_FRAMES);
  canvas.height = height;

  // Cover, not fit: a cell is 48 wide by the clip row's height, which is a
  // squarer box than any screen recording. Letterboxing would put bars through
  // the middle of the strip, so the frame is cropped to the centre instead —
  // this is orientation, and the centre is where the content is.
  const scale = Math.max(THUMB_WIDTH / video.videoWidth, height / video.videoHeight);
  const cropWidth = THUMB_WIDTH / scale;
  const cropHeight = height / scale;
  const cropX = (video.videoWidth - cropWidth) / 2;
  const cropY = (video.videoHeight - cropHeight) / 2;

  const context = canvas.getContext("2d");
  if (!context) return null;

  let drew = 0;
  for (let index = 0; index < plan.count; index += 1) {
    if (!live()) return null;

    // Clamped inside the file: the last frame's nominal time can land a hair
    // past the end, and seeking past the end never fires `seeked`.
    const at = Math.min(frameTime(index, plan.interval), duration - plan.interval / 2);
    const seeked = await seek(video, at / 1_000_000_000);
    if (!seeked) continue;

    context.drawImage(
      video,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      index * THUMB_WIDTH,
      0,
      THUMB_WIDTH,
      height,
    );
    drew += 1;
  }

  if (!live() || drew === 0) return null;

  // JPEG, not PNG: this is photographic content at 48px wide, and a PNG sheet of
  // 240 screen frames runs to several megabytes of data URL for no visible gain.
  return { sheet: canvas.toDataURL("image/jpeg", 0.7), height, cadence: plan };
}

/** Resolves once the element has a frame at `seconds`, or false if it will not. */
function seek(video: HTMLVideoElement, seconds: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      resolve(ok);
    };

    const onSeeked = () => done(true);
    const onError = () => done(false);

    // A seek that never completes must not stall the whole strip: one missing
    // thumbnail is a gap, a hung loop is a timeline that never gets one.
    const timer = setTimeout(() => done(false), SEEK_TIMEOUT_MS);

    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.currentTime = seconds;
  });
}

function once(target: HTMLVideoElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    target.addEventListener(event, () => resolve(), { once: true });
    target.addEventListener("error", () => reject(new Error(`${event} never arrived`)), {
      once: true,
    });
  });
}
