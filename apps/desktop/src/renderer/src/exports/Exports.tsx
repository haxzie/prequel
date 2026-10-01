import { useCallback, useEffect, useState } from "react";

import type { LibraryView, ExportSummary } from "../../../shared/contract";
import { cn } from "../lib/cn";
import { formatElapsed, formatFileSize, formatTimeAgo } from "../lib/format";
import { CheckIcon, CopyIcon, ExportIcon, FolderIcon } from "../editor/icons";
import { useDock } from "../hooks/useDock";
import { PaneHeader } from "../workspace/PaneHeader";
import { ViewToggle } from "../workspace/ViewToggle";
import { useExportThumbnails } from "./useExportThumbnails";

/**
 * Every video this Mac has exported.
 *
 * The one place a finished export can be found again. Until this existed the
 * only record of one was the dialog that wrote it: close that and the file was
 * wherever the save sheet had been pointed weeks ago, under a name that says
 * the date and nothing about what is in it.
 *
 * So a picture of each, and the three things that tell two of them apart — what
 * it is called, when it was made, how big it is. A row rather than a tile by
 * default, which is the opposite of the Projects grid and deliberately so: a
 * recording is identified by what is on the screen, and an export is identified
 * by which recording it came from and which attempt it was. The grid is there
 * for anybody who disagrees, and the choice is remembered.
 *
 * Nothing here opens the editor. These are files, and everything the pane does
 * hands one to the rest of the Mac — opened in a player, revealed in Finder,
 * copied, or dragged out.
 */
