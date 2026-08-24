import { useCallback, useEffect, useState } from "react";

import type { AfterRecording } from "../../../shared/contract";
import { Field, Section } from "../editor/controls/Field";
import { Segmented, Toggle } from "../editor/controls/inputs";
import { Avatar } from "../components/Avatar";
import { useAuth } from "../hooks/useAuth";
import { useDock } from "../hooks/useDock";
import { cn } from "../lib/cn";
import { AccountIcon, GeneralIcon, RecordingIcon, ShortcutsIcon } from "./icons";
import { ShortcutField } from "./ShortcutField";

const SECTIONS = [
  { id: "general", label: "General", Icon: GeneralIcon },
  { id: "recording", label: "Recording", Icon: RecordingIcon },
  { id: "shortcuts", label: "Shortcuts", Icon: ShortcutsIcon },
  { id: "account", label: "Account", Icon: AccountIcon },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

/**
 * Everything the app remembers, in one place.
 *
 * Reads through `useDock` rather than a settings-specific channel: preferences
 * already ride along in the state main broadcasts to every window, so there is
 * nothing to add and no second copy to keep in step. Writes go the same way the
 * panel's own controls do, through `dock.updatePreferences`.
 *
 * The two exceptions are the two things `preferences.json` does not own — the
 * login item, which belongs to macOS, and the shortcut, whose binding can be
 * refused.
 */
export function Settings() {
  const [section, setSection] = useState<SectionId>("general");
  const { preferences } = useDock();

  const set = useCallback((patch: Parameters<typeof window.prequel.dock.updatePreferences>[0]) => {
    void window.prequel.dock.updatePreferences(patch);
  }, []);

  return (
    <div className="editor-theme flex h-dvh min-h-0 bg-editor-bg text-editor-fg">
      <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-editor-line p-3 pt-10">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSection(item.id)}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-[13px] transition-colors",
              // The glyph inherits the row's colour, so the selected item's
              // icon brightens with its label rather than staying muted
              // against it.
              "[&_svg]:size-4 [&_svg]:shrink-0",
              section === item.id
                ? "bg-white/8 text-editor-fg"
                : "text-editor-muted hover:bg-white/4 hover:text-editor-fg",
            )}
          >
            <item.Icon />
            {item.label}
          </button>
        ))}
      </nav>

      {/* `Section` was drawn for the editor's 24rem rail. Given a whole
          window it stretches a segmented control to arm's length, so the
          panes get a measure of their own. */}
      <main className="min-w-0 flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-md">
          {section === "general" ? <General preferences={preferences} set={set} /> : null}
          {section === "recording" ? <Recording preferences={preferences} set={set} /> : null}
          {section === "shortcuts" ? <Shortcuts accelerator={preferences.toggleShortcut} /> : null}
          {section === "account" ? <Account /> : null}
        </div>
      </main>
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
    <div className="flex flex-col">
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

        <Field label="When a recording stops">
          <Segmented
            value={preferences.afterRecording}
            options={AFTER_RECORDING}
            onChange={(value) => set({ afterRecording: value })}
          />
        </Field>
      </Section>
    </div>
  );
}

function Recording({ preferences, set }: PaneProps) {
  return (
    <div className="flex flex-col">
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
    </div>
  );
}

function Shortcuts({ accelerator }: { accelerator: string }) {
  return (
    <div className="flex flex-col">
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
    </div>
  );
}

/**
 * Reserved for plans and billing.
 *
 * Deliberately empty of anything that looks like an account. Nothing is for
 * sale yet, so a plan name, a renewal date or a manage-billing button would all
 * be invented — and a fabricated account screen is worse than an honest gap.
 */
/**
 * The account, and the device this Mac is signed in on.
 *
 * Signing in happens in the browser — see `main/auth.ts` for why there is no
 * form here — so this pane is mostly a report on what happened elsewhere.
 */
function Account() {
  const auth = useAuth();

  if (auth.status !== "signed-in") {
    const waiting = auth.status === "waiting";

    return (
      <div className="flex flex-col">
        <Section title="Account">
          <p className="text-[13px] leading-relaxed text-editor-muted">
            Sign in to share recordings with your team. A link works for anyone you send it to —
            they need no account of their own.
          </p>
          <button
            type="button"
            disabled={waiting}
            onClick={() => void window.prequel.auth.signIn()}
            className="mt-4 self-start rounded-lg bg-selected px-3 py-1.5 text-[12px] font-medium text-white hover:brightness-110 disabled:cursor-default disabled:opacity-70"
          >
            {waiting ? "Waiting for your browser…" : "Sign in"}
          </button>
          {waiting && (
            <p className="mt-2 text-[11px] text-editor-muted">
              Finish in the browser and come back — this updates by itself.
            </p>
          )}
        </Section>
      </div>
    );
  }

  const { account } = auth;

  return (
    <div className="flex flex-col">
      <Section title="Account">
        <div className="flex items-center gap-3">
          <Avatar seed={account.email} size={36} />
          <div className="min-w-0">
            <p className="truncate text-[13px] text-editor-fg">{account.name || account.email}</p>
            <p className="truncate text-[12px] text-editor-muted">{account.email}</p>
          </div>
        </div>
      </Section>

      <Section title="Team">
        <p className="text-[13px] leading-relaxed text-editor-muted">
          {account.teamName
            ? `Recordings you share go to ${account.teamName}.`
            : "You are not in a team yet. Create one on the web to start sharing."}
        </p>
        <div className="mt-4 flex items-center gap-4">
          <button
            type="button"
            onClick={() => void window.prequel.auth.openDashboard()}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-medium text-editor-fg hover:bg-white/15"
          >
            Open library
          </button>
          <button
            type="button"
            onClick={() => void window.prequel.auth.signOut()}
            className="text-[12px] text-editor-muted hover:text-editor-fg"
          >
            Sign out
          </button>
        </div>
      </Section>

      <Section title="Billing">
        {/* Deliberately carries no price. `apps/web/src/lib/pricing.ts` is the
            one file that holds one, and the desktop app may not import across
            that boundary — so a figure here would be a second copy to keep in
            step, and the one nobody would remember to update. */}
        <p className="text-[13px] leading-relaxed text-editor-muted">
          Your plan, invoices and seats live in your account on the web.
        </p>
      </Section>
    </div>
  );
}
