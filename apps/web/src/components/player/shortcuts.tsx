"use client";

import { X } from "lucide-react";

/** What a key asks the player to do. */
export type Shortcut =
  | { type: "toggle" }
  | { type: "seekBy"; seconds: number }
  | { type: "frame"; direction: 1 | -1 }
  | { type: "seekFraction"; fraction: number }
  | { type: "start" }
  | { type: "end" }
  | { type: "mute" }
  | { type: "volume"; delta: number }
  | { type: "rate"; direction: 1 | -1 }
  | { type: "fullscreen" }
  | { type: "pip" }
  | { type: "captions" }
  | { type: "chapter"; direction: 1 | -1 }
  | { type: "help" };

/**
 * The key to the action, or null for a key the player does not take.
 *
 * The set is YouTube's, because that is the one people arrive knowing: k and
 * space play, j and l jump ten seconds, the arrows five, the digits a tenth
 * each. Inventing a better layout would mean nobody's fingers already knew it.
 *
 * `focused` is whether the player itself holds focus. The up and down arrows
 * are volume only then — on a page with anything below the video they are
 * how somebody scrolls, and taking them everywhere would break the page to
 * save a reach for the mouse.
 */
export function shortcutFor(event: KeyboardEvent, focused: boolean): Shortcut | null {
  // `code` for the letters, so a keyboard layout that puts a different
  // character on the K key still plays; `key` for the punctuation, which
  // moves between layouts and is what is printed on the cap.
  switch (event.code) {
    case "Space":
    case "KeyK":
      return { type: "toggle" };
    case "KeyJ":
      return { type: "seekBy", seconds: -10 };
    case "KeyL":
      return { type: "seekBy", seconds: 10 };
    case "ArrowLeft":
      return { type: "seekBy", seconds: -5 };
    case "ArrowRight":
      return { type: "seekBy", seconds: 5 };
    case "ArrowUp":
      return focused ? { type: "volume", delta: 0.1 } : null;
    case "ArrowDown":
      return focused ? { type: "volume", delta: -0.1 } : null;
    case "Home":
      return { type: "start" };
    case "End":
      return { type: "end" };
    case "KeyM":
      return { type: "mute" };
    case "KeyF":
      return { type: "fullscreen" };
    case "KeyI":
      return { type: "pip" };
    case "KeyC":
      return { type: "captions" };
    case "KeyN":
      return event.shiftKey ? { type: "chapter", direction: 1 } : null;
    case "KeyP":
      return event.shiftKey ? { type: "chapter", direction: -1 } : null;
  }

  switch (event.key) {
    case ",":
      return { type: "frame", direction: -1 };
    case ".":
      return { type: "frame", direction: 1 };
    case "<":
      return { type: "rate", direction: -1 };
    case ">":
      return { type: "rate", direction: 1 };
    case "?":
      return { type: "help" };
  }

  if (/^[0-9]$/.test(event.key) && !event.shiftKey) {
    return { type: "seekFraction", fraction: Number(event.key) / 10 };
  }

  return null;
}

/** A row of the sheet: the keys, then what they do. */
const ROWS: { keys: string[]; does: string; chapters?: true; captions?: true }[] = [
  { keys: ["Space", "K"], does: "Play or pause" },
  { keys: ["J", "L"], does: "Back or forward 10 seconds" },
  { keys: ["←", "→"], does: "Back or forward 5 seconds" },
  { keys: [",", "."], does: "Previous or next frame, while paused" },
  { keys: ["0–9"], does: "Jump to a tenth of the way through" },
  { keys: ["Home", "End"], does: "Start or end" },
  { keys: ["⇧ P", "⇧ N"], does: "Previous or next chapter", chapters: true },
  { keys: ["<", ">"], does: "Slower or faster" },
  { keys: ["M"], does: "Mute" },
  { keys: ["C"], does: "Subtitles", captions: true },
  { keys: ["↑", "↓"], does: "Volume, when the player has focus" },
  { keys: ["F"], does: "Full screen" },
  { keys: ["I"], does: "Picture in picture" },
  { keys: ["?"], does: "This sheet" },
];

/**
 * The shortcuts, on a sheet over the picture.
 *
 * Over the picture rather than in a tooltip, so it can be read while the video
 * plays under it and dismissed with the same key that opened it. Shown from
 * the keyboard button in the bar and from `?`, which is the key every
 * keyboard-driven site has taught people to try.
 */
export function Shortcuts({
  hasChapters,
  hasCaptions,
  onClose,
}: {
  hasChapters: boolean;
  hasCaptions: boolean;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label="Keyboard shortcuts"
      className="absolute inset-0 z-20 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-black/80 p-4 text-sm shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Keyboard shortcuts</h2>
          <button
            type="button"
            aria-label="Close"
            className="grid size-7 place-items-center rounded-md text-white/70 hover:bg-white/15 hover:text-white"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          {ROWS.filter(
            (row) => (!row.chapters || hasChapters) && (!row.captions || hasCaptions),
          ).map((row) => (
            <div key={row.does} className="contents">
              <dt className="flex gap-1">
                {row.keys.map((key) => (
                  <kbd
                    key={key}
                    className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-sans text-xs text-white/90"
                  >
                    {key}
                  </kbd>
                ))}
              </dt>
              <dd className="text-white/70">{row.does}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
