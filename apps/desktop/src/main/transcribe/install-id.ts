/**
 * A stable, anonymous identifier for this install.
 *
 * Its own file rather than a field on `RecordingPreferences`: that type crosses
 * to the renderer over IPC, and an identifier the rate limiter uses has no
 * business being readable by a window.
 *
 * Deliberately random and derived from nothing — not the machine, not the user,
 * not the hardware. All it has to do is stop one client minting tokens in a
 * loop, and a value that carried anything more would be a tracking identifier
 * for a local-first recorder that has no accounts.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { app } from "electron";

const FILE = "install.json";

let cached: string | null = null;

export function installId(): string {
  if (cached) return cached;

  const file = join(app.getPath("userData"), FILE);

  try {
    const stored = JSON.parse(readFileSync(file, "utf8")) as { id?: unknown };
    if (typeof stored.id === "string" && stored.id.length > 0) {
      cached = stored.id;
      return cached;
    }
  } catch {
    // No file yet, or an unreadable one. Either way the answer is a new id —
    // there is nothing here worth recovering.
  }

  const id = randomUUID();
  try {
    writeFileSync(file, JSON.stringify({ id }), "utf8");
  } catch (cause) {
    // A read-only userData directory is not a reason to refuse a transcription.
    // The id simply changes next launch, which costs the rate limiter its
    // memory of this install and nothing else.
    console.warn("[transcribe] could not persist the install id:", cause);
  }

  cached = id;
  return id;
}
