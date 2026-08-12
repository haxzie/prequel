import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

/**
 * A labelled control, with its override state.
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
  label,
  overridden,
  inline,
  children,
}: {
  label: string;
  /** True when the selected slice sets this itself rather than inheriting. */
  overridden?: boolean;
  /** Lay the control out beside the label rather than beneath it. */
  inline?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex gap-1.5", inline ? "items-center" : "flex-col")}>
      <label
        className={cn(
          "flex-1 text-[11px]",
          overridden ? "font-medium text-editor-fg" : "text-editor-muted",
        )}
        title={overridden ? "Set for this clip" : undefined}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

/** A named group of fields within a panel. */
export function Section({
  title,
  onReset,
  children,
}: {
  title: string;
  /** Present when anything in the section is overridden. */
  onReset?: () => void;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-b border-editor-line px-4 py-4 last:border-b-0">
      <header className="flex items-center">
        <h2 className="flex-1 text-[11px] font-semibold tracking-wide uppercase">{title}</h2>
        {onReset && (
          <button
            type="button"
            className="text-[11px] text-editor-muted hover:text-editor-fg"
            onClick={onReset}
          >
            Reset
          </button>
        )}
      </header>
      {children}
    </section>
  );
}
