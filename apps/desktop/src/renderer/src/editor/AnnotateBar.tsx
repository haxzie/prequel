/**
 * The screenshot editor's tool row.
 *
 * A pill floating over the board at the bottom, in the same material the frame
 * picker wears at the top — not the full-width strip the transport is on a
 * recording. The two look like the same kind of thing because they are: a
 * handful of controls about the picture, sitting on it.
 *
 * The strip is right for the transport and wrong here. A transport is one half
 * of a pair with the timeline under it, and the two together are a section with
 * a rule above them; this has no timeline, so a full-width strip was a band of
 * board the composition could not reach and the background's own light could
 * not cross — the wash stopped dead at a horizontal line across the bottom of
 * the window, which is the same fault the frame bar was moved off a row to
 * avoid. Floating, the board is one surface and the bar sits on it.
 *
 * Tools here are modes, which the transport's own note argues against for its
 * buttons. The difference is what the gesture is: Split and Delete act on
 * something already selected, where drawing an arrow *is* the gesture — there is
 * nothing to select first, and the only alternative to a mode is a button that
 * drops a stock-sized arrow in the middle of the picture to be dragged into
 * place twice. Each tool puts itself down once it has drawn, so the mode is
 * never left behind.
 */
import type { Dispatch, ReactNode } from "react";

import type { AnnotationKind } from "../../../shared/annotations";
import { useTooltip } from "../components/Tooltip";
import { cn } from "../lib/cn";
import {
  AddTextIcon,
  ArrowToolIcon,
  BoxToolIcon,
  EllipseToolIcon,
  HighlighterToolIcon,
  LineToolIcon,
  MaskToolIcon,
  PenToolIcon,
  PointerToolIcon,
  TrashIcon,
  UndoIcon,
} from "./icons";
import type { EditorAction } from "./state";
import { FLOATING } from "./surfaces";

const BUTTON =
  "grid size-8 place-items-center rounded-lg text-editor-fg hover:bg-white/10 " +
  "disabled:opacity-35 [&_svg]:size-[15px]";

/** The tool in hand, which keeps its fill on hover rather than lighting up. */
const HELD = "bg-selected text-white hover:bg-selected hover:brightness-110";

/**
 * The tools, in the order they are reached for.
 *
 * Arrow first because it is most of what anybody draws on a screenshot, then
 * the plain line, then the two shapes that enclose something, then freehand,
 * then the highlighter, then the mask. The pointer is separated from them: it
 * is the absence of a tool rather than another one.
 */
const TOOLS: {
  tool: AnnotationKind;
  label: string;
  detail: string;
  keys: string;
  Icon: typeof ArrowToolIcon;
}[] = [
  {
    tool: "arrow",
    label: "Arrow",
    detail: "Drag from anywhere to the thing you are pointing at.",
    keys: "A",
    Icon: ArrowToolIcon,
  },
  {
    tool: "line",
    label: "Line",
    detail: "Drag to rule a straight line.",
    keys: "L",
    Icon: LineToolIcon,
  },
  {
    tool: "rect",
    label: "Box",
    detail: "Drag a rectangle around something. Only the outline is drawn.",
    keys: "R",
    Icon: BoxToolIcon,
  },
  {
    tool: "ellipse",
    label: "Ellipse",
    detail: "Drag an oval around something.",
    keys: "O",
    Icon: EllipseToolIcon,
  },
  {
    tool: "pen",
    label: "Draw",
    detail: "Draw freehand, as if with a pen.",
    keys: "P",
    Icon: PenToolIcon,
  },
  {
    tool: "highlight",
    label: "Highlighter",
    detail: "Drag a band over a line of text, like a marker.",
    keys: "H",
    Icon: HighlighterToolIcon,
  },
  // Last, and the only one that takes something away rather than adding it: a
  // mask hides a patch of the picture instead of drawing on top of it. Its
  // strength and whether it blurs or blocks up are in the panel, like every
  // other mark's own settings — the row sets what the *next* mark is, and a
  // mask has nothing in common with the swatches beside it.
  {
    tool: "mask",
    label: "Mask",
    detail: "Drag over anything private, then blur or pixelate it in the panel.",
    keys: "M",
    Icon: MaskToolIcon,
  },
];

