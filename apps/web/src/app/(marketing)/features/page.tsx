import type { Metadata } from "next";
import Link from "next/link";

import { ButtonLink } from "@/components/Button";
import { Container, SectionHeading } from "@/components/Section";
import { DownloadCta } from "@/components/DownloadButton";
import { Bento, type Card } from "@/components/features/Bento";
import {
  BackgroundSources,
  BlurBehind,
  FrameControls,
  Watermark,
} from "@/components/features/background";
import {
  EditTranscript,
  NineFaces,
  OnDevice,
  Placement,
  SixLooks,
  SpokenWord,
} from "@/components/features/captions";
import {
  AudioTracks,
  CameraTrack,
  Countdown,
  NativeResolution,
  OwnWindowsExcluded,
  SourcePicker,
} from "@/components/features/capture";
import { HideWhenStill, MotionBlur, PointerStyles, Smoothing } from "@/components/features/cursor";
import {
  AnyFrame,
  ExportDialog,
  HardwareExport,
  PreviewEqualsExport,
} from "@/components/features/export";
import {
  CameraShapes,
  Cutout,
  DragAnywhere,
  LayoutPerClip,
  LayoutPicker,
  ShrinkOnZoom,
} from "@/components/features/layout";
import { Library, NeverIndexed, Unfurl, WatchPage } from "@/components/features/sharing";
import {
  AudioGains,
  FilmstripAndWave,
  PerClipOverride,
  ScenePresets,
  SplitAndTrim,
} from "@/components/features/timeline";
import {
  EditableZoom,
  TiltAndFocus,
  TopUp,
  ZoomCurve,
  ZoomPass,
  ZoomTargets,
} from "@/components/features/zoom";
import { pageMetadata } from "@/lib/seo";
import { TRIAL_DAYS } from "@/lib/pricing";

export const metadata: Metadata = pageMetadata({
  title: "Features",
  description:
    "Prequel's features in full: screen, window and region capture, automatic zooms, fourteen layouts, a camera you frame afterwards, editable captions, and MP4, HEVC or GIF export.",
  path: "/features",
});

/**
 * Every claim on this page is a control that exists in the app today, and
 * every card carries a picture of it.
 *
 * The home page's `LandingBody` says the same things in six cards, because it is
 * also the body under all sixteen `/create/<slug>` pages and cannot be where
 * detail accumulates. This is the page that carries the counts — fourteen
 * layouts, fifteen pointers, six caption looks, nine faces — so a number here is
 * one somebody may sit down and check. The figures are read off the app:
 * `LayoutPicker.tsx`, `CURSOR_STYLES`, `CAPTION_STYLES`, `fonts.ts`.
 *
 * One section per panel of the app, in the order a take passes through them:
 * what is captured, what the first pass does, then each editor panel, then the
 * export and the share. The old page had one editor section of twelve cards
 * and it read as a list; a section a panel keeps each grid at four to six.
 *
 * The one number deliberately absent is the frame rate ceiling. The export
 * dialog offers 60 or 30; the export card says so.
 */
interface Section {
  id: string;
  eyebrow: string;
  title: string;
  lede: string;
  cards: Card[];
}

