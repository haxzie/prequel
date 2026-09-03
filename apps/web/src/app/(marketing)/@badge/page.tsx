/**
 * The directory badge, on the home page only.
 *
 * A parallel route rather than a check inside the footer: the footer is
 * rendered by the marketing layout, and a layout has no way to ask which route
 * it is wrapping. The alternative is `usePathname`, which would turn the
 * footer's bottom bar into a client component to decide something that is
 * already known at build time.
 *
 * This file matches `/` and nothing else. `default.tsx` beside it renders
 * nothing, which is what every other marketing route falls back to.
 */
export default function BadgeSlot() {
  return (
    <a
      href="https://marketingdb.live"
      target="_blank"
      rel="noopener noreferrer nofollow sponsored"
      className="shrink-0"
    >
      {/* A plain `img`, not `next/image`: it is a fixed-size badge served by
          somebody else, so there is nothing to optimise and a remote pattern in
          `next.config.ts` would be a config entry earning nothing. */}
      <img
        src="https://marketingdb.live/badge.svg"
        alt="Listed on MarketingDB"
        width="190"
        height="44"
      />
    </a>
  );
}