/**
 * The colours a mark can be drawn in.
 *
 * A fixed row rather than a picker. A mark on a screenshot has one job — to be
 * seen against whatever is under it — and six strong hues cover that; a full
 * picker invites somebody to spend time matching an arrow to a brand, which is
 * not what the arrow is for. The selected mark's own colour can still be
 * changed to anything, in the inspector's Marks panel.
 */
const INKS: { color: string; label: string; keys: string }[] = [
  { color: "#e5484d", label: "Red", keys: "1" },
  { color: "#f5a524", label: "Orange", keys: "2" },
  { color: "#ffd84d", label: "Yellow", keys: "3" },
  { color: "#46a758", label: "Green", keys: "4" },
  { color: "#3b82f6", label: "Blue", keys: "5" },
  { color: "#ffffff", label: "White", keys: "6" },
];

/** Thicknesses, as fractions of the frame's shorter edge. */
const WIDTHS: { label: string; width: number; keys?: string }[] = [
  { label: "Thin", width: 0.0025, keys: "[" },
  // No key of its own. The brackets step rather than name — see `stepped` —
  // so the middle is where `[` arrives from the thick end and `]` from the
  // thin one, and a tooltip claiming a key for it would be claiming one that
  // does not go straight there.
  { label: "Medium", width: 0.0045 },
  { label: "Thick", width: 0.008, keys: "]" },
];

/**
 * The key each tool answers to, by `KeyboardEvent.code`.
 *
 * Built from `TOOLS` rather than written out beside it, so a tool's key is
 * stated once: the tooltip shows what this table dispatches, and two lists
 * would drift the first time one was changed. The pointer is here too and is
 * not in `TOOLS` — it is the absence of a tool, and V is what every drawing
 * program has called it since Illustrator.
 */
const TOOL_KEYS: Record<string, AnnotationKind | null> = {
  KeyV: null,
  ...Object.fromEntries(TOOLS.map((entry) => [`Key${entry.keys}`, entry.tool])),
};

/**
 * What a key press on a screenshot does, or null for one that means nothing
 * here.
 *
 * In this file because the keys *are* the toolbar: every one of them is a
 * button above, and the tables the tooltips read are the tables this answers
 * from. The editor owns when to ask — a key typed into a field is not a
 * shortcut — and this owns what the answer is.
 */
export function stillShortcut(
  event: KeyboardEvent,
  /** The hand: what it is holding, and what it would draw with. */
  hand: { tool: AnnotationKind | null; ink: { width: number } },
): EditorAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;

  if (event.code in TOOL_KEYS) {
    const picked = TOOL_KEYS[event.code]!;
    // The same toggle the buttons have: pressing the tool already in hand puts
    // it down rather than doing nothing.
    return { type: "pickTool", tool: picked === hand.tool ? null : picked };
  }

  const ink = INKS.find((entry) => entry.keys === event.key);
  if (ink) {
    // The highlighter's own colour, exactly as the swatches write it — see
    // `EditorState.ink`.
    return {
      type: "setInk",
      ink: hand.tool === "highlight" ? { highlight: ink.color } : { color: ink.color },
    };
  }

  // The brackets step through the three weights rather than naming one each,
  // because that is what a bracket means everywhere else it sets a brush size.
  if (event.code === "BracketLeft" || event.code === "BracketRight") {
    return {
      type: "setInk",
      ink: { width: stepped(hand.ink.width, event.code === "BracketRight") },
    };
  }

  return null;
}

/**
 * The next weight up or down, held at the ends rather than wrapping.
 *
 * Held, because a brush size that jumps from thick back to thin is a control
 * nobody can hold a key on: the press that was meant to go one further undoes
 * the two before it.
 */
