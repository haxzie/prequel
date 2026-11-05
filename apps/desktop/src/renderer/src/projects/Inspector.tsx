import { useCallback, useEffect, useState } from "react";

import type {
  ExportSummary,
  ProjectComposition,
  ProjectDetails,
  ProjectSummary,
} from "../../../shared/contract";
import { CopyIcon, FolderIcon, TrashIcon } from "../editor/icons";
import { formatElapsed, formatFileSize, formatTimeAgo } from "../lib/format";
import { cn } from "../lib/cn";
import { Preview } from "./Preview";

/**
 * The pane beside the library, for whichever recording is pointed at.
 *
 * Clicking a tile used to open the editor, which is a long way to go to answer
 * "is this the one". It selects now, and this is what a selection shows: the
 * edit playing, the one button that opens it, and the facts that are otherwise
 * only in Finder.
 *
 * It owns no list. Everything here hangs off one directory, and every fetch is
 * keyed on it — so the pane is a function of what is selected rather than a
 * second copy of the library's state that has to be kept in step with it.
 */
export function Inspector({
  project,
  onOpen,
  onDelete,
}: {
  /** The selected recording, or null when nothing is. */
  project: ProjectSummary | null;
  onOpen: (dir: string) => void;
  /** Already moved to the Trash. The library re-lists; this clears itself. */
  onDelete: (dir: string) => void;
}) {
  const dir = project?.dir ?? null;
  const [tab, setTab] = useState<"details" | "exports">("details");
  const [composition, setComposition] = useState<ProjectComposition | null>(null);
  const [details, setDetails] = useState<ProjectDetails | null>(null);
  const [exports, setExports] = useState<ExportSummary[] | null>(null);

  // Back to the facts whenever the selection moves. The Exports tab is the
  // answer to a question about one recording, and leaving it open across a
  // change showed another recording's exports under this one's name.
  useEffect(() => setTab("details"), [dir]);

  // Three fetches, each cleared on the way in rather than left showing the last
  // recording's answer while the next one loads. `live` is what stops a slow
  // reply landing in a pane that has moved on.
  useEffect(() => {
    setComposition(null);
    setDetails(null);
    setExports(null);
    if (!dir) return;

    let live = true;
    void window.prequel.projects.composition(dir).then((result) => {
      if (live && result.ok) setComposition(result.value);
    });
    void window.prequel.projects.details(dir).then((result) => {
      if (live && result.ok) setDetails(result.value);
    });
    void window.prequel.exports.list(dir).then((result) => {
      if (live && result.ok) setExports(result.value);
    });

    return () => {
      live = false;
    };
  }, [dir]);

  const remove = useCallback(async () => {
    if (!dir) return;
    const result = await window.prequel.projects.delete(dir);
    // False is the confirmation declined, which must leave the pane as it is.
    if (result.ok && result.value) onDelete(dir);
  }, [dir, onDelete]);

  if (!project || !dir) {
    return (
      <aside className={SHELL}>
        <p className="m-auto max-w-[180px] text-center text-[13px] text-editor-muted">
          Pick a recording to see it here.
        </p>
      </aside>
    );
  }

  return (
    <aside className={SHELL}>
      {/* Scrolls as one column. The preview is part of what is being read
          rather than a header over it — on a short window the facts matter
          more than the picture, and pinning it would leave them in a slot two
          rows tall. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <Preview spec={composition} poster={project.poster} />

        <h2 className="truncate text-[15px] font-semibold" title={project.name}>
          {project.name}
        </h2>

        <div className="flex items-center gap-2">
          {/* The one thing this pane leads to, and the only filled button in
              it. Everything else here reports; this acts. */}
          <button
            type="button"
            className={cn(
              "flex h-9 flex-1 items-center justify-center rounded-lg text-[13px] font-medium",
              "bg-editor-accent text-black transition-[filter] hover:brightness-105",
            )}
            onClick={() => onOpen(dir)}
          >
            {project.still ? "Edit screenshot" : "Edit recording"}
          </button>

          {/* Glyph only, and the one control in here that cannot be undone —
              so it is the one that is not labelled in words beside a button
              that is. It turns red under the pointer rather than being drawn
              red: a destructive button sitting permanently lit beside the one
              people came for is a pane that looks like a warning. */}
          <button
            type="button"
            title="Move this recording to the Trash"
            aria-label="Move this recording to the Trash"
            className={cn(
              "grid size-9 flex-none place-items-center rounded-lg text-editor-muted",
              "hover:bg-cut/20 hover:text-editor-fg [&_svg]:size-4",
            )}
            onClick={() => void remove()}
          >
            <TrashIcon />
          </button>
        </div>

        <div className="flex gap-1 rounded-lg bg-white/5 p-1">
          {(["details", "exports"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={cn(
                "flex-1 rounded-md py-1 text-[12px] font-medium capitalize transition-colors",
                tab === id
                  ? "bg-white/10 text-editor-fg"
                  : "text-editor-muted hover:text-editor-fg",
              )}
              onClick={() => setTab(id)}
            >
              {id}
              {/* The count on the tab rather than inside it: whether a
                  recording has ever been exported is worth knowing without
                  opening the tab that says so. */}
              {id === "exports" && exports !== null && exports.length > 0 && (
                <span className="ml-1.5 tabular-nums opacity-60">{exports.length}</span>
              )}
            </button>
          ))}
        </div>

        {tab === "details" ? (
          <Facts project={project} details={details} />
        ) : (
          <Exports entries={exports} />
        )}
      </div>
    </aside>
  );
}

