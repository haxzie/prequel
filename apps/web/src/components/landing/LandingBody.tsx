import {
  ChevronDown,
  // Aliased: `Image` is already taken by next/image in this file.
  Image as ImageIcon,
  MousePointer2,
  SlidersHorizontal,
  Webcam,
  ZoomIn,
} from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";

import { ButtonLink } from "@/components/Button";
import { JsonLd } from "@/components/JsonLd";
import {
  BackgroundIllustration,
  CameraIllustration,
  CursorIllustration,
  ExportIllustration,
  TimelineIllustration,
  ZoomIllustration,
} from "@/components/editor-illustrations";
import { Container, Eyebrow, SectionHeading } from "@/components/Section";
import { DownloadCta } from "@/components/DownloadButton";
import type { FaqEntry } from "@/lib/faq";
import { faqPageJsonLd } from "@/lib/seo";
import { TRIAL_DAYS } from "@/lib/pricing";

import editor from "../../../public/editor-shot.png";
import stage from "../../../public/stage.jpg";

/** What is already done by the time the editor opens on a take. */
const ALREADY_DONE = [
  { icon: ZoomIn, done: "Zooms placed", note: "On every click and every burst of typing" },
  { icon: Webcam, done: "Camera framed", note: "Shaped, sized and set in a corner" },
  { icon: ImageIcon, done: "Background applied", note: "Padding, radius, border and shadow" },
  {
    icon: SlidersHorizontal,
    done: "Audio balanced",
    note: "Microphone and system on separate gains",
  },
  {
    icon: MousePointer2,
    done: "Cursor cleaned up",
    note: "Smoothed, resized, hidden when it idles",
  },
];

const FEATURES = [
  {
    title: "Zooms that follow the work",
    body: "Push in on the cursor, a region or whatever you are typing into. Level, speed, tilt and yaw, with progressive blur falling away from the focus.",
    illustration: <ZoomIllustration />,
  },
  {
    title: "A camera you frame afterwards",
    body: "Circle, squircle, rounded or wide, in any corner and any size. The webcam is never burned into the recording, so none of it is decided while you record.",
    illustration: <CameraIllustration />,
  },
  {
    title: "Backgrounds worth shipping",
    body: "Your own wallpaper by default, seven bundled presets, gradients and solids. Padding, radius, border and shadow on top.",
    illustration: <BackgroundIllustration />,
  },
  {
    title: "Cuts on a real timeline",
    body: "Trim the dead air, slice by slice, with a waveform under every clip and a playhead that scrubs. Layout, background and audio can all change mid-take.",
    illustration: <TimelineIllustration />,
  },
  {
    title: "A cursor that behaves",
    body: "Four pointer styles, resized to survive a zoom, and gone from the frame after a few seconds of stillness rather than parked over your work.",
    illustration: <CursorIllustration />,
  },
  {
    title: "What you see is what exports",
    body: "The preview and the exporter draw the same plan, so the file is the frame you approved — not a close approximation of it.",
    illustration: <ExportIllustration />,
  },
];

const SPECS = [
  ["Resolution", "Up to 4K"],
  ["Frame rate", "Up to 120 fps"],
  ["Codecs", "H.264 · HEVC"],
  ["Encoding", "Hardware, VideoToolbox"],
  ["Compositing", "Metal"],
  ["Output", "Constant frame rate MP4"],
];

const PRESETS = [
  "Landscape 16:9",
  "4K",
  "Vertical 9:16",
  "Square 1:1",
  "Portrait 4:5",
  "YouTube",
  "Shorts",
  "TikTok",
  "Reels",
  "X",
  "LinkedIn",
];

/**
 * Everything below the hero, shared by `/` and every `/create/<slug>` page.
 *
 * The arrays above stay with the loops that read them rather than moving to
 * `lib/`: `FEATURES` holds JSX, and a constant used in one place is just
 * indirection.
 */
