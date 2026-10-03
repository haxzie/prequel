/**
 * One message to every live renderer.
 *
 * Main owns state several surfaces show at once — the dock, the update, the
 * signed-in account, an export's progress — and every one of them travels the
 * same way: to all windows, never to the one that asked. The loop lived in
 * nine places before this; one of them forgetting `isDestroyed()` throws
 * "Object has been destroyed" from inside a progress callback the moment a
 * window closes mid-export.
 */
import { webContents } from "electron";

/**
 * Listeners in main that want what the windows are being told.
 *
 * The command line is the one that needs this: an export and a transcription
 * report their progress by broadcasting it, and `prequel render` has to print
 * frame counts with no window in the picture at all. Watching the broadcast
 * rather than threading a callback through both modules keeps one path for
 * progress — a second one would eventually report something the editor's
 * progress bar does not, or stop reporting when the editor was closed.
 */
const watchers = new Map<string, Set<(payload: unknown) => void>>();

export function toEveryWindow(channel: string, payload: unknown): void {
  for (const contents of webContents.getAllWebContents()) {
    if (!contents.isDestroyed()) contents.send(channel, payload);
  }

  for (const listener of watchers.get(channel) ?? []) {
    try {
      listener(payload);
    } catch (cause) {
      // A watcher that throws must not take the broadcast down with it: the
      // windows have already been told, and the next listener is still owed
      // its copy.
      console.warn(`[broadcast] a ${channel} watcher threw:`, cause);
    }
  }
}

/** Hears everything sent on one channel. Returns the function that stops it. */
export function watch(channel: string, listener: (payload: unknown) => void): () => void {
  const set = watchers.get(channel) ?? new Set();
  set.add(listener);
  watchers.set(channel, set);

  return () => {
    set.delete(listener);
    if (set.size === 0) watchers.delete(channel);
  };
}
