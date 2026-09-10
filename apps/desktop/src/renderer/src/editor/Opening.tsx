/**
 * A recording on its way, whether what is missing is its media or its chunk.
 *
 * Deliberately almost nothing: it is on screen for a few hundred milliseconds
 * and only ever on the way to an editor. A skeleton of the editor would be a
 * second layout to keep in step with the real one, and a spinner in an empty
 * window says less than the name of what is opening.
 *
 * Takes the name rather than the directory now. It is drawn in two places — as
 * `Root`'s Suspense fallback while the editor chunk loads, and by the route
 * while the session is being read — and at the first of those the only thing
 * that exists is what the URL says.
 */
export function Opening({ name }: { name: string }) {
  return (
    <div className="grid h-full place-items-center text-xs text-editor-muted">
      <p className="animate-pulse">Opening {name}…</p>
    </div>
  );
}
