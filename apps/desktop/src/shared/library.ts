/**
 * The assets Prequel supplies, and how a project points at them.
 *
 * A recording's own directory holds everything that was *made* for it — the
 * footage, the pointer, a picture somebody picked off their disk, the snapshot
 * of their desktop. Those are irreplaceable, and copying them in is what makes
 * a recording stand on its own.
 *
 * The catalogue is not that. A wallpaper from our own list is the same two
 * megabytes in every project that uses it, fetched from an address that can
 * answer again tomorrow — `monterey.jpg` was on this machine a hundred and
 * seventy-eight times, one copy per recording, for 53 MB of the same bytes. So
 * those live once, under `userData`, and a project names them rather than
 * holding them.
 *
 * The naming is this prefix. A plan carries paths and nothing else — by the
 * time either rasteriser sees one there is no `source` field left to ask — so
 * which root a path belongs to has to be legible in the path itself. Bare names
 * are the recording's, as they always were, and a project written before this
 * existed carries only those and resolves exactly as it did.
 *
 * Mirrored by `library_path` in `crates/prequel-render/src/plan.rs`, with the
 * same prefix in both sets of tests.
 */

/**
 * What a library path starts with.
 *
 * The `@` is what keeps it unambiguous: every name a recording holds is bare —
 * `BARE_JPEG` and the rest refuse a separator outright — so nothing in a
 * project can collide with this, and a resolver that does not know the prefix
 * reads it as a name it will not find rather than as a file outside the
 * recording. A plain `library/` would have been a directory somebody could
 * make.
 */
export const LIBRARY_PREFIX = "@library/";

/** Which shelf an asset sits on. One directory each, under the prefix. */
export type LibraryKind = "backgrounds" | "music";

/** How a project refers to one of ours: `@library/backgrounds/monterey.jpg`. */
export function libraryRef(kind: LibraryKind, file: string): string {
  return `${LIBRARY_PREFIX}${kind}/${file}`;
}

/**
 * The shelf and the name a reference points at, or null for a recording's own
 * file.
 *
 * Null is the answer for every bare name, which is what makes this safe to ask
 * of any path in any plan: a caller resolves against the recording wherever
 * this says nothing.
 *
 * Refuses anything that is not exactly a shelf and a bare name. The path comes
 * out of a project file and ends up joined onto a directory, so `..` and a
 * second slash have to be impossible here rather than caught downstream.
 */
export function libraryParts(path: string): { kind: LibraryKind; file: string } | null {
  if (!path.startsWith(LIBRARY_PREFIX)) return null;

  const parts = path.slice(LIBRARY_PREFIX.length).split("/");
  if (parts.length !== 2) return null;

  const [kind, file] = parts as [string, string];
  if (kind !== "backgrounds" && kind !== "music") return null;
  // A bare name: letters, digits and dashes, one dot, an extension. The same
  // shape the API's own names take — see `BARE_JPEG`.
  if (!/^[a-z0-9][a-z0-9-]*\.[a-z0-9]+$/i.test(file)) return null;

  return { kind, file };
}

/** Whether this path is one of ours rather than one of the recording's. */
export function isLibraryRef(path: string): boolean {
  return libraryParts(path) !== null;
}
