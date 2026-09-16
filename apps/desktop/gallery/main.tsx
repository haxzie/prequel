import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { DOCK_HEADROOM, PANEL_INSET } from "../src/shared/contract";
import { Gallery } from "./Gallery";
import { SHOTS, configure } from "./shots";
import "./gallery.css";

// The same two custom properties `src/renderer/src/main.tsx` publishes, for
// the same reason: the dock's panel sizes its margins from them.
document.documentElement.style.setProperty("--panel-inset", `${PANEL_INSET}px`);
document.documentElement.style.setProperty("--dock-headroom", `${DOCK_HEADROOM}px`);

/**
 * What the capture script reads and calls.
 *
 * The shot list, so the script never carries a copy of the steps; a `rect`
 * that resolves a selector (and optionally a text match) to a bounding box, so
 * every click and crop is measured in the page rather than guessed in Node;
 * and `settle`, which waits for fonts and for every video to have a frame.
 */
declare global {
  interface Window {
    __gallery: {
      shots: { id: string; frame: string; steps: unknown[]; clip: string | string[]; pad: number; maxWidth: number | null }[];
      rect: (selector: string, text?: string) => DOMRect | null;
      settle: () => Promise<void>;
    };
  }
}

window.__gallery = {
  shots: SHOTS.map(({ id, frame, steps, clip, pad = 0, maxWidth = null }) => ({
    id,
    frame,
    steps,
    clip,
    pad,
    maxWidth,
  })),
  rect(selector, text) {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const element =
      text === undefined
        ? candidates[0]
        : candidates.find((candidate) => (candidate.textContent ?? "").trim() === text);
    return element ? element.getBoundingClientRect() : null;
  },
  async settle() {
    await document.fonts.ready;
    // Every animation that ends, ended. The dock's setup row slides in and a
    // capture taken mid-way shows two rows ghosted over each other. Anything
    // infinite — the recording view's pulsing dot — is left alone, or this
    // would never return.
    await Promise.all(
      document.getAnimations().flatMap((animation) => {
        const timing = animation.effect?.getTiming();
        return timing && timing.iterations !== Infinity ? [animation.finished.catch(() => {})] : [];
      }),
    );
    // Every video with a first frame decoded and no seek in flight, or the
    // preview composites a background with nothing on it.
    const videos = Array.from(document.querySelectorAll("video"));
    await Promise.all(
      videos.map(
        (video) =>
          new Promise<void>((resolve) => {
            const check = () => {
              if (video.readyState >= 2 && !video.seeking) resolve();
              else setTimeout(check, 50);
            };
            check();
          }),
      ),
    );
    for (let i = 0; i < 3; i += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  },
};

/**
 * The devices the fixtures name, reported as present.
 *
 * `DeviceMenu` shows a device as switched on only when the browser lists it;
 * headless Chrome lists nothing, so a camera that is on in the preferences
 * would draw with the red "unavailable" dot. Chrome's `--use-fake-device`
 * flags would list devices, but under their own names, which would not match
 * either. Nothing here ever opens a device — `devicesLive` is false in every
 * fixture — so listing them is the whole of what is needed.
 */
const FIXTURE_DEVICES: MediaDeviceInfo[] = [
  { deviceId: "camera-1", kind: "videoinput", label: "FaceTime HD Camera", groupId: "built-in" },
  { deviceId: "mic-1", kind: "audioinput", label: "MacBook Pro Microphone", groupId: "built-in" },
].map((device) => ({ ...device, toJSON: () => device }) as MediaDeviceInfo);

navigator.mediaDevices.enumerateDevices = () => Promise.resolve(FIXTURE_DEVICES);

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

void configure().then(() => {
  createRoot(container).render(
    <StrictMode>
      <Gallery />
    </StrictMode>,
  );
});
