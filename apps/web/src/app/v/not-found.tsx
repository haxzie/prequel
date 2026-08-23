/**
 * A share link that resolves to nothing.
 *
 * Scoped to `/v` so it renders inside the player's own layout. The root 404 is
 * written for somebody who mistyped a marketing URL — it offers the blog — and
 * showing that to a stranger whose colleague sent them a dead link answers a
 * question they did not ask, on a site they have never heard of.
 *
 * Deliberately vague about *why*. A slug is unguessable by design, and telling
 * an anonymous caller whether a given one ever existed is the one piece of
 * information an enumeration attempt would be after.
 */
export default function ShareNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-5 py-24 text-center sm:px-8">
      <h1 className="text-xl font-medium tracking-tight text-fg">This link doesn&rsquo;t work</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
        The recording may have been deleted, or the link may be incomplete. Ask whoever shared it
        for another one.
      </p>
    </div>
  );
}
