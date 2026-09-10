import type { Metadata } from "next";
import Link from "next/link";

import { ButtonLink } from "@/components/Button";
import {
  CaptureDiagram,
  EditorDiagram,
  ShareDiagram,
  ZoomPanelDiagram,
  ZoomPassDiagram,
} from "@/components/feature-diagrams";
import { Container, SectionHeading } from "@/components/Section";
import { DownloadCta } from "@/components/DownloadButton";
import { pageMetadata } from "@/lib/seo";
import { TRIAL_DAYS } from "@/lib/pricing";

export const metadata: Metadata = pageMetadata({
  title: "Features",
  description:
    "Prequel's features in full: screen, window and region capture, automatic zooms, a camera you frame afterwards, editable captions, and MP4, HEVC or GIF export.",
  path: "/features",
});

/**
 * Every claim on this page is a control that exists in the app today.
 *
 * The home page's `LandingBody` says the same things in six cards, because it is
 * also the body under all sixteen `/create/<slug>` pages and cannot be where
 * detail accumulates. This is the page that carries the counts — fifteen
 * layouts, fifteen pointers, six caption looks — so a number here is one
 * somebody may sit down and check.
 *
 * The one number deliberately absent is the frame rate ceiling. The export
 * dialog offers 60 or 30; `EXPORT_SPECS` says so.
 */
const CAPTURE = [
  {
    title: "Screen, window or region",
    body: "Record a whole display, a single window, or an area you drag out. Every display your Mac has gets its own picker.",
  },
  {
    title: "Camera recorded as its own track",
    body: "The webcam is never burned into the screen recording. Whether it appears, what shape it is and where it sits are all decided afterwards.",
  },
  {
    title: "Microphone and system audio on separate tracks",
    body: "Your microphone and the sound coming out of your Mac, on separate tracks with a gain each. System audio arrives through ScreenCaptureKit, so there is no virtual driver to install.",
  },
  {
    title: "Countdown, global shortcut, pause and resume",
    body: "A countdown of 3, 5 or 10 seconds, and a global shortcut you can rebind. Pause and resume part way through, or discard a take without leaving a file behind.",
  },
  {
    title: "Captured at native resolution",
    body: "Recording runs at your display's own pixel size. A Retina Mac exporting at 1080p has roughly three times the pixels it needs, and a zoom spends that headroom.",
  },
  {
    title: "Prequel's own windows are excluded",
    body: "The dock, the picker and every other Prequel window are excluded by id. Recording your whole screen does not record Prequel recording it.",
  },
];

const FIRST_PASS = [
  {
    title: "Clicks and typing clustered into shots",
    body: "Clicks and bursts of typing, clustered into shots with a lead-in and a lead-out. A push lands on the thing rather than behind it.",
  },
  {
    title: "Every generated zoom is editable",
    body: "A generated zoom is identical to one you add yourself. Move it, retime it, point it somewhere else, delete it.",
  },
  {
    title: "Run the zoom pass again at any time",
    body: "Add zooms automatically fills the stretches that are not already covered. A take you have cut about in gets topped up rather than started again.",
  },
];

/**
 * The editor, in two grids of six rather than one of twelve.
 *
 * `COPY.md` puts the ceiling at six cards a section, and it is a reading limit
 * rather than a layout one: past six the reader stops reading titles and starts
 * skimming for the end of the block. The split is by what the control touches —
 * the picture, then the words and the cuts — so each grid is a group rather than
 * an arbitrary half.
 */
const EDITOR_PICTURE = [
  {
    title: "Fifteen layouts for the screen and camera",
    body: "Fifteen arrangements in three groups: the screen and camera together, the camera alone, or the screen alone. One for the video, or a different one per clip.",
  },
  {
    title: "Zooms that follow the cursor, a region or a field",
    body: "Follow the cursor, hold still on a region you draw, or track the field you are typing into. Level, speed, and an ease you drag as a curve.",
  },
  {
    title: "Perspective tilt and focus falloff",
    body: "A perspective tilt and yaw on the push-in, so the frame has a direction. Focus falls away from the subject, with its own sharp area and strength.",
  },
  {
    title: "Five camera shapes, sized and mirrored",
    body: "Five shapes, with a roundness, size and border of its own. Mirror it, zoom into its picture, and let it shrink out of the way while a zoom is in.",
  },
  {
    title: "Backgrounds, padding, corner radius and shadow",
    body: "Your desktop picture, a hosted catalogue in four groups, gradients, solids, or an image you pick. Padding, corner radius, border and shadow on top.",
  },
  {
    title: "Fifteen pointer styles, smoothed and blurred",
    body: "Fifteen pointer styles, sized to survive a zoom. Smoothing, motion blur as it travels, and gone from the frame when it goes still.",
  },
];

