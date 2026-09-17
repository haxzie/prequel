/**
 * Persisted recording setup.
 *
 * The panel preselects whatever was used last, so the common case — the same
 * screen, camera and mic as yesterday — is one click. Stored as plain JSON in
 * the app's userData directory; there is not enough here to justify a database
 * or a dependency.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { app } from "electron";

import { normaliseAccelerator } from "../shared/accelerator.js";
import type {
  AfterRecording,
  RecordingPreferences,
  ScreenMode,
  TeleprompterMode,
  TeleprompterSize,
  TeleprompterWidth,
} from "../shared/contract.js";
import { DEFAULT_PREFERENCES } from "../shared/contract.js";

const SCREEN_MODES: ScreenMode[] = ["screen", "window", "area"];
const AFTER_RECORDING: AfterRecording[] = ["editor", "finder", "nothing"];
const TELEPROMPTER_MODES: TeleprompterMode[] = ["voice", "timed", "manual"];
const TELEPROMPTER_SIZES: TeleprompterSize[] = ["small", "medium", "large"];
const TELEPROMPTER_WIDTHS: TeleprompterWidth[] = ["narrow", "normal", "wide"];

/** Long enough to get out of the way, short enough not to be a wait. */
const MAX_COUNTDOWN = 10;

/**
 * Auto-scroll bounds, in words per minute.
 *
 * Below sixty the text is still; above three hundred nobody can read it, and
 * a hand-edited thousand would fling the script past before the countdown
 * ends.
 */
const MIN_SPEED = 60;
const MAX_SPEED = 300;

export class Preferences {
  private cached: RecordingPreferences | null = null;

  constructor(private readonly file = defaultFile()) {}

  /** Where settings are stored. Surfaced so it can be inspected or reported. */
  get path(): string {
    return this.file;
  }

  get(): RecordingPreferences {
    this.cached ??= this.read();
    return this.cached;
  }

  update(patch: Partial<RecordingPreferences>): RecordingPreferences {
    const next = sanitise({ ...this.get(), ...patch });
    this.cached = next;
    this.write(next);
    return next;
  }

  private read(): RecordingPreferences {
    try {
      return sanitise(JSON.parse(readFileSync(this.file, "utf8")));
    } catch {
      // Missing or corrupt: defaults are always better than refusing to start.
      return { ...DEFAULT_PREFERENCES };
    }
  }

  private write(preferences: RecordingPreferences): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(preferences, null, 2));
    } catch (cause) {
      // Losing a preference is not worth failing a recording over.
      console.warn("[preferences] could not save:", cause);
    }
  }
}

/**
 * Coerces stored JSON into a valid shape.
 *
 * Preferences outlive the code that wrote them: a mode that no longer exists,
 * or a hand-edited file, must not put the panel into a state it cannot render.
 */
function sanitise(value: Partial<RecordingPreferences>): RecordingPreferences {
  return {
    mode: SCREEN_MODES.includes(value.mode as ScreenMode)
      ? (value.mode as ScreenMode)
      : DEFAULT_PREFERENCES.mode,
    cameraId: typeof value.cameraId === "string" ? value.cameraId : null,
    cameraLabel: typeof value.cameraLabel === "string" ? value.cameraLabel : null,
    micId: typeof value.micId === "string" ? value.micId : null,
    micLabel: typeof value.micLabel === "string" ? value.micLabel : null,
    systemAudio: value.systemAudio ?? DEFAULT_PREFERENCES.systemAudio,
    bakeCursor: value.bakeCursor ?? DEFAULT_PREFERENCES.bakeCursor,
    cameraPosition: point(value.cameraPosition),
    // Normalised on the way in as well as the way out: a hand-edited
    // "Command+Shift+R" binds the same keys as the stored "Shift+Cmd+R", and
    // the settings window compares the two as strings.
    toggleShortcut:
      (typeof value.toggleShortcut === "string"
        ? normaliseAccelerator(value.toggleShortcut)
        : null) ?? DEFAULT_PREFERENCES.toggleShortcut,
    countdown: countdown(value.countdown),
    saveDirectory: typeof value.saveDirectory === "string" ? value.saveDirectory : null,
    afterRecording: AFTER_RECORDING.includes(value.afterRecording as AfterRecording)
      ? (value.afterRecording as AfterRecording)
      : DEFAULT_PREFERENCES.afterRecording,
    teleprompter: value.teleprompter ?? DEFAULT_PREFERENCES.teleprompter,
    teleprompterMode: oneOf(
      TELEPROMPTER_MODES,
      value.teleprompterMode,
      DEFAULT_PREFERENCES.teleprompterMode,
    ),
    teleprompterSize: oneOf(
      TELEPROMPTER_SIZES,
      value.teleprompterSize,
      DEFAULT_PREFERENCES.teleprompterSize,
    ),
    teleprompterWidth: oneOf(
      TELEPROMPTER_WIDTHS,
      value.teleprompterWidth,
      DEFAULT_PREFERENCES.teleprompterWidth,
    ),
    teleprompterSpeed: speed(value.teleprompterSpeed),
    welcomed: value.welcomed ?? DEFAULT_PREFERENCES.welcomed,
  };
}

/** The value if it is one of the allowed ones, else the default. */
function oneOf<T extends string>(allowed: T[], value: unknown, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Whole words per minute within range. */
function speed(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_PREFERENCES.teleprompterSpeed;
  }
  return Math.min(Math.max(Math.round(value), MIN_SPEED), MAX_SPEED);
}

/** Whole seconds within range. A negative or absurd value reaches this. */
function countdown(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_PREFERENCES.countdown;
  return Math.min(Math.max(Math.round(value), 0), MAX_COUNTDOWN);
}

/** A stored point, or null if it is not one. Hand-edited files reach this. */
function point(value: unknown): { x: number; y: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const { x, y } = value as { x?: unknown; y?: unknown };
  return Number.isFinite(x) && Number.isFinite(y) ? { x: x as number, y: y as number } : null;
}

function defaultFile(): string {
  // `app.getPath` throws before the app is ready; tests pass their own path.
  return join(app.getPath("userData"), "preferences.json");
}
