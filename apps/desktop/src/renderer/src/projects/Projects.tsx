import { useCallback, useEffect, useRef, useState } from "react";

import { FILMSTRIP_FRAMES, type ProjectSummary } from "../../../shared/contract";
import { formatTimeAgo } from "../lib/format";
import { cn } from "../lib/cn";
import { FolderIcon, TrashIcon } from "../editor/icons";
import { PaneHeader } from "../workspace/PaneHeader";
import { PencilIcon } from "./icons";
import { useFilmstrip } from "./useFilmstrip";
import { usePosters } from "./usePosters";

/**
 * How long each frame of the hover preview stays up.
 *
 * Slow enough to see what is in it — these are frames from minutes apart, not
 * playback — and fast enough that a whole recording has gone past before anyone
 * decides the tile is not moving.
 */
const FRAME_MS = 700;

/**
 * Every recording on this Mac.
 *
 * A grid rather than a list: what identifies a screen recording is what is on
 * the screen, and a column of timestamps is a column of things that all look
 * the same. The thumbnail is doing the work here; the name and the age are
 * there to tell two similar-looking takes apart.
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

export function Projects({
  onOpen,
}: {
  /** The recording being loaded, if a card has been clicked. */
  onOpen: (dir: string) => void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  /** Which card is being renamed. Only ever one. */
  const [renaming, setRenaming] = useState<string | null>(null);

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

  return (
    <>
      <PaneHeader icon={<FolderIcon />} title="Projects">
        {projects !== null && projects.length > 0 && (
          <span className="text-[12px] text-editor-muted">
            {projects.length} {projects.length === 1 ? "recording" : "recordings"}
          </span>
        )}
      </PaneHeader>

      {projects === null ? (
        // Skeletons rather than a blank. This used to be empty on the grounds
        // that a directory read is over in a frame — true of twenty takes and
        // not of a thousand, where the window opened on nothing at all while
        // main worked through them.
        <Skeletons />
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
                renaming={renaming === project.dir}
                onOpen={() => onOpen(project.dir)}
                onRename={() => setRenaming(project.dir)}
                onRenamed={(name) => void rename(project.dir, name)}
                onCancelRename={() => setRenaming(null)}
                onDelete={() => void remove(project.dir)}
              />
            ))}

            {/* The next page, fetched when this comes into view.
                Skeletons rather than a spinner: they are the size of what is
                coming, so the scrollbar stops jumping as each page lands. */}
            {projects.length < total && <Sentinel onVisible={more} />}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * A grid of cards that are not there yet.
 *
 * The same shape and spacing as the real ones, so the first page lands in place
 * rather than pushing a half-drawn grid down the screen. Eight of them: enough
 * to look like a library on any window, few enough that a small one is not
 * scrolled by placeholders.
 */
function Skeletons() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5" aria-hidden>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <div className="aspect-video animate-pulse rounded-xl border border-editor-line bg-editor-panel" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-editor-panel" />
            <div className="h-2.5 w-1/3 animate-pulse rounded bg-editor-panel" />
          </div>
        ))}
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
function Sentinel({ onVisible }: { onVisible: () => void }) {
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

  return (
    <div ref={ref} className="flex flex-col gap-2" aria-hidden>
      <div className="aspect-video animate-pulse rounded-xl border border-editor-line bg-editor-panel" />
      <div className="h-3 w-2/3 animate-pulse rounded bg-editor-panel" />
    </div>
  );
}

function Card({
  project,
  poster,
  renaming,
  onOpen,
  onRename,
  onRenamed,
  onCancelRename,
  onDelete,
}: {
  project: ProjectSummary;
  poster: string | null;
  renaming: boolean;
  onOpen: () => void;
  onRename: () => void;
  onRenamed: (name: string) => void;
  onCancelRename: () => void;
  onDelete: () => void;
}) {
  /**
   * Whether the pointer is over this tile, and whether it ever has been.
   *
   * The second outlives the first on purpose: leaving the strip mounted keeps
   * it decoded, so coming back to a tile is instant. Mounting it before the
   * first hover would mean every tile in the library holding a decoded strip
   * to show a still.
   */
  const [hovering, setHovering] = useState(false);
  const [warm, setWarm] = useState(false);

  const strip = useFilmstrip(project.dir, project.filmstrip, hovering);
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = stripRef.current;
    if (!hovering || !strip || !element) return;

    let frame = 0;
    // Written straight to the element rather than through state: a timer that
    // re-rendered would rebuild the card's label, its two actions and its
    // field to move a background by a fixed step.
    const show = () => {
      element.style.backgroundPosition = `${((frame / (FILMSTRIP_FRAMES - 1)) * 100).toFixed(4)}% 0`;
    };

    show();
    const timer = window.setInterval(() => {
      frame = (frame + 1) % FILMSTRIP_FRAMES;
      show();
    }, FRAME_MS);

    return () => window.clearInterval(timer);
  }, [hovering, strip]);

  return (
    <div className="group flex flex-col gap-2">
      {/* The whole thumbnail is the button, and the actions sit over it rather
          than inside it: nesting a button inside a button is invalid, and the
          browser resolves it by dropping one of the two. */}
      <div
        className="relative"
        onPointerEnter={() => {
          setHovering(true);
          setWarm(true);
        }}
        onPointerLeave={() => setHovering(false)}
      >
        <button
          type="button"
          onClick={onOpen}
          title={`Open ${project.name}`}
          className={cn(
            // `relative`, so the hover strip's `inset-0` resolves against this
            // button and is clipped by its rounding. Against the wrapper
            // outside it — the next positioned ancestor — the strip covers the
            // border and squares off all four corners the moment it fades in.
            "relative block w-full overflow-hidden rounded-xl border border-editor-line bg-editor-panel",
            "aspect-video transition-[border-color,opacity] hover:border-editor-accent/60",
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

          {/* The frames, as one strip moved sideways. Over the poster rather
              than instead of it, so a tile whose strip is still being made
              keeps its picture instead of going blank under the pointer. */}
          {warm && strip && (
            <div
              ref={stripRef}
              aria-hidden="true"
              style={{
                backgroundImage: `url("${strip}")`,
                // The strip is `FILMSTRIP_FRAMES` frames wide, so this sizes one
                // of them to the tile — and a percentage background position
                // then steps between frames exactly, whatever the tile's size.
                backgroundSize: `${String(FILMSTRIP_FRAMES * 100)}% 100%`,
              }}
              className={cn(
                "absolute inset-0 transition-opacity duration-150",
                hovering ? "opacity-100" : "opacity-0",
              )}
            />
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
      {/* No "Opening…" here any more. A click navigates on the spot, so this
          card is gone before it could say so, and the editor route names the
          recording it is fetching instead. */}
      <span className="-mt-1.5 text-[12px] text-editor-muted">
        {formatTimeAgo(project.createdAt)}
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
