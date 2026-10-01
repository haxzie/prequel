import { useEffect, useRef, useState } from "react";

import {
  AUTO_PRESET_ID,
  evenSize,
  FRAME_PRESETS,
  presetForSize,
  type FramePreset,
} from "../../../shared/presets";
import type { Size } from "../../../shared/layout";
import { cn } from "../lib/cn";
import { FLOATING } from "./surfaces";

export interface Frame {
  width: number;
  height: number;
  presetId: string | null;
}

/**
 * Output size, above the preview.
 *
 * The video is composited *into* this frame, so changing it is not a zoom —
 * it changes what is in shot. Every setting underneath is a fraction of the
 * frame's shorter edge, which is what lets a look survive the switch from
 * landscape to vertical.
 */
export function FrameBar({
  frame,
  recorded,
  onChange,
}: {
  frame: Frame;
  /** The screen track's own size, which `Automatic` follows. */
  recorded: Size | null;
  onChange: (frame: Frame) => void;
}) {
  const [open, setOpen] = useState(false);
  const bar = useRef<HTMLDivElement>(null);

  /**
   * Closes the list on a press anywhere else, and on Escape.
   *
   * A listener on the document rather than the full-screen click-away `<div>`
   * this used to have, and the reason is worth keeping: that element was
   * `position: fixed`, and the bar it lives in grew a `backdrop-filter` when it
   * was given a surface of its own. A backdrop filter makes its element a
   * containing block for fixed descendants — the same rule `filter` and
   * `transform` follow — so `inset-0` stopped meaning the viewport and started
   * meaning the pill. The overlay was still there, still catching clicks, and
   * covered nothing but the control that opened it.
   *
   * Nothing above it in the tree can break a document listener the same way.
   *
   * `pointerdown` rather than `click`, so the list is gone by the time a drag
   * that started outside it finishes.
   */
  useEffect(() => {
    if (!open) return;

    const away = (event: Event) => {
      if (!bar.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const auto = frame.presetId === AUTO_PRESET_ID;
  const preset = FRAME_PRESETS.find((candidate) => candidate.id === frame.presetId);
  // Several presets share dimensions — YouTube and X are both 1920×1080 — so a
  // size alone cannot say which was chosen. Only used to label a custom size
  // that happens to match one.
  const label = auto
    ? "Automatic"
    : (preset?.label ?? presetForSize(frame.width, frame.height)?.label ?? "Custom");

  const choose = (next: FramePreset) => {
    onChange({ width: next.width, height: next.height, presetId: next.id });
    setOpen(false);
  };

  const chooseAuto = () => {
    onChange({
      width: recorded ? evenSize(recorded.width) : frame.width,
      height: recorded ? evenSize(recorded.height) : frame.height,
      presetId: AUTO_PRESET_ID,
    });
    setOpen(false);
  };

  return (
    // A surface of its own, the same one the dock and the inspector are made
    // of. It had none for a long time, on the argument that it sits on the same
    // ground the composition does so the eye goes to the frame rather than to a
    // bar above it — which was right while it *was* a bar above it, taking a row
    // of its own at the top of the column.
    //
    // It floats on the board now, over light the recording itself is casting,
    // and a row of bare controls out there is the one group in the window with
    // nothing holding it together. Pill-shaped like the dock rather than
    // rounded like the panel: both of those are a line of controls, and the
    // panel is a page of them.
    //
    // Still centred, and for the original reason — the controls belong to the
    // thing in the middle, not to the left edge of the window.
    <div
      className={cn(
        "relative flex flex-none items-center justify-center gap-3 rounded-full px-4 py-1.5",
        FLOATING,
      )}
      data-panel="frame-bar"
      ref={bar}
    >
      {/* White, not `--editor-muted`. That tone was chosen against the opaque
          strip this used to be a row in; the bar floats on the board now, and
          over a surface lit by the recording's own colours a muted grey is the
          one thing on the bar you have to look twice at. The same goes for the
          numbers beside it — every one of these is a reading, and a reading
          that is hard to read is not one. */}
      <span className="text-[11px] tracking-wide text-editor-fg uppercase">Frame</span>

      <button
        type="button"
        // Fully round, like everything else that floats on the board. A
        // rounded rectangle lighting up under the pointer beside a row of
        // pills reads as a different kind of control.
        className="flex items-center gap-2 rounded-full px-3 py-1.5 text-xs hover:bg-white/10"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <AspectGlyph width={frame.width} height={frame.height} />
        {label}
        <span className="tabular-nums text-editor-fg">
          {frame.width} × {frame.height}
        </span>
      </button>

      <div className="flex items-center gap-1.5 text-xs">
        <SizeField
          label="Width"
          value={frame.width}
          onChange={(width) => onChange({ ...frame, width, presetId: null })}
        />
        <span className="text-editor-fg">×</span>
        <SizeField
          label="Height"
          value={frame.height}
          onChange={(height) => onChange({ ...frame, height, presetId: null })}
        />
      </div>

      {open && (
        <ul
          className={
            // Anchored to the trigger now that the bar is centred, rather
            // than to the window's left edge. Downwards again: the bar is
            // back at the head of the board, where the whole height of it is
            // below the list's anchor.
            "absolute top-full left-1/2 z-20 mt-1 max-h-80 w-64 -translate-x-1/2 overflow-y-auto rounded-xl " +
            "border border-editor-line bg-editor-panel p-1 shadow-[0_8px_28px_rgba(0,0,0,0.5)]"
          }
          role="listbox"
        >
          {/* First, and outside the groups: it is not a size, it is the
                absence of choosing one. */}
          <li>
            <button
              type="button"
              role="option"
              aria-selected={auto}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-white/10",
                auto && "text-editor-accent",
              )}
              onClick={chooseAuto}
            >
              <AspectGlyph
                width={recorded?.width ?? frame.width}
                height={recorded?.height ?? frame.height}
              />
              <span className="flex-1">Automatic</span>
              <span className="tabular-nums text-editor-muted">
                {recorded ? `${evenSize(recorded.width)} × ${evenSize(recorded.height)}` : "—"}
              </span>
            </button>
          </li>

          {(["General", "Social"] as const).map((group) => (
            <li key={group}>
              <p className="px-2 pt-2 pb-1 text-[10px] tracking-wide text-editor-muted uppercase">
                {group}
              </p>
              <ul>
                {FRAME_PRESETS.filter((candidate) => candidate.group === group).map((candidate) => (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={candidate.id === frame.presetId}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-white/10",
                        candidate.id === frame.presetId && "text-editor-accent",
                      )}
                      onClick={() => choose(candidate)}
                    >
                      <AspectGlyph width={candidate.width} height={candidate.height} />
                      <span className="flex-1">{candidate.label}</span>
                      <span className="tabular-nums text-editor-muted">
                        {candidate.width} × {candidate.height}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SizeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      aria-label={label}
      className="w-16 rounded-full bg-transparent px-2 py-1 text-center tabular-nums outline-none hover:bg-white/5 focus:bg-white/10"
      value={draft ?? String(value)}
      // Held as text while being typed: committing on every keystroke would
      // clamp "10" to the minimum before "1080" could be finished.
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== null) onChange(evenSize(Number(draft) || value));
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") setDraft(null);
      }}
    />
  );
}

/** A rectangle of the frame's proportions, at a glance. */
function AspectGlyph({ width, height }: { width: number; height: number }) {
  const scale = 14 / Math.max(width, height);

  return (
    <span className="grid size-4 flex-none place-items-center" aria-hidden="true">
      <span
        className="rounded-[2px] border border-current"
        style={{ width: width * scale, height: height * scale }}
      />
    </span>
  );
}
