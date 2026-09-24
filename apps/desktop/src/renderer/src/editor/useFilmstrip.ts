/**
 * Extracting a recording's frames into one sprite sheet for the timeline.
 *
 * Runs once per recording and produces a single image covering the whole source
 * clock, which every clip then reads its own span out of — the same arrangement
 * `useWaveforms` has, and for the same reason: doing it per clip would decode
 * the same file again on every cut.
 *
 * One sheet across every take, not one per take. The cells are indexed by source
 * time, so a sheet per take would make every reader ask which take a moment is
 * in before it could pick a cell — where walking the takes in order while
 * filling one sheet costs a `src` swap per take, on an element nothing is
 * watching.
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

  const screen = media.filter((track) => track.kind === "screen");
  // Keyed on the URLs rather than the array: `media` is a fresh array on every
  // render of the editor, and depending on it directly would re-extract the
  // whole recording each time.
  const key = screen.map((track) => track.url).join("|");

  useEffect(() => {
    if (key === "" || duration <= 0) {
      setStrip(null);
      return;
    }

    // The editor can be closed, or another recording opened into the same
    // window, while a long take is still being walked through.
    let live = true;
    const video = document.createElement("video");

    void build(video, screen, duration, cellHeight, () => live)
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
    // `screen` is derived from `key`, which is what actually decides whether the
    // work has to be redone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, duration, cellHeight]);

  return strip;
}

/** Walks every take in order, drawing each frame into the one sheet. */
async function build(
  video: HTMLVideoElement,
  segments: readonly TrackMedia[],
  duration: MediaTime,
  cellHeight: number,
  live: () => boolean,
): Promise<Filmstrip | null> {
  // Same reason the on-screen elements carry it: `prequel-media:` is a different
  // origin, and a tainted element poisons any attempt to read pixels back off it
  // — which is the entire purpose of this one.
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.preload = "auto";

  const plan = cadence(duration);
  const height = Math.max(1, Math.round(cellHeight));

  const canvas = document.createElement("canvas");
  canvas.width = THUMB_WIDTH * Math.min(plan.count, MAX_FRAMES);
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) return null;

  let drew = 0;

  for (const segment of segments) {
    if (!live()) return null;

    video.src = segment.url;
    // A swap per take, not per frame. This element is off the DOM and nothing
    // reads it while it seeks, so the `load()` a swap costs is paid once per
    // take — unlike the playback elements, where a swap at a seam would blank
    // the picture every time the playhead crossed one.
    await once(video, "loadedmetadata");
    if (!live()) return null;
    if (video.videoWidth === 0) continue;

    // Per take, because two takes can be different sizes. Cover, not fit: a cell
    // is 48 wide by the clip row's height, which is a squarer box than any
    // screen recording. Letterboxing would put bars through the middle of the
    // strip, so the frame is cropped to the centre instead — this is
    // orientation, and the centre is where the content is.
    const scale = Math.max(THUMB_WIDTH / video.videoWidth, height / video.videoHeight);
    const cropWidth = THUMB_WIDTH / scale;
    const cropHeight = height / scale;
    const cropX = (video.videoWidth - cropWidth) / 2;
    const cropY = (video.videoHeight - cropHeight) / 2;

    const from = segment.offset;
    const to = segment.offset + segment.duration;

    for (let index = 0; index < plan.count; index += 1) {
      if (!live()) return null;

      // Clamped inside the whole recording first, because the last cell's
      // nominal time can land a hair past the end.
      const source = Math.min(frameTime(index, plan.interval), duration - plan.interval / 2);
      if (source < from || source >= to) continue;

      // Into this take's own file, which is zero-based — the offset is the only
      // record of where it sits, and subtracting it twice would show an earlier
      // moment of the take in every cell.
      const at = Math.min(source - from, Math.max(0, segment.duration - plan.interval / 2));
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
