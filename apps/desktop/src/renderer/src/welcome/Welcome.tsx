import { useEffect, useState, type ReactNode } from "react";

import type { AppInfo, PermissionId } from "../../../shared/contract";
import { assetUrl, permissionIconUrl } from "../../../shared/media-url";
import { cn } from "../lib/cn";
import { CheckIcon, CommandIcon, ShiftIcon } from "../editor/icons";
import { Avatar } from "../components/Avatar";
import { Wash } from "../components/Wash";
import { useAuth } from "../hooks/useAuth";
import { usePermissions, type Permissions } from "../hooks/usePermissions";

/**
 * What the app opens on when it cannot yet do its job.
 *
 * Three steps, and the middle one is the reason the other two exist: macOS will
 * not let Prequel record anything until it has been told to, and a recorder
 * that silently produces nothing is the worst possible first run. Welcome and
 * All set are there so the permissions are asked for in a place that has
 * explained itself first.
 *
 * See `main/windows/welcome.ts` for when it opens, and `main/permissions.ts`
 * for why two of the four cannot be granted from a prompt.
 */

/** One thing to ask for, and why anyone should say yes. */
const PERMISSIONS: {
  id: PermissionId;
  label: string;
  /** One line. Two wrap at this width, and a wrapped row reads as a warning. */
  detail: string;
  /**
   * Whether macOS decides this one once per process.
   *
   * Screen Recording and Accessibility are both read from a value the system
   * fixes at launch — `AXIsProcessTrusted` caches for the life of the process
   * exactly as the screen check does. An approval given in System Settings
   * while Prequel is running therefore never reaches the running copy, and the
   * row goes on saying no however many times it is re-read. Camera and
   * microphone come back from a prompt and take effect at once, so offering
   * them a restart would be telling the user to fix something that is not
   * broken.
   */
  needsRestart: boolean;
}[] = [
  {
    id: "screen",
    label: "Screen Recording",
    detail: "Everything Prequel records comes through it.",
    needsRestart: true,
  },
  {
    id: "accessibility",
    label: "Accessibility",
    detail: "Lets the automatic zooms find your clicks and typing.",
    needsRestart: true,
  },
  {
    id: "camera",
    label: "Camera",
    detail: "For the webcam bubble, only when you turn it on.",
    needsRestart: false,
  },
  {
    id: "microphone",
    label: "Microphone",
    detail: "For your voice, only when you turn it on.",
    needsRestart: false,
  },
];

/**
 * Four, since signing in became one of them.
 *
 * Sign-in sits between permissions and the finish, and is skippable. The
 * permissions block recording and an account does not — gating the app somebody
 * has just installed behind a browser round trip would be the wrong trade for a
 * recorder that works perfectly well without one.
 */
const STEPS = 4;

/** The steps, by name, so `startAt` cannot drift from the order below. */
const STEP = { intro: 0, permissions: 1, signIn: 2, ready: 3 } as const;

export function Welcome({ startAt = "intro" }: { startAt?: "intro" | "permissions" } = {}) {
  // A returning user with a permission missing lands on the step that is the
  // reason the window opened. The dots still go back, so nothing is unreachable
  // — see `Dots`, which allows every step at or before the current one.
  const [step, setStep] = useState<number>(STEP[startAt]);
  const permissions = usePermissions();
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    void window.prequel.getAppInfo().then(setInfo);
  }, []);

  const last = step === STEPS - 1;

  return (
    // `min-h-0 flex-1` rather than `h-full`: this is a flex child of `#root`,
    // and an item that cannot shrink below its content pushes the footer out of
    // a window this size.
    <div className="editor-theme relative flex min-h-0 flex-1 flex-col overflow-hidden bg-editor-bg text-editor-fg">
      <Wash />

      {/* Room for the inset traffic lights, and the only place the window can
          be picked up — there is no title bar. */}
      <header className="drag relative z-10 h-8 flex-none" />

      <main className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto px-12">
        {step === 0 && <WelcomeStep name={info?.name ?? "Prequel"} version={info?.version} />}
        {step === 1 && <PermissionsStep permissions={permissions} />}
        {step === 2 && <SignInStep />}
        {step === 3 && <ReadyStep permissions={permissions} />}
      </main>

      {/* Dots left, button right: the reading order of the footer is "where am
          I" then "what happens next", which is the order they are in. */}
      <footer className="relative z-10 flex flex-none items-center gap-4 px-12 pt-4 pb-9">
        <Dots step={step} onStep={setStep} />
        <div className="flex-1" />

        {/* Only on the sign-in step, and only while nobody is signed in. Once
            there is an account the primary button says Continue and a Skip
            beside it would be offering to undo something already done. */}
        {step === 2 && (
          <button
            type="button"
            className="text-xs text-editor-muted hover:text-editor-fg"
            onClick={() => setStep((current) => current + 1)}
          >
            Skip for now
          </button>
        )}

        {/* White, with the window's own near-black on it. The only solid white
            in the window, so it is unmistakably the thing to press — and the
            one place a colour would have to compete with the wash behind it. */}
        <button
          type="button"
          className="rounded-lg bg-white px-4 py-2 text-xs font-medium text-editor-bg hover:bg-white/90"
          onClick={() => {
            if (last) void window.prequel.welcome.done();
            else setStep((current) => current + 1);
          }}
        >
          {last ? "Start recording" : "Continue"}
        </button>
      </footer>
    </div>
  );
}

