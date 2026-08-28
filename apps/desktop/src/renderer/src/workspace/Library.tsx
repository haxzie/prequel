import type { ReactNode } from "react";

import type { WorkspaceSection } from "../../../shared/contract";
import { cn } from "../lib/cn";
import { FolderIcon } from "../editor/icons";
import { Projects } from "../projects/Projects";
import { AccountIcon, GeneralIcon } from "../settings/icons";
import { AccountPane, SettingsPane } from "../settings/Settings";
import { PaneHeader } from "./PaneHeader";

/**
 * Everything the app window shows when no recording is open.
 *
 * One window for the library and for settings, rather than the two this used to
 * be. A menu-bar app has no app menu and no `⌘,` of its own, so every surface
 * it owns has to be gone and found — and a second window to hold four switches
 * was one more thing to find, and one more thing left open behind the first.
 *
 * The three capture settings that had a sidebar item each are one Settings pane
 * now. Account keeps its own, because it is the only item here that is not a
 * switch: it says who you are, and it changes on its own while nothing is being
 * set.
 */
const SECTIONS = [
  { id: "projects", label: "Projects", Icon: FolderIcon },
  { id: "settings", label: "Settings", Icon: GeneralIcon },
  { id: "account", label: "Account", Icon: AccountIcon },
] as const satisfies readonly {
  id: WorkspaceSection;
  label: string;
  Icon: () => React.JSX.Element;
}[];

export function Library({
  section,
  onSection,
  opening,
  onOpen,
}: {
  section: WorkspaceSection;
  onSection: (section: WorkspaceSection) => void;
  /** The recording being loaded, if a card has been clicked. */
  opening: string | null;
  onOpen: (dir: string) => void;
}) {
  return (
    // `min-h-0 flex-1` rather than `h-full`: this is a flex child of `#root`,
    // and a flex item that cannot shrink below its content pushes the bottom of
    // the window out of view instead of letting the middle give way.
    <div className="editor-theme flex min-h-0 flex-1 overflow-hidden bg-editor-bg text-editor-fg">
      {/* Dragging the sidebar moves the window, and the inset traffic lights
          need the room at the top of it. The buttons opt back out, or a press
          on one would move the window instead of switching the pane. */}
      <nav className="drag flex w-48 shrink-0 flex-col gap-0.5 border-r border-editor-line p-3 pt-10">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSection(item.id)}
            className={cn(
              "no-drag flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-[13px] transition-colors",
              // The glyph inherits the row's colour, so the selected item's
              // icon brightens with its label rather than staying muted
              // against it.
              "[&_svg]:size-4 [&_svg]:shrink-0",
              section === item.id
                ? "bg-white/8 text-editor-fg"
                : "text-editor-muted hover:bg-white/4 hover:text-editor-fg",
            )}
          >
            <item.Icon />
            {item.label}
          </button>
        ))}
      </nav>

      <main className="flex min-w-0 flex-1 flex-col">
        {section === "projects" ? (
          <Projects opening={opening} onOpen={onOpen} />
        ) : section === "settings" ? (
          <Pane icon={<GeneralIcon />} title="Settings">
            <SettingsPane />
          </Pane>
        ) : (
          <Pane icon={<AccountIcon />} title="Account">
            <AccountPane />
          </Pane>
        )}
      </main>
    </div>
  );
}

/**
 * A settings pane, at a width it can be read at.
 *
 * `Section` was drawn for the editor's 24rem rail. Given a whole window it
 * stretches a segmented control to arm's length, so the measure is capped here
 * rather than in each pane.
 */
function Pane({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <>
      <PaneHeader icon={icon} title={title} />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-md">{children}</div>
      </div>
    </>
  );
}
