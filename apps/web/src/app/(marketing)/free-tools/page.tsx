import type { Metadata } from "next";
import Link from "next/link";

import { ButtonLink } from "@/components/Button";
import { DownloadCta } from "@/components/DownloadButton";
import { Faq } from "@/components/Faq";
import { JsonLd } from "@/components/JsonLd";
import { Container, SectionHeading } from "@/components/Section";
import { freeTools, type FreeTool } from "@/content/free-tools";
import type { FaqEntry } from "@/lib/faq";
import { itemListJsonLd, pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Free tools",
  description:
    "Free browser tools from Prequel: record your screen, your webcam or your voice in a tab and download the file. No sign up, no upload, no watermark.",
  path: "/free-tools",
});

/**
 * The index's own questions.
 *
 * About the set rather than about any one tool, which is what keeps them from
 * repeating the three pages below. "Is it free" is answered on every page
 * because it is the first thing anybody asks; it is answered differently here,
 * about all three at once.
 */
const INDEX_FAQ: FaqEntry[] = [
  {
    question: "What does free mean here?",
    answer:
      "No account, no trial, no card and no watermark. Each tool records in your browser, so running one costs nothing to serve and there is nothing to charge for.",
  },
  {
    question: "Do these tools work without installing anything?",
    answer:
      "Yes. Each one is a web page that uses capture, encoding and drawing your browser already has. Open it, allow access to what you are recording or drop an image in, and save the file at the end.",
  },
  {
    question: "Where do my recordings go?",
    answer:
      "Into your browser's memory while you work, and into your downloads folder when you save them. Nothing is uploaded, and closing the tab discards whatever has not been saved.",
  },
  {
    question: "Which browsers do they need?",
    answer:
      "Chrome, Edge, Firefox or Safari 17 on a desktop. The webcam recorder, the voice recorder and the screenshot editor also work on a phone; screen capture has no mobile API, so that one needs a computer.",
  },
  {
    question: "Why does Prequel give these away?",
    answer:
      "Because they answer the quick jobs, and because the limits of a browser are the clearest explanation of what a native recorder is for. Prequel records on your Mac at full resolution, places the zooms and exports at up to 4K.",
  },
  {
    question: "Why do the converters download 32 MB the first time?",
    answer:
      "Because the converter is ffmpeg itself, compiled to WebAssembly and sent to you rather than run on a server. It is cached for the rest of your visit, so only the first conversion waits for it, and it is the reason your file is never uploaded.",
  },
  {
    question: "Can I use the recordings commercially?",
    answer:
      "Yes. They are your recordings, there is no watermark on them and Prequel keeps no copy. Use them anywhere you like.",
  },
];

type ToolKind = FreeTool["surface"]["kind"];

/**
 * The bands, in the order they are read.
 *
 * This page owns the order and the words; the registry owns only which band a
 * tool is in, through its `surface`.
 *
 * A `Record` rather than an array of `{ kind, … }`, because the array could be
 * missing a kind and still typecheck — which is exactly what happened when the
 * downloader was added. It went out linked from the footer and the sitemap and
 * with no card on this page at all, since the one thing that renders a card is
 * a band to put it in. A missing kind is now a build error.
 */
const BANDS: Record<ToolKind, { label: string; lede: string }> = {
  recorder: {
    label: "Record",
    lede: "Your screen, your camera or your voice, captured in the tab and downloaded as a file.",
  },
  editor: {
    label: "Edit",
    lede: "Mark up a screenshot and put it on a background, without an account or an extension.",
  },
  converter: {
    label: "Convert",
    lede: "ffmpeg runs inside your browser, so a file is converted on your own machine rather than uploaded to a queue.",
  },
  downloader: {
    label: "Download",
    lede: "Paste a link to a post and save its video, fetched by your browser from where it already sits.",
  },
};

/** The order the bands are shown in, which is the order they are wanted in. */
const ORDER = [
  "recorder",
  "editor",
  "converter",
  "downloader",
] as const satisfies readonly ToolKind[];

/**
 * `never` when every kind is in `ORDER` above.
 *
 * `BANDS` makes a kind carry words; this makes it get shown. Without it a kind
 * left out of `ORDER` renders nothing and says nothing, which is the same
 * silent gap one line up — a tool that exists everywhere except the page
 * listing the tools.
 */
type Unbanded = Exclude<ToolKind, (typeof ORDER)[number]>;
const _everyKindIsShown: Unbanded extends never ? true : false = true;