export function LandingBody({ faq }: { faq: FaqEntry[] }) {
  return (
    <>
      <section>
        {/* The stage is a panel between the rails rather than a full-bleed
            band: the gradient stops where the page's borders do, and the
            screenshot sits inside it with the gradient reading as a frame.

            `isolate` keeps the backdrop's negative z-index inside this panel.
            Without a stacking context of its own it escapes to the root and
            paints behind the page background, which reads as the image simply
            not loading. */}
        <div className="relative isolate mx-auto w-full max-w-6xl overflow-hidden px-6 py-20 sm:px-14 sm:py-28">
          <Image
            src={stage}
            alt=""
            fill
            sizes="(min-width: 1152px) 1152px, 100vw"
            className="-z-10 object-cover"
          />
          {/* No border, rounding or shadow of ours. This is a composed shot on
              a transparent canvas — the window, the camera bubble hanging off
              its corner and the recording bar below it — and every one of those
              already carries its own corners and shadow. A `border` would draw
              a rectangle around the empty space they float in, and `box-shadow`
              follows the element box rather than the artwork, so it would cast
              a hard rectangle behind a composition that has none. */}
          <Image
            src={editor}
            alt="The Prequel editor: a recording on a background with the clip inspector open, the camera bubble beside it, and the recording bar below."
            // Eager rather than lazy — it is the first thing below the hero and
            // would otherwise pop in. `priority` is deprecated in Next 16.
            loading="eager"
            quality={90}
            className="w-full"
          />
        </div>
      </section>

      <section className="py-24">
        <Container className="grid items-start gap-12 lg:grid-cols-2 lg:gap-20">
          <SectionHeading
            eyebrow="Automatic"
            title="It arrives already directed"
            lede="A raw screen recording is flat — one distance from the viewer for the whole take, with the thing that matters too small to see. Prequel watches where you click and type while it records, and opens the editor with that pass already made."
          />

          <div className="rounded-2xl border border-line bg-surface p-2">
            <ul className="flex flex-col gap-px overflow-hidden rounded-xl">
              {ALREADY_DONE.map(({ icon: Icon, done, note }) => (
                <li
                  key={done}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-elevated px-4 py-3.5"
                >
                  <Icon className="size-4 shrink-0 text-fg" strokeWidth={1.75} aria-hidden />
                  <span className="text-sm text-fg">{done}</span>
                  <span className="ml-auto text-xs text-muted">{note}</span>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      <section className="bg-surface/40 py-24">
        <Container>
          <SectionHeading
            eyebrow="The editor"
            title="Everything you would have done in post"
            lede="It opens by itself when you stop recording, on the take you just made. Nothing to import, nothing to line up."
            align="centre"
          />
          <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="bg-bg">
                <div className="relative h-36 overflow-hidden">{feature.illustration}</div>
                <div className="p-7">
                  <h3 className="text-[0.9375rem] font-medium text-fg">{feature.title}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-muted">{feature.body}</p>
                </div>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-24">
        <Container className="grid items-start gap-12 lg:grid-cols-2 lg:gap-20">
          <SectionHeading
            eyebrow="Quality"
            title="Exports that hold up"
            lede="A video that looks produced is worth nothing if the file is soft. Capture and export run on your Mac's own media engine — hardware H.264 or HEVC, composited in Metal — so 1080p60 records without dropping frames and 4K is a setting rather than a compromise."
          />
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line">
            {SPECS.map(([label, value]) => (
              <div key={label} className="bg-surface px-5 py-5">
                <dt className="font-mono text-[11px] tracking-wider text-muted uppercase">
                  {label}
                </dt>
                <dd className="mt-1.5 text-sm text-fg">{value}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </section>

      <section className="pb-24">
        <Container>
          <SectionHeading
            eyebrow="Formats"
            title="One MP4, shaped for wherever it is going"
            lede="Switch a recording from landscape to vertical and the look holds — the framing is stored in proportions, not pixels, so nothing slides off the frame on the way."
            align="centre"
          />
          <ul className="mx-auto mt-10 flex max-w-3xl flex-wrap justify-center gap-2">
            {PRESETS.map((preset) => (
              <li
                key={preset}
                className="rounded-full border border-line bg-surface px-4 py-2 text-sm text-muted"
              >
                {preset}
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <CallToAction />
      <Faq entries={faq} />
    </>
  );
}

function Faq({ entries }: { entries: FaqEntry[] }): ReactNode {
  return (
    <section id="faq" className="scroll-mt-16 pt-24">
      <Container className="grid gap-10 lg:grid-cols-[1fr_1.6fr]">
        <div>
          <Eyebrow>FAQ</Eyebrow>
          <h2 className="text-2xl font-medium tracking-tight text-balance text-fg">
            Zooms, exports and the rest
          </h2>
        </div>

        {/*
          Every answer is rendered in full, always. An accordion would hide most
          of this behind a click; `<details>` would at least keep it in the DOM,
          but plain markup removes the question entirely — for crawlers and for
          anyone who wants to skim or search the page with ⌘F.
        */}
        <div className="flex flex-col gap-px overflow-hidden rounded-2xl border border-line bg-line">
          {entries.map((item, i) => (
            <details
              key={item.question}
              // The first one open, so the section does not read as a wall of
              // closed rows with nothing to show for itself.
              open={i === 0}
              className="faq-item group bg-bg"
            >
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-6 py-5 text-[0.9375rem] font-medium text-fg [&::-webkit-details-marker]:hidden">
                {item.question}
                <ChevronDown
                  className="mt-0.5 size-4 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <p className="px-6 pb-5 text-sm leading-relaxed text-muted">{item.answer}</p>
            </details>
          ))}
        </div>
      </Container>

      {/* FAQPage structured data, off the same array as the markup above so the
          two cannot drift apart. Google restricted FAQ rich results to a
          narrow set of sites in 2023, so treat this as machine-readable
          context rather than a ticket to a rich snippet. */}
      <JsonLd data={faqPageJsonLd(entries)} />
    </section>
  );
}

function CallToAction(): ReactNode {
  return (
    <section className="pb-8">
      <Container>
        <div className="squircle lit relative overflow-hidden rounded-3xl border border-line bg-surface px-6 py-16 text-center sm:px-16">
          <div className="brand-gradient pointer-events-none absolute inset-x-0 top-0 h-px opacity-70" />
          <h2 className="text-3xl font-medium tracking-tight text-balance text-fg sm:text-4xl">
            Record something worth watching
          </h2>
          <p className="mx-auto mt-4 max-w-md text-pretty text-muted">
            Free for {TRIAL_DAYS} days, with nothing held back and no watermark on anything you
            export.
          </p>
          <DownloadCta className="mt-8" />
          <p className="mt-8 text-xs text-muted">
            Curious about the internals?{" "}
            <ButtonLink
              href="/blog"
              variant="ghost"
              size="sm"
              className="px-1 underline-offset-4 hover:underline"
            >
              Read the blog
            </ButtonLink>
          </p>
        </div>
      </Container>
    </section>
  );
}
