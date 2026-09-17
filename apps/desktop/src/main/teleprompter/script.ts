/**
 * The script, remembered between launches.
 *
 * Its own file rather than a field in `preferences.json`. It is the one thing
 * the app remembers that is content rather than setup — a few kilobytes of
 * someone's words — and it changes on every keystroke in the script window,
 * which is not a rate to rewrite every preference at.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { app } from "electron";

export class ScriptStore {
  private cached: string | null = null;

  constructor(private readonly file = defaultFile()) {}

  get(): string {
    this.cached ??= this.read();
    return this.cached;
  }

  set(text: string): void {
    if (text === this.cached) return;
    this.cached = text;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify({ text }, null, 2));
    } catch (cause) {
      // Losing the script on disk is not worth failing the edit over; it is
      // still in memory for the take about to be made.
      console.warn("[teleprompter] could not save the script:", cause);
    }
  }

  private read(): string {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, "utf8"));
      const text = (parsed as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    } catch {
      // Missing or corrupt: an empty script, and the window says so.
      return "";
    }
  }
}

function defaultFile(): string {
  // `app.getPath` throws before the app is ready; tests pass their own path.
  return join(app.getPath("userData"), "teleprompter.json");
}
