import { cn } from "../lib/cn";
import { TrashIcon } from "../editor/icons";

/**
 * The tick on a card, and the bar that appears once one is ticked.
 *
 * Both halves of selecting several recordings at once, kept together because
 * the rule that governs them is one rule: **the tick is not always there.** A
 * library is a thing to look at, and a checkbox on every tile turns a wall of
 * pictures into a form. It appears under the pointer, and it stays out once
 * anything is selected — at that point the question has changed from "what is
 * this?" to "which of these?", and a tick that vanished as the pointer moved on
 * would hide the answer to the second.
 */

export function Checkbox({
  checked,
  label,
  /** Shown regardless of hover: something is selected, so every tick is out. */
  pinned,
  onChange,
}: {
  checked: boolean;
  label: string;
  pinned: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={(event) => {
        // The tick sits on top of the card's own button in the grid and inside
        // its row in the list. Without this the press reaches both and the
        // recording opens the moment it is selected.
        event.stopPropagation();
        event.preventDefault();
        onChange();
      }}
      className={cn(
        "pointer-events-auto grid size-[18px] shrink-0 place-items-center rounded-[5px] border transition-all",
        checked
          ? // Green, and the palette's own: `--export` is the one green here
            // and it was picked dark enough to carry white text — the system
            // green is tuned for black-on-green and white over it is the
            // pairing that fails to read.
            "border-export bg-export text-white"
          : // Dark and translucent rather than a plain border: an empty box
            // sits over a thumbnail that can be any colour, and a hairline on
            // white is invisible. The backdrop is what makes it readable
            // against a picture rather than against the pane.
            "border-white/60 bg-black/35 text-transparent backdrop-blur-sm hover:border-white",
        // Hidden until the pointer arrives, and then kept out for as long as a
        // selection is live. `group-focus-within` as well, or the tick would be
        // tabbable and invisible.
        pinned || checked
          ? "opacity-100"
          : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
      )}
    >
      <TickIcon />
    </button>
  );
}

/**
 * What to do with the selection, floating over the foot of the pane.
 *
 * Over the list rather than above it: a bar that took its own row would push
 * the whole library down the moment a tile was ticked, which is motion in
 * everything the user is not looking at. It rises into place instead, and the
 * scroller carries padding under its last row so nothing is left stranded
 * behind it.
 */
export function SelectionBar({
  count,
  onSelectAll,
  onDeselectAll,
  onDelete,
}: {
  count: number;
  /**
   * Every recording in this library, not only the ones drawn.
   *
   * The grid pages as it is scrolled, so "all" read off what is on screen
   * would be a button that ticked twelve of sixty and said nothing about the
   * rest. It is answered from the whole library instead — see `selectAll` —
   * and the count beside it is what says how many that was.
   */
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 grid place-items-center p-4">
      <div
        role="toolbar"
        aria-label="Selected recordings"
        className={cn(
          "pointer-events-auto flex items-center gap-2 rounded-full py-1.5 pr-1.5 pl-4",
          // Opaque enough to read against a grid of bright thumbnails, and
          // lifted off them by a shadow rather than a border — this floats,
          // and a hairline would read as another row.
          "border border-white/8 bg-editor-bg/92 shadow-[0_12px_32px_rgba(0,0,0,0.5)] backdrop-blur-xl",
          "animate-selection-in motion-reduce:animate-none",
        )}
      >
        <span className="text-[12px] tabular-nums">{count} selected</span>

        {/* The two ends of the same question, side by side and in the same
            quiet style: neither is the thing the bar is for. Delete is, and it
            is the only filled button on it.

            "Select all" first, because it adds to what is already ticked and
            the other throws it away — the undoable one before the one that is
            not.

            "Deselect all" and not "Clear", which is what this said while it
            stood alone and nothing was named "select" beside it. A pair has to
            read as one: `Clear` next to `Select all` is two different kinds of
            word for two halves of one question, and the half somebody is
            looking for is the one they cannot find. "Deselect" is also what
            the tick on every card already calls itself — see `Checkbox`'s
            label — so this is the app's own word rather than a third one. */}
        <button type="button" onClick={onSelectAll} className={QUIET}>
          <DoubleTickIcon />
          Select all
        </button>

        <button type="button" onClick={onDeselectAll} className={QUIET}>
          <ClearIcon />
          Deselect all
        </button>

        <button
          type="button"
          onClick={onDelete}
          className={cn(
            "flex items-center gap-1.5 rounded-full bg-editor-danger px-3 py-1 text-[12px] font-medium text-white",
            "transition-opacity hover:opacity-90 [&_svg]:size-3.5",
          )}
        >
          <TrashIcon />
          Delete
        </button>
      </div>
    </div>
  );
}

/**
 * The bar's two plain verbs.
 *
 * One constant because they are a pair and have to stay one: written apart,
 * the first of them to be adjusted becomes the louder of two things that are
 * meant to weigh the same.
 */
const QUIET =
  "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] text-editor-fg/70 " +
  "transition-colors hover:bg-white/10 hover:text-editor-fg [&_svg]:size-3.5";

/**
 * Lucide's geometry for the two verbs, at the weight 14px wants.
 *
 * Thinner than `TickIcon` below, which is drawn white inside a filled 18px box
 * and needs the mass to read against it. These sit beside 12px type at the
 * same colour, and at 3.5 they were bolder than the word they label.
 */
const VERB = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.25,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/** Lucide `check-check`. Two ticks, which is more than one of them. */
function DoubleTickIcon() {
  return (
    <svg {...VERB}>
      <path d="M18 6 7 17l-5-5M22 10l-7.5 7.5L13 16" />
    </svg>
  );
}

/** Lucide `x`. The same glyph every dismissal in the app is drawn with. */
function ClearIcon() {
  return (
    <svg {...VERB}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/** Lucide `check`, at the weight a 18px box wants. */
function TickIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
