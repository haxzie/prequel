/**
 * One saved look, as a card.
 *
 * A preview, with its name under it and what it is *of* on the right of that.
 * Two of these fit the panel across, which is what makes a preview big enough to
 * tell one look from another — the whole reason a preset has a picture rather
 * than only a name.
 *
 * The two glyphs earn their place because the preview is small: a camera bubble
 * tucked into the corner of a 160-pixel thumbnail reads as part of the
 * wallpaper, so a look that arranges a camera and one that hides it can be hard
 * to tell apart at a glance. What is drawn comes from `picturesIn`, which asks
 * `layoutBoxes` rather than reading the arrangement a second time here.
 *
 * The preview is a fixed rectangle with the picture *contained* inside it rather
 * than cropped to fill. A look's whole point is the frame it lives in, and
 * applying one changes yours: letterboxed, a 9:16 preset is visibly a tall strip
 * in a wide box, which is the only warning of that anyone gets at a glance. A
 * cover-crop would have kept the grid tidy by lying about the shape, and sizing
 * the box to each preset's own ratio would leave the names in a row sitting at
 * different heights.
 *
 * A card is a `div` holding two buttons rather than one button holding another:
 * applying the look and opening its menu are two things to press, and a button
 * inside a button is neither valid nor clickable in the way it looks.
 */
import { useEffect, useRef, useState } from "react";

import { scenePresetUrl } from "../../../../shared/media-url";
import { picturesIn, type ScenePreset } from "../../../../shared/scene-presets";
import { CameraIcon, EllipsisIcon, PencilIcon, ScreenIcon, TrashIcon } from "../icons";
import { cn } from "../../lib/cn";
import { Spinner } from "./BackgroundSwatch";

export function ScenePresetCard({
  preset,
  busy,
  onApply,
  onRename,
  onDelete,
}: {
  preset: ScenePreset;
  /** This look's wallpaper is being fetched right now. */
  busy: boolean;
  onApply: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  // Always on this disk: every look is one the user saved. Nothing to fetch and
  // nothing to stand in for it while it arrives.
  const preview = scenePresetUrl(preset.id);
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(preset.name);
  const field = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (renaming) field.current?.select();
  }, [renaming]);

  const shows = picturesIn(preset);

  const commit = () => {
    const trimmed = name.trim();
    // Declined rather than saved blank, the way renaming a recording is: an
    // unnamed look in a list of looks is one nobody can pick out.
    if (trimmed !== "" && trimmed !== preset.name) onRename(trimmed);
    setRenaming(false);
  };

  return (
    <div className="group relative flex flex-col gap-1">
      <button
        type="button"
        title={preset.name}
        aria-label={preset.name}
        aria-busy={busy}
        className="flex w-full flex-col gap-1 text-left"
        onClick={onApply}
      >
        <span className="relative block aspect-video w-full overflow-hidden rounded-md border border-editor-line bg-black/25 group-hover:border-white/25">
          <span
            aria-hidden
            className="absolute inset-0 bg-contain bg-center bg-no-repeat"
            style={{ backgroundImage: `url("${preview}")` }}
          />

          {busy && (
            <span aria-hidden className="absolute inset-0 grid place-items-center bg-black/45">
              <Spinner />
            </span>
          )}
        </span>

        {/* Inset a little from the preview above it. Flush with the picture's
            edge, a name reads as part of the frame rather than as a caption
            under it — and the icons sat hard against the right rule. */}
        <span className="flex w-full items-center gap-1.5 px-1">
          {renaming ? (
            // Held open by its own focus rather than by the menu, so clicking
            // anywhere else commits it — which is what renaming a file does.
            <input
              ref={field}
              value={name}
              maxLength={40}
              className="min-w-0 flex-1 rounded-sm bg-white/10 px-1 text-[11px] outline-none"
              onChange={(event) => setName(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setName(preset.name);
                  setRenaming(false);
                }
              }}
            />
          ) : (
            <span className="min-w-0 flex-1 truncate text-[11px] text-editor-muted group-hover:text-editor-fg">
              {preset.name}
            </span>
          )}

          {/* What the look is *of*, which the picture alone does not always say —
              a preview is small, and a bubble tucked into a corner of one reads
              as part of the wallpaper. Both icons where the arrangement holds
              both, one where it holds one. */}
          <span
            className="flex flex-none items-center gap-1 text-editor-muted [&_svg]:size-3"
            aria-hidden
          >
            {shows.screen && <ScreenIcon />}
            {shows.camera && <CameraIcon />}
          </span>
        </span>
      </button>

      {/* Inside the thumbnail's top corner, and only once the pointer is on
            the card — a row of these each showing a button would be a grid of
            controls rather than a grid of pictures. Kept up while its own menu
            is open, or pressing it would take away the thing just pressed, and
            on keyboard focus, or it could not be reached without a mouse. */}
      <button
        type="button"
        title="More…"
        aria-label={`More options for ${preset.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full",
          "bg-black/55 text-white/90 backdrop-blur-sm transition-opacity hover:bg-black/75",
          "focus-visible:opacity-100 [&_svg]:size-3.5",
          open ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
        onClick={() => setOpen((was) => !was)}
      >
        <EllipsisIcon />
      </button>

      {open && (
        <>
          {/* Click-away, behind the menu and over everything else — the
                same shape the frame bar's menu uses. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <ul
            role="menu"
            className={
              "absolute top-8 right-1.5 z-20 w-32 rounded-lg border border-editor-line " +
              "bg-editor-panel p-1 shadow-[0_8px_28px_rgba(0,0,0,0.5)]"
            }
          >
            <li>
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-white/10 [&_svg]:size-3.5"
                onClick={() => {
                  setOpen(false);
                  setName(preset.name);
                  setRenaming(true);
                }}
              >
                <PencilIcon />
                Rename
              </button>
            </li>
            <li>
              <button
                type="button"
                role="menuitem"
                // Muted until reached for, then red — the same treatment
                // the panel header's delete gets, rather than a row that
                // sits shouting in an open menu.
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-cut/20 hover:text-cut [&_svg]:size-3.5"
                onClick={() => {
                  setOpen(false);
                  onDelete();
                }}
              >
                <TrashIcon />
                Delete
              </button>
            </li>
          </ul>
        </>
      )}
    </div>
  );
}
