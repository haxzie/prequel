/**
 * Where the assets Prequel supplies live on this machine.
 *
 * One copy each, under `userData`, shared by every recording that names one —
 * see `shared/library.ts` for why, and for the reference a project stores.
 * This half is only the directory and the guard on a name.
 *
 * In main because everything that fills it is: the renderer's CSP cannot reach
 * `api.prequel.sh`, and the renderer is also the process that must never be
 * handed a path it supplied back as a file to open.
 */
import { join } from "node:path";

import { app } from "electron";

import { libraryParts, type LibraryKind } from "../shared/library.js";

/** The root. `library/`, beside the thumbnails and fonts already cached here. */
export function libraryDir(): string {
  return join(app.getPath("userData"), "library");
}

/** One shelf of it. */
export function shelfDir(kind: LibraryKind): string {
  return join(libraryDir(), kind);
}

/**
 * The file a reference points at, or null.
 *
 * Null for a recording's own name, which is every path in every project
 * written before the library existed — the caller resolves those against the
 * recording directory exactly as it always has.
 *
 * Null as well for anything the shared parser refuses, which is the traversal
 * guard: the reference comes out of a project file, and by the time it is
 * joined onto a directory it has to be a shelf and a bare name or nothing.
 */
export function libraryFile(path: string): string | null {
  const parts = libraryParts(path);
  return parts && join(shelfDir(parts.kind), parts.file);
}
