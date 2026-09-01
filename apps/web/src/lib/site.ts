import type { Route } from "next";

/**
 * Every piece of copy that appears in more than one place, in one file.
 *
 * Anything here is safe to change without touching a component. Anything not
 * here lives with the section that says it, because a constant used once is
 * just indirection.
 */
export const SITE = {
  name: "Prequel",
  /* Read in a search result and on a share card, where it is the line under
     the name rather than a sentence of its own — so it names the thing being
     searched for and stops. `Prequel — Cinematic screen recorder for Mac` is 43
     characters, well inside the ~60 a result keeps before truncating.

     The home page's own headline says something close to this but is written
     out in `page.tsx`, because three of its words are drawn as chips and a
     share card has nowhere to put them. */
  tagline: "Cinematic screen recorder for Mac",
  /* Read as the search snippet before anything else, so: the term in the first
     four words, the claim before Google's ~155 character cut, and no clause
     worth reading left after it. */
  description:
    "Prequel is a Mac screen recorder that hands back a finished video: automatic zooms, a framed camera, dead air cut. Records locally, exports at up to 4K.",
  platform: "Apple Silicon · macOS 14+",
} as const;

export const NAV: { href: Route; label: string }[] = [
  { href: "/pricing", label: "Pricing" },
  { href: "/blog", label: "Blog" },
  { href: "/about", label: "About" },
];

export const CONTACT_EMAIL = "hello@prequel.sh";