export function Exports() {
  const { preferences } = useDock();
  const view = preferences.exportsView;

  const [exports, setExports] = useState<ExportSummary[] | null>(null);

  const list = useCallback(async () => {
    const result = await window.prequel.exports.list();
    // An empty pane rather than none at all: main has logged whatever went
    // wrong, and a screen that never resolves says nothing to the user.
    setExports(result.ok ? result.value : []);
  }, []);

  useEffect(() => void list(), [list]);

  // An export finishing anywhere adds a row here. The dialog that wrote it is
  // in the editor, which is this same window on another route — but the pane
  // survives the trip back, and a list that needed a relaunch to show this
  // morning's export would be the first thing anybody noticed about it.
  useEffect(
    () =>
      window.prequel.editor.export.onProgress((progress) => {
        if (progress.stage === "done") void list();
      }),
    [list],
  );

  const thumbnails = useExportThumbnails(exports ?? []);

  const setView = useCallback((next: LibraryView) => {
    void window.prequel.dock.updatePreferences({ exportsView: next });
  }, []);

  return (
    <>
      <PaneHeader icon={<ExportIcon />} title="Exports">
        {exports !== null && exports.length > 0 && (
          <span className="text-[12px] text-editor-muted">
            {exports.length} {exports.length === 1 ? "video" : "videos"}
          </span>
        )}
        <ViewToggle view={view} onChange={setView} />
      </PaneHeader>

      {exports === null ? (
        // Skeletons rather than a blank, for the reason the grid has them: the
        // listing is a `stat` per file and most of them are on an SSD, but one
        // on a drive that has spun down is not.
        <Skeletons view={view} />
      ) : exports.length === 0 ? (
        <Empty />
      ) : (
        <div className={cn("min-h-0 flex-1 overflow-y-auto", view === "grid" && "p-5")}>
          {/* The column heads, and only for the table. Sticky rather than
              above the scroller: the pane scrolls as one, and a head that
              scrolled away would leave three unlabelled columns. */}
          {view === "list" && (
            <div
              className={cn(
                COLUMNS,
                // Sticky, so scrolling a long list never leaves four
                // unlabelled columns. Opaque, or the rows would show through
                // it as they pass underneath.
                "sticky top-0 z-10 border-b border-white/7 bg-editor-scrim",
                "h-8 text-[11px] font-medium text-editor-muted",
              )}
            >
              <span>Name</span>
              <span>Folder</span>
              <span className="text-right">Length</span>
              <span>Exported</span>
              <span className="text-right">Size</span>
              <span />
            </div>
          )}

          <div
            className={cn(
              view === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4" : "",
            )}
          >
            {exports.map((entry) => (
              <Row
                key={entry.path}
                entry={entry}
                view={view}
                thumbnail={entry.thumbnail ?? thumbnails.get(entry.path) ?? null}
              />
            ))}
            {/* The bottom row's rule would otherwise sit on the edge of the
                pane, which reads as the list having been cut off. */}
            {view === "list" && <div className="h-4" />}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The table's columns, stated once.
 *
 * Shared between the head and every row, and that is the whole reason it is a
 * constant: two grids with the columns written out separately drift the moment
 * one of them is adjusted, and a head half a column off its values is worse
 * than no head at all.
 *
 * The last column is empty in both. It is the room the two hover actions sit
 * in — they cannot be inside the row's button, so they are positioned over a
 * space the row reserves, and without it they would cover the size.
 */
const COLUMNS =
  "grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_72px_120px_80px_64px] items-center gap-4 px-4";

/**
 * One export, as a row or as a tile.
 *
 * The same component for both, because the two differ only in where the
 * picture sits: the picture, the name, the age, the size, the drag and the two
 * actions are identical, and splitting them into two components is how the
 * grid comes to be missing whatever the list gained last.
 *
 * `draggable` is on the wrapper rather than the button, so the drag is picked
 * up anywhere on the row — including the name, which is what a Finder row
 * would drag by.
 */
function Row({
  entry,
  view,
  thumbnail,
}: {
  entry: ExportSummary;
  view: LibraryView;
  thumbnail: string | null;
}) {
  const [copied, setCopied] = useState(false);

  const grid = view === "grid";

  return (
    <div
      className={cn(
        "group relative",
        grid ? "flex flex-col gap-2" : "border-b border-white/4 last:border-b-0",
      )}
      draggable
      onDragStart={(event) => {
        // The browser's own drag has to be called off before Electron's can
        // take over: left to run, it offers the page's HTML to the drop target
        // and the file never leaves the app.
        event.preventDefault();
        window.prequel.exports.drag(entry.path);
      }}
    >
      {/* One button for the whole row, with the actions over it rather than
          inside it: a button nested in a button is invalid, and the browser
          resolves it by dropping one of the two. */}
      <button
        type="button"
        onClick={() => void window.prequel.exports.open(entry.path)}
        title={`Open ${entry.name}`}
        className={cn(
          "w-full text-left transition-colors",
          grid
            ? // The same blue the Recordings grid lights a tile with under the
              // pointer. Two panes of tiles in one window that answered "this
              // one" differently would be two panes nobody reads as a pair.
              "block overflow-hidden rounded-xl border border-editor-line bg-editor-panel aspect-video hover:border-indicator hover:ring-2 hover:ring-indicator/35"
            : // Full-bleed and unrounded: the hover has to fill the row
              // between two rules, and a rounded inset highlight inside a ruled
              // row reads as a card that has been dropped into a table.
              cn(COLUMNS, "h-11 hover:bg-white/6"),
        )}
      >
        {grid ? (
          <Thumbnail entry={entry} thumbnail={thumbnail} className="size-full" />
        ) : (
          <>
            {/* `min-w-0` or a long name refuses to truncate and pushes the
                other columns off their heads: a grid item's floor is its
                content width until it is told otherwise. */}
            {/* `min-w-0` on every cell that can overflow, or a long value
                refuses to truncate and pushes the columns off their heads: a
                grid item's floor is its content width until it is told
                otherwise. */}
            <span className="flex min-w-0 items-center gap-2.5">
              <Thumbnail
                entry={entry}
                thumbnail={thumbnail}
                // Small, and sized to the row rather than the other way
                // round. A tall picture would set the row height and turn
                // four columns back into a stack of cards.
                className="h-7 w-12 shrink-0 overflow-hidden rounded-sm border border-white/7 bg-editor-panel"
              />
              <span className="truncate text-[13px]">{entry.name}</span>
            </span>
            <span className="min-w-0 truncate text-[12px] text-editor-muted">{entry.folder}</span>
            {/* A dash, not `0:00`, for an export written before lengths were
                kept: "not known" and "instant" are the same number, and one of
                the two is a lie about a video that plays for a minute. */}
            <span className="text-right text-[12px] text-editor-muted tabular-nums">
              {entry.durationMs === null ? "—" : formatElapsed(entry.durationMs)}
            </span>
            <span className="truncate text-[12px] text-editor-muted">
              {formatTimeAgo(entry.createdAt)}
            </span>
            {/* Right-aligned and tabular, so the megabytes line up on the
                decimal point rather than on the first digit. */}
            <span className="text-right text-[12px] text-editor-muted tabular-nums">
              {formatFileSize(entry.bytes)}
            </span>
            <span />
          </>
        )}
      </button>

      {grid && (
        <>
          <span className="truncate text-[13px] font-medium" title={entry.name}>
            {entry.name}
          </span>
          <span className="-mt-1.5">
            <Meta entry={entry} />
          </span>
        </>
      )}

      {/* Revealed on hover, and on focus so they can be reached from the
          keyboard at all — `opacity-0` alone leaves a control that is tabbable
          and invisible. */}
      <div
        className={cn(
          "pointer-events-none absolute flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100",
          grid ? "top-2 right-2" : "top-1/2 right-4 -translate-y-1/2",
        )}
      >
        <Action
          label={`Show ${entry.name} in Finder`}
          onClick={() => void window.prequel.library.reveal(entry.path)}
        >
          <FolderIcon />
        </Action>
        <Action
          label={copied ? "Copied" : `Copy ${entry.name}`}
          onClick={async () => {
            // The file itself and not its path — `export.copy` writes the
            // pasteboard type Finder writes on Copy, so this pastes into Slack
            // as a video rather than as a line of text naming one.
            const done = await window.prequel.editor.export.copy(entry.path);
            setCopied(done.ok);
            window.setTimeout(() => setCopied(false), 1600);
          }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Action>
      </div>
    </div>
  );
}

/**
 * The picture, or the space it will take.
 *
 * A GIF is shown through its own cached still rather than as itself: an
 * animated GIF in every row of a list is as many decode loops as there are
 * rows, running for as long as the pane is open.
 */
function Thumbnail({
  entry,
  thumbnail,
  className,
}: {
  entry: ExportSummary;
  thumbnail: string | null;
  className?: string;
}) {
  return (
    <span className={cn("block", className)}>
      {thumbnail ? (
        // `cover`, so a pane of exports at different aspect ratios reads as one
        // list rather than as a column of differently-shaped pictures.
        <img src={thumbnail} alt="" className="size-full object-cover" />
      ) : (
        // Held open at the same size, so a still arriving does not reflow
        // everything below it.
        <span className="grid size-full place-items-center text-editor-muted/40 [&_svg]:size-5">
          <ExportIcon />
        </span>
      )}
      <span className="sr-only">{entry.name}</span>
    </span>
  );
}

/**
 * The age and the size on one line, for a tile.
 *
 * Only the grid uses this. The table gives each of the two a column of its
 * own, which is the whole point of the table — values under a head, lining up
 * down the pane, rather than a sentence to be read per row.
 */
function Meta({ entry }: { entry: ExportSummary }) {
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-editor-muted">
      <span>{formatTimeAgo(entry.createdAt)}</span>
      {entry.durationMs !== null && (
        <>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{formatElapsed(entry.durationMs)}</span>
        </>
      )}
      <span aria-hidden>·</span>
      <span className="tabular-nums">{formatFileSize(entry.bytes)}</span>
    </span>
  );
}

function Action({
  label,
  onClick,
  children,
}: {
  label: string;
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
        // the row underneath.
        "pointer-events-auto grid size-7 place-items-center rounded-full bg-editor-bg/80 text-editor-fg backdrop-blur",
        "[&_svg]:size-3.5 hover:bg-editor-panel",
      )}
    >
      {children}
    </button>
  );
}

/** The shape of what is coming, so the first listing lands in place. */
function Skeletons({ view }: { view: LibraryView }) {
  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto", view === "grid" ? "p-5" : "pt-8")}>
      <div
        className={cn(
          view === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4" : "",
        )}
        aria-hidden
      >
        {Array.from({ length: 6 }, (_, index) =>
          view === "grid" ? (
            <div key={index} className="flex flex-col gap-2">
              <div className="aspect-video animate-pulse rounded-xl border border-editor-line bg-editor-panel" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-editor-panel" />
              <div className="h-2.5 w-1/3 animate-pulse rounded bg-editor-panel" />
            </div>
          ) : (
            // The same columns the real rows use, so the head above them does
            // not shift sideways when the listing lands.
            <div key={index} className={cn(COLUMNS, "h-11 border-b border-white/4")}>
              <span className="flex items-center gap-2.5">
                <span className="h-7 w-12 shrink-0 animate-pulse rounded-sm bg-editor-panel" />
                <span className="h-3 w-1/2 animate-pulse rounded bg-editor-panel" />
              </span>
              <span className="h-2.5 w-2/3 animate-pulse rounded bg-editor-panel" />
              <span className="h-2.5 w-full animate-pulse rounded bg-editor-panel" />
              <span className="h-2.5 w-full animate-pulse rounded bg-editor-panel" />
              <span className="h-2.5 w-full animate-pulse rounded bg-editor-panel" />
              <span />
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function Empty() {
  return (
    <div className="grid flex-1 place-items-center px-8 text-center">
      <div className="max-w-xs">
        <p className="text-[13px] font-medium">No exports yet</p>
        <p className="mt-1 text-[12px] text-editor-muted">
          Every video you export shows up here, wherever you saved it. Open a recording and press
          Export to make one.
        </p>
      </div>
    </div>
  );
}
