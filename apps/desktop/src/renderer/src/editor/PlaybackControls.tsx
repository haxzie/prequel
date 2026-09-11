import type { Dispatch } from "react";

import { cn } from "../lib/cn";
import { formatTimecode } from "../lib/format";
import { Timecode } from "./Timecode";
import {
  AddZoomIcon,
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
  canAddZoom,
  canSplit,
  canDelete,
  canUndo,
  onAddZoom,
  onSplit,
  onDelete,
  onUndo,
  dispatch,
}: {
  media: EditorPlayback;
  /** Some gap in the zoom row is big enough to hold one. */
  canAddZoom: boolean;
  /** A clip is selected, so there is something to cut. */
  canSplit: boolean;
  /** A clip or a zoom is selected, so there is something to remove. */
  canDelete: boolean;
  /** The timeline has been changed at least once, so there is a step back. */
  canUndo: boolean;
  onAddZoom: () => void;
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
        <Timecode
          elementRef={media.timecodeRef}
          initial="0:00.00"
          className="flex-none text-right text-editor-fg"
          // The total, because the two share a format and nothing the clock can
          // say is wider than the thing it is counting towards. `ch` is the
          // advance of a digit and `tabular-nums` makes every digit that wide,
          // so this is exact for the digits and generous by the difference on
          // the colon and the point — which is the safe direction to be wrong.
          style={{ width: `${String(formatTimecode(duration).length)}ch` }}
        />
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

      <div className="flex items-center justify-self-end gap-2">
        {/* On its own, in a pill of its own. The group beside it is the verbs
            for the current selection — undo, cut, delete all act on what you
            have already picked — and this one acts on the playhead instead,
            so putting it in the same box said it was a fourth of the same
            kind. It is also the one with a word on it: a bare magnifier next
            to a pair of scissors reads as a search box. */}
        <div className="rounded-lg bg-white/5 p-0.5">
          <Action
            label="Add Zoom"
            shortcut="Z"
            Icon={AddZoomIcon}
            text
            // Only ever off when the zoom row is full — every gap is already
            // taken or too small to grab. Not tied to the playhead: the button
            // finds the nearest gap itself, so where the head is does not
            // decide whether pressing it does something.
            disabled={!canAddZoom}
            onClick={onAddZoom}
          />
        </div>

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
    </div>
  );
}

/**
 * One of the verbs, with its shortcut in the tooltip.
 *
 * A square glyph by default; with `text` it grows into a pill with the word
 * beside the glyph, the same height, so the two shapes sit on one baseline in
 * the same group without looking like two kinds of control.
 */
function Action({
  label,
  shortcut,
  Icon,
  text,
  disabled,
  onClick,
}: {
  label: string;
  shortcut: string;
  Icon: () => React.JSX.Element;
  /** Whether the label is written out beside the glyph. */
  text?: boolean;
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
        "flex h-7 items-center gap-1.5 rounded-md text-[11px] [&_svg]:size-[15px]",
        text ? "px-2" : "w-7 justify-center",
        disabled
          ? "text-editor-muted/40"
          : "text-editor-muted hover:bg-white/10 hover:text-editor-fg",
      )}
      onClick={onClick}
    >
      <Icon />
      {text && <span>{label}</span>}
    </button>
  );
}
