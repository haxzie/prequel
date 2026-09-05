/**
 * The marketing site's icons.
 *
 * Drawn inline rather than pulled from a package, for the reason
 * `dashboard/icons.tsx` gives: there are a handful of them and each is a path.
 * None of them sets a size — the caller does that in CSS.
 */

/**
 * The Apple mark, for the download button.
 *
 * A fill rather than a stroke, unlike everything in `dashboard/icons.tsx`: this
 * is a solid mark and outlining it would draw a different logo. It also wants to
 * be a shade larger than a stroked icon beside the same text — a solid shape
 * reads smaller than an outlined one at matching dimensions — and it sits a
 * hair high because the leaf puts the mark's optical centre below its
 * geometric one.
 *
 * Used only to say which platform the build is for, beside the word Mac — on the
 * download button and in the home page's headline, and nowhere else. Apple's
 * trademark guidelines are strict about their marks — the note in
 * `content/competitors.ts` is where that came up before — so it always sits
 * beside the word and never stands in for it.
 */
export function AppleIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.05 12.536c-.03-3.02 2.47-4.47 2.58-4.54-1.41-2.06-3.6-2.34-4.37-2.37-1.86-.19-3.63 1.09-4.57 1.09-.94 0-2.4-1.07-3.94-1.04-2.03.03-3.9 1.18-4.94 3-2.1 3.65-.54 9.06 1.51 12.03 1 1.45 2.2 3.08 3.77 3.02 1.51-.06 2.08-.98 3.91-.98 1.83 0 2.34.98 3.94.95 1.63-.03 2.66-1.48 3.65-2.93 1.15-1.68 1.62-3.31 1.65-3.39-.04-.02-3.17-1.22-3.2-4.84M14.32 3.72c.83-1.01 1.4-2.42 1.24-3.82-1.2.05-2.65.8-3.51 1.81-.77.89-1.45 2.32-1.27 3.69 1.34.1 2.71-.68 3.54-1.68" />
    </svg>
  );
}

/**
 * The GitHub mark, for the link to the repository.
 *
 * A fill for the same reason the Apple mark is one: it is a solid logo, and
 * stroking its outline would draw something that is not it. GitHub's own
 * guidelines allow the mark unmodified in a link back to a repository, which is
 * the only place it appears.
 */
export function GitHubIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 .5C5.73.5.5 5.73.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2.17c-3.2.7-3.88-1.37-3.88-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.5 3.17-1.18 3.17-1.18.63 1.59.24 2.76.12 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.4-5.27 5.69.42.36.79 1.07.79 2.15v3.19c0 .31.2.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
    </svg>
  );
}

/** A filled star, for the count beside the mark above. */
export function StarIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2.6l2.92 5.92 6.53.95-4.72 4.6 1.11 6.5L12 17.5l-5.84 3.07 1.11-6.5-4.72-4.6 6.53-.95z" />
    </svg>
  );
}

/**
 * The hamburger, and the cross it becomes.
 *
 * Stroked, unlike the three marks above: those are logos and outlining one
 * draws a different logo, while these are ordinary icons and want the weight of
 * the text beside them. `round` caps so the bars end the way the pill buttons
 * around them do.
 */
export function MenuIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function CloseIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/**
 * A payment card, for the line under the download button.
 *
 * Stroked, like the two above and for the same reason: it is an ordinary icon
 * rather than a logo, so it wants the weight of the small print beside it. The
 * stripe across it is what makes a rounded rectangle read as a card at eleven
 * pixels — without it the shape is a window, a photograph or a button.
 */
export function CardIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="2" y="5" width="20" height="14" rx="2.5" />
      <path d="M2 10h20" />
    </svg>
  );
}

/**
 * The X mark and the LinkedIn mark, for an author's links.
 *
 * Fills, for the reason the two above are: both are solid logos and stroking
 * their outlines would draw something that is not them. Neither is ever shown
 * without the author's name beside it — they say where this person is, not who
 * published the post.
 */
export function XIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function LinkedInIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05a3.74 3.74 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.46zM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13M7.12 20.45H3.56V9h3.56zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0" />
    </svg>
  );
}
