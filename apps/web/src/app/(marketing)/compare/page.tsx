import type { Metadata } from "next";
import Link from "next/link";

import { Mark, MARK_RADIUS } from "@/components/comparison/Comparison";
import { DownloadCta } from "@/components/DownloadButton";
import { JsonLd } from "@/components/JsonLd";
import { Logo } from "@/components/Logo";
import { Container, Eyebrow, SectionHeading } from "@/components/Section";
import { Cell } from "@/components/Table";
import { FEATURE_ROWS, PREQUEL_FEATURES, competitors, formatVerified } from "@/content/competitors";
import type { FaqEntry } from "@/lib/faq";
import { faqPageJsonLd, itemListJsonLd, pageMetadata } from "@/lib/seo";
import { SITE } from "@/lib/site";

/** Read off the registry, so a seventh competitor names itself here. */
const names = competitors.map((competitor) => competitor.name);
const named = `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

export const metadata: Metadata = pageMetadata({
  title: "Compare screen recorders for Mac",
  description: `Prequel beside ${named} on one grid: automatic zoom, camera, backgrounds, export, licence and price, each checked against the vendor's own site.`,
  path: "/compare",
});

/**
 * The questions somebody types before they have a shortlist.
 *
 * Phrased as searches rather than as support questions, because that is the
 * page's job: "best screen recorder for Mac" is a query, and an answer that
 * opens with the query is what gets quoted. Every figure in an answer is one
 * the grid above already shows, so the two cannot disagree; the grid's own
 * rule about citing applies, and a number not in `competitors.ts` does not go
 * here either. Rendered once as copy and once as `FAQPage`, off this array.
 */
const FAQ: FaqEntry[] = [
  {
    question: "What is the best screen recorder for Mac?",
    answer:
      "Prequel, if the recording has to look produced without an afternoon of editing. It records the screen, your camera and both audio tracks, then opens an editor with the zooms already placed on your clicks and typing, your camera framed and a background behind it. Export is 4K at 120 fps, on your Mac, with nothing uploaded. Seven days free, then $9 a month or $29 once.",
  },
  {
    question: "Which Mac screen recorder has automatic zoom?",
    answer:
      "Prequel, Screen Studio and Tella place zooms on their own. Prequel also zooms on the field you are typing into, and adds a perspective tilt on the push-in with focus falling away from the subject, which none of the others on the grid do. Every generated zoom is editable afterwards.",
  },
  {
    question: "What is the best Screen Studio alternative?",
    answer:
      "Prequel is the closest to it: the same automatic zooms and cursor smoothing, plus the perspective tilt, the focus falloff, fourteen layouts and export at 4K 120 where Screen Studio stops at 4K 60. It is $9 a month, the same as Screen Studio's yearly rate and a third of its monthly one, and there is a $29 lifetime licence, which Screen Studio withdrew in 2025.",
  },
  {
    question: "Which screen recorder does not upload my recordings?",
    answer:
      "Prequel records, edits, transcribes and exports on your Mac. Nothing leaves it unless you press Share. Loom, Descript and Tella upload the recording to work on it; Screen Studio records locally but uploads for a share link. On the grid, the only two that transcribe captions on the machine are Prequel and Screen Studio.",
  },
  {
    question: "Which screen recorder exports 4K at 120 fps?",
    answer:
      "Prequel. Screen Studio exports 4K at 60 fps, and the rest top out at 4K on a paid plan or at 60. The export is rendered on your Mac's own media engine, with no upload and no cloud render.",
  },
  {
    question: "Which screen recorder can remove the camera background?",
    answer:
      "Prequel cuts you out of the camera picture while you record, so it is you standing on the wallpaper with no card, shape or shadow around you. Camtasia, ScreenFlow and Descript remove a background inside a video editor; Loom and Tella swap or blur it inside the camera bubble.",
  },
  {
    question: "Which is the smallest screen recorder to download?",
    answer:
      "Prequel is 102 MB, with the recorder and the whole editor in it. Screen Studio is 366 MB, Camtasia 435 MB, Descript 255 MB and Loom 228 MB. ScreenFlow is 89 MB. Tella's 25 MB app is only the recorder, and its editor is a web page.",
  },
  {
    question: "Is there a free screen recorder with automatic zoom for Mac?",
    answer:
      "Prequel is free for seven days with the whole app in it, no card needed, and then $9 a month or $29 once. Screen Studio and Tella are paid too. The free recorders in this category capture faithfully and leave the zooms, the framing and the background to you.",
  },
  {
    question: "Which screen recorder is cheapest?",
    answer:
      "Prequel is $9 a month or $29 once, for everything. Screen Studio is $29 a month or $9 a month billed yearly; Loom Business is $18 a seat; Tella is $13 a seat; Descript's paid plans start at $16; Camtasia is an annual subscription and ScreenFlow is $199.99 once. Prices as checked on the dates under the grid.",
  },
];

