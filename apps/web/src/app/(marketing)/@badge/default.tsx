/**
 * Every marketing route that is not `/`.
 *
 * Without this the slot has nothing to render on those routes and the page
 * 404s, which is the failure mode parallel routes are known for.
 */
export default function NoBadge() {
  return null;
}
