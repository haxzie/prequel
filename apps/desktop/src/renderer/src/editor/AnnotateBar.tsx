/**
 * The screenshot editor's tool row.
 *
 * It stands where the transport does in a recording — the bottom of the window,
 * full width, over the board — because the two are the same thing at the same
 * moment: the verbs for what is on screen. A still has no clock to scrub, so
 * what the row carries instead is what to draw with.
 *
 * Tools here are modes, which the transport's own note argues against for its
 * buttons. The difference is what the gesture is: Split and Delete act on
 * something already selected, where drawing an arrow *is* the gesture — there is
 * nothing to select first, and the only alternative to a mode is a button that
 * drops a stock-sized arrow in the middle of the picture to be dragged into
 * place twice. Each tool puts itself down once it has drawn, so the mode is
 * never left behind.
 */
import type { Dispatch } from "react";

import type { AnnotationKind } from "../../../shared/annotations";
import { cn } from "../lib/cn";
import {
  AddTextIcon,
  ArrowToolIcon,
  BoxToolIcon,
  EllipseToolIcon,
  HighlighterToolIcon,
  LineToolIcon,
  PenToolIcon,
  PointerToolIcon,
  TrashIcon,
  UndoIcon,
} from "./icons";
import type { EditorAction } from "./state";

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
 * then the highlighter. The pointer is separated from them: it is the absence
 * of a tool rather than another one.
 */
const TOOLS: { tool: AnnotationKind; label: string; Icon: typeof ArrowToolIcon }[] = [
  { tool: "arrow", label: "Arrow", Icon: ArrowToolIcon },
  { tool: "line", label: "Line", Icon: LineToolIcon },
  { tool: "rect", label: "Box", Icon: BoxToolIcon },
  { tool: "ellipse", label: "Ellipse", Icon: EllipseToolIcon },
  { tool: "pen", label: "Draw", Icon: PenToolIcon },
  { tool: "highlight", label: "Highlighter", Icon: HighlighterToolIcon },
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
const INKS = ["#e5484d", "#f5a524", "#ffd84d", "#46a758", "#3b82f6", "#ffffff"];

/** Thicknesses, as fractions of the frame's shorter edge. */
const WIDTHS: { label: string; width: number }[] = [
  { label: "Thin", width: 0.0025 },
  { label: "Medium", width: 0.0045 },
  { label: "Thick", width: 0.008 },
];

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
  const colour = marking ? ink.highlight : ink.color;
  const setColour = (value: string) =>
    dispatch({ type: "setInk", ink: marking ? { highlight: value } : { color: value } });

  return (
    // Named by attribute for the documentation screenshots, the same convention
    // `data-panel="transport"` uses.
    <div
      data-panel="annotate"
      className={
        "flex flex-none items-center justify-center gap-3 " +
        "border-t border-editor-line bg-editor-veil px-4 py-2"
      }
    >
      <div className="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5">
        <button
          type="button"
          title="Select and move marks"
          aria-label="Select and move marks"
          aria-pressed={tool === null}
          className={cn(BUTTON, tool === null && HELD)}
          onClick={() => dispatch({ type: "pickTool", tool: null })}
        >
          <PointerToolIcon />
        </button>
      </div>

      <div className="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5">
        {TOOLS.map(({ tool: kind, label, Icon }) => (
          <button
            key={kind}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={tool === kind}
            className={cn(BUTTON, tool === kind && HELD)}
            // Pressing the tool already in hand puts it down, so the row is a
            // toggle rather than a trap: there is no "none" to go back to
            // except the pointer, and reaching for it is a second press either
            // way.
            onClick={() => dispatch({ type: "pickTool", tool: tool === kind ? null : kind })}
          >
            <Icon />
          </button>
        ))}
      </div>

      {/* The ink, next to the tools that use it. It sets what the *next* mark
          is drawn in rather than recolouring the selection — a row of swatches
          beside a toolbar is read as the tool's setting, and one that silently
          repainted whatever happened to be selected would be a different
          control wearing the same clothes. The selected mark's own colour is in
          the inspector. */}
      <div className="flex items-center gap-1 rounded-lg bg-white/5 px-1.5 py-1">
        {INKS.map((color) => (
          <button
            key={color}
            type="button"
            title={`Draw in ${color}`}
            aria-label={`Draw in ${color}`}
            aria-pressed={colour.toLowerCase() === color}
            // A ring outside the swatch rather than a border inside it: a
            // border eats into a 14px circle and makes the chosen colour read
            // as a different, darker one.
            className={cn(
              "size-3.5 rounded-full",
              colour.toLowerCase() === color
                ? "ring-2 ring-white ring-offset-1 ring-offset-editor-veil"
                : "ring-1 ring-white/25",
            )}
            style={{ backgroundColor: color }}
            onClick={() => setColour(color)}
          />
        ))}
      </div>

      <div className="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5">
        {WIDTHS.map(({ label, width }) => (
          <button
            key={label}
            type="button"
            title={`${label} stroke`}
            aria-label={`${label} stroke`}
            aria-pressed={ink.width === width}
            // Dead while the highlighter is in hand rather than hidden. A band
            // is not a stroke weight — the marker sets its own — and three
            // buttons vanishing and reappearing as tools are picked up would
            // shuffle everything to the right of them along the row.
            disabled={marking}
            className={cn(
              "grid h-8 w-7 place-items-center rounded-lg text-editor-fg hover:bg-white/10",
              "disabled:pointer-events-none disabled:opacity-35",
              ink.width === width && !marking && HELD,
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
          </button>
        ))}
      </div>

      <div className="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5">
        {/* Text is the one mark that is not drawn here. A still's words go
            through the editor's own text overlays — the fonts, the styles and
            the position panel every recording's titles use — so this button
            adds one of those rather than a second kind of text that would have
            to grow its own typography. */}
        <button
          type="button"
          title="Add text"
          aria-label="Add text"
          className={BUTTON}
          disabled={!canAddText}
          onClick={onAddText}
        >
          <AddTextIcon />
        </button>

        <button
          type="button"
          title="Delete"
          aria-label="Delete"
          className={BUTTON}
          disabled={!canDelete}
          onClick={onDelete}
        >
          <TrashIcon />
        </button>

        {/* Hidden until there is a step back rather than disabled, for the
            reason the transport's is: an empty history has nothing to say. */}
        {canUndo && (
          <button type="button" title="Undo" aria-label="Undo" className={BUTTON} onClick={onUndo}>
            <UndoIcon />
          </button>
        )}
      </div>
    </div>
  );
}
