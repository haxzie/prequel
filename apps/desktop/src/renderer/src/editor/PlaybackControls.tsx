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
 * The transport's own button, which is the one control here with a colour.
 *
 * Round rather than the rounded square its neighbours are, and filled either
 * way: it is pressed far more than everything else in this row put together,
 * and the two skips beside it are the same size and the same silhouette. A
 * shape of its own is what lets the pointer find it without reading it.
 *
 * Green to start and white to stop, so the button says what pressing it does
 * rather than what is currently happening — the icon inside it already says
 * that, and a green button showing a pause bar would be two answers to one
 * question. White rather than a second colour because stopping is not a
 * warning; it is simply the other half of the same switch.
 */
const TRANSPORT =
  "grid size-8 place-items-center rounded-full transition-colors [&_svg]:size-[15px]";

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
    // Three columns rather than a flex row with a spacer, so the transport is
    // centred on the *row* and not on whatever is left over after the clock and
    // the verbs have taken their share. The two outer columns are `1fr` each
    // and get an equal split, so the middle one stays put as either side
    // changes width — which the clock does not, but the verb group does the
    // first time undo appears.
    // The border belongs here and nowhere below it: the transport and the strip
    // are one section, so the line goes above the pair rather than between
    // them, where it read as the timeline being a separate panel.
    <div
      className={
        "grid flex-none grid-cols-[1fr_auto_1fr] items-center gap-3 " +
        "border-t border-editor-line bg-editor-veil px-4 py-2"
      }
    >
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
          the longest value it can hold puts that slack on the outside of the
          pair instead, where nothing is reading it. */}
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
      <div className="flex items-center justify-center gap-1">
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
          className={cn(TRANSPORT, playing ? "bg-white text-editor-bg" : "bg-play text-white")}
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

      <div className="flex items-center justify-self-end gap-0.5 rounded-lg bg-white/5 p-0.5">
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