/**
 * Where you are, and a way back.
 *
 * Only backwards: a dot for a step you have not reached would let the flow be
 * skipped past the one screen it exists for. Going back is free, so those dots
 * are buttons rather than decoration.
 */
function Dots({ step, onStep }: { step: number; onStep: (step: number) => void }) {
  return (
    <div className="flex items-center gap-2" role="tablist" aria-label="Steps">
      {Array.from({ length: STEPS }, (_, index) => {
        const name = `Step ${String(index + 1)} of ${String(STEPS)}`;

        return (
          <button
            key={index}
            type="button"
            role="tab"
            aria-selected={index === step}
            aria-label={name}
            // A dot carries no writing, so hovering one is the only way to find
            // out which step it is before committing to going back to it.
            title={name}
            disabled={index > step}
            className={cn(
              "size-2 rounded-full transition-colors",
              index === step ? "bg-editor-fg" : "bg-white/20",
              index < step && "hover:bg-white/40",
              index > step && "cursor-default",
            )}
            onClick={() => onStep(index)}
          />
        );
      })}
    </div>
  );
}

function WelcomeStep({ name, version }: { name: string; version?: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 py-6 text-center">
      {/* The app's own icon, at a radius well past macOS's own squircle. The
          artwork is a full-bleed square, so a gentle radius reads as a
          screenshot of an icon rather than as the icon itself.

          Served over `prequel-media://` like every other shipped asset: the
          renderer never gets a filesystem path, and the source in `build/` is
          not packaged — `resources/app-icon.png` is the copy that ships. */}
      <img
        src={assetUrl("app-icon.png")}
        alt=""
        width={72}
        height={72}
        className="size-[72px] rounded-[22px] shadow-lg ring-1 ring-white/10"
      />
      <h1 className="text-3xl font-semibold tracking-tight">Welcome to {name}</h1>
      <p className="max-w-sm text-sm leading-relaxed text-editor-muted">
        Cinematic screen recordings, straight from your Mac. Press record — {name} takes care of how
        it looks.
      </p>
      {version && <p className="pt-2 text-[11px] text-editor-muted">Version {version}</p>}
    </div>
  );
}

function PermissionsStep({ permissions }: { permissions: Permissions }) {
  return (
    <div className="flex flex-col gap-4 py-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">A few permissions</h1>
        <p className="max-w-lg text-sm text-editor-muted">
          macOS asks for each of these separately. Grant them one at a time — Prequel never uses the
          camera or microphone unless you turn them on for a recording.
        </p>
      </div>

      <ul className="flex flex-col gap-1.5">
        {PERMISSIONS.map((permission) => (
          <PermissionRow
            key={permission.id}
            permission={permission}
            granted={permissions.granted(permission.id)}
            onGrant={() => void permissions.request(permission.id)}
          />
        ))}
      </ul>
    </div>
  );
}