const EDITOR_REST = [
  {
    title: "Captions transcribed on your Mac",
    body: "Transcribed on your Mac, with nothing uploaded. Six looks, any of nine faces your Mac already has, and a colour for the word being spoken.",
  },
  {
    title: "Edit the transcript to edit the video",
    body: "Open the transcript and correct what it heard. Delete a sentence there and that stretch of footage leaves the video with it.",
  },
  {
    title: "Timeline with filmstrip, waveform and split",
    body: "Filmstrip thumbnails and a waveform under every clip. Split at the playhead, trim from either end, delete a clip, duplicate a zoom.",
  },
  {
    title: "Your own logo anywhere in the frame",
    body: "Any image, anywhere in the frame, sized by its corner. An SVG stays sharp at whatever size you export.",
  },
  {
    title: "Change one clip or the whole project",
    body: "With nothing selected you edit the defaults. Select a clip and every change becomes that clip's own, with a dot beside the control saying so.",
  },
  {
    title: "Save a look as a reusable preset",
    body: "Save a look and put it on the next recording. A preset carries the arrangement, the background, the captions, the camera and the frame.",
  },
];

const EXPORT_SPECS = [
  ["Formats", "MP4 (H.264) · HEVC · GIF"],
  ["Quality", "Full, 1080p, 720p, 480p"],
  ["Frame rate", "60 or 30 fps"],
  ["Encoding", "Hardware, VideoToolbox"],
  ["Compositing", "Metal"],
  ["Output", "Constant frame rate"],
];

const FRAMES = [
  "Automatic",
  "Landscape 16:9",
  "Landscape 4K",
  "Vertical 9:16",
  "Square 1:1",
  "Portrait 4:5",
  "YouTube",
  "Shorts",
  "TikTok",
  "Reels",
  "Instagram Feed",
  "X",
  "LinkedIn",
  "Any size you type",
];

const SHARING = [
  {
    title: "A watch page that needs no account",
    body: "Press Share on a finished export and it becomes a link, with a poster still from the video. It unfurls in Slack and needs no account on the other side.",
  },
  {
    title: "Share links are never indexed",
    body: "A share page is never indexed. Anyone with the link can watch it, and that is as far as it goes.",
  },
  {
    title: "A library of everything you have shared",
    body: "Everything you have shared, with its length, size and view count, a copy button and a storage meter.",
  },
];

const REQUIREMENTS = [
  ["Mac", "Apple Silicon, macOS 14 or later"],
  ["Screen Recording", "Granted once, then quit and reopen Prequel"],
  ["Accessibility", "Optional. It is what lets zooms follow your typing"],
];

