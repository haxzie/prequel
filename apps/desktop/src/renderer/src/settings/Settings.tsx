import { useCallback, useEffect, useState } from "react";

import type { AfterRecording, UpdateStatus } from "../../../shared/contract";
import { Field, Section } from "../editor/controls/Field";
import { Segmented, Toggle } from "../editor/controls/inputs";
import { useDock } from "../hooks/useDock";
import { ShortcutField } from "./ShortcutField";
import { useUpdate } from "../update/useUpdate";

/**
 * Everything the app remembers, in one scrolling pane.
 *
 * Reads through `useDock` rather than a settings-specific channel: preferences
 * already ride along in the state main broadcasts to every window, so there is
 * nothing to add and no second copy to keep in step. Writes go the same way the
 * panel's own controls do, through `dock.updatePreferences`.
 *
 * The two exceptions are the two things `preferences.json` does not own — the
 * login item, which belongs to macOS, and the shortcut, whose binding can be
 * refused.
 *
 * One pane rather than the three sidebar items this used to have. Splitting
 * "when a recording stops" from "countdown before recording" across two screens
 * put two halves of one question in two places, and the whole of it fits on
 * about a screen and a half.
 */
export function SettingsPane() {
  const { preferences } = useDock();

  const set = useCallback((patch: Parameters<typeof window.prequel.dock.updatePreferences>[0]) => {
    void window.prequel.dock.updatePreferences(patch);
  }, []);

  return (
    <div className="flex flex-col">
      <General preferences={preferences} set={set} />
      <Recording preferences={preferences} set={set} />
      <Shortcuts accelerator={preferences.toggleShortcut} />
    </div>
  );
}

type PaneProps = {
  preferences: ReturnType<typeof useDock>["preferences"];
  set: (patch: Partial<ReturnType<typeof useDock>["preferences"]>) => void;
};

const AFTER_RECORDING: { value: AfterRecording; label: string }[] = [
  { value: "editor", label: "Open editor" },
  { value: "finder", label: "Reveal file" },
  { value: "nothing", label: "Do nothing" },
];

function General({ preferences, set }: PaneProps) {
  const [openAtLogin, setOpenAtLogin] = useState<boolean | null>(null);
  const { state: update } = useUpdate();

  /**
   * Read from macOS, never from `preferences.json`.
   *
   * Login Items is a System Settings pane the user can change at any time, and
   * a stored copy would disagree with it the moment they did. The tray gets
   * away with reading it when its menu is built; this window stays open, so
   * main pushes a fresh value whenever the window is focused.
   */
  useEffect(() => {
    void window.prequel.loginItem.get().then(setOpenAtLogin);
    return window.prequel.loginItem.onChange(setOpenAtLogin);
  }, []);

  return (
    <Section title="General">
      <Field label="Open Prequel at login" inline>
        <Toggle
          value={openAtLogin ?? false}
          // `null` is main saying there is nothing here to switch: a
          // development build has no app bundle to register, so the switch is
          // shown unavailable rather than accepting a press and quietly
          // springing back, which is what it used to do.
          disabled={openAtLogin === null}
          title={
            openAtLogin === null ? "Only an installed copy of Prequel can open at login" : undefined
          }
          onChange={(enabled) => {
            // Answer with what macOS ended up with, not what was asked: under
            // `pnpm dev` there is no bundle to register and the switch must
            // not claim otherwise.
            void window.prequel.loginItem.set(enabled).then(setOpenAtLogin);
          }}
        />
      </Field>

      <Field label="When a recording stops">
        <Segmented
          value={preferences.afterRecording}
          options={AFTER_RECORDING}
          onChange={(value) => set({ afterRecording: value })}
        />
      </Field>

      {/* The only place in the app that says which version this is. The
          welcome window shows it once and is never seen again. */}
      <Field label={`Version ${update.current}`} inline>
        <button
          type="button"
          className="rounded-md border border-editor-line px-2.5 py-1 text-[11px] text-editor-muted hover:text-editor-fg disabled:opacity-40"
          disabled={update.status === "checking" || update.status === "downloading"}
          onClick={() => {
            // Checked from here, shown over there: the result needs release
            // notes and a progress bar, and this pane is a list of switches.
            void window.prequel.update.check().then((state) => {
              if (state.status !== "idle") void window.prequel.update.open();
            });
          }}
        >
          {updateLabel(update.status)}
        </button>
      </Field>
    </Section>
  );
}

/** What the button in General says, given where the check has got to. */
function updateLabel(status: UpdateStatus): string {
  switch (status) {
    case "checking":
      return "Checking…";
    case "available":
      return "Update available";
    case "downloading":
      return "Downloading…";
    case "ready":
      return "Restart to update";
    default:
      return "Check for Updates";
  }
}

function Recording({ preferences, set }: PaneProps) {
  return (
    <>
      <Section title="Recording">
        <Field label="Countdown before recording">
          <Segmented
            value={String(preferences.countdown)}
            options={[
              { value: "0", label: "Off" },
              { value: "3", label: "3s" },
              { value: "5", label: "5s" },
              { value: "10", label: "10s" },
            ]}
            onChange={(value) => set({ countdown: Number(value) })}
          />
        </Field>
      </Section>

      <Section title="Audio">
        <Field label="Record system audio" inline>
          <Toggle
            value={preferences.systemAudio}
            onChange={(systemAudio) => set({ systemAudio })}
          />
        </Field>
      </Section>

      <Section title="Cursor">
        <Field label="Bake the pointer into the recording" inline>
          <Toggle value={preferences.bakeCursor} onChange={(bakeCursor) => set({ bakeCursor })} />
        </Field>
        <p className="text-[11px] leading-relaxed text-editor-muted">
          Off means the pointer is sampled during capture and drawn by the editor instead, which is
          what makes it possible to hide, resize or zoom to it afterwards. Baking it in cannot be
          undone.
        </p>
      </Section>
    </>
  );
}

function Shortcuts({ accelerator }: { accelerator: string }) {
  return (
    <Section title="Shortcuts">
      {/* Not `Field inline`: the control grows a second row when it is
          explaining a refusal, and `inline` centres the label against it. */}
      <div className="flex items-start justify-between gap-4">
        <span className="pt-1.5 text-[11px] text-editor-muted">Start and stop recording</span>
        <ShortcutField
          accelerator={accelerator}
          onChange={async (chord) => {
            const result = await window.prequel.settings.setShortcut(chord);
            return result.ok ? { ok: true } : { ok: false, message: result.message };
          }}
        />
      </div>
      <p className="text-[11px] leading-relaxed text-editor-muted">
        Works while any application is focused. One key does both jobs: it begins a recording, and
        stops the one already running.
      </p>
    </Section>
  );
}
