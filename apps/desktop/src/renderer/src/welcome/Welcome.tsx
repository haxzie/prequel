import { useEffect, useState, type ReactNode } from "react";

import type { AppInfo, PermissionId } from "../../../shared/contract";
import { assetUrl } from "../../../shared/media-url";
import { cn } from "../lib/cn";
import {
  AudioIcon,
  CameraIcon,
  CheckIcon,
  CommandIcon,
  CursorIcon,
  ScreenIcon,
  ShiftIcon,
} from "../editor/icons";
import { usePermissions, type Permissions } from "./usePermissions";

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
  icon: ReactNode;
}[] = [
  {
    id: "screen",
    label: "Screen Recording",
    detail: "Everything Prequel records comes through it.",
    icon: <ScreenIcon />,
  },
  {
    id: "accessibility",
    label: "Accessibility",
    detail: "Lets the automatic zooms find your clicks and typing.",
    icon: <CursorIcon />,
  },
  {
    id: "camera",
    label: "Camera",
    detail: "For the webcam bubble, only when you turn it on.",
    icon: <CameraIcon />,
  },
  {
    id: "microphone",
    label: "Microphone",
    detail: "For your voice, only when you turn it on.",
    icon: <AudioIcon />,
  },
];

const STEPS = 3;

export function Welcome() {
  const [step, setStep] = useState(0);
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
        {step === 2 && <ReadyStep permissions={permissions} />}
      </main>

      {/* Dots left, button right: the reading order of the footer is "where am
          I" then "what happens next", which is the order they are in. */}
      <footer className="relative z-10 flex flex-none items-center gap-4 px-12 pt-4 pb-9">
        <Dots step={step} onStep={setStep} />
        <div className="flex-1" />

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
 * The colour at the top of the window.
 *
 * Three circles rather than a CSS gradient doing the whole job: a linear ramp
 * between two hues goes through the dead grey in the middle of them, and the
 * app's icon is a sunrise across orange, crimson and violet. Overlapping blurs
 * keep every hue at full saturation and let them mix where they meet, which is
 * what makes it read as light rather than as a fill.
 *
 * `blur-3xl` on absolutely positioned circles, not a `backdrop-filter`: this has
 * nothing behind it to filter, and a backdrop blur on the window root is a
 * compositing cost paid on every frame the editor draws.
 *
 * Low opacity and clipped to the top third, so it is atmosphere behind the text
 * rather than something the text has to survive being on top of.
 */
function Wash() {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 h-56 overflow-hidden"
      // Masked rather than merely clipped. `overflow-hidden` alone cuts the
      // circles off at the container's edge, and a blurred circle ending in a
      // straight line is the one thing that gives away that it is a rectangle
      // full of circles — it read as a seam across the window. The mask fades
      // everything inside out before the boundary, so there is no edge to see.
      style={{
        maskImage: "linear-gradient(to bottom, black 45%, transparent)",
        WebkitMaskImage: "linear-gradient(to bottom, black 45%, transparent)",
      }}
      aria-hidden="true"
    >
      {/* The hue itself, fading out downwards so it has no edge to notice. */}
      <div className="absolute inset-0 bg-gradient-to-b from-white/[0.06] to-transparent" />

      {/* Pulled above the top edge so only the lower, widest part of each circle
          is in the window — a circle wholly inside reads as a dot.

          The opacities look high for something meant to be subtle, and are not:
          `blur-3xl` spreads each circle over 64px in every direction, and most of
          its area is off screen, so what actually lands in the window is a
          fraction of the figure. At half these values the wash was invisible
          against `--editor-bg`. */}
      <div className="absolute -top-20 -left-20 size-80 rounded-full bg-[#f2622e] opacity-30 blur-3xl" />
      <div className="absolute -top-24 left-1/3 size-80 rounded-full bg-[#d81e63] opacity-25 blur-3xl" />
      <div className="absolute -top-20 -right-12 size-80 rounded-full bg-[#8b5cf6] opacity-30 blur-3xl" />
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
      {Array.from({ length: STEPS }, (_, index) => (
        <button
          key={index}
          type="button"
          role="tab"
          aria-selected={index === step}
          aria-label={`Step ${index + 1} of ${STEPS}`}
          disabled={index > step}
          className={cn(
            "size-2 rounded-full transition-colors",
            index === step ? "bg-editor-fg" : "bg-white/20",
            index < step && "hover:bg-white/40",
            index > step && "cursor-default",
          )}
          onClick={() => onStep(index)}
        />
      ))}
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
      <span
        className={cn(
          "mt-0.5 grid size-7 flex-none place-items-center rounded-lg [&_svg]:size-4",
          granted ? "bg-export/20 text-export" : "bg-white/5 text-editor-muted",
        )}
      >
        {permission.icon}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-xs font-medium">{permission.label}</p>
        <p className="text-[11px] leading-relaxed text-editor-muted">{permission.detail}</p>

        {/* Only where it can actually be the problem, and only while it is one.
            macOS decides Screen Recording once per process, so an approval
            given while Prequel is running does not reach the running copy —
            the row stays red and the app looks broken. */}
        {!granted && permission.id === "screen" && (
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
    </div>
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