export default function Features() {
  return (
    <>
      <section className="pt-20 pb-10">
        <Container>
          <SectionHeading
            eyebrow="Features"
            title="Everything Prequel does to a recording"
            lede="Nothing about the look is fixed while you record. Here is the whole list: what Prequel captures, what it does on its own, and what comes out."
            align="centre"
          />
          <DownloadCta className="mt-10" />
        </Container>
      </section>

      <section id="record" className="scroll-mt-16 py-24">
        <Container>
          <SectionHeading
            eyebrow="Capture"
            title="Records your screen, camera, microphone and system audio"
            lede="Prequel records the screen, the camera, your microphone and the system audio as four separate files. Nothing is mixed while you record. The framing, the volume and the layout are still open when you stop."
          />
          <CaptureDiagram />
          <CardGrid items={CAPTURE} />
        </Container>
      </section>

      <section id="automatic" className="scroll-mt-16 bg-surface/40 py-24">
        <Container>
          <SectionHeading
            eyebrow="Automatic"
            title="Places the zooms for you, from your clicks and typing"
            lede="Prequel watches where you click and type while it records. The editor opens with the zooms placed, the camera framed, a background on, the audio balanced and the cursor cleaned up."
            align="centre"
          />
          <ZoomPassDiagram />
          <CardGrid items={FIRST_PASS} className="lg:grid-cols-3" />
        </Container>
      </section>

      <section id="editor" className="scroll-mt-16 py-24">
        <Container>
          <SectionHeading
            eyebrow="The editor"
            title="A full editor that opens on the take you just recorded"
            lede="Nothing to import and nothing to line up. Every control changes the video in front of you rather than a setting you have to render to see."
          />
          <EditorDiagram />
          <CardGrid items={EDITOR_PICTURE} />

          <div className="mt-20">
            <SectionHeading
              eyebrow="Also in the editor"
              title="Captions, transcript, timeline, logo and presets"
            />
            <CardGrid items={EDITOR_REST} />
            <ZoomPanelDiagram />
          </div>
        </Container>
      </section>

      <section id="export" className="scroll-mt-16 py-24">
        <Container className="grid items-start gap-12 lg:grid-cols-2 lg:gap-20">
          <SectionHeading
            eyebrow="Export"
            title="Exports MP4, HEVC or GIF on your own Mac"
            lede="Capture and export run on your Mac's own media engine: hardware H.264 or HEVC through VideoToolbox, composited in Metal. There is no upload step and no cloud render."
            cta="Download for Mac"
          />
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line">
            {EXPORT_SPECS.map(([label, value]) => (
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
            eyebrow="Frames"
            title="Exports at any frame size, from 16:9 to vertical 9:16"
            lede="Quality scales by the frame's shorter edge and never upscales past the source. Framing is stored in proportions, not pixels, so nothing slides off the frame when you switch shape."
            align="centre"
          />
          <ul className="mx-auto mt-10 flex max-w-3xl flex-wrap justify-center gap-2">
            {FRAMES.map((frame) => (
              <li
                key={frame}
                className="rounded-full border border-line bg-surface px-4 py-2 text-sm text-muted"
              >
                {frame}
              </li>
            ))}
          </ul>
          <p className="mx-auto mt-8 max-w-2xl text-center text-sm leading-relaxed text-muted">
            The preview and the exporter draw the same plan, so the file you get is the frame you
            approved. GIF is the one exception to the sizes above: it is silent, and it tops out at a
            720 pixel short edge.
          </p>
        </Container>
      </section>

      <section id="sharing" className="scroll-mt-16 pb-24">
        <Container>
          <SectionHeading
            eyebrow="Sharing"
            title="Share a finished export as a private link"
            lede="Everything above happens without the network. Uploading a finished export to get a link is something you ask for, on a file you have already made."
          />
          <ShareDiagram />
          <CardGrid items={SHARING} className="lg:grid-cols-3" />
          {/* Said here because a features page is where somebody goes looking for
              the row that is withheld. `lib/pricing.ts` is explicit that no
              feature on this site may be described as Pro: the two plans are the
              same app and differ only in storage. */}
          <p className="mt-6 text-sm leading-relaxed text-muted">
            Both plans carry every feature on this page. The only thing that differs between them is
            how much you may keep on the sharing side.{" "}
            <Link href="/pricing" className="text-fg underline decoration-line underline-offset-4">
              See the pricing
            </Link>
            .
          </p>
        </Container>
      </section>

      <section className="pb-20">
        <Container>
          <dl className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3">
            {REQUIREMENTS.map(([label, value]) => (
              <div key={label} className="bg-surface px-6 py-6">
                <dt className="font-mono text-[11px] tracking-wider text-muted uppercase">
                  {label}
                </dt>
                <dd className="mt-1.5 text-sm text-fg">{value}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </section>

      <section className="pb-20">
        <Container>
          <div className="squircle lit relative overflow-hidden rounded-3xl border border-line bg-surface px-6 py-14 text-center sm:px-16">
            <div className="brand-gradient pointer-events-none absolute inset-x-0 top-0 h-px opacity-70" />
            <h2 className="text-2xl font-medium tracking-tight text-fg">
              Try the whole thing for {TRIAL_DAYS} days
            </h2>
            <p className="mx-auto mt-3 max-w-md text-pretty text-muted">
              Every feature on this page, and no watermark on anything you export.
            </p>
            <DownloadCta className="mt-8" />
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <ButtonLink href="/usecases" variant="secondary" size="sm">
                What people record
              </ButtonLink>
              <ButtonLink href="/#faq" variant="secondary" size="sm">
                Product FAQ
              </ButtonLink>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}

/**
 * Separate bordered cards with a gap, and not the `gap-px` over a `bg-line`
 * parent that the rest of the site draws its card sets with.
 *
 * That technique paints the hairlines by letting the parent show through the
 * gaps, which means it also shows through any cell no card landed in. Every set
 * it is used on elsewhere happens to fill its rows — six cards in three columns,
 * four in two — so the case never came up. Here the sets are three, six and
 * twelve long across two breakpoints, and a set of three in two columns leaves
 * a solid block of `--line` sitting where a fourth card would be. It reads as a
 * card that failed to render rather than as a row that ended.
 */
function CardGrid({
  items,
  className = "lg:grid-cols-3",
}: {
  items: { title: string; body: string }[];
  className?: string;
}) {
  return (
    <div className={`mt-12 grid gap-4 sm:grid-cols-2 ${className}`}>
      {items.map((item) => (
        <div key={item.title} className="rounded-2xl border border-line bg-surface p-7">
          <h3 className="text-[0.9375rem] font-medium text-fg">{item.title}</h3>
          <p className="mt-2.5 text-sm leading-relaxed text-muted">{item.body}</p>
        </div>
      ))}
    </div>
  );
}
