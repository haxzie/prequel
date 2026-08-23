import BoringAvatar from "boring-avatars";

/**
 * Everyone's picture, generated rather than fetched.
 *
 * The identity provider's photo is never rendered, and here that is not only a
 * preference: the renderer's CSP is `img-src 'self' data: prequel-media:`, so a
 * `https://lh3.googleusercontent.com/…` avatar is blocked outright and draws an
 * empty box. Loosening the policy to admit one 32px picture would be the wrong
 * trade — and the account may have no photo at all, since a magic-link user
 * never supplies one.
 *
 * The same palette, variant and seed as `apps/web`, so a person is the same
 * marble in the app and in their browser. That is why both use the package
 * rather than either drawing its own: two implementations of a generative
 * avatar means one account with two faces.
 */
const PALETTE = ["#e14b15", "#ac1860", "#c000f0", "#4e84f9", "#eeacff"];

export function Avatar({
  /** What the marble is generated from. The email: stable, unique, and known. */
  seed,
  size = 36,
  className = "",
}: {
  seed: string;
  size?: number;
  className?: string;
}) {
  return (
    <span className={`block shrink-0 overflow-hidden rounded-full ${className}`}>
      <BoringAvatar size={size} name={seed} variant="marble" colors={PALETTE} />
    </span>
  );
}
