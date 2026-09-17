/**
 * The global shortcuts, and the one that can be rebound.
 *
 * These were two `globalShortcut.register` calls at the end of `whenReady`,
 * which was fine while both accelerators were constants. A remappable one needs
 * an owner, because rebinding is not "register the new chord" — it is
 * unregister, try, and put the old one back if the try failed.
 *
 * `register` returning `false` is the only signal macOS gives us that something
 * else already owns a combination. There is no way to ask *who*, so nothing
 * here pretends to know.
 */
import { globalShortcut } from "electron";

import { isBindable, normaliseAccelerator } from "../shared/accelerator.js";
import { TELEPROMPTER_SHORTCUTS } from "../shared/contract.js";
import { log } from "./log.js";

/** Pause stays a constant: only the start/stop toggle is rebindable. */
export const PAUSE_SHORTCUT = "Shift+Cmd+P";

type Handlers = {
  onToggle: () => void;
  onPause: () => void;
};

let handlers: Handlers | null = null;
let toggle: string | null = null;

/**
 * Registers both shortcuts for the first time.
 *
 * A toggle that will not register is logged and left unbound rather than
 * substituted — a shortcut that silently became a different chord is worse than
 * one that is visibly missing, and the settings window shows the stored value
 * either way.
 */
export function applyShortcuts(accelerator: string, next: Handlers): void {
  handlers = next;
  globalShortcut.register(PAUSE_SHORTCUT, () => next.onPause());

  const wanted = normaliseAccelerator(accelerator);
  if (wanted && bind(wanted)) return;
  log("warn", `could not register ${accelerator}; start/stop has no shortcut`);
}

/**
 * Rebinds the toggle, keeping the old chord live if the new one is refused.
 *
 * The order is load-bearing. Unregistering first is what lets someone rebind to
 * the chord they already have — registering over yourself fails otherwise — and
 * restoring on failure is what stops a rejected change leaving them with no
 * working shortcut at all, which is worse than the change they attempted.
 */
export function setToggleShortcut(accelerator: string): boolean {
  const wanted = normaliseAccelerator(accelerator);
  if (!wanted || !isBindable(wanted)) return false;

  const previous = toggle;
  if (previous) globalShortcut.unregister(previous);

  if (bind(wanted)) {
    log("info", `start/stop shortcut is now ${wanted}`);
    return true;
  }

  log("warn", `${wanted} is already taken; keeping ${previous ?? "nothing"}`);
  if (previous) bind(previous);
  return false;
}

export interface TeleprompterKeys {
  onStep: (sentences: -1 | 1) => void;
  onPause: () => void;
  onTop: () => void;
}

/**
 * Binds the prompter's keys, for as long as the island shows.
 *
 * Global rather than window-level because the island is a non-activating
 * panel and never has the keyboard — anything it responds to has to be taken
 * from the app being recorded, which is why they are bound for exactly that
 * long and no longer. Each one that another app already owns is logged and
 * left unbound rather than substituted, as the toggle is.
 */
export function bindTeleprompterKeys(keys: TeleprompterKeys): void {
  const chords: [string, () => void][] = [
    [TELEPROMPTER_SHORTCUTS.previous, () => keys.onStep(-1)],
    [TELEPROMPTER_SHORTCUTS.next, () => keys.onStep(1)],
    [TELEPROMPTER_SHORTCUTS.pause, () => keys.onPause()],
    [TELEPROMPTER_SHORTCUTS.top, () => keys.onTop()],
  ];
  for (const [chord, handler] of chords) {
    if (!globalShortcut.register(chord, handler)) {
      log("warn", `could not register ${chord}; the prompter key is unbound`);
    }
  }
}

export function unbindTeleprompterKeys(): void {
  for (const chord of Object.values(TELEPROMPTER_SHORTCUTS)) globalShortcut.unregister(chord);
}

export function teardownShortcuts(): void {
  globalShortcut.unregisterAll();
  handlers = null;
  toggle = null;
}

/** The chord the toggle is actually bound to, or null if nothing took. */
export function boundToggle(): string | null {
  return toggle;
}

function bind(accelerator: string): boolean {
  // Reading `handlers` at fire time rather than capturing it means a rebind
  // does not leave a closure pointing at a flow from a previous registration.
  const ok = globalShortcut.register(accelerator, () => handlers?.onToggle());
  if (ok) toggle = accelerator;
  return ok;
}
