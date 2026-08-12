import type { Dispatch } from "react";

import { cn } from "../lib/cn";
import { formatTimecode } from "../lib/format";
import {
  ScissorsIcon,
  CursorIcon,
  PauseIcon,
  PlayIcon,
  SkipEndIcon,
  SkipStartIcon,
  TrashIcon,
} from "./icons";
import type { EditorAction, TimelineTool } from "./state";
import type { EditorPlayback } from "./useEditorPlayback";

const BUTTON =
  "grid size-8 place-items-center rounded-lg text-editor-fg hover:bg-white/10 " +
  "disabled:opacity-35 [&_svg]:size-[15px]";

/**
 * Which tools the timeline offers, and the keys that reach them.
 *
 * The shortcut is in the tooltip rather than only in a menu: these are the
 * three things done most often in an editor, and reaching for the mouse to
 * change tool is most of the cost of using one.
 */
export const TOOLS: { tool: TimelineTool; label: string; key: string; Icon: typeof CursorIcon }[] =
  [
    { tool: "select", label: "Select", key: "V", Icon: CursorIcon },
    { tool: "slice", label: "Slice", key: "C", Icon: ScissorsIcon },
    { tool: "delete", label: "Delete", key: "D", Icon: TrashIcon },
  ];

/**
 * Transport on the left, timeline tools on the right.
 *
 * No scrub bar: the timeline underneath is the scrubber now, and two of them
 * would be two playheads to keep in step and two places to look for the same
 * answer.
 */
export function PlaybackControls({
  media,
  tool,
  dispatch,
}: {
  media: EditorPlayback;
  tool: TimelineTool;
  dispatch: Dispatch<EditorAction>;
}) {
  const { playback, playing, duration, onInteract } = media;

  return (
    <div className="flex flex-none items-center gap-3 border-t border-editor-line px-4 py-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={BUTTON}
          title="Go to start"
          onClick={() => {
            onInteract();
            playback.seek(0);
          }}
        >
          <SkipStartIcon />
        </button>
        <button
          type="button"
          className={cn(BUTTON, "bg-white/10")}
          title={playing ? "Pause (Space)" : "Play (Space)"}
          onClick={() => {
            onInteract();
            playback.toggle();
          }}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          type="button"
          className={BUTTON}
          title="Go to end"
          onClick={() => {
            onInteract();
            playback.seek(duration);
          }}
        >
          <SkipEndIcon />
        </button>
      </div>

      {/* Rendered once. The playback loop rewrites its text, so React must not
          — it changes sixty times a second. */}
      <span ref={media.timecodeRef} className="w-16 flex-none text-xs tabular-nums text-editor-fg">
        0:00.00
      </span>
      <span className="text-xs tabular-nums text-editor-muted">/ {formatTimecode(duration)}</span>

      <span className="flex-1" />

      <div
        className="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5"
        role="radiogroup"
        aria-label="Timeline tool"
      >
        {TOOLS.map(({ tool: value, label, key, Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={value === tool}
            title={`${label} (${key})`}
            className={cn(
              "grid size-7 place-items-center rounded-md [&_svg]:size-[15px]",
              // The same blue the dock marks a chosen capture mode with — one
              // token, `--selected`, so "this is the active choice" looks the
              // same in both windows. White on it, unlike the editor's light
              // accent, which needs dark text.
              value === tool
                ? "bg-selected text-white"
                : "text-editor-muted hover:bg-white/10 hover:text-editor-fg",
            )}
            onClick={() => dispatch({ type: "setTool", tool: value })}
          >
            <Icon />
          </button>
        ))}
      </div>
    </div>
  );
}