/**
 * The column heading's mark. The hero on `/alternatives/<slug>` draws these at
 * 64px; seven of those across a row is a row of billboards, and the names under
 * them are what the eye reads anyway.
 */
const HEADING_MARK = 40;

/**
 * The megabytes in a "Download size" cell, or null for a cell that does not
 * start with a number.
 *
 * Parsed from the string rather than stored beside it. The row's value is the
 * string — it is what every other page prints — and a second numeric field
 * would be one more thing to keep in step with it by hand. The format is the
 * one the note on `PREQUEL_FEATURES.downloadSize` fixes: decimal megabytes,
 * first thing in the string.
 */
function megabytes(value: boolean | string): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d+) MB/.exec(value);
  return match ? Number(match[1]) : null;
}

/**
 * The largest download on the grid, which is the row's full height.
 *
 * Over every column including ours, so the tallest bar is whoever actually
 * ships the biggest file rather than always a rival.
 */
const LARGEST_DOWNLOAD = Math.max(
  ...[PREQUEL_FEATURES, ...competitors.map((competitor) => competitor.features)].map(
    (features) => megabytes(features.downloadSize) ?? 0,
  ),
);

/**
 * A bar behind a "Download size" cell, as tall as its share of the largest.
 *
 * The row is the chart: the cell's height is the axis and the bar is drawn
 * from the bottom edge, so seven numbers that read alike ("228 MB", "255 MB")
 * are also seven heights that do not. It sits behind the text, in a tint of
 * the ink rather than a colour, because it is a background for a number and
 * not a mark of its own; the number stays in text ink for the same reason.
 * Ours is in `positive` to match the ticks in the column.
 */
function SizeBar({ value, own = false }: { value: boolean | string; own?: boolean }) {
  const size = megabytes(value);
  if (size === null || LARGEST_DOWNLOAD === 0) return null;
  return (
    <span
      // A pixel in from each side, so two full-height neighbours are two bars
      // with a hairline of page between them rather than one wide block. The
      // top edge is a solid rule and the corners are square: the rule is the
      // reading, the height the eye compares across the row, and a soft
      // corner blurs exactly the edge that carries it.
      className={`pointer-events-none absolute inset-x-px bottom-0 border-t ${
        own ? "border-positive bg-positive/15" : "border-fg/40 bg-fg/6"
      }`}
      style={{ height: `${(size / LARGEST_DOWNLOAD) * 100}%` }}
      aria-hidden
    />
  );
}

