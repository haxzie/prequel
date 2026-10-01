import { useCallback, useEffect, useRef, useState } from "react";

import type { LibraryView, ProjectSummary } from "../../../shared/contract";
import { formatTimeAgo } from "../lib/format";
import { cn } from "../lib/cn";
import { FolderIcon, TrashIcon } from "../editor/icons";
import { RecordingsIcon } from "../workspace/icons";
import { useDock } from "../hooks/useDock";
import { PaneHeader } from "../workspace/PaneHeader";
import { ViewToggle } from "../workspace/ViewToggle";
import { PencilIcon } from "./icons";
import { Checkbox, SelectionBar } from "./Selection";
import { usePosters } from "./usePosters";

/**
 * Every recording on this Mac.
 *
 * A grid by default: what identifies a screen recording is what is on the
 * screen, and a column of timestamps is a column of things that all look the
 * same. The thumbnail is doing the work; the name and the age are there to tell
 * two similar-looking takes apart. The list is for the other question — which
 * of these did I touch this morning — where the picture is the thing in the way.
 *
 * The tile is a still and stays one. It used to flick through six frames under
 * the pointer, which put a grid of takes in motion the moment the pointer
 * crossed it — a library is a thing to read, and every tile animating as you
 * pass over them is the opposite of that.
 */
/**
 * How many recordings a page holds.
 *
 * Enough to fill the grid on an ordinary window, so the first page is the whole
 * screen and everything after it is scrolling. Smaller would show a half-empty
 * grid and immediately fetch again; larger would put the cost this exists to
 * avoid back into the first request.
 */
const PAGE = 12;

/**
 * The list's columns, stated once.
 *
 * Shared between the head and every row for the reason the Exports table shares
 * its own: two grids with the columns written out separately drift the moment
 * one is adjusted, and a head half a column off its values is worse than no
 * head at all.
 *
 * The first column is the tick. It holds its width whether or not anything is
 * showing in it, so rows do not shift sideways as the pointer crosses them.
 */
const COLUMNS = "grid grid-cols-[18px_minmax(0,1fr)_130px_130px_64px] items-center gap-4 px-4";

