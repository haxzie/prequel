/**
 * The chords macOS keeps for itself.
 *
 * Here rather than in `main/` for the reason `accelerator.ts` is: main needs the
 * table to switch a hotkey off, and the settings window needs it to say that it
 * has been, and two copies of "is ⇧⌘5 Apple's?" is two ways to be wrong. Imports
 * nothing from `electron` or Node.
 *
 * A *symbolic hotkey* is one the WindowServer dispatches to an Apple service
 * before any application's hotkey table is consulted. `globalShortcut.register`
 * takes one happily and never hears the key. `main/system-hotkeys.ts` is what
 * actually takes it off macOS; this is only the knowledge of which chords those
 * are.
 */
import { normaliseAccelerator } from "./accelerator.js";

export type SystemHotkey = {
  /** The chord, in `normaliseAccelerator`'s spelling. */
  chord: string;
  /** The id this hotkey has in `com.apple.symbolichotkeys`. */
  id: number;
  /**
   * `(ascii, keycode, modifier mask)` — the triple System Settings stores, and
   * what tells a default mapping from one the user has moved elsewhere.
   */
  parameters: [number, number, number];
  /** What macOS does with it, for a sentence the user reads. */
  owner: string;
};

/**
 * Only the screenshot family.
 *
 * These are the ids a screen recorder has any reason to want, and the set is
 * deliberately short: an id guessed wrong switches off something the user never
 * mentioned, and there is no list of these in any SDK header to check against.
 */
export const SYSTEM_HOTKEYS: SystemHotkey[] = [
  { chord: "Ctrl+Shift+Cmd+3", id: 28, parameters: [51, 20, 1441792], owner: "copying the screen" },
  { chord: "Shift+Cmd+3", id: 29, parameters: [51, 20, 1179648], owner: "saving the screen" },
  {
    chord: "Ctrl+Shift+Cmd+4",
    id: 30,
    parameters: [52, 21, 1441792],
    owner: "copying a selection",
  },
  { chord: "Shift+Cmd+4", id: 31, parameters: [52, 21, 1179648], owner: "saving a selection" },
  { chord: "Shift+Cmd+5", id: 184, parameters: [53, 23, 1179648], owner: "the screenshot toolbar" },
];

/** The system hotkey a chord collides with, or null if macOS wants nothing. */
export function systemHotkeyFor(accelerator: string): SystemHotkey | null {
  const wanted = normaliseAccelerator(accelerator);
  if (!wanted) return null;
  return SYSTEM_HOTKEYS.find((hotkey) => hotkey.chord === wanted) ?? null;
}