function PermissionRow({
  permission,
  granted,
  onGrant,
}: {
  permission: (typeof PERMISSIONS)[number];
  granted: boolean;
  onGrant: () => void;
}) {
  return (
    // Translucent rather than the panel's solid surface, so the wash at the top
    // of the window carries through the rows instead of stopping dead at the
    // first one.
    <li className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3">
      {/* macOS's own icon for the pane this permission is granted in, so the
          row and the System Settings window it sends you to show the same
          picture — the artwork is the instruction for what to look for once you
          are there, which a glyph of our own cannot be.

          No tinted square behind it any more. These carry their own rounded
          square and their own colour, and a second one around them read as an
          icon inside a button. The grant state is the right-hand side of the
          row, where it can be a word rather than a hue. */}
      <img
        src={permissionIconUrl(permission.id)}
        alt=""
        width={32}
        height={32}
        className="mt-0.5 size-8 flex-none"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-xs font-medium">{permission.label}</p>
        <p className="text-[11px] leading-relaxed text-editor-muted">{permission.detail}</p>

        {/* Only where it can actually be the problem, and only while it is one.
            See `needsRestart` above: for these two, an approval given while
            Prequel is running does not reach the running copy, so the row stays
            red and the app looks broken. Without this the user has granted the
            permission, can see that they have granted it, and is told they have
            not — with nothing on screen to do about it. */}
        {!granted && permission.needsRestart && (
          <p className="pt-1 text-[11px] text-editor-muted">
            Already allowed it in System Settings?{" "}
            <button
              type="button"
              className="text-editor-fg underline underline-offset-2 hover:text-selected"
              onClick={() => void window.prequel.welcome.relaunch()}
            >
              Restart Prequel
            </button>
          </p>
        )}
      </div>

      {granted ? (
        <span className="flex flex-none items-center gap-1.5 self-center text-[11px] text-export [&_svg]:size-3.5">
          <CheckIcon />
          Allowed
        </span>
      ) : (
        // One button per row. Allow already ends at System Settings for the
        // two macOS will not grant from a prompt — `requestPermission` opens
        // the pane itself once the prompt has been spent — so a second control
        // beside it offered a choice that was never really a choice.
        <button
          type="button"
          className="flex-none self-center rounded-lg bg-white/10 px-2.5 py-1.5 text-[11px] font-medium hover:bg-white/15"
          onClick={onGrant}
        >
          Allow
        </button>
      )}
    </li>
  );
}

/**
 * Signing in, offered once rather than insisted on.
 *
 * Everything up to here has been about permissions, which the app genuinely
 * cannot work without. This one is not like that: recording, editing and
 * exporting all work signed out, and the only thing an account adds is a link
 * other people can open. So it is presented as what it buys, and skipping it
 * costs nothing.
 */
function SignInStep() {
  const auth = useAuth();
  const signedIn = auth.status === "signed-in";

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-4 py-6">
      <h1 className="text-3xl font-semibold tracking-tight">
        {signedIn ? "You're signed in" : "Share what you record"}
      </h1>

      <p className="max-w-md text-sm leading-relaxed text-editor-muted">
        {signedIn ? (
          <>
            Exports can go straight to{" "}
            <span className="text-editor-fg">{auth.account.teamName ?? "your team"}</span> and come
            back as a link. Anyone you send it to can watch it — no account needed on their side.
          </>
        ) : (
          <>
            With an account, a finished export uploads to your team and gives you back a link.
            Everything else — recording, the editor, exporting to a file — works without one.
          </>
        )}
      </p>

      {signedIn ? (
        <div className="mt-2 flex items-center gap-3">
          <Avatar seed={auth.account.email} size={36} />
          <div className="min-w-0">
            <p className="truncate text-sm">{auth.account.name || auth.account.email}</p>
            <p className="truncate text-xs text-editor-muted">{auth.account.email}</p>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-col items-start gap-2">
          <button
            type="button"
            disabled={auth.status === "waiting"}
            onClick={() => void window.prequel.auth.signIn()}
            className="rounded-lg bg-selected px-4 py-2 text-xs font-medium text-white hover:brightness-110 disabled:cursor-default disabled:opacity-70"
          >
            {auth.status === "waiting" ? "Waiting for your browser…" : "Sign in"}
          </button>

          {/* Said plainly, because the window is about to lose focus and that
              is alarming if it was not expected. */}
          <p className="text-xs text-editor-muted">
            {auth.status === "waiting"
              ? "Finish in the browser and come back — this updates by itself."
              : "Opens your browser. There's no separate signup."}
          </p>
        </div>
      )}
    </div>
  );
}

function ReadyStep({ permissions }: { permissions: Permissions }) {
  const missing = PERMISSIONS.filter((permission) => !permissions.granted(permission.id));

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-4 py-6">
      <h1 className="text-3xl font-semibold tracking-tight">
        {permissions.all ? "You're all set" : "Nearly there"}
      </h1>

      {/* What is still missing, named. "Some permissions are missing" is a
          sentence the user can do nothing with. */}
      {missing.length > 0 && (
        <p className="max-w-md text-sm leading-relaxed text-editor-muted">
          Still to allow: {missing.map((permission) => permission.label).join(", ")}. You can go
          back a step, or grant them later — Prequel will ask again next time it opens.
        </p>
      )}

      {/* The shortcut as the thing you look at, not a phrase with keys inside
          it. This is the one fact worth carrying out of the flow — a menu-bar
          app has no window to go back to — so it gets the size a heading would.

          Three keys rather than one chip reading "⇧⌘R": a chord is pressed one
          key at a time, and drawn as separate caps it says so. */}
      <Shortcut
        keys={[
          { icon: <CommandIcon />, label: "Command" },
          { icon: <ShiftIcon />, label: "Shift" },
          { letter: "R", label: "R" },
        ]}
      />

      <ul className="flex max-w-md flex-col gap-2 text-sm text-editor-muted">
        <li>Starts and stops a recording from anywhere, even with another app in front.</li>
        <li>
          <Chord
            keys={[
              { icon: <CommandIcon />, label: "Command" },
              { icon: <ShiftIcon />, label: "Shift" },
              { letter: "P", label: "P" },
            ]}
          />{" "}
          pauses and resumes without stopping the take.
        </li>
        <li>Stop, and the editor opens on what you just recorded.</li>
      </ul>

      <LoginItemToggle />
    </div>
  );
}

