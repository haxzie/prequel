import type { Metadata } from "next";
import Link from "next/link";

import { ButtonLink } from "@/components/Button";
import { DownloadCta } from "@/components/DownloadButton";
import { Faq } from "@/components/Faq";
import { JsonLd } from "@/components/JsonLd";
import { Container, SectionHeading } from "@/components/Section";
import { freeTools } from "@/content/free-tools";
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
    question: "Can I use the recordings commercially?",
    answer:
      "Yes. They are your recordings, there is no watermark on them and Prequel keeps no copy. Use them anywhere you like.",
  },
];

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
            lede="Small tools that run in a tab. Record your screen, your camera or your voice, or mark up a screenshot. Nothing is uploaded and nothing asks you to sign up."
            align="centre"
          />
        </Container>
      </section>

      <section className="pb-8">
        <Container>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {freeTools.map((tool) => (
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

      <section className="pt-12">
        <Container>
          <SectionHeading
            eyebrow="How they work"
            title="Your browser does the recording"
            lede="Each tool uses capture and encoding that is already in the browser. The frames are composited in a canvas on your machine and encoded there, so there is no upload step and no account."
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
                body: "MP4 where your browser writes it, WebM where it does not, PNG from the editor, and no watermark on any of it.",
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
