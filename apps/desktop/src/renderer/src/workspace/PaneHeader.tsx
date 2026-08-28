import type { ReactNode } from "react";

/**
 * The bar at the top of a library pane.
 *
 * Shared rather than repeated per pane because it does two jobs beyond saying
 * what is on screen: it is the window's drag region, and its fixed height is
 * what keeps every pane's first row level with the sidebar's, whose own top
 * padding is holding the traffic lights out of the content.
 */
export function PaneHeader({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  /** Anything the pane wants at the far right — a count, a control. */
  children?: ReactNode;
}) {
  return (
    <header className="drag flex h-[38px] flex-none items-center gap-1.5 border-b border-editor-line px-4">
      <span className="flex items-center gap-1.5 text-[13px] font-medium [&_svg]:size-3.5">
        {icon}
        {title}
      </span>
      <span className="flex-1" />
      {children}
    </header>
  );
}
