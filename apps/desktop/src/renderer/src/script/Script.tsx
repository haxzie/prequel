import { useEffect, useRef, useState } from "react";

import type {
  TeleprompterMode,
  TeleprompterSize,
  TeleprompterWidth,
} from "../../../shared/contract";
import { Field } from "../editor/controls/Field";
import { Segmented, Slider, Toggle } from "../editor/controls/inputs";
import { useDock } from "../hooks/useDock";
import { useTeleprompter } from "../hooks/useTeleprompter";

/** How long after the last keystroke the script is sent to main. */
const SAVE_MS = 150;

const MODES: { value: TeleprompterMode; label: string; title: string }[] = [
  { value: "voice", label: "Voice", title: "Follows the words you say" },
  { value: "timed", label: "Auto-scroll", title: "Scrolls at a steady pace" },
  { value: "manual", label: "Manual", title: "Moves only on the keys" },
];

const SIZES: { value: TeleprompterSize; label: string }[] = [
  { value: "small", label: "S" },
  { value: "medium", label: "M" },
  { value: "large", label: "L" },
];

const WIDTHS: { value: TeleprompterWidth; label: string }[] = [
  { value: "narrow", label: "Narrow" },
  { value: "normal", label: "Normal" },
  { value: "wide", label: "Wide" },
];

/**
 * The script window.
 *
 * A textarea and the few choices that shape the island. Autosaved: there is
 * no Save because there is nothing to save *to* — the script is remembered
 * and the island shows it as it is typed, which is also how the size and
 * width choices are judged.
 */
export function Script() {
  const { preferences } = useDock();
  const state = useTeleprompter();
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Seeded from main once, then the textarea is the truth. Re-seeding on every
  // broadcast would put the cursor back at the end mid-sentence, because the
  // broadcast is this window's own keystrokes coming back round.
  useEffect(() => {
    if (text === null) setText(state.script);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.script]);

  const edit = (next: string) => {
    setText(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void window.prequel.teleprompter.setScript(next), SAVE_MS);
  };

  const set = (patch: Parameters<typeof window.prequel.dock.updatePreferences>[0]) =>
    void window.prequel.dock.updatePreferences(patch);

  return (
    <div className="editor-theme flex h-screen min-h-0 flex-col bg-editor-bg text-editor-fg">
      {/* The window is frameless past the traffic lights, so this strip is what
          it is dragged by. */}
      <header className="drag flex h-8 flex-none items-center justify-center text-xs text-editor-muted">
        Teleprompter
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3 px-5 pb-5">
        <textarea
          className={
            "min-h-0 flex-1 resize-none rounded-lg border border-white/10 bg-black/25 p-3 " +
            "text-[15px] leading-relaxed text-editor-fg outline-none placeholder:text-editor-muted " +
            "focus:border-white/25"
          }
          placeholder={"Type or paste what you want to say.\n\nOne thought per line. [Notes in brackets] show dimmed and are never read for."}
          spellCheck
          value={text ?? ""}
          onChange={(event) => edit(event.target.value)}
        />

        <div className="flex flex-col gap-3">
          <Field label="Show in the notch" inline>
            <Toggle
              value={preferences.teleprompter}
              onChange={(enabled) => set({ teleprompter: enabled })}
            />
          </Field>

          <Field label="Moves">
            <Segmented
              value={preferences.teleprompterMode}
              options={MODES}
              onChange={(value) => set({ teleprompterMode: value })}
            />
          </Field>

          {preferences.teleprompterMode === "timed" && (
            <Slider
              value={preferences.teleprompterSpeed}
              min={60}
              max={300}
              step={10}
              icon={<SpeedIcon />}
              label="Speed"
              format={(value) => `${String(Math.round(value))} wpm`}
              onChange={(value) => set({ teleprompterSpeed: value })}
            />
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Text">
              <Segmented
                value={preferences.teleprompterSize}
                options={SIZES}
                onChange={(value) => set({ teleprompterSize: value })}
              />
            </Field>
            <Field label="Width">
              <Segmented
                value={preferences.teleprompterWidth}
                options={WIDTHS}
                onChange={(value) => set({ teleprompterWidth: value })}
              />
            </Field>
          </div>
        </div>
      </main>
    </div>
  );
}

function SpeedIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2 11.5a6 6 0 1 1 12 0M8 11.5 11 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
