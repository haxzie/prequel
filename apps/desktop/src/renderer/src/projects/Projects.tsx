import { useCallback, useEffect, useState } from "react";

import type { ProjectSummary } from "../../../shared/contract";
import { formatTimeAgo } from "../lib/format";
import { cn } from "../lib/cn";
import { FolderIcon, TrashIcon } from "../editor/icons";
import { PencilIcon } from "./icons";
import { usePosters } from "./usePosters";

/**
 * Every recording on this Mac.
 *
 * A grid rather than a list: what identifies a screen recording is what is on
 * the screen, and a column of timestamps is a column of things that all look
 * the same. The thumbnail is doing the work here; the name and the age are
 * there to tell two similar-looking takes apart.
 */
export function Projects({
  opening,
  onOpen,
}: {
  /** The recording being loaded, if a card has been clicked. */
  opening: string | null;
  onOpen: (dir: string) => void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  /** Which card is being renamed. Only ever one. */
  const [renaming, setRenaming] = useState<string | null>(null);

  const list = useCallback(async () => {
    const result = await window.prequel.projects.list();
    // An empty grid rather than none at all: main has logged whatever went
    // wrong, and a screen that never resolves says nothing to the user.
    setProjects(result.ok ? result.value : []);
  }, []);

  useEffect(() => void list(), [list]);

  const posters = usePosters(projects ?? []);

  const rename = useCallback(
    async (dir: string, name: string) => {
      setRenaming(null);
      await window.prequel.projects.rename(dir, name);
      await list();
    },
    [list],
  );

  const remove = useCallback(
    async (dir: string) => {
      // Confirmed by main, in a sheet hung off this window. Declining comes
      // back as `false`, which is nothing to re-list for.
      const result = await window.prequel.projects.delete(dir);
      if (result.ok && result.value) await list();
    },
    [list],
  );

  return (
    // `min-h-0 flex-1` rather than `h-full`: this is a flex child of `#root`,
    // and a flex item that cannot shrink below its content pushes the bottom of
    // the window out of view instead of letting the middle give way.
    <div className="editor-theme flex min-h-0 flex-1 flex-col overflow-hidden bg-editor-bg text-editor-fg">
      {/* Dragging the bar moves the window, and the inset traffic lights need
          the room on the left. */}
      <header className="drag flex h-[38px] flex-none items-center gap-1.5 border-b border-editor-line pr-3 pl-20">
        <span className="flex items-center gap-1.5 text-[13px] font-medium [&_svg]:size-3.5">
          <FolderIcon />
          Projects
        </span>
        <span className="flex-1" />
        {projects !== null && projects.length > 0 && (
          <span className="text-[12px] text-editor-muted">
            {projects.length} {projects.length === 1 ? "recording" : "recordings"}
          </span>
        )}
      </header>

      {projects === null ? (
        // Blank rather than a spinner: the list is a directory read, and
        // anything that announces itself is on screen for one frame.
        <div className="flex-1" />
      ) : projects.length === 0 ? (
        <Empty />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {projects.map((project) => (
              <Card
                key={project.dir}
                project={project}
                poster={project.poster ?? posters.get(project.dir) ?? null}
                opening={opening === project.dir}
                renaming={renaming === project.dir}
                onOpen={() => onOpen(project.dir)}
                onRename={() => setRenaming(project.dir)}
                onRenamed={(name) => void rename(project.dir, name)}
                onCancelRename={() => setRenaming(null)}
                onDelete={() => void remove(project.dir)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Card({
  project,
  poster,
  opening,
  renaming,
  onOpen,
  onRename,
  onRenamed,
  onCancelRename,
  onDelete,
}: {
  project: ProjectSummary;
  poster: string | null;
  opening: boolean;
  renaming: boolean;
  onOpen: () => void;
  onRename: () => void;
  onRenamed: (name: string) => void;
  onCancelRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group flex flex-col gap-2">
      {/* The whole thumbnail is the button, and the actions sit over it rather
          than inside it: nesting a button inside a button is invalid, and the
          browser resolves it by dropping one of the two. */}
      <div className="relative">
        <button
          type="button"
          onClick={onOpen}
          disabled={opening}
          title={`Open ${project.name}`}
          className={cn(
            "block w-full overflow-hidden rounded-xl border border-editor-line bg-editor-panel",
            "aspect-video transition-[border-color,opacity] hover:border-editor-accent/60",
            opening && "pointer-events-none opacity-50",
          )}
        >
          {poster ? (
            <img
              src={poster}
              alt=""
              // `cover`, so a grid of takes at different aspect ratios reads as
              // a grid rather than as a row of differently-shaped pictures.
              className="size-full object-cover"
            />
          ) : (
            // Held open at the same size, so a still arriving does not reflow
            // every tile below it.
            <span className="grid size-full place-items-center text-editor-muted/40 [&_svg]:size-6">
              <FolderIcon />
            </span>
          )}
        </button>

        {/* Revealed on hover, and on focus so they can be reached from the
            keyboard at all — `opacity-0` alone leaves a control that is
            tabbable and invisible. */}
        <div className="pointer-events-none absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <Action label={`Rename ${project.name}`} onClick={onRename}>
            <PencilIcon />
          </Action>
          <Action label={`Move ${project.name} to the Trash`} danger onClick={onDelete}>
            <TrashIcon />
          </Action>
        </div>
      </div>

      {renaming ? (
        <RenameField name={project.name} onDone={onRenamed} onCancel={onCancelRename} />
      ) : (
        <button
          type="button"
          onClick={onRename}
          title="Rename"
          className="truncate rounded text-left text-[13px] font-medium hover:text-editor-accent"
        >
          {project.name}
        </button>
      )}
      <span className="-mt-1.5 text-[12px] text-editor-muted">
        {opening ? "Opening…" : formatTimeAgo(project.createdAt)}
      </span>
    </div>
  );
}

function Action({
  label,
  danger,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        // `pointer-events-auto` against the row's `pointer-events-none`, which
        // is what keeps the hidden controls from swallowing clicks meant for
        // the thumbnail underneath.
        "pointer-events-auto grid size-7 place-items-center rounded-lg bg-editor-bg/80 text-editor-fg backdrop-blur",
        "[&_svg]:size-3.5",
        danger ? "hover:bg-editor-danger hover:text-white" : "hover:bg-editor-panel",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Renaming, in place on the card.
 *
 * Committed on Enter and on blur, abandoned on Escape — the three things a
 * label that turned into a field is expected to do. A dialog for one short
 * string would be more chrome than the edit.
 */
function RenameField({
  name,
  onDone,
  onCancel,
}: {
  name: string;
  onDone: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(name);
  /**
   * Whether Escape has already taken this field away.
   *
   * Escape moves focus, which fires `blur` straight after — without this the
   * abandoned edit is committed by the very keypress that abandoned it.
   */
  const [cancelled, setCancelled] = useState(false);

  return (
    <input
      autoFocus
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.target.select()}
      onBlur={() => (cancelled ? onCancel() : onDone(value))}
      onKeyDown={(event) => {
        if (event.key === "Enter") onDone(value);
        if (event.key === "Escape") {
          setCancelled(true);
          onCancel();
        }
      }}
      className="w-full rounded border border-editor-accent/60 bg-editor-panel px-1.5 py-0.5 text-[13px] font-medium outline-none"
    />
  );
}

function Empty() {
  return (
    <div className="grid flex-1 place-items-center px-8 text-center">
      <div className="max-w-xs">
        <p className="text-[13px] font-medium">No recordings yet</p>
        <p className="mt-1 text-[12px] text-editor-muted">
          Everything you record on this Mac shows up here. Start one from the Prequel icon in the
          menu bar.
        </p>
      </div>
    </div>
  );
}
