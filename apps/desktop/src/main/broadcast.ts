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

export function toEveryWindow(channel: string, payload: unknown): void {
  for (const contents of webContents.getAllWebContents()) {
    if (!contents.isDestroyed()) contents.send(channel, payload);
  }
}
