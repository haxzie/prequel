import { useEffect, useRef, useState, type Dispatch } from "react";

import { cn } from "../lib/cn";
import { formatTimecode } from "../lib/format";
import { Timecode } from "./Timecode";
import {
  AddAudioIcon,
  AddRecordingIcon,
  AddTextIcon,
  AddZoomIcon,
  ImportAudioIcon,
  ImportVideoIcon,
  MusicIcon,
  PauseIcon,
  PlayIcon,
  PointerToolIcon,
  ScissorsIcon,
  SkipEndIcon,
  SkipStartIcon,
  TrashIcon,
  UndoIcon,
} from "./icons";
import type { EditorAction, TimelineTool } from "./state";
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
 * The tool in hand, which keeps its fill on hover rather than lighting up.
 *
 * `AnnotateBar`'s own class, verbatim. The two rows are never on screen
 * together — one belongs to a screenshot and one to a recording — so "which
 * tool am I holding" has to look the same in both or it reads as two features.
 */
const HELD = "bg-selected text-white hover:bg-selected hover:brightness-110";

/**
 * The tools and the verbs and the clock on the left, transport centred, the
 * things you can add on the right.
 *
 * The verbs are deliberately not modes: Delete acts on what is already
 * selected, so it never has to be picked up first. The blade beside it is the
 * one tool here, and it earns that by being the only way to cut a zoom or a
 * title at all — the playhead acts on the clips and nothing else, so without
 * something to aim, those rows could be moved, trimmed and deleted but never
 * divided.
 *
 * No scrub bar: the timeline underneath is the scrubber now, and two of them
 * would be two playheads to keep in step and two places to look for the same
 * answer.
 */
