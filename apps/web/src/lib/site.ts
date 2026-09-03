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
     worth reading left after it.

     Only what the first pass actually does. Cutting is a manual pass on the
     timeline, so a description that promises trimmed silences promises an
     automatic feature that does not exist. */
  description:
    "Prequel is a Mac screen recorder that does the editing for you: zooms on every click, your camera framed, a background behind it. Exports at up to 4K.",
  platform: "Apple Silicon · macOS 14+",
} as const;

export const NAV: { href: Route; label: string }[] = [
  { href: "/pricing", label: "Pricing" },
  { href: "/blog", label: "Blog" },
  { href: "/about", label: "About" },
];

export const CONTACT_EMAIL = "hello@prequel.sh";

/**
 * Where anything that needs an answer goes.
 *
 * Separate from `CONTACT_EMAIL` because the two are read by different people in
 * a different frame of mind: `hello@` is a stranger saying hello, `support@` is
 * somebody whose export just failed. Both reach us; only one of them is a queue
 * with a promise attached.
 */
export const SUPPORT_EMAIL = "support@prequel.sh";

/**
 * Who writes the posts.
 *
 * One author, so this is a constant rather than a field on `Post` — a per-post
 * author would be a column that reads the same on every row until there is a
 * second person, and adding one then is a smaller change than keeping the
 * column honest until then.
 *
 * `avatar` is committed under `public/` rather than pointed at
 * `github.com/haxzie.png`. A hotlinked avatar is a third party deciding when
 * the byline goes blank, and it would be fetched on every post view from a host
 * that is not ours.
 */
export const AUTHOR = {
  name: "Musthaq Ahamad",
  role: "Building Prequel",
  avatar: "/authors/haxzie.jpg",
  url: "https://haxzie.com",
  x: "https://x.com/haxzie_",
  linkedin: "https://www.linkedin.com/in/haxzie",
} as const;
