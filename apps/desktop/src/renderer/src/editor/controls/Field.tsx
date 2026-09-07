import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

/**
 * A control, with an optional label and its override state.
 *
 * `label` is left out where the panel header already names the control and a
 * word over it would be the third time — the layout grid, the background's
 * image swatches. Such a field has nowhere to show that it is overridden, which
 * is the trade: the header's Reset is still the tell that something here is set
 * for the clip, and on a panel whose one control *is* the thing named, that is
 * the same statement.
 *
 * Overridden fields say so through the label's own weight, and nothing else.
 * There is no per-control reset: with one beside every field the panel became a
 * column of buttons that are almost never the thing being reached for, and the
 * section reset in the header undoes the same edits in one place.
 *
 * `inline` puts the control on the label's own line, which is what a switch
 * wants — a toggle under its label leaves a wide empty gutter and reads as two
 * separate things.
 */
export function Field({
  icon,
  label,
  overridden,
  inline,
  children,
}: {
  /**
   * Stands in the gutter a slider's icon does.
   *
   * With a label it sits beside the name, above the control; without one it
   * sits beside the control itself, which is the slider's own shape. Either
   * way the glyph is at the panel's edge and the control starts 24px in, so a
   * grid or a map lines up with the bars above and below it.
   */
  icon?: ReactNode;
  /**
   * Left out where the control says what it is — a grid of caption samples, a
   * font dropdown set in its own face, a row of camera shapes. The trade is
   * that such a field has nowhere to show it is overridden, the weight of this
   * word being the only place that is said.
   */
  label?: string;
  /** True when the selected slice sets this itself rather than inheriting. */
  overridden?: boolean;
  /** Lay the control out beside the label rather than beneath it. */
  inline?: boolean;
  children: ReactNode;
}) {
  if (label) {
    return (
      <div className={cn("flex gap-1.5", inline ? "items-center" : "flex-col")}>
        <span className="flex items-center gap-2">
          {icon && (
            <span className="flex-none text-editor-muted [&_svg]:size-4" aria-hidden>
              {icon}
            </span>
          )}
          <label
            className={cn(
              "flex-1 text-[11px]",
              overridden ? "font-medium text-editor-fg" : "text-editor-muted",
            )}
            title={overridden ? "Set for this clip" : undefined}
          >
            {label}
          </label>
        </span>
        {icon ? <div className="ml-6">{children}</div> : children}
      </div>
    );
  }

  if (icon) {
    return (
      // Top-aligned, not centred: these controls are grids and maps several
      // rows tall, and a glyph halfway down one has nothing to be beside.
      // `mt-1.5` puts it on the middle of the first row rather than its edge.
      <div className="flex items-start gap-2">
        <span className="mt-1.5 flex-none text-editor-muted [&_svg]:size-4" aria-hidden>
          {icon}
        </span>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    );
  }

  return <div className={cn("flex gap-1.5", inline ? "items-center" : "flex-col")}>{children}</div>;
}

/**
 * A group of fields, in the inspector or in Settings.
 *
 * No reset of its own — that lives in the inspector's panel header now, beside
 * the other controls acting on the whole panel.
 *
 * `title` is optional, and every inspector panel now leaves it out: the panel
 * header already names what is showing, so a heading saying it again was that
 * word twice, stacked, in two type sizes. Settings has no such header and its
 * window is one scroll of several groups, which is exactly the case a heading
 * is for — hence optional rather than gone.
 */
export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-editor-line px-4 py-4 last:border-b-0">
      {title && <h2 className="text-[11px] font-semibold tracking-wide uppercase">{title}</h2>}
      {children}
    </section>
  );
}
