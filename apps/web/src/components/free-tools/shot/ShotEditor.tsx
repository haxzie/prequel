"use client";

/**
 * The screenshot editor.
 *
 * Drop a picture in, mark it up, put a ground behind it, copy or download it.
 * Everything happens in the tab: the file is read with `FileReader`, drawn into
 * a canvas, and read back out as a PNG. Nothing is uploaded, for the same
 * structural reason as the recorders — there is no code here that could.
 *
 * The furniture is the recorders': the dark stage, the `dock-theme` bar along
 * the bottom, the `editor-theme` rail down the side. Somebody who has used the
 * screen recorder has used this.
 *
 * Interaction is the part worth reading. Annotations are stored in **image
 * space** (see `lib/free-tools/shot.ts`), the canvas is drawn at a scale that
 * fits the stage, and pointer positions are converted on the way in. Storing
 * screen coordinates would be simpler and would move every arrow the first time
 * the window was resized.
 */

import {
  ArrowUpRight,
  Clipboard,
  Download,
  EyeOff,
  Highlighter,
  ImagePlus,
  MousePointer2,
  Square,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { BACKGROUNDS, findBackground } from "@/lib/free-tools/presets";
import {
  boxFrom,
  buildShotPlan,
  clampItem,
  itemAt,
  moveItem,
  type Item,
  type Point,
  type Shot,
  type Tool,
} from "@/lib/free-tools/shot";

import { DownloadDialog } from "../DownloadDialog";
import { Group, Panel, Slider } from "../controls";
import { paintShot } from "./paint";

/** The pens, in the order the toolbar reads. */
const TOOLS: { tool: Tool; label: string; icon: ReactNode }[] = [
  { tool: "move", label: "Select", icon: <MousePointer2 /> },
  { tool: "arrow", label: "Arrow", icon: <ArrowUpRight /> },
  { tool: "rect", label: "Rectangle", icon: <Square /> },
  { tool: "highlight", label: "Highlighter", icon: <Highlighter /> },
  { tool: "redact", label: "Redact", icon: <EyeOff /> },
  { tool: "text", label: "Text", icon: <Type /> },
];

/**
 * Five colours, and no picker.
 *
 * A screenshot is marked up to point at something, so the only question is
 * which of these reads against what is underneath. A full picker is a decision
 * nobody wants to make while explaining a bug.
 */
const COLOURS = ["#e14b15", "#4296fc", "#30a46c", "#ffffff", "#141518"];

const DEFAULT_SHOT: Shot["look"] = {
  backgroundId: "sunrise",
  padding: 0.06,
  radius: 0.02,
  shadow: 0.5,
};

const BUTTON =
  "grid size-[30px] place-items-center rounded-lg transition-colors disabled:opacity-35 [&_svg]:size-[17px]";
const DIVIDER = "h-[18px] w-px flex-none self-center bg-dock-line";

let counter = 0;
const nextId = () => `item-${(counter += 1)}`;

export function ShotEditor() {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [shot, setShot] = useState<Shot>({
    image: { width: 0, height: 0 },
    look: DEFAULT_SHOT,
    items: [],
  });
  const [tool, setTool] = useState<Tool>("move");
  const [colour, setColour] = useState(COLOURS[0] ?? "#e14b15");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Item | null>(null);
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  // Raised by the download button and by nothing else. The file is already
  // saving when it opens; see the note in `DownloadDialog`.
  const [pitching, setPitching] = useState(false);
  const [error, setError] = useState("");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const textRef = useRef<HTMLInputElement | null>(null);
  /** Where the pointer went down, and what the item looked like then. */
  const gesture = useRef<{ from: Point; item: Item | null } | null>(null);
  /** Output pixels per CSS pixel, kept for converting pointer positions back. */
  const scale = useRef(1);

  /** Load a file, whether it arrived by picker, drop or paste. */
  const open = useCallback((file: File | null | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("That is not an image. PNG, JPEG, WebP and GIF all work.");
      return;
    }

    setError("");
    const url = URL.createObjectURL(file);
    const element = new Image();
    element.onload = () => {
      // The object URL is revoked once the bitmap is decoded: the element holds
      // the pixels from here on, and a URL left behind is a reference the tab
      // keeps until it is closed.
      URL.revokeObjectURL(url);
      setImage(element);
      setShot({
        image: { width: element.naturalWidth, height: element.naturalHeight },
        look: DEFAULT_SHOT,
        items: [],
      });
      setSelected(null);
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      setError("That image would not open. Try exporting it as a PNG.");
    };
    element.src = url;
  }, []);

  /**
   * Paste, from anywhere on the page.
   *
   * The whole point of a screenshot editor: ⌘⇧4 then ⌘V, with no file ever
   * written. Bound to the document rather than to the drop zone, because a
   * paste has no target unless something is focused and nothing here is.
   */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.items ?? [])]
        .find((item) => item.type.startsWith("image/"))
        ?.getAsFile();
      if (file) {
        event.preventDefault();
        open(file);
      }
    };

    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [open]);

  /** Undo and delete, which are the two keys anybody tries. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing =
        event.target instanceof HTMLElement &&
        (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA");
      if (typing) return;

      if ((event.metaKey || event.ctrlKey) && event.key === "z") {
        event.preventDefault();
        setShot((current) => ({ ...current, items: current.items.slice(0, -1) }));
        setSelected(null);
        return;
      }
      if ((event.key === "Backspace" || event.key === "Delete") && selected) {
        event.preventDefault();
        setShot((current) => ({
          ...current,
          items: current.items.filter((item) => item.id !== selected),
        }));
        setSelected(null);
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected]);

  /**
   * Draw, whenever anything changes.
   *
   * No animation loop: nothing here moves on its own, so a frame is painted in
   * response to an edit and not sixty times a second over a still picture.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !image || shot.image.width === 0) return;

    const plan = buildShotPlan(shot);
    const box = boxRef.current;
    const ratio = window.devicePixelRatio || 1;

    // The canvas is sized to what is on screen times the device ratio, never to
    // the output. A 5K screenshot at full size is a 30 megapixel surface
    // repainted on every pointer move; the export gets its own canvas, made
    // once, at the moment it is asked for.
    const room = box
      ? { width: box.clientWidth, height: box.clientHeight }
      : { width: plan.frame.width, height: plan.frame.height };
    const fit = Math.min(
      room.width / plan.frame.width,
      room.height / plan.frame.height,
      // Never blown up past its own pixels: a small screenshot drawn large is a
      // blurry screenshot, and the file would not be.
      1,
    );

    scale.current = fit;
    canvas.width = Math.max(1, Math.round(plan.frame.width * fit * ratio));
    canvas.height = Math.max(1, Math.round(plan.frame.height * fit * ratio));
    canvas.style.width = `${plan.frame.width * fit}px`;
    canvas.style.height = `${plan.frame.height * fit}px`;

    const drawn: Shot = draft ? { ...shot, items: [...shot.items, draft] } : shot;
    paintShot(
      ctx,
      drawn,
      image,
      findBackground(shot.look.backgroundId),
      fit * ratio,
      draft ? null : selected,
    );
  }, [draft, image, selected, shot]);

  /** A repaint on resize, because the fit is measured off the box. */
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(() => setShot((current) => ({ ...current })));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  /** A pointer position, in image space. */
  const locate = (event: React.PointerEvent): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const plan = buildShotPlan(shot);
    return {
      x: (event.clientX - rect.left) / scale.current - plan.picture.x,
      y: (event.clientY - rect.top) / scale.current - plan.picture.y,
    };
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (!image) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const at = locate(event);

    if (tool === "move") {
      const hit = itemAt(shot.items, at, shot.image);
      setSelected(hit?.id ?? null);
      gesture.current = { from: at, item: hit };
      setDragging(true);
      return;
    }

    if (tool === "text") {
      const item: Item = { id: nextId(), kind: "text", at, text: "Text", colour };
      setShot((current) => ({ ...current, items: [...current.items, item] }));
      setSelected(item.id);
      // Back to Select, so the next click moves the label that was just placed
      // rather than dropping a second one on top of it.
      setTool("move");
      // The field in the rail is the only way to type, so it takes the focus
      // with the word selected: a label that has to be found before it can be
      // named is a label most people leave reading "Text".
      requestAnimationFrame(() => {
        textRef.current?.focus();
        textRef.current?.select();
      });
      return;
    }

    gesture.current = { from: at, item: null };
    setDragging(true);
    setSelected(null);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!dragging || !gesture.current) return;
    const at = locate(event);
    const { from, item } = gesture.current;

    if (tool === "move") {
      if (!item) return;
      setShot((current) => ({
        ...current,
        items: current.items.map((candidate) =>
          candidate.id === item.id
            ? clampItem(moveItem(item, at.x - from.x, at.y - from.y), current.image)
            : candidate,
        ),
      }));
      return;
    }

    // The shape being dragged out is a draft rather than an item in the list:
    // an item would be pushed and replaced on every pointer move, and undo
    // would then step back through a hundred intermediate rectangles.
    const id = "draft";
    const box = boxFrom(from, at);
    setDraft(
      tool === "arrow"
        ? { id, kind: "arrow", from, to: at, colour }
        : tool === "rect"
          ? { id, kind: "rect", box, colour }
          : tool === "highlight"
            ? { id, kind: "highlight", box, colour }
            : { id, kind: "redact", box },
    );
  };

  const onPointerUp = () => {
    setDragging(false);

    if (draft) {
      // A text item is never a draft — it is placed on the click rather than
      // dragged out — but the union says it could be, and a `box` read off one
      // would be a type error waiting for the day someone adds a dragged text
      // box. Named rather than cast.
      const big =
        draft.kind === "arrow"
          ? Math.hypot(draft.to.x - draft.from.x, draft.to.y - draft.from.y) > 8
          : draft.kind === "text"
            ? true
            : draft.box.width > 6 && draft.box.height > 6;

      // A click with a pen selected is a click, not a zero sized rectangle.
      if (big) {
        const item = clampItem({ ...draft, id: nextId() }, shot.image);
        setShot((current) => ({ ...current, items: [...current.items, item] }));
      }
      setDraft(null);
    }

    gesture.current = null;
  };

  /** The export, drawn once at full size. */
  const render = useCallback((): HTMLCanvasElement | null => {
    if (!image) return null;

    const plan = buildShotPlan(shot);
    const canvas = document.createElement("canvas");
    canvas.width = plan.frame.width;
    canvas.height = plan.frame.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // No `selected`, so the dashed outline is on screen and never in the file.
    paintShot(ctx, shot, image, findBackground(shot.look.backgroundId), 1);
    return canvas;
  }, [image, shot]);

  const download = () => {
    const canvas = render();
    if (!canvas) return;

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `prequel-screenshot-${Date.now()}.png`;
      link.click();
      URL.revokeObjectURL(url);
      setPitching(true);
    }, "image/png");
  };

  const copy = async () => {
    const canvas = render();
    if (!canvas) return;

    try {
      // The blob has to be handed over inside the `ClipboardItem` as a promise
      // in Safari, which requires the write to happen in the same task as the
      // click. Awaiting the blob first and writing afterwards throws
      // NotAllowedError there, with nothing wrong on Chrome to show for it.
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (blob) => (blob ? resolve(blob) : reject(new Error("no blob"))),
              "image/png",
            ),
          ),
        }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Your browser would not take the image. Download it instead.");
    }
  };

  const setLook = (patch: Partial<Shot["look"]>) =>
    setShot((current) => ({ ...current, look: { ...current.look, ...patch } }));

  const selectedText = shot.items.find((item) => item.id === selected && item.kind === "text") as
    Extract<Item, { kind: "text" }> | undefined;

  return (
    <>
      <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
        <div className="flex min-h-0 flex-col gap-4">
          <div
            className="editor-theme squircle dot-grid relative flex min-h-[32rem] flex-1 overflow-hidden rounded-3xl bg-editor-bg ring-1 ring-black/20"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              open(event.dataTransfer.files[0]);
            }}
          >
            <div
              ref={boxRef}
              className="absolute inset-3 bottom-20 flex items-center justify-center sm:inset-5 sm:bottom-20"
            >
              {image ? (
                <canvas
                  ref={canvasRef}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  className={`touch-none rounded-xl ${tool === "move" ? "cursor-default" : "cursor-crosshair"}`}
                />
              ) : (
                <Invitation onPick={() => fileRef.current?.click()} error={error} />
              )}
            </div>

            {/* The same lane the recorders put their dock in. */}
            <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
              <div className="dock-theme pointer-events-auto flex max-w-full items-center gap-1.5 overflow-x-auto rounded-[10px] bg-dock-bg p-1.5 text-dock-fg shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
                <div className="flex items-center gap-0.5 rounded-lg bg-dock-group p-0.5">
                  {TOOLS.map((entry) => (
                    <button
                      key={entry.tool}
                      type="button"
                      disabled={!image}
                      aria-pressed={tool === entry.tool}
                      title={entry.label}
                      aria-label={entry.label}
                      onClick={() => setTool(entry.tool)}
                      className={`${BUTTON} ${
                        tool === entry.tool
                          ? "bg-dock-selected text-white"
                          : "text-dock-fg/80 not-disabled:hover:bg-dock-hover"
                      }`}
                    >
                      {entry.icon}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1 px-1">
                  {COLOURS.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      disabled={!image}
                      aria-label={`Pen colour ${swatch}`}
                      aria-pressed={colour === swatch}
                      onClick={() => {
                        setColour(swatch);
                        // A colour picked with something selected recolours it,
                        // which is what anybody expects and saves undoing an
                        // arrow to change its colour.
                        if (selected) {
                          setShot((current) => ({
                            ...current,
                            items: current.items.map((item) =>
                              item.id === selected && item.kind !== "redact"
                                ? { ...item, colour: swatch }
                                : item,
                            ),
                          }));
                        }
                      }}
                      className={`size-5 rounded-full ring-offset-2 ring-offset-dock-bg disabled:opacity-35 ${
                        colour === swatch ? "ring-2 ring-white" : "ring-1 ring-white/20"
                      }`}
                      style={{ backgroundColor: swatch }}
                    />
                  ))}
                </div>

                <span className={DIVIDER} />

                <button
                  type="button"
                  disabled={!image || shot.items.length === 0}
                  title="Undo"
                  aria-label="Undo"
                  onClick={() => {
                    setShot((current) => ({ ...current, items: current.items.slice(0, -1) }));
                    setSelected(null);
                  }}
                  className={`${BUTTON} text-dock-fg/80 not-disabled:hover:bg-dock-hover`}
                >
                  <Undo2 />
                </button>
                <button
                  type="button"
                  disabled={!selected}
                  title="Delete"
                  aria-label="Delete the selected mark"
                  onClick={() => {
                    setShot((current) => ({
                      ...current,
                      items: current.items.filter((item) => item.id !== selected),
                    }));
                    setSelected(null);
                  }}
                  className={`${BUTTON} text-dock-fg/80 not-disabled:hover:bg-dock-hover`}
                >
                  <Trash2 />
                </button>

                <span className={DIVIDER} />

                <button
                  type="button"
                  disabled={!image}
                  onClick={() => void copy()}
                  className="flex h-[30px] flex-none items-center gap-2 rounded-full px-3 text-[13px] font-medium text-dock-fg transition-colors hover:bg-dock-hover disabled:opacity-35"
                >
                  <Clipboard className="size-4" />
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  type="button"
                  disabled={!image}
                  onClick={download}
                  className="flex h-[30px] flex-none items-center gap-2 rounded-full bg-white px-3.5 text-[13px] font-medium text-black transition-colors hover:bg-white/90 disabled:opacity-35"
                >
                  <Download className="size-4" />
                  Download
                </button>
              </div>
            </div>
          </div>

          {error && image ? (
            <p
              role="alert"
              className="rounded-xl border border-negative/30 bg-negative/5 px-4 py-3 text-sm text-pretty text-fg"
            >
              {error}
            </p>
          ) : null}
        </div>

        <Panel>
          <Group label="Ground">
            <div className="flex flex-wrap gap-1.5 px-0.5">
              {BACKGROUNDS.map((background) => (
                <button
                  key={background.id}
                  type="button"
                  title={background.label}
                  aria-label={background.label}
                  aria-pressed={shot.look.backgroundId === background.id}
                  onClick={() => setLook({ backgroundId: background.id })}
                  className={`size-7 rounded-full ring-offset-2 ring-offset-editor-panel focus-visible:outline-none ${
                    shot.look.backgroundId === background.id
                      ? "ring-2 ring-selected"
                      : "ring-1 ring-white/15 hover:ring-white/40"
                  }`}
                  style={{
                    // The same stops the canvas paints, as a CSS gradient: one
                    // array read twice, so a swatch cannot advertise a colour the
                    // file does not have.
                    backgroundImage: `linear-gradient(${background.angle}deg, ${background.stops
                      .map(([offset, hex]) => `${hex} ${offset * 100}%`)
                      .join(", ")})`,
                  }}
                />
              ))}
            </div>
            <Slider
              label="Padding"
              read={`${Math.round((shot.look.padding / 0.2) * 100)}%`}
              value={shot.look.padding}
              min={0}
              max={0.2}
              step={0.005}
              onChange={(padding) => setLook({ padding })}
            />
            <Slider
              label="Corner"
              read={`${Math.round((shot.look.radius / 0.08) * 100)}%`}
              value={shot.look.radius}
              min={0}
              max={0.08}
              step={0.002}
              onChange={(radius) => setLook({ radius })}
            />
            <Slider
              label="Shadow"
              read={`${Math.round(shot.look.shadow * 100)}%`}
              value={shot.look.shadow}
              min={0}
              max={1}
              step={0.05}
              onChange={(shadow) => setLook({ shadow })}
            />
          </Group>

          {selectedText ? (
            <Group label="Text">
              <input
                ref={textRef}
                value={selectedText.text}
                onChange={(event) =>
                  setShot((current) => ({
                    ...current,
                    items: current.items.map((item) =>
                      item.id === selectedText.id ? { ...item, text: event.target.value } : item,
                    ),
                  }))
                }
                className="h-7 w-full rounded-full bg-white/5 px-2.5 text-[11px] text-white focus-visible:ring-2 focus-visible:ring-selected/70 focus-visible:outline-none"
              />
            </Group>
          ) : null}

          <Group label="Image">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex h-7 items-center gap-2 rounded-full bg-white/5 px-2.5 text-[11px] text-white transition-colors hover:bg-white/10"
            >
              <ImagePlus className="size-3.5" />
              {image ? "Open another" : "Open an image"}
            </button>
            {image ? (
              <p className="px-1 text-[11px] leading-snug text-editor-muted">
                {shot.image.width} by {shot.image.height}, exported at full size.
              </p>
            ) : null}
          </Group>

          <p className="px-1 text-[11px] leading-relaxed text-editor-muted">
            Edited and saved in this tab. Nothing is uploaded. Saves as PNG.
          </p>
        </Panel>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => open(event.target.files?.[0])}
        />
      </div>

      <DownloadDialog open={pitching} surface="editor" onClose={() => setPitching(false)} />
    </>
  );
}

/** What the stage says before there is a picture. */
function Invitation({ onPick, error }: { onPick: () => void; error: string }) {
  return (
    <div className="flex max-w-md flex-col items-center gap-4 px-4 py-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-white/5 text-editor-muted ring-1 ring-white/10">
        <ImagePlus className="size-7" strokeWidth={1.5} />
      </span>
      <h2 className="text-lg font-medium text-editor-fg">Drop a screenshot in</h2>
      <p className="text-sm leading-relaxed text-pretty text-editor-muted">
        Drag an image anywhere on this panel, paste one with ⌘V, or open a file. It stays in your
        browser.
      </p>
      <button
        type="button"
        onClick={onPick}
        className="mt-2 inline-flex h-11 items-center justify-center gap-2 rounded-full bg-white px-6 text-sm font-medium text-black transition-colors hover:bg-white/90"
      >
        Open an image
      </button>
      {error ? <p className="text-sm text-negative">{error}</p> : null}
    </div>
  );
}
