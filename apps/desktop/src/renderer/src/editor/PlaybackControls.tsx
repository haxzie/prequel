import { useEffect, useRef, useState, type Dispatch } from "react";

import { cn } from "../lib/cn";
import { formatTimecode } from "../lib/format";
import { Timecode } from "./Timecode";
import {
  AddRecordingIcon,
  AddTextIcon,
  AddZoomIcon,
  ChevronUpIcon,
  ImportVideoIcon,
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
 * The verbs for the selection and the clock on the left, transport centred,
 * the two things you can add on the right.
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
  canAddText,
  canAddClip,
  canSplit,
  canDelete,
  canUndo,
  onAddZoom,
  onAddText,
  onAddRecording,
  onImportVideo,
  onSplit,
  onDelete,
  onUndo,
  dispatch,
}: {
  media: EditorPlayback;
  /** Some gap in the zoom row is big enough to hold one. */
  canAddZoom: boolean;
  /** Some row of texts has room for one. */
  canAddText: boolean;
  /** Nothing else has the recording busy, so another clip can be added. */
  canAddClip: boolean;
  /** A clip is selected, so there is something to cut. */
  canSplit: boolean;
  /** A clip or a zoom is selected, so there is something to remove. */
  canDelete: boolean;
  /** The timeline has been changed at least once, so there is a step back. */
  canUndo: boolean;
  onAddZoom: () => void;
  onAddText: () => void;
  onAddRecording: () => void;
  onImportVideo: () => void;
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
    // changes width — which the clock does not, but the verb group beside it
    // does the first time undo appears.
    // The border belongs here and nowhere below it: the transport and the strip
    // are one section, so the line goes above the pair rather than between
    // them, where it read as the timeline being a separate panel.
    <div
      // The documentation screenshots clip to this row — see the note on
      // `data-panel="inspector"` in `Editor.tsx`.
      data-panel="transport"
      className={
        "grid flex-none grid-cols-[1fr_auto_1fr] items-center gap-3 " +
        "border-t border-editor-line bg-editor-veil px-4 py-2"
      }
    >
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5">
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
          {/* Hidden until there is a step back, not disabled like the two
              beside it — those are always the verbs for the current selection,
              whereas undo is a claim that something happened, and an empty
              history has nothing to say. Last in the group rather than first
              because the group is pinned to the left: appearing has to extend
              it away from the edge, or the cut and delete buttons would move
              out from under the pointer the first time an edit lands. It pushes
              the clock along instead, which is read and never aimed at. */}
          {canUndo && (
            <Action label="Undo" shortcut="⌘Z" Icon={UndoIcon} disabled={false} onClick={onUndo} />
          )}
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
        {/* On its own, at the other end of the row from the verbs. Those act on
            what you have already picked — cut, delete, undo — and these two act
            on the playhead instead, so sharing a box said they were more of the
            same kind. They are also the ones with a word on them: a bare
            magnifier next to a pair of scissors reads as a search box. */}
        <div className="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5">
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
          {/* Beside Add Zoom, in the same pill: both act on the playhead and
              both lay something on a row of its own. */}
          <Action
            label="Add Text"
            shortcut="T"
            Icon={AddTextIcon}
            text
            disabled={!canAddText}
            onClick={onAddText}
          />
          {/* Third in the pill, and the only one of the three that asks a
              question first: footage can come from the screen or from a file,
              and both arrive the same way — as another clip at the end. Here
              rather than beside Split and Delete because it adds something to
              the timeline, which is what this group is for. */}
          <AddClip
            disabled={!canAddClip}
            onAddRecording={onAddRecording}
            onImportVideo={onImportVideo}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Add Clip, and the two places a clip comes from.
 *
 * A menu rather than two buttons in the pill. They are the same verb — footage
 * on the end of the timeline — and spelling both out put three words on a row
 * whose other two controls are one word each, which read as three unrelated
 * things rather than as one with a choice in it.
 *
 * Upwards, because the transport sits above the timeline at the bottom of the
 * window and a menu dropped downwards would open off the screen.
 */
function AddClip({
  disabled,
  onAddRecording,
  onImportVideo,
}: {
  disabled: boolean;
  onAddRecording: () => void;
  onImportVideo: () => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  // Closed the moment it cannot be used. Both choices leave the editor — one
  // for the panel, one for a file dialog — and a menu left standing over the
  // window they come back to is a menu nobody asked for.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        title="Add Clip"
        aria-label="Add Clip"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] [&_svg]:size-[15px]",
          disabled
            ? "text-editor-muted/40"
            : "text-editor-muted hover:bg-white/10 hover:text-editor-fg",
          open && "bg-white/10 text-editor-fg",
        )}
        onClick={() => setOpen(!open)}
      >
        <AddRecordingIcon />
        <span>Add Clip</span>
        {/* Smaller and dimmer than the glyph on the other side: it says the
            button has more behind it, and it is not one of the two things being
            chosen between. */}
        <span className="text-editor-muted/60 [&_svg]:size-3">
          <ChevronUpIcon />
        </span>
      </button>

      {open && (
        <>
          {/* Click-away, behind the menu and over everything else — the same
              pair the frame picker uses. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <ul
            role="menu"
            className={
              "absolute right-0 bottom-full z-20 mb-1.5 w-48 rounded-xl border border-editor-line " +
              "bg-editor-panel p-1 shadow-[0_8px_28px_rgba(0,0,0,0.5)]"
            }
            // Escape from inside the menu as well as from the trigger: the
            // pointer is over the list by the time anybody wants out of it.
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              setOpen(false);
              trigger.current?.focus();
            }}
          >
            {/* The shortcut lives here rather than on the trigger: R records,
                it does not open this menu, and a key listed on a button it does
                not press is worse than one nobody finds. */}
            <MenuItem
              label="New Recording"
              shortcut="R"
              Icon={AddRecordingIcon}
              onClick={() => choose(onAddRecording)}
            />
            <MenuItem
              label="Import Video"
              Icon={ImportVideoIcon}
              onClick={() => choose(onImportVideo)}
            />
          </ul>
        </>
      )}
    </div>
  );
}

function MenuItem({
  label,
  shortcut,
  Icon,
  onClick,
}: {
  label: string;
  shortcut?: string;
  Icon: () => React.JSX.Element;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        role="menuitem"
        className={
          "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs " +
          "text-editor-fg hover:bg-white/10 [&_svg]:size-[15px] [&_svg]:text-editor-muted"
        }
        onClick={onClick}
      >
        <Icon />
        <span className="flex-1">{label}</span>
        {shortcut && <span className="text-editor-muted">{shortcut}</span>}
      </button>
    </li>
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
