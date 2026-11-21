/**
 * `/llms.txt`, the file an assistant reads to find out what this site is.
 *
 * The format is llmstxt.org's, and the order is not negotiable: an H1 with the
 * name, a blockquote summary, some prose with no headings in it, then H2
 * sections that hold nothing but markdown link lists. An agent parsing this
 * looks for exactly that shape, so a stray `###` in the prose costs the file
 * its meaning rather than merely its tidiness.
 *
 * **Generated rather than a file in `public/`**, for the reason `robots.ts` and
 * `sitemap.ts` are generated beside it: the links come from `SITE`, `NAV` and
 * the docs' own front matter, so a page renamed in one place does not leave a
 * dead link here. A static copy would be correct on the day it was written and
 * quietly wrong a month later, and nothing on the site would show it.
 *
 * **What this is honestly worth.** The spec's claims about adoption are the
 * spec author's; no major crawler has published that it reads this file during
 * search or browsing, and the strongest evidence is for developer
 * documentation rather than marketing sites. It costs a small text file, so it
 * is worth having — but the thing that actually decides what an assistant says
 * about Prequel is that the ordinary pages are complete and crawlable, which
 * is `robots.ts`'s job and not this one.
 *
 * The prose is unwrapped, one line to a paragraph. Hard-wrapping it reads
 * better in this file and worse in the generated one: the prices and the trial
 * length are interpolated, so a wrap tuned to today's values goes ragged the
 * moment one of them changes, in a file whose whole audience reads it raw.
 *
 * Links point at the HTML pages. The spec would rather have markdown versions
 * at `page.md`, and the site serves none — adding a markdown rendering of every
 * route is a far larger change than this file, and the fallback the spec leaves
 * unspecified is to link what exists.
 */
import { env } from "@prequel/env";

import { outline } from "@/content/docs";
import { PRICE_LIFETIME, PRICE_MONTHLY, TRIAL_DAYS } from "@/lib/pricing";
import { SITE } from "@/lib/site";

/**
 * Prerendered at build time rather than run per request.
 *
 * A route handler is dynamic by default, and this one reads the docs' front
 * matter off disk — work that has no business happening again for a file whose
 * content only changes when the site is rebuilt.
 */
export const dynamic = "force-static";

/**
 * The one-line summary, and deliberately not `SITE.description`.
 *
 * They read the same and are answering different questions. The site
 * description is a search snippet and the footer's standfirst: Google cuts it
 * near 155 characters and a visitor reads it in passing, so it names the thing
 * and stops. This is read whole, by something deciding whether Prequel is the
 * answer to "screen recorder for Mac with automatic zoom" or "how do I add
 * click sounds to a screen recording" — so it is worth naming the features in
 * the words somebody would actually ask for, and it has no length to fit.
 *
 * Sharing one string would mean one of the two jobs being done badly, and the
 * one that would quietly lose is the search snippet, because nothing on the
 * page shows it being truncated.
 *
 * The jobs come before the features, because that is the half of it somebody
 * asks for by name: "record a product demo", "make a software tutorial". The
 * four named here are the highest-intent of the sixteen in
 * `content/use-cases.ts`, and `/usecases` carries the rest.
 *
 * No superlative, per `COPY.md`: "best screen recorder" is a claim with
 * nothing in it and would survive being moved to a rival's page, which is the
 * test that rules it out. The jobs and the features are the argument instead,
 * and every one of them is real.
 */
const SUMMARY =
  "Prequel is a screen recorder for macOS, for product demos, software " +
  "tutorials, onboarding and course videos. It turns a plain screen recording " +
  "into a beautiful one: automatic zooms on every click, custom camera frames " +
  "and screen layouts, restyled cursors, click and key sounds, captions " +
  "transcribed on your Mac, and export up to 4K.";

/** One `- [name](url): notes` line. */
function link(base: string, path: string, name: string, notes: string): string {
  return `- [${name}](${base}${path}): ${notes}`;
}

export async function GET(): Promise<Response> {
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const at = (path: string, name: string, notes: string) => link(base, path, name, notes);

  const docs = await outline();
  const docLinks = docs.flatMap((section) =>
    section.pages.map((page) => at(page.path, page.title, page.description)),
  );

  const body = `# ${SITE.name}

> ${SUMMARY}

Prequel is a native Mac app, not a web recorder. It records, edits and exports on your own machine — nothing is uploaded to make a video, and it works with no network at all. ${SITE.platform}.

The first pass is the point: Prequel watches where you clicked and typed while recording, and uses that to place the zooms, frame the camera and put a background behind the screen. Everything it decides is then editable on a timeline. Captions are transcribed on the Mac, and exports go to MP4, HEVC or GIF at up to 4K.

Sharing is a separate, optional step taken after a file exists: an export can be published as a private link.

Pricing is one number rather than a free tier with the useful part removed — ${PRICE_MONTHLY} a month or ${PRICE_LIFETIME} once, after a ${String(TRIAL_DAYS)}-day trial that holds the whole app, with no watermark and no length limit.

## Product

${at("/", `${SITE.name} — ${SITE.tagline}`, "What the app does, and the download")}
${at("/features", "Features", "Every feature in detail, grouped by what it does to a recording")}
${at("/pricing", "Pricing", `${PRICE_MONTHLY} a month or ${PRICE_LIFETIME} once, what each includes, and the FAQ`)}
${at("/usecases", "Use cases", "Product demos, tutorials, onboarding, courses and shorts")}
${at("/compare", "Compare", "Prequel against the other Mac screen recorders, feature by feature")}

## What it records and makes

${at("/features#record", "Recording", "Screen, window or region, with camera, microphone and system audio on their own tracks")}
${at("/features#zoom", "Zooms", "Placed for you from your clicks and typing, and editable afterwards")}
${at("/features#layout", "Layouts", "Fourteen arrangements of the screen and the camera, five camera shapes")}
${at("/features#background", "Backgrounds", "A wallpaper, gradient or solid behind the recording, with padding, radius and shadow")}
${at("/features#cursor", "Cursor", "A drawn pointer: fifteen styles, smoothed, motion-blurred, hidden while idle")}
${at("/features#captions", "Captions", "Transcribed on your Mac and edited as text")}
${at("/features#timeline", "Timeline", "The cut, the sound and the look on one timeline")}
${at("/features#export", "Export", "MP4, HEVC or GIF, up to 4K, rendered on your own Mac")}
${at("/features#sharing", "Sharing", "Publish a finished export as a private link")}

## Documentation

${docLinks.join("\n")}

## Writing

${at("/blog", "Blog", "Guides and comparisons on screen recording for Mac")}
${at("/docs/changelog", "Changelog", "What shipped in each release")}
${at("/content", "Glossary and articles", "Definitions and explainers on video, codecs and recording")}

## Free tools

${at("/free-tools", "Free browser tools", "Recorders and downloaders that run in the browser with no account")}

## Optional

${at("/about", "About", "Who makes Prequel and why")}
${at("/support", "Support", "How to get help, and where to send a bug")}
${at("/privacy", "Privacy", "What leaves your Mac, which is very little")}
${at("/terms", "Terms", "The terms the app and the share links are used under")}
`;

  return new Response(body, {
    headers: {
      // Markdown, and said so: the file is markdown by format and the spec
      // calls it that. `charset` is explicit because the prose carries
      // en dashes and the default for `text/markdown` is not UTF-8 everywhere.
      "content-type": "text/markdown; charset=utf-8",
    },
  });
}