/**
 * One grid, every recorder, every axis in `FEATURE_ROWS`.
 *
 * Wider than any screen on purpose, and scrolled sideways: the honest width of
 * seven columns of prose is about ninety rem, and folding them into cards
 * would put the comparison back into the one-page-per-rival shape this page
 * exists to escape. What keeps it readable while it scrolls is that the first
 * two columns do not move — the axis being read and our own answer to it stay
 * put, and the rivals slide past them.
 *
 * `border-separate` rather than the collapse the other tables use. Chrome drops
 * the borders of a `position: sticky` cell under `border-collapse` — they are
 * painted by the table, not the cell, and stay behind when the cell pins — so
 * the row rules and the pinned edge are drawn on the cells and the spacing is
 * zeroed instead.
 *
 * Fixed column widths, not fluid ones. The second pinned column's `left` is
 * the first column's width, and there is no way to say "the width of the
 * column before me" in CSS; a fluid first column would slide the second one
 * over or under it. So the three widths are custom properties on the wrapper,
 * and the `<col>`s, the `left` offsets and the table's own width all read
 * them — one number each, and the offset cannot drift from the width it is.
 *
 * The table's width is spelled out because `table-layout: fixed` is ignored
 * on a table whose width is `auto`: the browser falls back to auto layout,
 * the `<col>` widths become suggestions, and the pinned column lands a few
 * rem past the one it should abut. `w-full` would be a width, but a fixed
 * table wider than its columns stretches them to fill, which moves the first
 * column's edge away from the offset the second one was given.
 */
