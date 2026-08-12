import { useState } from "react";

import {
  AUTO_PRESET_ID,
  evenSize,
  FRAME_PRESETS,
  presetForSize,
  type FramePreset,
} from "../../../shared/presets";
import type { Size } from "../../../shared/layout";
import { cn } from "../lib/cn";

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
    <div className="relative flex flex-none items-center gap-3 border-b border-editor-line px-4 py-2">
      <span className="text-[11px] tracking-wide text-editor-muted uppercase">Frame</span>

      <button
        type="button"
        className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <AspectGlyph width={frame.width} height={frame.height} />
        {label}
        <span className="tabular-nums text-editor-muted">
          {frame.width} × {frame.height}
        </span>
      </button>

      <div className="flex items-center gap-1.5 text-xs">
        <SizeField
          label="Width"
          value={frame.width}
          onChange={(width) => onChange({ ...frame, width, presetId: null })}
        />
        <span className="text-editor-muted">×</span>
        <SizeField
          label="Height"
          value={frame.height}
          onChange={(height) => onChange({ ...frame, height, presetId: null })}
        />
      </div>

      {open && (
        <>
          {/* Click-away, behind the menu and over everything else. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <ul
            className={
              "absolute top-full left-4 z-20 mt-1 max-h-80 w-64 overflow-y-auto rounded-xl " +
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
                  {FRAME_PRESETS.filter((candidate) => candidate.group === group).map(
                    (candidate) => (
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
                    ),
                  )}
                </ul>
              </li>
            ))}
          </ul>
        </>
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
      className="w-16 rounded-md bg-white/5 px-2 py-1 text-center tabular-nums outline-none focus:bg-white/10"
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
