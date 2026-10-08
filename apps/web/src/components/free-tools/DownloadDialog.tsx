"use client";

/**
 * What a visitor sees the moment their file is saving.
 *
 * The one place on these pages where the app is put in front of somebody who has
 * just finished using the free version of it, and the only moment they have
 * proof that it works: they have a file. So the pitch is the difference between
 * what they just did and what the Mac app would have done, and nothing else.
 *
 * The file is already saving by the time this opens. Nothing here gates a
 * download, and the dialog is dismissed with Escape, the backdrop, or the button
 * that says so. A tool that holds a file hostage for an install is the pattern
 * this is deliberately not.
 *
 * A native `<dialog>`, opened with `showModal`. That brings the focus trap, the
 * Escape key, the inert background and the top layer with it, all of which would
 * otherwise be a few hundred lines of our own and worse.
 */

import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import { DownloadCta } from "@/components/DownloadButton";
import { ASSETS } from "@/lib/assets";
import { TRIAL_DAYS } from "@/lib/pricing";

const TAKE = `${ASSETS}/editor-take.mp4`;
const POSTER = `${ASSETS}/editor-take-poster.jpg`;
const CAMERA = `${ASSETS}/camera-take.mp4`;
const BACKDROP = `${ASSETS}/editor-backdrop.jpg`;

/**
 * The pitch. One, for every tool.
 *
 * It was three, written for the page the visitor came from. They came out
 * because of what a modal actually gets read: the title, and then either the
 * button or the close. A line tuned to the tool is a line nobody reaches, and
 * three of them is three places for the product's one claim to drift.
 *
 * The claim is the positioning rather than a ranking. "The Mac screen recorder
 * that edits for you" is a statement about what Prequel is for, and the body
 * under it is the evidence: five things that are done by the time the editor
 * opens. A superlative would say less and would be the one line on the site
 * that somebody could ask us to prove.
 */
const TITLE = "The Mac screen recorder that edits for you";

const BODY =
  "Record, and the editor opens with the zooms already placed, your camera framed and a background behind it. Export one MP4 at up to 4K, rendered on your own Mac.";

/**
 * What just happened, in the small line above the title.
 *
 * The dialog opens on a click that saved a file, so something has to say so or
 * it reads as an advert that fired at random. It is an eyebrow rather than the
 * heading because the heading is the only line most people read, and "Your file
 * is saving" is not worth spending it on.
 */
const EYEBROW = "Your file is saving";

export function DownloadDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): ReactNode {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const take = useRef<HTMLVideoElement | null>(null);
  const camera = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;

    if (open && !element.open) {
      element.showModal();
      // Both files are `preload="none"`, so nothing is fetched until a dialog is
      // actually opened. Most visitors of these pages never see this, and a
      // megabyte and a half of footage pulled on every page view to cover the
      // ones who do is the trade the home page already refuses to make.
      void take.current?.play().catch(() => {});
      void camera.current?.play().catch(() => {});
    }
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      // The backdrop click. A `<dialog>` reports a click on its own box for the
      // whole top layer, including the backdrop, so the test is whether the
      // pointer landed outside the panel's rectangle rather than on which
      // element it hit.
      onClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        const outside =
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom;
        if (outside) onClose();
      }}
      // `m-auto` is load-bearing. A modal `<dialog>` is centred by the user
      // agent's own `margin: auto`, and Tailwind's preflight zeroes the margin
      // on every element — so without this the panel sits in the top left
      // corner of the viewport, which looks like a layout bug rather than a
      // dialog. `max-h` and the scroll are for a short window: a dialog taller
      // than the viewport is otherwise clipped at both ends with no way to
      // reach the button.
      className="squircle m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-3xl border border-line bg-bg p-0 text-fg shadow-[0_30px_80px_-20px_rgb(20_21_24_/_0.45)] backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      {/* The header: the editor's composition, playing, over the same wallpaper
          the home page floats it on. A still would do most of this job; the
          thing it could not show is that the camera is a separate track sitting
          on top, which is the whole argument the picture is making. */}
      <div
        className="relative aspect-[16/8] w-full overflow-hidden bg-cover bg-center"
        style={{ backgroundImage: `url(${BACKDROP})` }}
      >
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="relative w-full max-w-[22rem]">
            <video
              ref={take}
              src={TAKE}
              poster={POSTER}
              muted
              loop
              playsInline
              preload="none"
              className="w-full rounded-lg shadow-[0_10px_30px_-12px_rgb(0_0_0_/_0.7)]"
            />
            <video
              ref={camera}
              src={CAMERA}
              muted
              loop
              playsInline
              preload="none"
              // A circle rather than the app's superellipse: at 56px the two are
              // a pixel apart, and `corner-shape` is Chrome-only. The home page's
              // bubble is four times this size, which is where the difference
              // starts to show.
              className="absolute right-2 bottom-2 size-14 rounded-full object-cover ring-2 ring-white/20"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 grid size-8 place-items-center rounded-full bg-black/40 text-white/80 transition-colors hover:bg-black/60 hover:text-white"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="px-7 py-7 text-center">
        <p className="mb-3 font-mono text-xs tracking-[0.18em] text-muted uppercase">{EYEBROW}</p>
        <h2 className="text-2xl font-medium tracking-tight text-balance sm:text-[1.75rem]">
          {TITLE}
        </h2>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-pretty text-muted">
          {BODY}
        </p>

        <DownloadCta className="mt-6" />

        <p className="mt-5 text-xs text-muted">
          Free for {TRIAL_DAYS} days. No watermark on anything you export.
        </p>

        {/* Named for what it does rather than "No thanks". The file is already
            on its way down, and a button that reads as declining it is the one
            misunderstanding this dialog can cause. */}
        <button
          type="button"
          onClick={onClose}
          className="mt-4 text-xs text-muted underline-offset-4 hover:text-fg hover:underline"
        >
          Back to the tool
        </button>
      </div>
    </dialog>
  );
}