function stepped(width: number, up: boolean): number {
  const at = WIDTHS.findIndex((entry) => entry.width === width);
  // A width set from the panel's own slider is on no step at all. Stepping up
  // from it goes to the thickest and down to the thinnest, which is the
  // nearest thing to "one along" when there is no along.
  const from = at === -1 ? (up ? WIDTHS.length - 2 : 1) : at;
  const next = Math.min(Math.max(from + (up ? 1 : -1), 0), WIDTHS.length - 1);
  return WIDTHS[next]!.width;
}

/**
 * One button in the row, with the label that explains it.
 *
 * Its own component because `useTooltip` is a hook and the rows are maps: a
 * hook cannot be called per item inside one component, and the alternative —
 * a `title` attribute — is the native chip this editor deliberately does not
 * use. See `components/Tooltip.tsx`.
 */
function BarButton({
  label,
  detail,
  keys,
  pressed,
  disabled,
  className,
  onClick,
  children,
}: {
  label: string;
  detail?: string;
  keys?: string;
  pressed?: boolean;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const tooltip = useTooltip({ title: label, detail, keys });

  return (
    <button
      type="button"
      // The name a screen reader reads is the title alone. The sentence under
      // it is for somebody looking at the row and wondering what a glyph does,
      // and read out before every button it would be in the way.
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      className={className}
      ref={tooltip.ref}
      onPointerEnter={tooltip.onPointerEnter}
      onPointerLeave={tooltip.onPointerLeave}
      onPointerDown={tooltip.onPointerDown}
      onFocus={tooltip.onFocus}
      onBlur={tooltip.onBlur}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function AnnotateBar({
  tool,
  ink,
  canDelete,
  canUndo,
  canAddText,
  onAddText,
  onDelete,
  onUndo,
  dispatch,
}: {
  tool: AnnotationKind | null;
  ink: { color: string; width: number; highlight: string };
  /** A mark or a text is selected, so there is something to remove. */
  canDelete: boolean;
  /** Something has been drawn, so there is a step back. */
  canUndo: boolean;
  /** There is room on a text row for another, which on a still there always is. */
  canAddText: boolean;
  onAddText: () => void;
  onDelete: () => void;
  onUndo: () => void;
  dispatch: Dispatch<EditorAction>;
}) {
  // The highlighter keeps an ink of its own — see `EditorState.ink`. The row
  // shows and writes whichever tool is in hand, so the swatch that is lit is
  // always the colour the next mark will be.
  const marking = tool === "highlight";
  // A mask has no ink at all — it takes the picture out rather than drawing on
  // it — so both rows go dead rather than away. Hidden, they would shuffle
  // everything to the right of them along the row every time the tool changed.
  const masking = tool === "mask";
  const colour = marking ? ink.highlight : ink.color;
  const setColour = (value: string) =>
    dispatch({ type: "setInk", ink: marking ? { highlight: value } : { color: value } });

  return (
    // Named by attribute for the documentation screenshots, the same convention
    // `data-panel="transport"` uses.
    //
    // Sized to its contents rather than stretched: the caller centres it, so a
    // bar that filled the width would be centred on nothing. `flex-none` for
    // the same reason the frame picker carries it.
    <div
      data-panel="annotate"
      className={cn("flex flex-none items-center gap-2 rounded-full px-2 py-1.5", FLOATING)}
    >
      <div className="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5">
        <BarButton
          label="Select"
          detail="Pick a mark to move it, pull a corner, or change it in the panel."
          keys="V"
          pressed={tool === null}
          className={cn(BUTTON, tool === null && HELD)}
          onClick={() => dispatch({ type: "pickTool", tool: null })}
        >
          <PointerToolIcon />
        </BarButton>
      </div>

      <div className="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5">
        {TOOLS.map(({ tool: kind, label, detail, keys, Icon }) => (
          <BarButton
            key={kind}
            label={label}
            detail={detail}
            keys={keys}
            pressed={tool === kind}
            className={cn(BUTTON, tool === kind && HELD)}
            // Pressing the tool already in hand puts it down, so the row is a
            // toggle rather than a trap: there is no "none" to go back to
            // except the pointer, and reaching for it is a second press either
            // way.
            onClick={() => dispatch({ type: "pickTool", tool: tool === kind ? null : kind })}
          >
            <Icon />
          </BarButton>
        ))}
      </div>

      {/* The ink, next to the tools that use it. It sets what the *next* mark
          is drawn in rather than recolouring the selection — a row of swatches
          beside a toolbar is read as the tool's setting, and one that silently
          repainted whatever happened to be selected would be a different
          control wearing the same clothes. The selected mark's own colour is in
          the inspector. */}
      <div className="flex items-center gap-1 rounded-lg bg-white/5 px-1.5 py-1">
        {INKS.map(({ color, label, keys }) => (
          <BarButton
            key={color}
            label={label}
            detail="The colour the next mark is drawn in."
            keys={keys}
            pressed={colour.toLowerCase() === color}
            disabled={masking}
            // A ring outside the swatch rather than a border inside it: a
            // border eats into a 14px circle and makes the chosen colour read
            // as a different, darker one.
            className={cn(
              "size-3.5 rounded-full disabled:pointer-events-none disabled:opacity-35",
              colour.toLowerCase() === color
                ? "ring-2 ring-white ring-offset-1 ring-offset-editor-veil"
                : "ring-1 ring-white/25",
            )}
            onClick={() => setColour(color)}
          >
            {/* The colour itself, drawn by a child rather than by the button's
                own background: `BarButton` takes no style of its own, and a
                swatch is the one control here whose *fill* is the label. */}
            <span
              aria-hidden
              className="block size-full rounded-full"
              style={{ backgroundColor: color }}
            />
          </BarButton>
        ))}
      </div>

      <div className="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5">
        {WIDTHS.map(({ label, width, keys }) => (
          <BarButton
            key={label}
            label={`${label} stroke`}
            detail="How heavy the next mark is drawn."
            keys={keys}
            pressed={ink.width === width}
            // Dead while the highlighter is in hand rather than hidden. A band
            // is not a stroke weight — the marker sets its own — and three
            // buttons vanishing and reappearing as tools are picked up would
            // shuffle everything to the right of them along the row.
            disabled={marking || masking}
            className={cn(
              "grid h-8 w-7 place-items-center rounded-lg text-editor-fg hover:bg-white/10",
              "disabled:pointer-events-none disabled:opacity-35",
              ink.width === width && !marking && !masking && HELD,
            )}
            onClick={() => dispatch({ type: "setInk", ink: { width } })}
          >
            {/* The thickness itself, drawn. Three words would be three labels
                to read where the difference is the one thing a line can show. */}
            <span
              aria-hidden
              className="block w-4 rounded-full bg-current"
              style={{ height: Math.max(1, Math.round(width * 620)) }}
            />
          </BarButton>
        ))}
      </div>

      <div className="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5">
        {/* Text is the one mark that is not drawn here. A still's words go
            through the editor's own text overlays — the fonts, the styles and
            the position panel every recording's titles use — so this button
            adds one of those rather than a second kind of text that would have
            to grow its own typography. */}
        <BarButton
          label="Add text"
          detail="Drops a line on the picture, ready to type."
          keys="T"
          className={BUTTON}
          disabled={!canAddText}
          onClick={onAddText}
        >
          <AddTextIcon />
        </BarButton>

        <BarButton
          label="Delete"
          detail="Removes whatever is selected."
          keys="⌫"
          className={BUTTON}
          disabled={!canDelete}
          onClick={onDelete}
        >
          <TrashIcon />
        </BarButton>

        {/* Hidden until there is a step back rather than disabled, for the
            reason the transport's is: an empty history has nothing to say. */}
        {canUndo && (
          <BarButton
            label="Undo"
            detail="Steps back one change."
            keys="⌘Z"
            className={BUTTON}
            onClick={onUndo}
          >
            <UndoIcon />
          </BarButton>
        )}
      </div>
    </div>
  );
}