/**
 * Opening at login, offered where the user first meets the app.
 *
 * Already on by default — main turns it on before this window opens — so this
 * is a switch that says so rather than a request. It is worth the room: a
 * menu-bar recorder that is not running has to be found and launched *before*
 * the thing worth capturing happens, which is never when anyone thinks of it.
 * And a default applied silently is the sort of thing users find later in
 * System Settings and resent; put where they can see it, it is a choice.
 *
 * `null` until the first read lands, so the switch cannot draw itself off and
 * then flick on — which would read as the app having changed it just then. It
 * is also what main answers in a development build, where there is no bundle to
 * register: the row is left out rather than offered and then refused.
 */
function LoginItemToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    void window.prequel.loginItem.get().then(setEnabled);
  }, []);

  if (enabled === null) return null;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      className="flex w-fit items-center gap-2.5 text-sm text-editor-muted hover:text-editor-fg"
      // Set from what main answers rather than from what was asked for: under
      // `pnpm dev` there is no app bundle to register as a login item, and a
      // switch that ticks anyway would be lying about it.
      onClick={() => void window.prequel.loginItem.set(!enabled).then(setEnabled)}
    >
      {/* The same treatment a granted permission gets a step earlier, so "on"
          means the same thing in both places. */}
      <span
        className={cn(
          "grid size-[18px] flex-none place-items-center rounded-md ring-1 transition-colors ring-inset [&_svg]:size-3",
          enabled
            ? "bg-export/20 text-export ring-export/30"
            : "bg-white/5 text-transparent ring-white/15",
        )}
      >
        <CheckIcon />
      </span>
      Open Prequel at login
    </button>
  );
}

/**
 * One chord, as a row of keycaps.
 *
 * Sized like buttons because that is what they are — a key is a button, and the
 * only reason the shortcut is worth this much room is that it is the whole
 * interface for an app with no window. The gradient is the same one the wash at
 * the top uses, so the two read as one surface rather than two decorations.
 */
function Shortcut({ keys }: { keys: { icon?: ReactNode; letter?: string; label: string }[] }) {
  return (
    <div className="flex items-center gap-2">
      {keys.map((key) => (
        <span
          key={key.label}
          aria-label={key.label}
          className={cn(
            "grid size-14 place-items-center rounded-2xl",
            // Lit from the top like a physical cap, and ringed rather than
            // bordered so the highlight sits inside the shape's own radius.
            "bg-gradient-to-b from-white/[0.14] to-white/[0.04]",
            "ring-1 ring-white/15 ring-inset",
            "text-editor-fg shadow-lg [&_svg]:size-6",
          )}
        >
          {key.icon ?? <span className="text-xl font-medium">{key.letter}</span>}
        </span>
      ))}
    </div>
  );
}

/**
 * The same chord at sentence size, as separate caps.
 *
 * The same three keys drawn the same way as `Shortcut` above, only small enough
 * to sit in a line of prose. Glyph characters in a single `<kbd>` were the
 * alternative and are worse in both directions: `⌘` and `⇧` render at whatever
 * weight the text font gives them, which is rarely the weight the caps above
 * are drawn at, and a reader who does not already know the symbols gets no help
 * from the tooltip a real cap carries.
 *
 * `align-middle` because a cap is taller than the line it sits on, and an
 * inline-block left on the text baseline drags the whole line down with it.
 */
function Chord({ keys }: { keys: { icon?: ReactNode; letter?: string; label: string }[] }) {
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {keys.map((key) => (
        <kbd
          key={key.label}
          aria-label={key.label}
          title={key.label}
          className={cn(
            "grid size-5 place-items-center rounded-[5px]",
            "bg-gradient-to-b from-white/[0.14] to-white/[0.04]",
            "ring-1 ring-white/15 ring-inset",
            "text-editor-fg [&_svg]:size-3",
          )}
        >
          {key.icon ?? <span className="text-[11px] font-medium">{key.letter}</span>}
        </kbd>
      ))}
    </span>
  );
}
