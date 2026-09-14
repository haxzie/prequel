"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";

import { Button } from "@/components/Button";

/** The edge of the square that is sent. The API keeps this size and no larger. */
export const AVATAR_EDGE = 256;

/** What the crop is drawn at on screen. */
const STAGE = 288;

/**
 * Picks a square out of a picture, and hands back its bytes at 256×256.
 *
 * Done here rather than on the server, and not only to save the upload: a
 * Worker has no image library, and shipping a phone's four-megabyte photo to
 * one to be turned down to twenty kilobytes is the wrong way round. The canvas
 * that draws the preview is the one that exports, so what is sent is exactly
 * what was seen.
 *
 * Drag moves the picture under a fixed circle; the slider scales it. The
 * picture can never leave the circle short — the offsets are clamped — so
 * there is no way to send a square with a blank corner.
 *
 * WebP where the browser can write it, JPEG where it cannot. Safari's canvas
 * answers a WebP request with a PNG, which at this size is ten times the
 * bytes; the type of the blob says which happened, so the fallback is taken
 * from the answer rather than from the user agent.
 */
export function CropDialog({
  file,
  pending,
  error,
  onCrop,
  onCancel,
}: {
  /** The picture to crop, or null for closed. */
  file: File | null;
  pending: boolean;
  error: string | null;
  onCrop: (blob: Blob) => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  /** 1 fills the circle with the picture's shorter edge; larger zooms in. */
  const [zoom, setZoom] = useState(1);
  /** The picture's centre, as a fraction of its own size, 0.5 being the middle. */
  const [centre, setCentre] = useState({ x: 0.5, y: 0.5 });
  const drag = useRef<{ x: number; y: number; centre: { x: number; y: number } } | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (file && !element.open) element.showModal();
    if (!file && element.open) element.close();
  }, [file]);

  // Decoded once per file. `createImageBitmap` would be lighter, but an
  // `<img>` is what `drawImage` takes on every browser this runs in, and the
  // object URL is revoked as soon as the decode has happened.
  useEffect(() => {
    if (!file) {
      setImage(null);
      return;
    }
    setZoom(1);
    setCentre({ x: 0.5, y: 0.5 });

    const url = URL.createObjectURL(file);
    const element = new Image();
    element.onload = () => {
      URL.revokeObjectURL(url);
      setImage(element);
    };
    element.onerror = () => URL.revokeObjectURL(url);
    element.src = url;
  }, [file]);

  /** Where the picture sits on a square of `edge` pixels, for the current zoom and centre. */
  const placement = (edge: number) => {
    if (!image) return null;
    const shorter = Math.min(image.naturalWidth, image.naturalHeight);
    const scale = (edge / shorter) * zoom;
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    // The centre the user chose, clamped so the picture always covers the square.
    const x = clamp(edge / 2 - centre.x * width, edge - width, 0);
    const y = clamp(edge / 2 - centre.y * height, edge - height, 0);
    return { x, y, width, height };
  };

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    const placed = placement(STAGE);
    if (!element || !context || !image || !placed) return;
    context.clearRect(0, 0, STAGE, STAGE);
    context.drawImage(image, placed.x, placed.y, placed.width, placed.height);
  });

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, centre };
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const from = drag.current;
    const placed = placement(STAGE);
    if (!from || !placed) return;
    // A pixel of drag is a pixel of picture, whatever the zoom.
    setCentre({
      x: clamp(from.centre.x - (event.clientX - from.x) / placed.width, 0, 1),
      y: clamp(from.centre.y - (event.clientY - from.y) / placed.height, 0, 1),
    });
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  const crop = () => {
    const placed = placement(AVATAR_EDGE);
    if (!image || !placed) return;

    const out = document.createElement("canvas");
    out.width = AVATAR_EDGE;
    out.height = AVATAR_EDGE;
    const context = out.getContext("2d")!;
    context.drawImage(image, placed.x, placed.y, placed.width, placed.height);

    out.toBlob(
      (webp) => {
        if (webp && webp.type === "image/webp") return onCrop(webp);
        out.toBlob((jpeg) => jpeg && onCrop(jpeg), "image/jpeg", 0.86);
      },
      "image/webp",
      0.86,
    );
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="crop-title"
      className="m-auto w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-line bg-elevated p-6 text-fg shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
      onClick={(event) => {
        if (event.target === dialog.current && !pending) onCancel();
      }}
    >
      <h2 id="crop-title" className="text-base font-medium tracking-tight">
        Crop your picture
      </h2>
      <p className="mt-1 text-sm text-muted">Drag to move it, and use the slider to zoom.</p>

      <div className="relative mx-auto mt-5 size-72 overflow-hidden rounded-xl bg-surface">
        <canvas
          ref={canvas}
          width={STAGE}
          height={STAGE}
          className="block size-72 cursor-grab touch-none active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        {/* The circle, as a hole in a dimmed square: what is outside it is
            still sent — the crop is square — but it is what the round avatar
            will not show, and dimming it says so. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_999px_rgb(0_0_0/0.45)]"
        />
      </div>

      <input
        type="range"
        min={1}
        max={3}
        step={0.01}
        value={zoom}
        aria-label="Zoom"
        className="mt-5 block w-full accent-fg"
        onChange={(event) => setZoom(Number(event.target.value))}
      />

      {error ? (
        <p className="mt-4 text-sm text-brand-from" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={pending || !image}
          onClick={crop}
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </dialog>
  );
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