export default function Compare() {
  return (
    <>
      <JsonLd
        data={itemListJsonLd(
          competitors.map((competitor) => ({
            name: competitor.name,
            path: `/alternatives/${competitor.slug}`,
          })),
        )}
      />

      <section className="pt-20 pb-10">
        <Container>
          <SectionHeading
            level={1}
            eyebrow="Compare"
            title="How Prequel compares"
            lede="The recorders people weigh Prequel against, on one grid, feature by feature. Scroll across for each one. The name at the top opens the full comparison."
            align="centre"
          />
          <DownloadCta className="mt-10" />
        </Container>
      </section>

      <section className="pb-20">
        {/* Not `Container`. The site's measure is 72rem, which shows the
            pinned pair and two and a half rivals; this is the one page whose
            content is wider than any screen, so it gets the share page's 90rem
            and shows four. The rails still line up with the header's at every
            width under that, because the padding is the same. */}
        <div className="mx-auto w-full max-w-[90rem] px-5 sm:px-8">
          {/* Bled to the viewport edge on a phone. The two pinned columns take
              fifteen and a half rem between them, which on a 375px screen
              leaves about 130px for the column being compared; the container's
              padding would take 40 of those. That much of a rival column is
              the difference between a grid that reads as scrollable and one
              that reads as cut off. */}
          <div className="-mx-5 overflow-x-auto border-y border-line [--own:6.5rem] [--rival:10rem] [--row:9rem] sm:mx-0 sm:rounded-2xl sm:border-x sm:[--own:10rem] sm:[--rival:12rem] sm:[--row:15rem]">
            <table
              className="table-fixed border-separate border-spacing-0 text-sm"
              style={{
                width: `calc(var(--row) + var(--own) + ${competitors.length} * var(--rival))`,
              }}
            >
              <colgroup>
                <col className="w-(--row)" />
                <col className="w-(--own)" />
                {competitors.map((competitor) => (
                  <col key={competitor.slug} className="w-(--rival)" />
                ))}
              </colgroup>

              <thead>
                <tr>
                  {/* `z-20` on the two pinned headings and `z-10` on the pinned
                      body cells: a corner cell has to win against both the
                      row it is in and the column it is in, and a body cell
                      scrolling up under the heading is the case that shows the
                      difference. */}
                  <th
                    scope="col"
                    className="sticky left-0 z-20 border-b border-line bg-surface px-5 py-5 text-left font-medium text-muted"
                  >
                    Feature
                  </th>
                  <th
                    scope="col"
                    className="sticky left-(--row) z-20 border-r border-b border-line bg-surface px-4 py-5 text-left align-bottom"
                  >
                    <span className="flex flex-col items-start gap-3">
                      <Logo size={HEADING_MARK} radius={MARK_RADIUS} />
                      <span className="font-medium text-fg">{SITE.name}</span>
                    </span>
                  </th>
                  {competitors.map((competitor) => (
                    <th
                      key={competitor.slug}
                      scope="col"
                      className="border-b border-line bg-surface px-4 py-5 text-left align-bottom"
                    >
                      {/* The heading is the way into the long-form page. Their
                          name is the link and the mark is decoration beside it,
                          so a screen reader hears the name once. */}
                      <Link
                        href={`/alternatives/${competitor.slug}`}
                        className="group flex flex-col items-start gap-3"
                      >
                        <Mark competitor={competitor} size={HEADING_MARK} />
                        <span className="font-medium text-fg underline decoration-line underline-offset-4 transition-colors group-hover:decoration-fg">
                          {competitor.name}
                        </span>
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {FEATURE_ROWS.map((row, i) => {
                  // Every cell draws its own top rule except the first row's,
                  // whose rule is the heading's bottom border.
                  const rule = i === 0 ? "" : "border-t border-line";
                  // The size row is a bar chart, so it is given the height of
                  // one — a single line of text is too short an axis to tell
                  // 228 from 255 on. `relative` is what the bars are placed
                  // against, and the value is lifted above them.
                  const chart = row.key === "downloadSize";
                  const cell = chart ? "relative h-24" : "";
                  return (
                    <tr key={row.key}>
                      <th
                        scope="row"
                        className={`sticky left-0 z-10 bg-bg px-5 py-4 text-left align-top font-normal text-muted ${rule}`}
                      >
                        {row.label}
                      </th>
                      <td
                        className={`sticky left-(--row) z-10 border-r border-line bg-bg px-4 py-4 align-top ${cell} ${rule}`}
                      >
                        {chart && <SizeBar value={PREQUEL_FEATURES[row.key]} own />}
                        <span className="relative">
                          <Cell value={PREQUEL_FEATURES[row.key]} own />
                        </span>
                      </td>
                      {competitors.map((competitor) => (
                        <td key={competitor.slug} className={`px-4 py-4 align-top ${cell} ${rule}`}>
                          {chart && <SizeBar value={competitor.features[row.key]} />}
                          <span className="relative">
                            <Cell value={competitor.features[row.key]} />
                          </span>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* The same working the per-rival pages show under their tables,
              once per column. A grid of ticks about six other products with
              no date on it is an opinion. */}
          <ul className="mt-5 flex flex-col gap-1.5 text-xs text-muted">
            {competitors.map((competitor) => (
              <li key={competitor.slug}>
                {competitor.name}: checked on {formatVerified(competitor.verifiedOn)} against{" "}
                {competitor.sources.map((source, i) => (
                  <span key={source.url}>
                    {i > 0 ? ", " : ""}
                    <a
                      href={source.url}
                      className="underline decoration-line underline-offset-4 hover:text-fg"
                      rel="nofollow noopener"
                    >
                      {source.label}
                    </a>
                  </span>
                ))}
                .
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* The pricing page's shape rather than the landing page's accordion:
          every answer in the DOM in full, which is what a crawler quotes and
          what ⌘F finds. */}
      <section className="pb-24">
        <Container className="grid gap-10 lg:grid-cols-[1fr_1.6fr]">
          <div>
            <Eyebrow>FAQ</Eyebrow>
            <h2 className="text-2xl font-medium tracking-tight text-balance text-fg">
              Before you pick one
            </h2>
          </div>
          <dl className="flex flex-col gap-px overflow-hidden rounded-2xl border border-line bg-line">
            {FAQ.map((item) => (
              <div key={item.question} className="bg-bg px-6 py-6">
                <dt className="text-[0.9375rem] font-medium text-fg">{item.question}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-muted">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </Container>

        {/* Off the same array as the markup above, so the two cannot drift. */}
        <JsonLd data={faqPageJsonLd(FAQ)} />
      </section>
    </>
  );
}
