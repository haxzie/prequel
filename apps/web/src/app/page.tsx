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
import {
  BackgroundIllustration,
  CameraIllustration,
  CursorIllustration,
  ExportIllustration,
  TimelineIllustration,
  ZoomIllustration,
} from "@/components/editor-illustrations";
import { Logo } from "@/components/Logo";
import { Container, Eyebrow, SectionHeading } from "@/components/Section";
import { WaitlistForm } from "@/components/WaitlistForm";
import { PRODUCT_FAQ } from "@/lib/faq";
import { SITE } from "@/lib/site";

import editor from "../../public/editor.png";
import stage from "../../public/stage.jpg";

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

export default function Home() {
  return (
    <>
      <section className="pt-20 pb-16 sm:pt-28">
        <Container>
          {/* Centred, so `mx-auto` on every width-capped child rather than one
              wrapper: the measures differ on purpose — the headline is allowed to
              run wider than the paragraph, and the form narrower than both — and
              a single `max-w` would flatten that into one column. */}
          <div className="mx-auto max-w-3xl text-center">
            {/* Two shadows: a neutral one for depth and a warm one picking up
                the icon's own sun gradient. On a flat background that warm
                halo is the only colour above the fold, so it does the work the
                section background used to. */}
            <Logo
              size={104}
              radius={0.42}
              className="mb-8 shadow-[0_26px_50px_-16px_rgb(0_0_0_/_0.8),0_14px_46px_-14px_rgb(225_75_21_/_0.5)]"
            />
            <h1 className="text-[2rem] leading-[1.05] font-normal tracking-tight text-balance text-fg sm:text-6xl">
              Create <span className="font-serif font-semibold italic">cinematic</span> screen
              recordings from Mac
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-pretty text-muted">
              Record once. Prequel hands back a finished video — pushed in on the work, the camera
              framed, the dead air gone — and exports it at up to 4K.
            </p>

            <div id="waitlist" className="mx-auto mt-9 max-w-lg scroll-mt-28">
              <WaitlistForm />
              {/* The platform used to be a badge above the headline. It still
                  belongs above the fold, so it rides with the small print. */}
              <p className="mt-3.5 font-mono text-[11px] tracking-wide text-muted">
                {SITE.platform} · one email when the first build is ready
              </p>
            </div>
          </div>
        </Container>
      </section>

      <section>
        {/* The stage is a panel between the rails rather than a full-bleed
            band: the gradient stops where the page's borders do, and the
            screenshot sits inside it with the gradient reading as a frame.

            `isolate` keeps the backdrop's negative z-index inside this panel.
            Without a stacking context of its own it escapes to the root and
            paints behind the page background, which reads as the image simply
            not loading. */}
        <div className="relative isolate mx-auto w-full max-w-6xl overflow-hidden border-y border-dashed border-rule px-6 py-20 sm:px-14 sm:py-28">
          <Image
            src={stage}
            alt=""
            fill
            sizes="(min-width: 1152px) 1152px, 100vw"
            className="-z-10 object-cover"
          />
          <Image
            src={editor}
            alt="The Prequel editor: a recording on a background, with the layout inspector open and two zoom slices on the timeline."
            // Eager rather than lazy — it is the first thing below the hero and
            // would otherwise pop in. `priority` is deprecated in Next 16.
            loading="eager"
            quality={90}
            className="w-full rounded-xl border border-white/10 shadow-2xl shadow-black/50"
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

      <section className="border-y border-dashed border-rule bg-surface/40 py-24">
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
      <Faq />
    </>
  );
}

function Faq(): ReactNode {
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
          {PRODUCT_FAQ.map((item, i) => (
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: PRODUCT_FAQ.map((item) => ({
              "@type": "Question",
              name: item.question,
              acceptedAnswer: { "@type": "Answer", text: item.answer },
            })),
          }),
        }}
      />
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
            Be there for the first build
          </h2>
          <p className="mx-auto mt-4 max-w-md text-pretty text-muted">
            Prequel is in development. Leave an address and we will send it the day it is worth
            installing.
          </p>
          <WaitlistForm className="mx-auto mt-8 max-w-lg" />
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