/** What the recording is, in the units somebody reading it would use. */
function Facts({ project, details }: { project: ProjectSummary; details: ProjectDetails | null }) {
  return (
    <dl className="flex flex-col gap-px text-[12px]">
      <Fact label="Created" value={new Date(project.createdAt).toLocaleString()} />
      <Fact
        label="Last edited"
        // "Never" and not a dash: a recording nobody has opened is a fact
        // about it, and a dash reads as a number that could not be found.
        value={project.editedAt === null ? "Never" : formatTimeAgo(project.editedAt)}
      />
      {!project.still && details && (
        <Fact label="Duration" value={formatElapsed(details.durationMs)} />
      )}
      {details?.source && (
        <Fact label="Captured at" value={`${details.source.width} × ${details.source.height}`} />
      )}
      {details && details.clips > 1 && <Fact label="Clips" value={String(details.clips)} />}
      <Fact label="Size on disk" value={details ? formatFileSize(details.bytes) : "…"} />

      {/* Last, and a button rather than a line of text. The path is the one
          fact here nobody wants to read — they want to be taken to it. */}
      {details && (
        <div className="mt-2 flex items-start justify-between gap-2 py-1.5">
          <dt className="flex-none pt-px text-editor-muted">Location</dt>
          <button
            type="button"
            title="Show in Finder"
            className={cn(
              "flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-right",
              "text-editor-fg hover:bg-white/10 [&_svg]:size-3.5 [&_svg]:flex-none",
            )}
            onClick={() => void window.prequel.library.reveal(project.dir)}
          >
            <FolderIcon />
            <span className="truncate" title={details.folder}>
              {details.folder}
            </span>
          </button>
        </div>
      )}
    </dl>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="flex-none text-editor-muted">{label}</dt>
      {/* Tabular, so a column of sizes and durations lines up on its figures
          rather than wandering with the width of each glyph. */}
      <dd className="truncate tabular-nums" title={value}>
        {value}
      </dd>
    </div>
  );
}

/**
 * Every file this recording has been exported to.
 *
 * Only the ones the ledger knows came from here — see `ExportSummary.dir`. An
 * export written before that was recorded belongs to no recording, and listing
 * it under whichever one looks likely would be a guess presented as a fact.
 */
function Exports({ entries }: { entries: readonly ExportSummary[] | null }) {
  if (entries === null) return <p className={EMPTY}>Looking…</p>;
  if (entries.length === 0) {
    return <p className={EMPTY}>Nothing exported from this recording yet.</p>;
  }

  return (
    <ul className="flex flex-col">
      {entries.map((entry) => (
        <li
          key={entry.path}
          className="group/row flex items-center gap-2 border-t border-white/4 py-2 first:border-t-0"
        >
          {/* The row itself reveals it. Opening Finder is what somebody who
              has found their export in a list wants next — the file is the
              thing, and this pane cannot be where it is played. */}
          <button
            type="button"
            className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
            title={`Show ${entry.name} in Finder`}
            onClick={() => void window.prequel.exports.reveal(entry.path)}
          >
            <span className="w-full truncate text-[12px]">{entry.name}</span>
            <span className="text-[11px] text-editor-muted">
              {formatTimeAgo(entry.createdAt)} · {formatFileSize(entry.bytes)}
              {entry.durationMs !== null && ` · ${formatElapsed(entry.durationMs)}`}
            </span>
          </button>

          {/* Shown on hover, like the actions on a timeline clip: a column of
              copy buttons down a list is a column of things to ignore. */}
          <button
            type="button"
            title="Copy the file"
            aria-label={`Copy ${entry.name}`}
            className={cn(
              "grid size-7 flex-none place-items-center rounded-md text-editor-muted opacity-0",
              "group-hover/row:opacity-100 hover:bg-white/10 hover:text-editor-fg",
              "focus-visible:opacity-100 [&_svg]:size-3.5",
            )}
            onClick={() => void window.prequel.exports.copy(entry.path)}
          >
            <CopyIcon />
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The pane itself.
 *
 * A fixed column rather than a share of the row: the grid beside it reflows to
 * whatever it is given and this does not — the preview, the button and the
 * facts all want the same width whatever the window is doing.
 */
const SHELL =
  "flex w-[280px] flex-none flex-col border-l border-white/8 bg-black/10 " +
  "min-h-0 overflow-hidden";

const EMPTY = "py-6 text-center text-[12px] text-editor-muted";
