/**
 * Letting the mouse through a transparent window except where something is drawn.
 *
 * Every floating panel here is bigger than the control inside it — a margin
 * for the shadow, a band for tooltips — and a transparent window still takes
 * every click over it. So the window ignores the mouse except while the
 * cursor is over the drawn part, and main watches the cursor to say when. Main
 * rather than the renderer, because the drawn part is a drag region, and a
 * drag region gets no mouse events for the renderer to decide this from.
 *
 * Shared by the dock and the teleprompter; the camera bubble's poll is a
 * different job (it reveals a button rather than deciding whether a click
 * lands) and keeps its own.
 */
import { screen, type BrowserWindow, type Rectangle } from "electron";

/**
 * How often the cursor is checked.
 *
 * Quick, because this decides whether a click lands at all: a cursor that
 * crossed the edge and clicked inside one tick would fall through to whatever
 * is behind.
 */
const CURSOR_POLL_MS = 40;

/**
 * Starts polling; returns the function that stops it.
 *
 * `over` says whether a point is on the drawn part of the window. Checked once
 * on the way in and then on every tick, so a panel that opens under the cursor
 * is clickable at once rather than a tick later. Stopping puts the window back
 * to click-through, so the next show starts from the state `prepare`
 * established rather than from wherever the cursor last was.
 */
export function watchCursor(
  window: BrowserWindow,
  over: (bounds: Rectangle, point: { x: number; y: number }) => boolean,
): () => void {
  let passthrough = true;
  let timer: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    if (!passthrough && !window.isDestroyed()) window.setIgnoreMouseEvents(true);
    passthrough = true;
  };

  const track = () => {
    if (window.isDestroyed() || !window.isVisible()) {
      stop();
      return;
    }
    const next = !over(window.getBounds(), screen.getCursorScreenPoint());
    if (next === passthrough) return;
    passthrough = next;
    window.setIgnoreMouseEvents(next);
  };

  track();
  timer = setInterval(track, CURSOR_POLL_MS);
  return stop;
}
