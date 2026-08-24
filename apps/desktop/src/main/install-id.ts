/**
 * A stable, anonymous identifier for this install.
 *
 * Two things read it: the transcription allowance, which needs to know that a
 * hundred requests came from one machine, and analytics, which needs an app that
 * has never been signed in to still have a timeline. It is the anonymous half of
 * the identity — `/v1/events` files events under `install_<this>` until there is
 * an account, and the sign-in merges the two.
 *
 * It is therefore a tracking identifier, and calling it anything else would be
 * dishonest. What it is not is a *machine* identifier: the value is random and
 * derived from nothing — not the hardware, not the user, not the hostname — so
 * it says "the same install as last time" and cannot say anything else. Deleting
 * this file makes the Mac a new install, which is the whole of what it means.
 *
 * Its own file rather than a field on `RecordingPreferences`, because that type
 * crosses to the renderer inside `DockState` and nothing a window renders needs
 * this. `auth.ts` makes the same call for the same reason.
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
    // The id simply changes next launch, which costs the rate limiter its memory
    // of this install and makes analytics count one Mac twice. Neither is worth
    // failing anything over.
    console.warn("[install] could not persist the install id:", cause);
  }

  cached = id;
  return id;
}
