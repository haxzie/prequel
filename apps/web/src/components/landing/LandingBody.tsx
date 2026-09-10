import {
  ChevronDown,
  // Aliased because a bare `Image` in a Next file reads as `next/image`.
  Image as ImageIcon,
  MousePointer2,
  SlidersHorizontal,
  Webcam,
  ZoomIn,
} from "lucide-react";
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
import { CaptionsDemo } from "@/components/landing/CaptionsDemo";
import { LayoutDemo } from "@/components/landing/LayoutDemo";
import { ZoomDemo } from "@/components/landing/ZoomDemo";
import { CaptureStep, PlayerStep, TimelineStep } from "@/components/landing/step-visuals";
import { Container, Eyebrow, SectionHeading } from "@/components/Section";
import { DownloadCta } from "@/components/DownloadButton";
import type { FaqEntry } from "@/lib/faq";
import { faqPageJsonLd } from "@/lib/seo";
import { TRIAL_DAYS } from "@/lib/pricing";

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

/**
 * The whole product in three steps, in the order they happen.
 *
 * The title is the step and the body is what it actually involves, which is the
 * only thing that makes a step worth reading: "Record your screen and camera"
 * on its own is a sentence nobody needed, and the display-or-window-or-region
 * choice under it is the answer to the first question anybody has.
 *
 * Step two is passive on purpose. `COPY.md` says Prequel does the verb, and it
 * does in that step's body, but the whole of what the step itself promises is
 * that the reader is not the one doing it.
 */
const STEPS = [
  {
    title: "Record your screen and camera",
    body: "Pick a display, a window or an area you drag out, with your camera, microphone and system audio each on their own track.",
    visual: <CaptureStep />,
  },
  {
    title: "Zooms and layout are applied automatically",
    body: "Prequel reads where you clicked and typed, then places the zooms, frames your camera and sets a background behind it.",
    visual: <TimelineStep />,
  },
  {
    title: "Edit, export and share",
    body: "Move a zoom, trim a clip or fix a caption, then export one MP4 at up to 4K or send a link that plays anywhere.",
    visual: <PlayerStep />,
  },
];

/**
 * The editor, as six outcomes.
 *
 * The title is what the reader gets and the body is how, which is the split a
 * dash was doing in the brief these were rewritten from. A card titled
 * "Backgrounds" names a control and leaves the reader to work out why they
 * would touch it; naming the outcome first is what makes the control worth
 * reading about.
 *
 * The bodies stay exact. An outcome with nothing checkable under it is the
 * failure mode at the other end, and the numbers here are all real: five camera
 * shapes in `CameraShape`, fifteen pointer styles in `CURSOR_STYLES`.
 */
const FEATURES = [
  {
    title: "Guide attention automatically",
    body: "Prequel zooms into the part of the screen that matters: the cursor, a region you draw, or whatever you are typing into. Set the level, the speed and how much the rest of the frame blurs.",
    illustration: <ZoomIllustration />,
  },
  {
    title: "Look present without taking over the video",
    body: "Your camera stays framed and out of the way: circle, squircle, rounded, wide or portrait, in any corner and any size. It is never burned into the recording, so none of it is decided while you record.",
    illustration: <CameraIllustration />,
  },
  {
    title: "Make recordings look designed",
    body: "Add a background, padding and a shadow without editing any of it by hand. Your own wallpaper by default, seven bundled presets, gradients and solids.",
    illustration: <BackgroundIllustration />,
  },
  {
    title: "Cut the parts nobody needs to see",
    body: "Trim the pauses yourself, slice by slice, with a waveform under every clip. Layout, background and audio can all change mid-take.",
    illustration: <TimelineIllustration />,
  },
  {
    title: "Keep the pointer out of the way",
    body: "Fifteen pointer styles, resized so the cursor survives a zoom. Smoothed while it travels, and hidden after a few seconds of stillness.",
    illustration: <CursorIllustration />,
  },
  {
    title: "Export the frame you approved",
    body: "The preview and the exporter draw the same plan, so the file matches what you signed off in the editor.",
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
      {/* Before the demos rather than after them. The three below are each a
          close look at one step, and a visitor who has not been told there are
          only three steps reads them as three separate features. It is also the
          shortest thing on the page, so it costs a skimmer nothing. */}
      <section className="pt-16 pb-8">
        <Container>
          <SectionHeading
            eyebrow="How it works"
            title="Three steps to a finished video"
            align="centre"
            cta="Download for Mac"
          />
          {/* An `ol`, because these are a sequence and not a set: read out in a
              different order they stop being true.

              Gapped cards rather than the hairline grid the feature cards use.
              That grid exists to make a set read as one object, and it is right
              where the cells are text; here each cell opens on a picture, and
              three pictures meeting at a hairline read as one wide image cut
              into thirds. */}
          <ol className="mx-auto mt-10 grid max-w-5xl gap-5 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li
                key={step.title}
                className="flex flex-col overflow-hidden rounded-2xl border border-line bg-bg"
              >
                {step.visual}
                <div className="flex flex-col gap-2.5 p-6">
                  <span className="font-mono text-xs tracking-wider text-muted" aria-hidden>
                    {index + 1}
                  </span>
                  <span className="text-[0.9375rem] font-medium text-fg">{step.title}</span>
                  <span className="text-sm leading-relaxed text-muted">{step.body}</span>
                </div>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* The first place on the page where the product is shown doing something
          rather than described. It replaced a composed screenshot of the editor:
          the still could show the zoom slices sitting on a timeline but not the
          push in, which is the part worth seeing. */}
      <ZoomDemo />

      {/* Directly under it, because the two make one argument between them: the
          zoom demo shows the camera moving *within* the picture, and this one
          shows the picture itself being re-arranged. Split apart by a section of
          prose they read as two unrelated animations. */}
      <LayoutDemo />

      {/* And a third, on the words rather than the picture. It comes last of
          the three because it is the only one that needs the other two to have
          landed first: a visitor who has not yet accepted that the frame is
          composed after the fact has no reason to care that the sentence under
          it is editable. */}
      <CaptionsDemo />

      <section className="py-24">
        <Container className="grid items-start gap-12 lg:grid-cols-2 lg:gap-20">
          <SectionHeading
            eyebrow="Instant edit"
            title="Start with the edit already done"
            lede="Prequel records where you click and type, then opens the editor with zooms already placed, a framed camera and a polished background. Spend less time building the first cut and more time fine-tuning."
            cta="Download for Mac"
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
            title="Everything you would have done by hand"
            lede="It opens by itself when you stop recording, on the take you just made. Nothing to import, nothing to line up."
            cta="Download for Mac"
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
            title="Videos stay sharp at 4K"
            lede="Capture and export run on your Mac's own media engine. 1080p at 60 fps records without dropping frames, and 4K is a setting you pick."
            cta="Download for Mac"
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
            title="Export in any frame"
            lede="Turn one recording into different formats without manually reframing every element. Switch from landscape to vertical and the layout stays intact."
            cta="Download for Mac"
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
            Record demos worth sharing
          </h2>
          <p className="mx-auto mt-4 max-w-md text-pretty text-muted">
            Free for {TRIAL_DAYS} days. No watermark on anything you export.
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
