/**
 * `/llms.txt`, the file an assistant reads to find out what this site is.
 *
 * The format is llmstxt.org's, and the order is not negotiable: an H1 with the
 * name, a blockquote summary, some prose with no headings in it, then H2
 * sections that hold nothing but markdown link lists. An agent parsing this
 * looks for exactly that shape, so a stray `###` in the prose costs the file
 * its meaning rather than merely its tidiness.
 *
 * **"When to use Prequel?" is the one section that does not follow that
 * shape, and it is deliberate.** The spec says an H2 holds nothing but a list
 * of links; this one holds plain bullets, because the question it answers is
 * what somebody is here to make, and the answer should be readable without
 * opening fourteen pages to find it. A strict parser reading H2s as link lists
 * finds none here and takes nothing from the section, which is the cost; every
 * one of those pages is still reachable from `/usecases` in `Product`.
 *
 * Written out rather than generated from `content/use-cases.ts`, which the
 * docs list below is not. Each line here gathers several of those pages and
 * names what Prequel does for them, and no mechanical join of an eyebrow and a
 * heading produces that. The price is that a use case added to the site does
 * not appear here on its own, so this is a list to revisit when the site gains
 * a kind of video rather than a sixteenth page of one it already has.
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
import { PRICE_LIFETIME, PRICE_MONTHLY } from "@/lib/pricing";
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

## When to use Prequel?

- Product demos, SaaS walkthroughs, sales and launch videos, where the zooms land on every click and the cursor is smoothed and motion blurred rather than left to dart about
- Courses, training, onboarding and software tutorials that want captions transcribed on your own Mac, a teleprompter sitting under the camera that never appears in the recording, and a look saved once and applied to the next lesson
- Vertical and square cuts of a take recorded in widescreen: changing the frame preset moves the layout, the camera and the background with it, because every position is stored as a fraction of the frame rather than in pixels
- Recording the whole display, a single window or a region you draw, with your camera, your microphone and Mac system audio kept on separate tracks you can still balance after the take
- Bug reports, code walkthroughs and changelog clips, where a zoom is what makes small text readable, and the typing and clicking get sounds placed on the keystrokes you can see
- Working offline from end to end: recording, editing and exporting all happen on your Mac with no network at all, and publishing a share link is a separate step taken after the file already exists

## Key features

- Recording: the whole display, a single window that stays followed as it moves, or a region you draw. Captured at your display's native resolution. The camera is a track of its own, and the microphone and Mac system audio are two more, so nothing is baked together. A countdown, a global shortcut, and pause and resume mid take. Prequel's own windows are kept out of the picture
- Automatic zooms: the clicks and keystrokes in the take are clustered into shots, and a zoom is placed on each. Level, speed and an ease you drag as a curve. Every generated zoom is editable and any of them can be deleted, and you can add zoom and pan again anywhere. A zoom can follow the cursor, hold on a region, or sit on a field, and it can carry a perspective tilt and a focus falloff. A loupe you can read through
- Layout: seventeen layouts and a custom one, including cutout layouts that keep only the person and lean the recording a few degrees away from them. One layout for the whole video or one per clip, and either picture can be dragged anywhere in the frame
- Camera: six shapes, sized and mirrored, and five plates to dress the bubble in: a polaroid, a Mac window, a stamp, an old television and a Macintosh. The background can be cut away with a person matte so only you are left. The camera shrinks itself while a zoom is in
- Background and frame: a solid, a gradient, your own wallpaper, a catalogue, or a pattern drawn at whatever size the frame needs, with padding, corner radius, border and shadow around the recording, and a blur behind it. Your own logo anywhere in the frame
- Cursor and clicks: pointer styles drawn rather than filmed, so they stay sharp through a zoom, including an arm that reaches in to point and one carrying a name tag. Smoothed while it travels, motion blurred as it moves, and hidden when it goes still or while you type. Thirteen click marks, from a ripple or a sonar ring to confetti, ink or chalk
- Keys you pressed: the shortcuts used during the take, drawn back as rows of key caps, with a panel to style them
- Looks: seventeen filters applied per clip, from a warm or faded grade to halftone, CRT, VHS, film, Riso, Game Boy and C64. A look worth keeping is saved as a scene preset and applied to the next recording
- Captions and text: transcribed on your Mac with nothing uploaded, then edited as text, where editing the transcript edits the video. Six looks, a colour for the word being spoken, placed top, middle or bottom in any of nine faces your Mac already has. Text overlays on top of that, with templates and motion of their own
- Annotations: arrows, lines, pen, rectangles, ellipses, highlights and masks drawn over the recording
- Sound: a gain for the microphone and one for the Mac, a clean-up pass over the microphone, and a music bed under the whole edit. Typing and clicks can be given sounds placed on the keystrokes you can see, with a switch to pick: Tactile, Linear, Clicky, Thock, the soft tock of a phone keyboard, or off, and Soft or Mechanical for the mouse
- Timeline: a filmstrip and a waveform under every clip, with split, trim, delete and duplicate, and clip speed up to ten times. Cutting words from the transcript leaves one clip with the footage stepped over rather than a timeline in pieces
- Teleprompter: a script in the notch under the camera that follows your voice as you read, and never appears in the recording
- Export: MP4, HEVC or GIF, 4K by default, encoded in hardware on your own Mac. Any frame you like, landscape, vertical, square, or a size you type, and what comes out is the frame you approved
- Sharing: an export can be published as a link to a watch page that needs no account, never indexed by search engines, unfurling where you paste it, with a library of everything you have shared
- Command line: the same recording, editing and rendering driven from a terminal, or by an agent

## Product

${at("/", `${SITE.name} — ${SITE.tagline}`, "What the app does, and the download")}
${at("/features", "Features", "Every feature in detail, grouped by what it does to a recording")}
${at("/pricing", "Pricing", `${PRICE_MONTHLY} a month or ${PRICE_LIFETIME} once, what each includes, and the FAQ`)}
${at("/usecases", "Use cases", "Product demos, tutorials, onboarding, courses and shorts")}
${at("/compare", "Compare", "Prequel against the other Mac screen recorders, feature by feature")}

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
