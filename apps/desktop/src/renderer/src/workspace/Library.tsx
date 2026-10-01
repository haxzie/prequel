import type { ReactNode } from "react";

import type { WorkspaceSection } from "../../../shared/contract";
import { cn } from "../lib/cn";
import { Exports } from "../exports/Exports";
import { Projects } from "../projects/Projects";
import { ExternalIcon, GeneralIcon } from "../settings/icons";
import { SettingsPane } from "../settings/Settings";
import { AccountMenu } from "./AccountMenu";
import { ExportsIcon, RecordingsIcon, SettingsIcon } from "./icons";
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
 * now. The account is not a pane at all: who you are is reported rather than
 * set, and it sits at the foot of the sidebar where it can be read at a glance
 * instead of behind a tab somebody visits once.
 */
/**
 * The sidebar, in the words the app uses for these things.
 *
 * "Recordings", not "Projects". A project is what the *edit* is called in the
 * code — `shared/project.ts`, `project.json` — and the pane does not list those:
 * it lists the takes, one card each, named for the moment they were made. The
 * two meanings sat on top of each other in the one place a user would read the
 * word. The id stays `projects`, because it is a persisted preference and an
 * IPC channel and neither is read by anybody.
 */
const SECTIONS = [
  { id: "projects", label: "Recordings", Icon: RecordingsIcon },
  { id: "exports", label: "Exports", Icon: ExportsIcon },
  { id: "settings", label: "Settings", Icon: SettingsIcon },
] as const satisfies readonly {
  id: WorkspaceSection;
  label: string;
  Icon: () => React.JSX.Element;
}[];

export function Library({
  section,
  onSection,
  onOpen,
}: {
  section: WorkspaceSection;
  onSection: (section: WorkspaceSection) => void;
  /** The recording being loaded, if a card has been clicked. */
  onOpen: (dir: string) => void;
}) {
  return (
    // `min-h-0 flex-1` rather than `h-full`: this is a flex child of `#root`,
    // and a flex item that cannot shrink below its content pushes the bottom of
    // the window out of view instead of letting the middle give way.
    <div className="editor-theme flex min-h-0 flex-1 overflow-hidden bg-editor-glass text-editor-fg">
      {/* Dragging the sidebar moves the window, and the inset traffic lights
          need the room at the top of it. The buttons opt back out, or a press
          on one would move the window instead of switching the pane. */}
      {/* Translucent white rather than `--editor-line`, and the labels below
          are white rather than `--editor-muted`, for the reason `--dock-hover`
          is written the way it is: those two tones were picked against an
          opaque `#16171a`, and this surface is not opaque any more. Whatever
          the window sits on raises the luminance here by an amount nothing can
          predict, so a fixed dark hairline sinks into it and a fixed muted grey
          loses the contrast it was chosen for. A white alpha rides whatever is
          behind it instead.

          The weights across these panes come in three: 8% for the edge of a
          surface, 7% for a container's own border, 4% for a rule between rows
          of one list. All a notch below where they started — a border only has
          to say where one thing ends, and at the distance they were drawn at a
          pane of eight bordered groups read as eight boxes. */}
      <nav className="drag flex w-48 shrink-0 flex-col gap-0.5 border-r border-white/8 p-3 pt-10">
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
                ? "bg-white/15 text-editor-fg"
                : "text-editor-fg/70 hover:bg-white/8 hover:text-editor-fg",
            )}
          >
            <item.Icon />
            {item.label}
          </button>
        ))}

        {/* What is not in this window. Separated by a rule rather than merely
            spaced, because the difference matters before the press and not
            after: everything above changes what this window shows, everything
            below hands the user to their browser. */}
        <hr className="my-2 border-0 border-t border-white/8" />

        <button
          type="button"
          onClick={() => void window.prequel.auth.openDashboard()}
          className={cn(
            "no-drag flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-[13px] transition-colors",
            "[&_svg]:size-4 [&_svg]:shrink-0",
            "text-editor-fg/70 hover:bg-white/8 hover:text-editor-fg",
          )}
        >
          Shared Library
          {/* Pushed to the end, and dimmer than the label: it marks the row
              rather than labelling it. */}
          <span className="flex-1" />
          <span className="text-editor-fg/45 [&_svg]:size-3.5">
            <ExternalIcon />
          </span>
        </button>

        {/* Everything below is anchored to the bottom of the sidebar. */}
        <span className="flex-1" />

        <AccountMenu />
      </nav>

      {/* Thicker than the sidebar beside it: this is where the recordings are
          read, and the sidebar is where the frost belongs. */}
      <main className="flex min-w-0 flex-1 flex-col bg-editor-scrim">
        {section === "projects" ? (
          <Projects onOpen={onOpen} />
        ) : section === "exports" ? (
          // Not wrapped in `Pane`: that caps the measure at 28rem for a column
          // of settings, and this pane is a grid that should fill the window.
          <Exports />
        ) : (
          <Pane icon={<GeneralIcon />} title="Settings">
            <SettingsPane />
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