export default function FreeTools() {
  return (
    <>
      <JsonLd
        data={itemListJsonLd(
          freeTools.map((tool) => ({ name: tool.name, path: `/free-tools/${tool.slug}` })),
        )}
      />

      <section className="pt-20 pb-10">
        <Container>
          <SectionHeading
            level={1}
            eyebrow="Free tools"
            title="Free tools that run in your browser"
            lede="Record, mark up and convert, all inside a tab. Your files are read and written on your own machine, so nothing is uploaded and nothing asks you to sign up."
            align="centre"
          />
        </Container>
      </section>

      {/* Grouped by what the tool is, the way `/usecases` bands its sixteen.
          Thirteen cards in one grid is a wall, and the four groups are the four
          reasons somebody is on this page. The order is the order they are
          wanted in: recording first, because that is what Prequel is. */}
      {ORDER.map((kind) => (
        <section key={kind} className="pb-8">
          <Container>
            <SectionHeading title={BANDS[kind].label} lede={BANDS[kind].lede} />
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {freeTools
                .filter((tool) => tool.surface.kind === kind)
                .map((tool) => (
                  /* The href is a literal rather than a field on the registry
                 entry. `Route` resolves its generic to `string`, and `string`
                 does not extend the generated `/free-tools/${SafeSlug<…>}`, so
                 a stored field typed `Route` is rejected for every one of
                 these. `Link` infers it from the template instead. */
                  <Link
                    key={tool.slug}
                    href={`/free-tools/${tool.slug}`}
                    className="group flex flex-col rounded-2xl border border-line bg-surface p-7 transition-colors hover:border-muted/40 hover:bg-elevated"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-current/20 bg-current/10 text-brand-from">
                        <tool.icon className="size-[1.05rem]" strokeWidth={1.75} aria-hidden />
                      </span>
                      <p className="font-mono text-[11px] tracking-wider text-muted uppercase">
                        {tool.eyebrow}
                      </p>
                    </div>
                    <h2 className="mt-4 text-[0.9375rem] font-medium text-fg">{tool.name}</h2>
                    <p className="mt-2.5 text-sm leading-relaxed text-muted">{tool.summary}</p>
                    <span className="mt-5 text-sm font-medium text-fg group-hover:underline">
                      Open the tool
                    </span>
                  </Link>
                ))}
            </div>
          </Container>
        </section>
      ))}

      <section className="pt-12">
        <Container>
          <SectionHeading
            eyebrow="How they work"
            title="Your browser does the recording"
            lede="Each tool uses capture, encoding and drawing your browser already has, plus ffmpeg compiled to WebAssembly for the converters. Everything runs on your own machine, so there is no upload step and no account."
          />
          <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3">
            {[
              {
                title: "Keep the recording to yourself",
                body: "The file is made in the tab and saved from the tab. Prequel never receives it, because nothing in these pages can send it.",
              },
              {
                title: "Start in a second",
                body: "No download, no account, no permission dialog until you ask to record. Allow access, and the preview is live.",
              },
              {
                title: "Download something you can post",
                body: "MP4 or WebM from the recorders, PNG from the editor, MP3 or MP4 from the converters, and no watermark on any of it.",
              },
            ].map((card) => (
              <div key={card.title} className="bg-bg p-7">
                <h3 className="text-[0.9375rem] font-medium text-fg">{card.title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-muted">{card.body}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="pt-20">
        <Container>
          <div className="squircle lit relative overflow-hidden rounded-3xl border border-line bg-surface px-6 py-14 text-center sm:px-16">
            <div className="brand-gradient pointer-events-none absolute inset-x-0 top-0 h-px opacity-70" />
            <h2 className="text-2xl font-medium tracking-tight text-balance text-fg sm:text-3xl">
              Recording more than once a week?
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-pretty text-muted">
              Prequel records on your Mac and opens an editor with the zooms already placed, your
              camera framed and a background applied.
            </p>
            <DownloadCta className="mt-8" />
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <ButtonLink href="/features" variant="secondary" size="sm">
                All the features
              </ButtonLink>
              <ButtonLink href="/pricing" variant="secondary" size="sm">
                Pricing and licences
              </ButtonLink>
            </div>
          </div>
        </Container>
      </section>

      <Faq heading="Free, in a browser, and what that means" entries={INDEX_FAQ} />
    </>
  );
}
