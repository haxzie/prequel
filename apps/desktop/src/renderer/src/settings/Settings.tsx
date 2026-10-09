import { useCallback, useEffect, useState, type ReactNode } from "react";

import type { AfterRecording, UpdateStatus } from "../../../shared/contract";
import { TELEPROMPTER_SHORTCUTS } from "../../../shared/contract";
import { systemHotkeyFor } from "../../../shared/system-hotkeys";
import { Field, Section } from "../editor/controls/Field";
import { cn } from "../lib/cn";
import { PaneHeader } from "../workspace/PaneHeader";
import { AppIcon, GeneralIcon, PermissionsIcon, RecordingIcon, ShortcutsIcon } from "./icons";
import { PermissionList } from "../components/PermissionList";
import { usePermissions } from "../hooks/usePermissions";
import { Segmented, Toggle } from "../editor/controls/inputs";
import { useDock } from "../hooks/useDock";
import { Keycaps } from "./Keycaps";
import { ShortcutField } from "./ShortcutField";
import { useUpdate } from "../update/useUpdate";

/**
 * Everything the app remembers, behind a sidebar of its own.
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
 * This was one scrolling pane, and before that three items in the window's own
 * sidebar. The three failed for a reason worth not repeating: "when a recording
 * stops" sat under General and "countdown before recording" under Recording, so
 * two halves of one question — what happens either side of a take — were two
 * screens apart. The grouping below is drawn around that, not around which
 * `Section` a control happened to live in: everything about making a recording
 * is on one screen, and the split is only there because permissions, shortcuts
 * and the rest had grown past what one scroll can be read as.
 */
export function SettingsPane() {
  const { preferences } = useDock();
  // Local, not a preference. `exportsView` and `projectsView` are stored because
  // they change what a user's own library looks like; which settings group was
  // last open is scaffolding, and a flat leaf in `preferences.json` for it would
  // be a setting about the settings window.
  const [group, setGroup] = useState<GroupId>("recording");

  const set = useCallback((patch: Parameters<typeof window.prequel.dock.updatePreferences>[0]) => {
    void window.prequel.dock.updatePreferences(patch);
  }, []);

  return (
    <>
      <PaneHeader icon={<GeneralIcon />} title="Settings" />

      <div className="flex min-h-0 flex-1">
        {/* Subordinate to the window's own sidebar, and drawn to say so: a
            glyph a size down at 3.5, a 12px label against its 13, and a
            selected row at 8% where that one uses 15%. Two navigations at the
            same weight read as two of the same thing, and the eye has no way
            to tell which of them it is in.

            Not `drag`: the sidebar beside it reaches the title bar and moves
            the window, this one begins under a header and would swallow a
            press meant for a row. */}
        <nav className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-white/8 p-2">
          {GROUPS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setGroup(item.id)}
              aria-current={group === item.id ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors",
                // The glyph inherits the row's colour, so a selected item's
                // icon brightens with its label rather than staying muted
                // against it — the same rule the sidebar beside it follows.
                "[&_svg]:size-3.5 [&_svg]:shrink-0",
                group === item.id
                  ? "bg-white/8 text-editor-fg"
                  : "text-editor-fg/60 hover:bg-white/5 hover:text-editor-fg",
              )}
            >
              <item.Icon />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            {/* The same measure the single pane had: `Section` was drawn for
                the editor's 24rem rail, and given a whole window it stretches a
                segmented control to arm's length.

                Centred in the space beside the sidebar, as it was centred in
                the window before there was one. */}
            <div className="mx-auto max-w-md">
              {group === "general" ? (
                <General preferences={preferences} set={set} />
              ) : group === "recording" ? (
                <Recording preferences={preferences} set={set} />
              ) : group === "shortcuts" ? (
                <Shortcuts accelerator={preferences.toggleShortcut} />
              ) : (
                <PermissionsSection />
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

type GroupId = "recording" | "shortcuts" | "permissions" | "general";

/**
 * The groups, in the order they are read.
 *
 * Recording first and selected by default: it is what somebody opening this
 * window came for. General last, because on this platform it holds what is left
 * over rather than what matters most.
 */
const GROUPS: { id: GroupId; label: string; Icon: () => ReactNode }[] = [
  { id: "recording", label: "Recording", Icon: RecordingIcon },
  { id: "shortcuts", label: "Shortcuts", Icon: ShortcutsIcon },
  { id: "permissions", label: "Permissions", Icon: PermissionsIcon },
  { id: "general", label: "General", Icon: AppIcon },
];

/**
 * What macOS has and has not allowed, and a way to fix it.
 *
 * The same four rows the first run shows, from the same module, because this is
 * where somebody arrives when a recording came out empty weeks later — and a
 * list here that disagreed with the one they said yes to on day one would be
 * worse than no list at all.
 *
 * Polled by `usePermissions` and re-read when the window takes focus, which is
 * the moment a trip to System Settings ends. Screen Recording and Accessibility
 * are read from a value macOS fixes at launch, so a row that still says no
 * after a grant offers the restart that makes it take effect.
 */
function PermissionsSection() {
  const permissions = usePermissions();

  return (
    <Section title="Permissions">
      <PermissionList permissions={permissions} />
    </Section>
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
    <>
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
              openAtLogin === null
                ? "Only an installed copy of Prequel can open at login"
                : undefined
            }
            onChange={(enabled) => {
              // Answer with what macOS ended up with, not what was asked: under
              // `pnpm dev` there is no bundle to register and the switch must
              // not claim otherwise.
              void window.prequel.loginItem.set(enabled).then(setOpenAtLogin);
            }}
          />
        </Field>
      </Section>

      <Version />
    </>
  );
}

/**
 * Which version this is, and the way to a newer one.
 *
 * The only place in the app that says so: the welcome window shows it once and
 * is never seen again, and the tray menu has it behind a right-click nobody
 * makes to read a number.
 *
 * It was a footer under the single scrolling pane, where it could sit below
 * everything because there was only one everything. Under General now, which is
 * where this platform keeps a version and a software update, and where somebody
 * looking for one goes. A heading over one line would read as a category with
 * one thing in it, so the row is given the section's title rather than its own.
 */
function Version() {
  const { state: update } = useUpdate();

  return (
    <Section title="Updates">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-editor-muted">Version {update.current}</span>

        <button
          type="button"
          className="rounded-md border border-editor-line px-2.5 py-1 text-[11px] text-editor-muted hover:text-editor-fg disabled:opacity-40"
          disabled={update.status === "checking" || update.status === "downloading"}
          onClick={() => {
            // Checked from here, shown over there: the result needs release notes
            // and a progress bar, and this pane is a list of switches.
            void window.prequel.update.check().then((state) => {
              if (state.status !== "idle") void window.prequel.update.open();
            });
          }}
        >
          {updateLabel(update.status)}
        </button>
      </div>
    </Section>
  );
}

/** What the button on that line says, given where the check has got to. */
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

        {/* Beside the countdown, not under General where it used to sit. The
            two are one question asked twice — what happens before a take, and
            what happens after it — and the previous sidebar put them on
            separate screens. */}
        <Field label="When a recording stops">
          <Segmented
            value={preferences.afterRecording}
            options={AFTER_RECORDING}
            onChange={(value) => set({ afterRecording: value })}
          />
        </Field>
      </Section>

      <Section title="Keyboard">
        <Field label="Note when keys are pressed" inline>
          <Toggle
            value={preferences.captureKeys}
            onChange={(captureKeys) => set({ captureKeys })}
          />
        </Field>
        <p className="text-[11px] leading-relaxed text-editor-muted">
          Each press is kept as a moment and whether it was a letter, the space bar, Return, Delete
          or a modifier — never which letter. This is what the editor's typing sounds are made from.
          Off keeps only the rough stretches of typing the pointer hides behind. Passwords are never
          seen either way: macOS keeps them from every app while you type one.
        </p>
      </Section>
    </>
  );
}