export function PlaybackControls({
  media,
  tool,
  canAddZoom,
  canAddText,
  canAddMusic,
  hasLibrary,
  canAddClip,
  canDelete,
  canUndo,
  onAddZoom,
  onAddText,
  onAddAmbient,
  onImportAudio,
  onAddRecording,
  onImportVideo,
  onDelete,
  onUndo,
  dispatch,
}: {
  media: EditorPlayback;
  /** What a press on the timeline does — see `TimelineTool`. */
  tool: TimelineTool;
  /** Some gap in the zoom row is big enough to hold one. */
  canAddZoom: boolean;
  /** Some row of texts has room for one. */
  canAddText: boolean;
  /** The music row has a gap big enough to hold a bed. */
  canAddMusic: boolean;
  /**
   * Whether the hosted library could be reached, so there is a track to lay
   * down. False on a machine that has never been online, where Import Audio is
   * still the way in — so the menu opens with one row dead rather than the
   * whole pill.
   */
  hasLibrary: boolean;
  /** Nothing else has the recording busy, so another clip can be added. */
  canAddClip: boolean;
  /** A clip or a zoom is selected, so there is something to remove. */
  canDelete: boolean;
  /** The timeline has been changed at least once, so there is a step back. */
  canUndo: boolean;
  onAddZoom: () => void;
  onAddText: () => void;
  /** A track from the library — which one is asked on the bed itself. */
  onAddAmbient: () => void;
  onImportAudio: () => void;
  onAddRecording: () => void;
  onImportVideo: () => void;
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
        {/* What a press on the strip means, in its own group at the far left.
            Before the verbs rather than among them, because it is not one: the
            two beside it do something the moment they are pressed, and these
            two only change what the *next* press on the timeline does.

            A pair rather than one button that toggles. The pointer has to be a
            thing you can aim at and press — "put the blade down" is the way out
            of a mode and the commonest thing wanted after a cut, and a single
            lit-up button says what is held without saying what else there is. */}
        <div className="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5">
          <Action
            label="Select"
            shortcut="V"
            Icon={PointerToolIcon}
            held={tool === "select"}
            disabled={false}
            onClick={() => dispatch({ type: "pickTimelineTool", tool: "select" })}
          />
          <Action
            label="Slice"
            shortcut="C"
            Icon={ScissorsIcon}
            held={tool === "slice"}
            disabled={false}
            // Pressing the blade while it is already held puts it down, the way
            // the drawing tools do: the pointer is the only thing to go back to
            // and reaching for it is a second press either way.
            onClick={() =>
              dispatch({ type: "pickTimelineTool", tool: tool === "slice" ? "select" : "slice" })
            }
          />
        </div>

        {/* Delete, and undo once there is something to undo. No scissors here:
            the blade in the group before it cuts anywhere on the strip, and two
            pairs of scissors a centimetre apart doing different things is the
            row asking which one you meant. S still cuts at the playhead — that
            is the cut you make while watching, and a key costs nobody a
            glance. */}
        <div className="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5">
          <Action
            label="Delete"
            shortcut="⌫"
            Icon={TrashIcon}
            disabled={!canDelete}
            onClick={onDelete}
          />
          {/* Dead until there is a step back, not absent. It was absent for a
              while, on the reasoning that undo is a claim something happened
              and an empty history has nothing to say — but a button that is
              not there cannot be found, and "where has undo gone" is the
              question that costs more than a greyed-out glyph ever did. Delete
              beside it has always been dead rather than absent with nothing
              selected, and this is the same answer to the same question. */}
          <Action label="Undo" shortcut="⌘Z" Icon={UndoIcon} disabled={!canUndo} onClick={onUndo} />
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
            what you have already picked — cut, delete, undo — and these act on
            the playhead instead, so sharing a box said they were more of the
            same kind.

            Glyphs alone, like every other group in this row. They carried their
            words for a while, on the argument that a bare magnifier beside a
            pair of scissors reads as a search box — which is true of a bare
            magnifier and not of these: every one of the four has a plus built
            into it, so the group reads as *adding* four kinds of thing rather
            than as four unrelated tools. Four words also made this group twice
            the width of the other three and pushed the transport off the
            middle of the row. The names are in the tooltips. */}
        <div className="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5">
          <Action
            label="Add Zoom"
            shortcut="Z"
            Icon={AddZoomIcon}
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
            disabled={!canAddText}
            onClick={onAddText}
          />
          {/* Beside the other two, and a menu for the reason Add Clip is one:
              a bed comes from the library or from a file, and both arrive the
              same way — as a bar on the music row. */}
          <AddAudio
            disabled={!canAddMusic}
            hasLibrary={hasLibrary}
            onAddAmbient={onAddAmbient}
            onImportAudio={onImportAudio}
          />
          {/* Last in the pill: footage can come from the screen or from a
              file, and both arrive the same way — as another clip at the end.
              Here rather than beside Split and Delete because it adds
              something to the timeline, which is what this group is for. */}
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
  return (
    <Menu label="Add Clip" Icon={AddRecordingIcon} disabled={disabled}>
      {(choose) => (
        <>
          {/* The shortcut lives here rather than on the trigger: R records, it
              does not open this menu, and a key listed on a button it does not
              press is worse than one nobody finds. */}
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
        </>
      )}
    </Menu>
  );
}

/**
 * Add Audio, and the two places a bed comes from.
 *
 * `AddClip`'s twin, deliberately: the same shape, the same menu, the same
 * reasoning. One verb — music under the video — with a choice of where it
 * comes from.
 *
 * Neither row asks *which* track. Ambient Music lays a bed down and the panel
 * that opens on it is where the song is chosen, so the menu stays two rows
 * long however big the library grows — and the control that changes the song
 * is the same one whether the bed came from the library or from a file, which
 * is the whole point of there being one panel for both.
 */
