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
 * Used only to say which platform the build is for, beside the word Mac. Apple's
 * trademark guidelines are strict about their marks — the note in
 * `content/competitors.ts` is where that came up before — so this belongs on a
 * download button and nowhere else on the site.
 */
export function AppleIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.05 12.536c-.03-3.02 2.47-4.47 2.58-4.54-1.41-2.06-3.6-2.34-4.37-2.37-1.86-.19-3.63 1.09-4.57 1.09-.94 0-2.4-1.07-3.94-1.04-2.03.03-3.9 1.18-4.94 3-2.1 3.65-.54 9.06 1.51 12.03 1 1.45 2.2 3.08 3.77 3.02 1.51-.06 2.08-.98 3.91-.98 1.83 0 2.34.98 3.94.95 1.63-.03 2.66-1.48 3.65-2.93 1.15-1.68 1.62-3.31 1.65-3.39-.04-.02-3.17-1.22-3.2-4.84M14.32 3.72c.83-1.01 1.4-2.42 1.24-3.82-1.2.05-2.65.8-3.51 1.81-.77.89-1.45 2.32-1.27 3.69 1.34.1 2.71-.68 3.54-1.68" />
    </svg>
  );
}