function Shortcuts({ accelerator }: { accelerator: string }) {
  // The default, ⇧⌘5, is one macOS keeps for itself, and Prequel switches the
  // system's off to hold it. That is a Mac-wide setting changed on someone's
  // behalf, so it is said out loud here — along with the way back, which is
  // simply choosing another chord.
  const taken = systemHotkeyFor(accelerator);

  return (
    <Section title="Shortcuts" id="shortcuts">
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

      {taken ? (
        <p className="text-[11px] leading-relaxed text-editor-muted">
          macOS gives <Keycaps accelerator={taken.chord} muted /> to {taken.owner}. Prequel has it
          instead. Choose another shortcut, or quit Prequel, and macOS takes it back.
        </p>
      ) : null}

      {/* Read-only: these are taken from the app in front only while the
          island is showing, and a chord that moves a prompter is not one
          anybody rebinds. Listed so they can be found at all — the island's
          footer has room for a hint, not a table. */}
      <div className="mt-2 flex flex-col gap-2">
        <span className="text-[11px] text-editor-muted">While the teleprompter is showing</span>
        {PROMPTER_KEYS.map(({ chord, label }) => (
          <div key={chord} className="flex items-center justify-between gap-4">
            <span className="text-[11px] text-editor-muted">{label}</span>
            <Keycaps accelerator={chord} />
          </div>
        ))}
      </div>
    </Section>
  );
}

const PROMPTER_KEYS: { chord: string; label: string }[] = [
  { chord: TELEPROMPTER_SHORTCUTS.previous, label: "Back a sentence" },
  { chord: TELEPROMPTER_SHORTCUTS.next, label: "On a sentence" },
  { chord: TELEPROMPTER_SHORTCUTS.pause, label: "Pause and resume" },
  { chord: TELEPROMPTER_SHORTCUTS.top, label: "Back to the top" },
];