function AddAudio({
  disabled,
  hasLibrary,
  onAddAmbient,
  onImportAudio,
}: {
  disabled: boolean;
  hasLibrary: boolean;
  onAddAmbient: () => void;
  onImportAudio: () => void;
}) {
  return (
    <Menu label="Add Audio" Icon={AddAudioIcon} disabled={disabled}>
      {(choose) => (
        <>
          {/* Dead rather than absent when the library could not be reached, the
              way Undo is with nothing to undo: a row that is not there cannot
              be found, and "where has the music gone" costs more than a greyed
              one ever did. */}
          <MenuItem
            label="Add Ambient Music"
            Icon={MusicIcon}
            disabled={!hasLibrary}
            onClick={() => choose(onAddAmbient)}
          />
          <MenuItem
            label="Import Audio"
            Icon={ImportAudioIcon}
            onClick={() => choose(onImportAudio)}
          />
        </>
      )}
    </Menu>
  );
}

/**
 * A pill in the add group with a menu behind it.
 *
 * Opens upwards, because the transport sits above the timeline at the bottom
 * of the window and a menu dropped downwards would open off the screen.
 *
 * One component for both of the pills that have one. They had a copy each for
 * a while, and the pair drifted the first time the stacking was fixed: the
 * inspector floats over the board at `z-30`, so a menu at `z-20` opened
 * *behind* the panel beside it, and only one of the two was raised.
 */
function Menu({
  label,
  Icon,
  disabled,
  children,
}: {
  /** The words on the pill, and what the menu is announced as. */
  label: string;
  Icon: () => React.JSX.Element;
  disabled: boolean;
  /** The rows. `choose` closes the menu and then acts. */
  children: (choose: (action: () => void) => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  // Closed the moment it cannot be used. Every choice leaves the editor — for
  // a panel, or a file dialog — and a menu left standing over the window they
  // come back to is a menu nobody asked for.
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
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-md [&_svg]:size-[15px]",
          disabled
            ? "text-editor-muted/40"
            : "text-editor-muted hover:bg-white/10 hover:text-editor-fg",
          open && "bg-white/10 text-editor-fg",
        )}
        onClick={() => setOpen(!open)}
      >
        {/* The glyph alone. The chevron that used to sit beside it said "there
            is more behind this" — worth a few pixels next to a word, and half
            the button's width without one. What is behind it arrives on the
            first press, and the tooltip names it before that. */}
        <Icon />
      </button>

      {open && (
        <>
          {/* Click-away, behind the menu and over everything else — the same
              pair the timeline's own context menu uses, at the same two
              levels.

              40 and 50, where this was 10 and 20. The menu opens upwards from
              a button at the foot of the window and the inspector now floats
              over the board at `z-30`, so the two overlap and the panel was
              winning — a menu that opened behind the thing beside it. The
              editor's scale has the two layers above the panel reserved for
              exactly this: anything summoned by a press, which has to be over
              everything because the press is the most recent thing the user
              did. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <ul
            role="menu"
            className={
              "absolute right-0 bottom-full z-50 mb-1.5 w-48 rounded-xl border border-editor-line " +
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
            {children(choose)}
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
  disabled,
  onClick,
}: {
  label: string;
  shortcut?: string;
  Icon: () => React.JSX.Element;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs",
          "[&_svg]:size-[15px] [&_svg]:text-editor-muted",
          disabled ? "text-editor-muted/40" : "text-editor-fg hover:bg-white/10",
        )}
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
 * A square glyph, and only that. It could grow a word beside it once, which is
 * how the add group was drawn for a while — see the note there for why all
 * four are bare now. One shape means every button in this row is the same
 * size, which is what lets the transport sit on the middle of it.
 */
function Action({
  label,
  shortcut,
  Icon,
  held,
  disabled,
  onClick,
}: {
  label: string;
  shortcut: string;
  Icon: () => React.JSX.Element;
  /** A tool rather than a verb, and this one is the tool in hand. */
  held?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={`${label} (${shortcut})`}
      aria-label={label}
      // Only where it means something. A verb is pressed and is done; a tool is
      // held, and that is a state a screen reader has to be able to read.
      aria-pressed={held}
      disabled={disabled}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md [&_svg]:size-[15px]",
        disabled
          ? "text-editor-muted/40"
          : "text-editor-muted hover:bg-white/10 hover:text-editor-fg",
        held && HELD,
      )}
      onClick={onClick}
    >
      <Icon />
    </button>
  );
}
