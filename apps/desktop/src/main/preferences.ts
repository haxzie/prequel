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

import type { RecordingPreferences, ScreenMode } from "../shared/contract.js";
import { DEFAULT_PREFERENCES } from "../shared/contract.js";

const SCREEN_MODES: ScreenMode[] = ["screen", "window", "area"];

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
  };
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
