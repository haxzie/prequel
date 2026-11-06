import { useCallback, useEffect, useState } from "react";

import type { ProjectComposition, ProjectDetails, ProjectSummary } from "../../../shared/contract";
import { CloseIcon, FolderIcon, TrashIcon } from "../editor/icons";
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
  onClose,
  onDelete,
}: {
  /**
   * The recording this pane is about.
   *
   * Never null. The pane is not drawn at all without a selection — an empty
   * column of its own width beside the grid is a pane asking to be filled, and
   * the grid wants the room back more than the empty state was worth saying.
   */
  project: ProjectSummary;
  onOpen: (dir: string) => void;
  /** The ✕. Drops the selection, which is what takes this off the row. */
  onClose: () => void;
  /** Already moved to the Trash. The library re-lists; this clears itself. */
  onDelete: (dir: string) => void;
}) {
  const dir = project.dir;
  const [composition, setComposition] = useState<ProjectComposition | null>(null);
  const [details, setDetails] = useState<ProjectDetails | null>(null);

  // Both cleared on the way in rather than left showing the last recording's
  // answer while the next one loads. `live` is what stops a slow reply landing
  // in a pane that has moved on.
  useEffect(() => {
    setComposition(null);
    setDetails(null);

    let live = true;
    void window.prequel.projects.composition(dir).then((result) => {
      if (live && result.ok) setComposition(result.value);
    });
    void window.prequel.projects.details(dir).then((result) => {
      if (live && result.ok) setDetails(result.value);
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

  return (
    <aside className={SHELL}>
      {/* The name and the way out, in a row of their own above the scroller.
          The name was under the preview and has moved up to meet the ✕: one
          header is one thing to read, and a close button floating over the
          picture would sit on the one control the picture already has.

          Outside the scroller, so the way out of the pane does not scroll
          away from somebody reading the bottom of it. */}
      <header className="flex flex-none items-center gap-2 px-4 pt-4">
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold" title={project.name}>
          {project.name}
        </h2>
        <button
          type="button"
          title="Close"
          aria-label="Close the preview"
          className={cn(
            "grid size-7 flex-none place-items-center rounded-md text-editor-muted",
            "hover:bg-white/10 hover:text-editor-fg [&_svg]:size-3.5",
          )}
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </header>

      {/* Scrolls as one column. The preview is part of what is being read
          rather than a header over it — on a short window the facts matter
          more than the picture, and pinning it would leave them in a slot two
          rows tall. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <Preview spec={composition} poster={project.poster} />

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

        <Facts project={project} details={details} />
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
 * The pane itself.
 *
 * A fixed column rather than a share of the row: the grid beside it reflows to
 * whatever it is given and this does not — the preview, the button and the
 * facts all want the same width whatever the window is doing.
 */
const SHELL =
  "flex w-[280px] flex-none flex-col border-l border-white/8 bg-black/10 " +
  "min-h-0 overflow-hidden";