const SECTIONS: Section[] = [
  {
    id: "record",
    eyebrow: "Capture",
    title: "Records your screen, camera, microphone and system audio",
    lede: "Four separate files, nothing mixed while you record. The framing, the volume and the layout are still open when you stop.",
    cards: [
      {
        title: "Screen, window or region",
        body: "Record a whole display, a single window, or an area you drag out. Every display your Mac has gets its own picker.",
        visual: <SourcePicker />,
        span: "wide",
      },
      {
        title: "Camera recorded as its own track",
        body: "The webcam is never burned into the screen recording. Whether it appears, what shape it is and where it sits are all decided afterwards.",
        visual: <CameraTrack />,
      },
      {
        title: "Countdown, global shortcut, pause and resume",
        body: "A countdown of 3, 5 or 10 seconds, and a global shortcut you can rebind. Pause and resume part way through, or discard a take without leaving a file behind.",
        visual: <Countdown />,
      },
      {
        title: "Microphone and system audio on separate tracks",
        body: "Your microphone and the sound coming out of your Mac, each with a gain of its own. System audio arrives through ScreenCaptureKit, so there is no virtual driver to install.",
        visual: <AudioTracks />,
        span: "wide",
      },
      {
        title: "Prequel's own windows are excluded",
        body: "The dock, the picker and every other Prequel window are left out by id. Recording your whole screen does not record Prequel recording it.",
        visual: <OwnWindowsExcluded />,
        span: "wide",
      },
      {
        title: "Captured at native resolution",
        body: "Recording runs at your display's own pixel size. A Retina Mac exporting at 1080p has roughly three times the pixels it needs, and a zoom spends that headroom.",
        visual: <NativeResolution />,
      },
    ],
  },
  {
    id: "zoom",
    eyebrow: "Zoom and pan",
    title: "Places the zooms for you, from your clicks and typing",
    lede: "Prequel watches where you click and type while it records. The editor opens with the zooms already placed, and every one of them is yours to change.",
    cards: [
      {
        title: "Clicks and typing clustered into shots",
        body: "Clicks and bursts of typing, clustered into shots with a lead-in and a lead-out. A push lands on the thing you did, at the moment you did it.",
        visual: <ZoomPass />,
        span: "wide",
      },
      {
        title: "Level, speed, and an ease you drag as a curve",
        body: "How far in, how fast, and the shape of the move between. The ease is a curve with two handles, and a fresh zoom starts on the smooth one.",
        visual: <ZoomCurve />,
        span: "tall",
      },
      {
        title: "Every generated zoom is editable",
        body: "A generated zoom is identical to one you add yourself. Move it, retime it, point it somewhere else, delete it.",
        visual: <EditableZoom />,
      },
      {
        title: "Add zoom and pan again at any time",
        body: "Add zooms fills the stretches that are not already covered. A take you have cut about in gets topped up, and what you placed by hand stays where it is.",
        visual: <TopUp />,
      },
      {
        title: "Zooms that follow the cursor, a region or a field",
        body: "Follow the cursor, hold still on a region you draw, or track the field you are typing into. One choice per zoom, and a different one for the next.",
        visual: <ZoomTargets />,
      },
      {
        title: "Perspective tilt and focus falloff",
        body: "A tilt and a yaw on the push-in, so the frame has a direction. Focus falls away from the subject, with its own sharp area and strength.",
        visual: <TiltAndFocus />,
        span: "wide",
      },
    ],
  },
  {
    id: "layout",
    eyebrow: "Layout and camera",
    title: "Fourteen ways to arrange the screen and the camera",
    lede: "The two pictures are separate tracks, so how they share the frame is a choice you make in the editor. Pick an arrangement, then drag either picture where you want it.",
    cards: [
      {
        title: "Fourteen layouts in three groups",
        body: "The screen and camera together, the camera alone, or the screen alone. Camera over the screen, beside it, stacked, or split down the middle.",
        visual: <LayoutPicker />,
        span: "wide",
      },
      {
        title: "Five camera shapes, sized and mirrored",
        body: "Circle, squircle, rounded, wide or portrait, each with a roundness, size and border of its own. Mirror it, and zoom into its picture to tighten the shot.",
        visual: <CameraShapes />,
      },
      {
        title: "Remove the background and keep only you",
        body: "The camera's background is cut away while you record, so switching it off in the editor is instant. What is left is you, on the wallpaper, with no bubble, border or shadow round it. Switch it back on and the bubble returns.",
        visual: <Cutout />,
        span: "wide",
      },
      {
        title: "The camera shrinks while a zoom is in",
        body: "A push-in brings the picture closer and the bubble would cover more of it. Set a size for while a zoom is in and the camera steps out of the way on its own.",
        visual: <ShrinkOnZoom />,
      },
      {
        title: "One layout for the video, or one per clip",
        body: "With nothing selected the arrangement is the whole video's. Select a clip and pick another, and that clip keeps it while the rest stay put.",
        visual: <LayoutPerClip />,
      },
      {
        title: "Drag either picture anywhere in the frame",
        body: "Take hold of the camera or the screen in the preview and move it. Positions are stored as fractions of the frame, so nothing slides off when you switch shape.",
        visual: <DragAnywhere />,
        span: "wide",
      },
    ],
  },
  {
    id: "background",
    eyebrow: "Background and frame",
    title: "A background behind the recording, and a frame round it",
    lede: "Your desktop picture is the default, so a take looks finished before you touch anything. Then padding, corners, a border, a shadow and your logo.",
    cards: [
      {
        title: "Your wallpaper, a catalogue, gradients or solids",
        body: "Your desktop picture, a hosted catalogue in four groups, gradients, solids, or an image you pick. Every one of these cards stands on one of them.",
        visual: <BackgroundSources />,
        span: "wide",
      },
      {
        title: "Padding, corner radius, border and shadow",
        body: "Four sliders that shape the frame. Every one is a fraction of the frame's shorter edge, so the same look holds from landscape to vertical.",
        visual: <FrameControls />,
        span: "tall",
      },
      {
        title: "Blur the background behind the recording",
        body: "Soften the wallpaper and the recording stays sharp on top of it. A busy desktop picture stops competing with the thing you recorded.",
        visual: <BlurBehind />,
      },
      {
        title: "Your own logo anywhere in the frame",
        body: "Any image, anywhere in the frame, sized by its corner and set to an opacity. An SVG stays sharp at whatever size you export.",
        visual: <Watermark />,
      },
    ],
  },
  {
    id: "cursor",
    eyebrow: "Cursor",
    title: "A pointer that is drawn, so it can be redrawn",
    lede: "Prequel records where the pointer went and draws it back over the take. That is what lets it be a different shape, a different size, smoother than your hand, and gone when it stops.",
    cards: [
      {
        title: "Fifteen pointer styles, sized to survive a zoom",
        body: "Black, white, the classic pair, a circle, a hand, and nine more for a take that is allowed some fun. Each sized so the pointer survives a zoom.",
        visual: <PointerStyles />,
        span: "wide",
      },
      {
        title: "Smoothed while it travels",
        body: "The recorded path steps from sample to sample. The drawn one runs through a curve, so a pointer moves the way a hand does and not the way a mouse reports.",
        visual: <Smoothing />,
      },
      {
        title: "Motion blur as it moves",
        body: "A pointer flung across the screen smears along its own travel, the way anything moving that fast does on film. Standing still, it is as sharp as ever.",
        visual: <MotionBlur />,
      },
      {
        title: "Hidden when it goes still, and while you type",
        body: "A pointer parked over a paragraph fades out after a pause you set, and comes back the moment it moves. Hide it while you type, so the words are what the viewer watches.",
        visual: <HideWhenStill />,
        span: "wide",
      },
    ],
  },
  {
    id: "captions",
    eyebrow: "Captions",
    title: "Captions transcribed on your Mac, and edited as text",
    lede: "Turn captions on and the take is transcribed where it was recorded, with nothing uploaded. Fix a word in the transcript and the caption follows. Delete a sentence and the footage goes with it.",
    cards: [
      {
        title: "Transcribed on your Mac, with nothing uploaded",
        body: "The transcript is made by the speech engine your Mac already has. It never leaves the machine, and there is no account to make before you can have it.",
        visual: <OnDevice />,
        span: "wide",
      },
      {
        title: "Six looks",
        body: "Blur in, Subtitle, Highlight, Pop, Outline and Band. Two of them light the word being spoken, one arrives a word at a time, and the band runs the width of the frame.",
        visual: <SixLooks />,
        span: "tall",
      },
      {
        title: "A colour for the word being spoken",
        body: "The lit looks colour the current word as it is said. Pick the colour, and it is the same in the preview and the export.",
        visual: <SpokenWord />,
      },
      {
        title: "Edit the transcript to edit the video",
        body: "Open the transcript and correct what it heard. Delete a sentence there and that stretch of footage leaves the video with it.",
        visual: <EditTranscript />,
      },
      {
        title: "Top, middle or bottom, at the size you want",
        body: "Three positions, a size, a distance from the edge and how many lines a cue may run to. All fractions of the frame, so the captions sit the same in every export size.",
        visual: <Placement />,
      },
      {
        title: "Any of nine faces your Mac already has",
        body: "System, Helvetica Neue, Avenir Next, Futura, Optima, Georgia, Times, Courier and Menlo. Nothing to install, and the export is drawn with the same face as the preview.",
        visual: <NineFaces />,
        span: "wide",
      },
    ],
  },
  {
    id: "timeline",
    eyebrow: "Timeline, audio and presets",
    title: "A timeline with the cut, the sound and the look on it",
    lede: "One strip under the preview, with the footage on it. Cut where you want, balance the two audio tracks, and save the whole look for the next recording.",
    cards: [
      {
        title: "Filmstrip and waveform under every clip",
        body: "Frames from the take along each clip, and its audio drawn over them. You can see a pause before you play it and find a click without scrubbing for it.",
        visual: <FilmstripAndWave />,
        span: "wide",
      },
      {
        title: "Split, trim, delete and duplicate",
        body: "Split at the playhead, trim from either end, delete a clip you do not need, duplicate a zoom you like.",
        visual: <SplitAndTrim />,
      },
      {
        title: "Change one clip or the whole project",
        body: "With nothing selected you edit the defaults. Select a clip and every change becomes that clip's own, with a dot beside the control saying so.",
        visual: <PerClipOverride />,
      },
      {
        title: "Save a look as a reusable preset",
        body: "Save a look and put it on the next recording. A preset carries the arrangement, the background, the captions, the camera and the frame.",
        visual: <ScenePresets />,
      },
      {
        title: "A gain for the microphone and one for the Mac",
        body: "The two tracks were recorded apart, so they are balanced apart. Turn the system sound down under your voice, or mute either one for a stretch.",
        visual: <AudioGains />,
      },
    ],
  },
  {
    id: "export",
    eyebrow: "Export",
    title: "Exports MP4, HEVC or GIF on your own Mac",
    lede: "Capture and export run on your Mac's own media engine: hardware H.264 or HEVC through VideoToolbox, composited in Metal. There is no upload step and no cloud render.",
    cards: [
      {
        title: "MP4, HEVC or GIF, at four sizes and two rates",
        body: "H.264 for a file that plays everywhere, HEVC for a smaller one, GIF for a silent loop. Full size, 1080p, 720p or 480p, at 60 or 30 frames per second.",
        visual: <ExportDialog />,
        span: "wide",
      },
      {
        title: "Encoded in hardware, on your Mac",
        body: "VideoToolbox does the encoding and Metal does the compositing, on the Mac in front of you. Nothing is sent anywhere to be rendered.",
        visual: <HardwareExport />,
      },
      {
        title: "The file is the frame you approved",
        body: "The preview and the exporter draw the same plan, so what you signed off in the editor is what comes out. There is no render to check afterwards.",
        visual: <PreviewEqualsExport />,
      },
      {
        title: "Any frame: landscape, vertical, square, or a size you type",
        body: "16:9, 4K, 9:16, 1:1, 4:5, and presets for YouTube, Shorts, TikTok, Reels, Instagram, X and LinkedIn. Every setting is a fraction of the frame, so a look survives 16:9 to 9:16.",
        visual: <AnyFrame />,
        span: "wide",
      },
    ],
  },
  {
    id: "sharing",
    eyebrow: "Sharing",
    title: "Share a finished export as a private link",
    lede: "Everything above happens without the network. Uploading a finished export to get a link is something you ask for, on a file you have already made.",
    cards: [
      {
        title: "A watch page that needs no account",
        body: "Press Share on a finished export and it becomes a link, with a poster still from the video. Whoever opens it gets a page with the video on it and nothing to sign up for.",
        visual: <WatchPage />,
        span: "wide",
      },
      {
        title: "Share links are never indexed",
        body: "A share page is never indexed. Anyone with the link can watch it, and that is as far as it goes.",
        visual: <NeverIndexed />,
      },
      {
        title: "A library of everything you have shared",
        body: "Everything you have shared, with its length, size and view count, a copy button and a storage meter.",
        visual: <Library />,
      },
      {
        title: "It unfurls where you paste it",
        body: "The page carries the still and the title, so a link dropped into a chat shows the video before anyone clicks. It plays in the browser on any machine.",
        visual: <Unfurl />,
        span: "wide",
      },
    ],
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
            level={1}
            eyebrow="Features"
            title="Everything Prequel does to a recording"
            lede="Nothing about the look is fixed while you record. Here is the whole list: what Prequel captures, what it does on its own, and what comes out."
            align="centre"
          />
          <DownloadCta className="mt-10" />
          {/* One pill per section, so a reader who came for the captions does
              not scroll past eight grids to find them. Plain anchors: every
              section has an `id` and `scroll-mt-16` for the fixed nav. */}
          <nav
            aria-label="Sections"
            className="mx-auto mt-10 flex max-w-3xl flex-wrap justify-center gap-2"
          >
            {SECTIONS.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="rounded-full border border-line bg-surface px-4 py-2 text-sm text-muted transition-colors hover:border-fg/20 hover:text-fg"
              >
                {section.eyebrow}
              </a>
            ))}
          </nav>
        </Container>
      </section>

      {SECTIONS.map((section, index) => (
        <section
          key={section.id}
          id={section.id}
          // Alternating grounds, so nine grids in a row do not read as one.
          className={`scroll-mt-16 py-24 ${index % 2 === 1 ? "bg-surface/40" : ""}`}
        >
          <Container>
            <SectionHeading eyebrow={section.eyebrow} title={section.title} lede={section.lede} />
            <Bento cards={section.cards} />
            {section.id === "sharing" ? (
              // Said here because a features page is where somebody goes
              // looking for the row that is withheld. `lib/pricing.ts` is
              // explicit that no feature on this site may be described as
              // Pro: the two plans are the same app and differ only in storage.
              <p className="mt-6 text-sm leading-relaxed text-muted">
                Both plans carry every feature on this page. The only thing that differs between
                them is how much you may keep on the sharing side.{" "}
                <Link
                  href="/pricing"
                  className="text-fg underline decoration-line underline-offset-4"
                >
                  See the pricing
                </Link>
                .
              </p>
            ) : null}
          </Container>
        </section>
      ))}

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