export function Projects({
  onOpen,
}: {
  /** The recording being loaded, if a card has been clicked. */
  onOpen: (dir: string) => void;
}) {
  const { preferences } = useDock();
  const view = preferences.projectsView;

  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  /** Which card is being renamed. Only ever one. */
  const [renaming, setRenaming] = useState<string | null>(null);

  /**
   * The recordings ticked, by directory.
   *
   * A set rather than a flag on each summary: the list is replaced wholesale by
   * every re-list, and a selection living inside it would be lost on a rename.
   */
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  /** How many recordings there are to page through, once the first page says. */
  const [total, setTotal] = useState(0);
  /** A page is in flight. Kept in a ref: the observer below reads it, and a
      render per fetch would be a render while the user is scrolling. */
  const loading = useRef(false);

  /**
   * Replaces the grid with its first page.
   *
   * Used for a fresh open and after anything that changes the list — a rename,
   * a delete — because both can move a recording between pages.
   */
  const list = useCallback(async () => {
    loading.current = true;
    const result = await window.prequel.projects.list(PAGE);
    loading.current = false;

    // An empty grid rather than none at all: main has logged whatever went
    // wrong, and a screen that never resolves says nothing to the user.
    setProjects(result.ok ? result.value.projects : []);
    setTotal(result.ok ? result.value.total : 0);
  }, []);

  /**
   * Adds the next page.
   *
   * Offset by candidates seen rather than by cards drawn: a folder with no
   * manifest is counted in `total` and never becomes a card, so paging on the
   * number of cards would ask for the same page for ever.
   */
  const more = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;

    const offset = seen.current;
    const result = await window.prequel.projects.list(PAGE, offset);
    loading.current = false;
    if (!result.ok) return;

    seen.current = offset + PAGE;
    setProjects((current) => [...(current ?? []), ...result.value.projects]);
    setTotal(result.value.total);
  }, []);

  /** Candidate folders asked for so far, which is what the offset counts. */
  const seen = useRef(PAGE);

  useEffect(() => {
    seen.current = PAGE;
    void list();
  }, [list]);

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

  const toggle = useCallback((dir: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(dir)) next.add(dir);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const removeSelected = useCallback(async () => {
    const result = await window.prequel.projects.deleteMany([...selected]);
    if (!result.ok) return;

    // Cleared whatever happened, including a decline. Leaving six tiles ticked
    // after the sheet has gone leaves the bar up over a library nobody is
    // acting on any more, and the one case where it matters — a recording that
    // would not move — is visible as a tile that is still there.
    clear();
    if (result.value.length > 0) await list();
  }, [selected, clear, list]);

  // Escape drops the selection, which is the one thing every selection UI is
  // expected to do and the only way out that does not involve finding the bar.
  useEffect(() => {
    if (selected.size === 0) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") clear();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected.size, clear]);

  const setView = useCallback((next: LibraryView) => {
    void window.prequel.dock.updatePreferences({ projectsView: next });
  }, []);

  /**
   * Whether a click on a card selects rather than opens.
   *
   * Once anything is ticked the question has changed from "show me this one" to
   * "which of these", and every click is an answer to the second. It is also
   * what keeps a half-made selection from being lost to a mis-click that
   * navigates the window away from it.
   */
  const selecting = selected.size > 0;
  const grid = view === "grid";

  return (
    <>
      <PaneHeader icon={<RecordingsIcon />} title="Recordings">
        {projects !== null && projects.length > 0 && (
          <span className="text-[12px] text-editor-muted">
            {projects.length} {projects.length === 1 ? "recording" : "recordings"}
          </span>
        )}
        <ViewToggle view={view} onChange={setView} />
      </PaneHeader>

      {projects === null ? (
        // Skeletons rather than a blank. This used to be empty on the grounds
        // that a directory read is over in a frame — true of twenty takes and
        // not of a thousand, where the window opened on nothing at all while
        // main worked through them.
        <Skeletons view={view} />
      ) : projects.length === 0 ? (
        <Empty />
      ) : (
        // `relative`, so the selection bar's `absolute` resolves against the
        // pane rather than the window — it belongs over this list, not over
        // the sidebar beside it.
        <div className="relative min-h-0 flex-1">
          {/* No padding in the list: the sticky head is the first thing in
              the scroller and has its own height, and padding above it would
              leave a band of empty pane that the head then scrolls up into. */}
          <div className={cn("h-full overflow-y-auto", grid && "p-5")}>
            {!grid && (
              <div
                className={cn(
                  COLUMNS,
                  // Sticky, so scrolling a long library never leaves four
                  // unlabelled columns. Opaque, or the rows would show through
                  // it as they pass underneath.
                  "sticky top-0 z-10 border-b border-white/7 bg-editor-scrim",
                  "h-8 text-[11px] font-medium text-editor-muted",
                )}
              >
                <span />
                <span>Name</span>
                <span>Edited</span>
                <span>Recorded</span>
                <span />
              </div>
            )}

            <div
              className={cn(
                grid ? "grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4" : "",
              )}
            >
              {projects.map((project) => (
                <Card
                  key={project.dir}
                  project={project}
                  view={view}
                  poster={project.poster ?? posters.get(project.dir) ?? null}
                  renaming={renaming === project.dir}
                  checked={selected.has(project.dir)}
                  selecting={selecting}
                  onOpen={() => (selecting ? toggle(project.dir) : onOpen(project.dir))}
                  onToggle={() => toggle(project.dir)}
                  onRename={() => setRenaming(project.dir)}
                  onRenamed={(name) => void rename(project.dir, name)}
                  onCancelRename={() => setRenaming(null)}
                  onDelete={() => void remove(project.dir)}
                />
              ))}

              {/* The next page, fetched when this comes into view.
                  Skeletons rather than a spinner: they are the size of what is
                  coming, so the scrollbar stops jumping as each page lands. */}
              {projects.length < total && <Sentinel view={view} onVisible={more} />}
            </div>

            {/* Room under the last row for the bar to float over. Reserved only
                while there is one, so a library nobody is selecting in does not
                scroll past its end for nothing. */}
            {selecting && <div className="h-16" aria-hidden />}
          </div>

          {selecting && (
            <SelectionBar count={selected.size} onClear={clear} onDelete={removeSelected} />
          )}
        </div>
      )}
    </>
  );
}

/**
 * Cards that are not there yet.
 *
 * The same shape and spacing as the real ones, so the first page lands in place
 * rather than pushing a half-drawn grid down the screen. Eight of them: enough
 * to look like a library on any window, few enough that a small one is not
 * scrolled by placeholders.
 */
function Skeletons({ view }: { view: LibraryView }) {
  const grid = view === "grid";

  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto", grid ? "p-5" : "pt-8")} aria-hidden>
      <div className={cn(grid ? "grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4" : "")}>
        {Array.from({ length: 8 }, (_, index) =>
          grid ? (
            <div key={index} className="flex flex-col gap-2">
              <div className="aspect-video animate-pulse rounded-xl border border-editor-line bg-editor-panel" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-editor-panel" />
              <div className="h-2.5 w-1/3 animate-pulse rounded bg-editor-panel" />
            </div>
          ) : (
            <div key={index} className={cn(COLUMNS, "h-11 border-b border-white/4")}>
              <span />
              <span className="flex items-center gap-2.5">
                <span className="h-7 w-12 shrink-0 animate-pulse rounded-sm bg-editor-panel" />
                <span className="h-3 w-1/2 animate-pulse rounded bg-editor-panel" />
              </span>
              <span className="h-2.5 w-2/3 animate-pulse rounded bg-editor-panel" />
              <span className="h-2.5 w-2/3 animate-pulse rounded bg-editor-panel" />
              <span />
            </div>
          ),
        )}
      </div>
    </div>
  );
}

/**
 * Asks for the next page when it is scrolled to.
 *
 * An `IntersectionObserver` rather than a scroll handler: a scroll listener
 * fires on every frame of a flick and has to measure the scroller to decide
 * anything, which is a layout read in the middle of a scroll — the one thing
 * the editor's own rules single out as making a list judder.
 *
 * `rootMargin` so it fires a screen early. Waiting until the placeholder is
 * actually visible means the user reaches the end of the list and stops there,
 * which reads as the library having run out.
 */
function Sentinel({ view, onVisible }: { view: LibraryView; onVisible: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onVisible();
      },
      { rootMargin: "600px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [onVisible]);

  return view === "grid" ? (
    <div ref={ref} className="flex flex-col gap-2" aria-hidden>
      <div className="aspect-video animate-pulse rounded-xl border border-editor-line bg-editor-panel" />
      <div className="h-3 w-2/3 animate-pulse rounded bg-editor-panel" />
    </div>
  ) : (
    <div ref={ref} className={cn(COLUMNS, "h-11 border-b border-white/4")} aria-hidden>
      <span />
      <span className="flex items-center gap-2.5">
        <span className="h-7 w-12 shrink-0 animate-pulse rounded-sm bg-editor-panel" />
        <span className="h-3 w-1/2 animate-pulse rounded bg-editor-panel" />
      </span>
      <span className="h-2.5 w-2/3 animate-pulse rounded bg-editor-panel" />
      <span className="h-2.5 w-2/3 animate-pulse rounded bg-editor-panel" />
      <span />
    </div>
  );
}

/**
 * One recording, as a tile or as a row.
 *
 * The same component for both, because what differs between them is where the
 * picture sits and nothing else: the tick, the name, the dates, the rename and
 * the delete are identical, and splitting them into two components is how the
 * list comes to be missing whatever the grid gained last.
 */
function Card({
  project,
  view,
  poster,
  renaming,
  checked,
  selecting,
  onOpen,
  onToggle,
  onRename,
  onRenamed,
  onCancelRename,
  onDelete,
}: {
  project: ProjectSummary;
  view: LibraryView;
  poster: string | null;
  renaming: boolean;
  checked: boolean;
  /** Something is selected, so every tick is out and a click selects. */
  selecting: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onRename: () => void;
  onRenamed: (name: string) => void;
  onCancelRename: () => void;
  onDelete: () => void;
}) {
  const grid = view === "grid";

  const tick = (
    <Checkbox
      checked={checked}
      pinned={selecting}
      label={checked ? `Deselect ${project.name}` : `Select ${project.name}`}
      onChange={onToggle}
    />
  );

  if (!grid) {
    return (
      <div
        className={cn(
          "group relative border-b border-white/4 last:border-b-0",
          // Tinted with the same green the tick is, so the row and its box
          // read as one selection rather than two states that happen to
          // coincide.
          checked && "bg-export/10",
        )}
      >
        {/* One button for the whole row, with the tick and the actions over it
            rather than inside it: a button nested in a button is invalid, and
            the browser resolves it by dropping one of the two. */}
        <button
          type="button"
          onClick={onOpen}
          title={selecting ? project.name : `Open ${project.name}`}
          className={cn(COLUMNS, "h-11 w-full text-left transition-colors hover:bg-white/6")}
        >
          {/* The tick's column, held open by the grid. What is drawn in it is
              positioned over the top, so the row's own press still reaches the
              button underneath everywhere else. */}
          <span />
          {/* `min-w-0` or a long name refuses to truncate and pushes the dates
              off their heads: a grid item's floor is its content width until it
              is told otherwise. */}
          <span className="flex min-w-0 items-center gap-2.5">
            <Poster
              project={project}
              poster={poster}
              className="h-7 w-12 shrink-0 overflow-hidden rounded-sm border border-white/7 bg-editor-panel"
            />
            {renaming ? null : <span className="truncate text-[13px]">{project.name}</span>}
          </span>
          <span className="truncate text-[12px] text-editor-muted">
            {project.editedAt === null ? "—" : formatTimeAgo(project.editedAt)}
          </span>
          <span className="truncate text-[12px] text-editor-muted">
            {formatTimeAgo(project.createdAt)}
          </span>
          <span />
        </button>

        <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2">{tick}</span>

        {/* Renaming replaces the name in place, over the row. A field inside
            the button would be a field inside a button, which is the same
            nesting problem the tick has. */}
        {renaming && (
          <span className="absolute top-1/2 left-[94px] w-56 -translate-y-1/2">
            <RenameField name={project.name} onDone={onRenamed} onCancel={onCancelRename} />
          </span>
        )}

        <div className="pointer-events-none absolute top-1/2 right-4 flex -translate-y-1/2 gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <Action label={`Rename ${project.name}`} onClick={onRename}>
            <PencilIcon />
          </Action>
          <Action label={`Move ${project.name} to the Trash`} danger onClick={onDelete}>
            <TrashIcon />
          </Action>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex flex-col gap-2">
      <div className="relative">
        <button
          type="button"
          onClick={onOpen}
          title={selecting ? project.name : `Open ${project.name}`}
          className={cn(
            "block w-full overflow-hidden rounded-xl border bg-editor-panel",
            "aspect-video transition-[border-color,opacity]",
            // The selected tile says so with its border rather than only with
            // its tick: the tick is 18 points in a corner, and which of twelve
            // tiles are chosen should be readable from across the room. The
            // same green, for the same reason the row is tinted with it.
            //
            // The pointer says the same thing in blue — the same border and
            // ring, a different colour. Two states that look alike are right
            // here: both are "this one", and the only difference is whether it
            // is the pointer saying so or the user. The blue is the app's one
            // blue, `--indicator`, which is a hue away from both the green of
            // a selection and the purple of everything in a thumbnail.
            checked
              ? "border-export ring-2 ring-export/40"
              : "border-editor-line hover:border-indicator hover:ring-2 hover:ring-indicator/35",
          )}
        >
          <Poster project={project} poster={poster} className="size-full" />
        </button>

        <span className="pointer-events-none absolute top-2 left-2">{tick}</span>

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
      {/* No "Opening…" here any more. A click navigates on the spot, so this
          card is gone before it could say so, and the editor route names the
          recording it is fetching instead. */}
      <span className="-mt-1.5 text-[12px] text-editor-muted">
        {formatTimeAgo(project.createdAt)}
      </span>
    </div>
  );
}

/** The still, or the space it will take. */
function Poster({
  project,
  poster,
  className,
}: {
  project: ProjectSummary;
  poster: string | null;
  className?: string;
}) {
  return (
    <span className={cn("block", className)}>
      {poster ? (
        <img
          src={poster}
          alt=""
          // `cover`, so a grid of projects at different aspect ratios reads as
          // a grid rather than as a row of differently-shaped pictures. A
          // portrait project is shown cropped to the tile; its shape is on the
          // card it opens, not here.
          className="size-full object-cover"
        />
      ) : (
        // Held open at the same size, so a still arriving does not reflow
        // every tile below it.
        <span className="grid size-full place-items-center text-editor-muted/40 [&_svg]:size-5">
          <FolderIcon />
        </span>
      )}
      <span className="sr-only">{project.name}</span>
    </span>
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
        "pointer-events-auto grid size-7 place-items-center rounded-full bg-editor-bg/80 text-editor-fg backdrop-blur",
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
        // Stopped here as well as handled: Escape is what drops the selection,
        // and a rename abandoned with it should not also empty the library's
        // ticks behind the field.
        event.stopPropagation();
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
