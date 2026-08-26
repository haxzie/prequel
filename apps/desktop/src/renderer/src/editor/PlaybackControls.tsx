import type { Dispatch } from "react";

import { cn } from "../lib/cn";
import { formatTimecode } from "../lib/format";
import {
  ScissorsIcon,
  PauseIcon,
  PlayIcon,
  SkipEndIcon,
  SkipStartIcon,
  TrashIcon,
  UndoIcon,
} from "./icons";
import type { EditorAction } from "./state";
import type { EditorPlayback } from "./useEditorPlayback";

const BUTTON =
  "grid size-8 place-items-center rounded-lg text-editor-fg hover:bg-white/10 " +
  "disabled:opacity-35 [&_svg]:size-[15px]";

/**
 * Transport on the left, the two things you can do to a clip on the right.
 *
 * Buttons rather than modes. A tool that changes what a click means has to be
 * held in your head, put back when you are done, and shows its effect only
 * after you have already committed to it — for two actions on an already
 * selected clip, that is a state machine standing in for a verb.
 *
 * No scrub bar: the timeline underneath is the scrubber now, and two of them
 * would be two playheads to keep in step and two places to look for the same
 * answer.
 */
export function PlaybackControls({
  media,
  canSplit,
  canDelete,
  canUndo,
  onSplit,
  onDelete,
  onUndo,
  dispatch,
}: {
  media: EditorPlayback;
  /** A clip is selected, so there is something to cut. */
  canSplit: boolean;
  /** A clip or a zoom is selected, so there is something to remove. */
  canDelete: boolean;
  /** The timeline has been changed at least once, so there is a step back. */
  canUndo: boolean;
  onSplit: () => void;
  onDelete: () => void;
  onUndo: () => void;
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

      {/* The clock and what it is counting towards, as one thing.

          Grouped so the row's own `gap-3` cannot fall between them: a time and
          its total read as a single value, and spacing them like two controls
          is half of what made this look wrong.

          The other half was the width. The box has to be fixed — the playback
          loop writes the text straight to the DOM sixty times a second, and an
          auto-width box would resize as the digits changed and shunt the total
          left and right on every frame — but it was a flat `w-16` with the text
          left-aligned, so every value shorter than the box left its slack
          sitting between the time and the slash. Right-aligned in a box sized to
          the longest value it can hold puts that slack beside the transport
          instead, where the row is already spaced. */}
      <div className="flex items-center gap-1 text-xs tabular-nums">
        {/* Rendered once. The playback loop rewrites its text, so React must not. */}
        <span
          ref={media.timecodeRef}
          className="flex-none text-right text-editor-fg"
          // The total, because the two share a format and nothing the clock can
          // say is wider than the thing it is counting towards. `ch` is the
          // advance of a digit and `tabular-nums` makes every digit that wide,
          // so this is exact for the digits and generous by the difference on
          // the colon and the point — which is the safe direction to be wrong.
          style={{ width: `${String(formatTimecode(duration).length)}ch` }}
        >
          0:00.00
        </span>
        <span className="text-editor-muted">/ {formatTimecode(duration)}</span>
      </div>

      <span className="flex-1" />

      <div className="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5">
        {/* Hidden until there is a step back, not disabled like the two beside
            it — those are always the verbs for the current selection, whereas
            undo is a claim that something happened, and an empty history has
            nothing to say. Because the group is pinned to the right by the
            spacer above, appearing extends it leftwards and the cut and delete
            buttons stay exactly where they were. */}
        {canUndo && (
          <Action label="Undo" shortcut="⌘Z" Icon={UndoIcon} disabled={false} onClick={onUndo} />
        )}
        <Action
          label="Split at the playhead"
          shortcut="S"
          Icon={ScissorsIcon}
          // Both act on the selection, so with nothing selected there is
          // nothing for either to do. Disabled rather than hidden: they are
          // where they will be when there is.
          disabled={!canSplit}
          onClick={onSplit}
        />
        <Action
          label="Delete"
          shortcut="⌫"
          Icon={TrashIcon}
          disabled={!canDelete}
          onClick={onDelete}
        />
      </div>
    </div>
  );
}

/** One of the two verbs, with its shortcut in the tooltip. */
function Action({
  label,
  shortcut,
  Icon,
  disabled,
  onClick,
}: {
  label: string;
  shortcut: string;
  Icon: () => React.JSX.Element;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={`${label} (${shortcut})`}
      aria-label={label}
      disabled={disabled}
      className={cn(
        "grid size-7 place-items-center rounded-md [&_svg]:size-[15px]",
        disabled
          ? "text-editor-muted/40"
          : "text-editor-muted hover:bg-white/10 hover:text-editor-fg",
      )}
      onClick={onClick}
    >
      <Icon />
    </button>
  );
}
