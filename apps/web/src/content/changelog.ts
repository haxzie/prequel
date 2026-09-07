/**
 * What shipped, release by release.
 *
 * The lines themselves live in `content/changelog/<version>.mdx`, one file per
 * release, written as an ordinary Markdown list. They were an array of strings
 * in this file, which meant every entry was a TypeScript string literal — a
 * sentence with a quote in it had to be escaped, nothing could be emphasised or
 * linked, and a release read as data rather than as the paragraph it is.
 *
 * Each of those files carries its own `date` as an export. What stays here is
 * the order, because a directory cannot give it: sorted as text, `0.0.9` comes
 * after `0.0.13`, and a changelog that has to be read newest-first is exactly
 * the case where that goes wrong quietly.
 *
 * Written by hand rather than generated from the tags. A commit log is a record
 * of work and a changelog is a record of what somebody using the app can now
 * do, and most releases contain a good deal of the first and very little of the
 * second. Anything that changed only for us stays out.
 *
 * Newest first, which is the order the page reads in and the order this file is
 * edited in: a release is added at the top, with its `.mdx` beside it.
 */
export const RELEASES = [
  "0.0.14",
  "0.0.13",
  "0.0.12",
  "0.0.11",
  "0.0.10",
  "0.0.9",
  "0.0.8",
  "0.0.7",
  "0.0.6",
  "0.0.5",
] as const;

export interface Release {
  /** Without the leading `v`, which the page adds. */
  version: string;
  /** ISO, rendered with `toLocaleDateString`. */
  date: string;
  /**
   * Written but not shipped.
   *
   * A release is described while the work is fresh and tagged some days later,
   * and the alternative to a flag is a file kept out of the directory until the
   * morning of — which is how a line ships undescribed. `export const draft =
   * true` in the `.mdx`, deleted when the version is tagged.
   */
  draft: boolean;
  /** The release's lines, already laid out. */
  Body: () => React.JSX.Element;
}

/**
 * The newest *published* release's date.
 *
 * The sitemap wants only this — see the note there on why the changelog is one
 * of the few pages that can honestly claim a `lastModified`.
 *
 * Walked rather than taken from the top of the list, because the top of the
 * list may be a draft: a page that does not yet mention 0.0.14 must not tell a
 * crawler it changed on the day 0.0.14 was written. Stops at the first release
 * a visitor can actually see, which is one import in the ordinary case.
 */
export async function latestDate(): Promise<string | undefined> {
  for (const version of RELEASES) {
    const { date, draft = false } = (await import(`./changelog/${version}.mdx`)) as {
      date: string;
      draft?: boolean;
    };

    if (!draft || process.env.NODE_ENV !== "production") return date;
  }

  return undefined;
}

/**
 * Every release, in order, with its body loaded.
 *
 * A template literal in the `import` rather than a map of them: the blog does
 * the same for its posts, and it is what lets a release be added by dropping a
 * file in beside a version string.
 */
export async function releases(): Promise<Release[]> {
  return Promise.all(
    RELEASES.map(async (version) => {
      const {
        default: Body,
        date,
        draft = false,
      } = (await import(`./changelog/${version}.mdx`)) as {
        default: () => React.JSX.Element;
        date: string;
        draft?: boolean;
      };

      return { version, date, draft, Body };
    }),
  );
}

/**
 * The releases a visitor should see.
 *
 * Drafts are kept in development so the page can be read as it will look, and
 * dropped from a production build so an unreleased version cannot be announced
 * by a deploy. `NODE_ENV` rather than a flag of our own: the site is built once
 * per deploy, so this is decided at build time and the draft is simply not in
 * the HTML.
 */
export async function published(): Promise<Release[]> {
  const all = await releases();
  return process.env.NODE_ENV === "production" ? all.filter((r) => !r.draft) : all;
}
