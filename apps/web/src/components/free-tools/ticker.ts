/**
 * A clock that keeps running while the tab is in the background.
 *
 * This is the single most important twenty lines in the browser recorder, and
 * it is here because of the obvious bug: the tab doing the recording is almost
 * never the tab being looked at. Somebody starts a recording, switches to the
 * app they are demonstrating, and the recording tab is now hidden.
 *
 * A composited recording is a canvas captured with `captureStream`, and that
 * stream only emits a frame when something paints the canvas. Driving that
 * paint from `requestAnimationFrame` works perfectly until the tab is hidden,
 * at which point the browser stops serving animation frames altogether and the
 * recording freezes on the last frame drawn. The file is the right length, the
 * audio is all there, and the picture is a still of the moment the viewer
 * looked away. `setInterval` on the main thread is throttled to about once a
 * second in a hidden tab, which is the same bug at one frame per second.
 *
 * A timer inside a worker is not throttled, so the worker holds the clock and
 * the main thread does nothing but draw when told to. Canvas 2D drawing and
 * `captureStream` both keep working in a hidden tab; it is only the frame
 * callback that stops.
 */

/**
 * The worker, as a string.
 *
 * Inline rather than a file under `public/`: a separate file would be a second
 * deployable artefact for a `setInterval`, and a blob URL worker is same-origin
 * so it is not blocked by the site's own policy.
 */
const SOURCE = `
let timer = null;
self.onmessage = (event) => {
  if (timer !== null) { clearInterval(timer); timer = null; }
  if (event.data.interval > 0) {
    timer = setInterval(() => self.postMessage(0), event.data.interval);
  }
};
`;

export type Ticker = { stop: () => void };

/**
 * Call `onTick` about `fps` times a second until the returned handle is stopped.
 *
 * Falls back to `requestAnimationFrame` where a worker cannot be constructed.
 * That is the degraded path, and it degrades in exactly the way described above,
 * so it is only ever reached in a browser that has blocked blob workers.
 */
export function startTicker(fps: number, onTick: () => void): Ticker {
  const interval = 1000 / fps;

  try {
    const url = URL.createObjectURL(new Blob([SOURCE], { type: "text/javascript" }));
    const worker = new Worker(url);
    // Revoked immediately: the worker is already loaded, and the URL is a
    // document-lifetime leak otherwise.
    URL.revokeObjectURL(url);

    worker.onmessage = () => onTick();
    worker.postMessage({ interval });

    return {
      stop: () => {
        worker.postMessage({ interval: 0 });
        worker.terminate();
      },
    };
  } catch {
    let frame = 0;
    let last = 0;

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (now - last < interval - 1) return;
      last = now;
      onTick();
    };

    frame = requestAnimationFrame(loop);
    return { stop: () => cancelAnimationFrame(frame) };
  }
}
