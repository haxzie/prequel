import type { LibraryView } from "../../../shared/contract";
import { cn } from "../lib/cn";

/**
 * Rows or tiles, for a library pane.
 *
 * Shared by Projects and Exports rather than written twice. They are the same
 * control over the same choice, and the second copy is the one that would miss
 * whatever the first gained — which is how two panes in one window come to
 * disagree about what a toggle looks like.
 *
 * Two buttons rather than a segmented control: there are exactly two states and
 * each has an icon that says which it is, so a control wide enough for two
 * words would be saying it twice.
 */
export function ViewToggle({
  view,
  onChange,
}: {
  view: LibraryView;
  onChange: (view: LibraryView) => void;
}) {
  return (
    // `no-drag`: this sits in the pane header, which is the window's drag
    // region, and without it a press here would move the window instead of
    // changing the layout.
    <div className="no-drag flex items-center gap-0.5 rounded-lg bg-white/6 p-0.5">
      {(
        [
          { id: "list", label: "Show as a list", Icon: ListIcon },
          { id: "grid", label: "Show as a grid", Icon: GridIcon },
        ] as const
      ).map((option) => (
        <button
          key={option.id}
          type="button"
          title={option.label}
          aria-label={option.label}
          aria-pressed={view === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            "grid size-6 place-items-center rounded-md transition-colors [&_svg]:size-3.5",
            view === option.id
              ? "bg-white/15 text-editor-fg"
              : "text-editor-fg/55 hover:text-editor-fg",
          )}
        >
          <option.Icon />
        </button>
      ))}
    </div>
  );
}

/**
 * Lucide's stroke geometry, restated so this file stands on its own.
 *
 * Verbatim, for the reason `projects/icons.tsx` gives: redrawing a familiar
 * icon by hand is how you end up with something that reads as almost-right.
 */
const STROKE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** Lucide `list`. */
function ListIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M3 5h.01M3 12h.01M3 19h.01M8 5h13M8 12h13M8 19h13" />
    </svg>
  );
}

/** Lucide `layout-grid`. */
function GridIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </svg>
  );
}
