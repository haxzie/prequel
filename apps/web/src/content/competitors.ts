/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  This is the file you edit to publish a comparison page.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  1. Write `src/content/alternatives/<slug>.mdx` — prose only, no frontmatter,
 *     and no `#` heading: the `<h1>` is the hero. Start at `##`.
 *  2. Add an entry below whose `slug` is that filename.
 *
 *  These pages are not like `/create/<keyword>`. They make checkable factual
 *  claims about someone else's product, so two rules apply that do not apply
 *  anywhere else on this site:
 *
 *  **Every price and feature below carries `verifiedOn` and `sources`.** The
 *  date renders on the page and the sources render as links under the tables.
 *  If you cannot cite it, do not claim it — an omitted row costs nothing and a
 *  wrong one discredits every other number on all eleven pages.
 *
 *  **Both billing figures, always.** Screen Studio is $29/month billed monthly
 *  *and* $9/month billed yearly. Quoting only the monthly number reads as three
 *  times the real annual cost, which is the single most damaging error this
 *  page type can make — and it is checkable in one click.
 *
 *  Our own prices are never written here. `PricingCompare` reads `PLANS` from
 *  `lib/pricing.ts`, so when the placeholders there become real prices, one
 *  edit updates every page.
 */

import type { FaqEntry } from "@/lib/faq";

/**
 * The comparison axes, in render order.
 *
 * One list for every page, so a tick means the same thing on all of them and
 * adding a twelfth competitor cannot quietly change what we claim about
 * ourselves.
 */
export const FEATURE_ROWS = [
  { key: "autoZoom", label: "Automatic zoom on clicks" },
  { key: "typingZoom", label: "Zoom on what you type" },
  { key: "smoothCursor", label: "Cursor smoothing and resizing" },
  { key: "camera", label: "Camera overlay, shaped and placed after" },
  { key: "backgrounds", label: "Backgrounds, padding and shadow" },
  { key: "timeline", label: "Timeline editing" },
  { key: "separateTracks", label: "Separate audio tracks" },
  { key: "systemAudio", label: "System audio without a virtual driver" },
  { key: "verticalReframe", label: "Reframe to vertical without cropping" },
  { key: "localOnly", label: "Records and exports without uploading" },
  { key: "iosCapture", label: "Records an iPhone or iPad" },
  { key: "maxExport", label: "Maximum export" },
  { key: "platforms", label: "Platforms" },
  { key: "licence", label: "Licence" },
] as const;

export type FeatureKey = (typeof FEATURE_ROWS)[number]["key"];

/**
 * Our column, written once.
 *
 * Every comparison page reads this. Two entries are deliberately `false` and
 * should stay that way until the app does them: a page that claims a feature we
 * do not have is the fastest way to lose the argument in the thread where it
 * gets posted.
 */
export const PREQUEL_FEATURES: Record<FeatureKey, boolean | string> = {
  autoZoom: true,
  typingZoom: true,
  smoothCursor: true,
  camera: true,
  backgrounds: true,
  timeline: true,
  separateTracks: true,
  systemAudio: true,
  verticalReframe: true,
  localOnly: true,
  // Prequel captures a display, a window or a region. There is no device
  // capture — see `TargetKind` in apps/desktop/src/shared/contract.ts.
  iosCapture: false,
  maxExport: "4K, 120 fps",
  platforms: "macOS 14+, Apple Silicon",
  licence: "Free tier · one-off purchase",
};

export type Competitor = {
  /** The MDX filename in `src/content/alternatives`, and the URL segment. */
  slug: string;
  /** Their product name, spelled the way they spell it. */
  name: string;
  /** Their own description of themselves, not our characterisation of it. */
  tagline: string;
  /** Brand colour, for the monogram tile. Theirs, read off their own site. */
  accent: string;
  /**
   * How the mark renders.
   *
   * `monogram` draws the initial in `accent` and needs no third-party asset.
   * `asset` reads `public/logos/<slug>.svg` and must only be set once that file
   * is there and the vendor's brand terms have been checked — Apple's forbid it
   * outright, so `quicktime` can never be `asset`.
   */
  mark: "monogram" | "asset";
  /**
   * The one-line price, for the summary card.
   *
   * Written by hand rather than taken from `plans[0]`, because the first plan
   * is not the honest answer: quoting Screen Studio at "$29 a month" hides the
   * $9 yearly rate and reads as three times the real cost. Whenever a product
   * has a cheaper billing period, this line carries both.
   */
  priceSummary: string;
  plans: { name: string; price: string; cadence: string }[];
  /** What the free tier actually allows, or `false`. */
  freeTier: string | false;
  /** Keyed by FEATURE_ROWS. A string wherever a tick would be a lie. */
  features: Record<FeatureKey, boolean | string>;
  /** Said plainly. A comparison that concedes nothing is not believed. */
  strength: string;
  /** ISO date the plans and features above were last checked. */
  verifiedOn: string;
  sources: { label: string; url: string }[];
  heading: string;
  lede: string;
  title: string;
  description: string;
  navLabel: string;
  faq: FaqEntry[];
};

/** Declaration order is the footer's order, and it is load-bearing. */
export const competitors: Competitor[] = [
  {
    slug: "screen-studio",
    name: "Screen Studio",
    tagline: "macOS screen recorder with automatic zoom and smooth animations.",
    accent: "#6c4cf1",
    mark: "monogram",
    priceSummary: "$29/mo, or $9/mo billed yearly",
    plans: [
      { name: "Monthly", price: "$29", cadence: "per month, billed monthly" },
      { name: "Yearly", price: "$9", cadence: "per month, billed yearly — $108 a year" },
    ],
    freeTier: false,
    features: {
      autoZoom: true,
      typingZoom: true,
      smoothCursor: true,
      camera: true,
      backgrounds: true,
      timeline: true,
      separateTracks: true,
      systemAudio: true,
      verticalReframe: true,
      localOnly: "Records locally; shareable links upload",
      iosCapture: true,
      maxExport: "4K, 60 fps",
      platforms: "macOS",
      licence: "Subscription only",
    },
    strength:
      "The automatic zoom and cursor smoothing that made this category, and still the output most people are comparing everything else against.",
    verifiedOn: "2026-08-21",
    sources: [{ label: "screen.studio pricing", url: "https://screen.studio/#pricing" }],
    heading: "Looking for a Screen Studio alternative?",
    lede: "Screen Studio is a subscription. Prequel is a one-off purchase with a free tier, records the same automatic zooms, and exports at up to 4K 120.",
    title: "Screen Studio alternative for Mac",
    description:
      "A Screen Studio alternative for macOS with automatic zooms, a framed camera and 4K export — bought once rather than rented. Compared on price, features and licence.",
    navLabel: "vs Screen Studio",
    faq: [
      {
        question: "What is the best Screen Studio alternative?",
        answer:
          "It depends on what pushed you to look. If it was the subscription, Prequel is a one-off purchase with a free tier and the same automatic zooms. If it was macOS-only, Screen Studio has no Windows build and neither do we — FocuSee and Cap both run on Windows. If it was price alone, Screen Studio at $9 a month billed yearly is cheaper than most of the paid alternatives.",
      },
      {
        question: "How much does Screen Studio cost?",
        answer:
          "$29 a month billed monthly, or $9 a month billed yearly — $108 a year. There is no free tier; both plans are paid. Checked on 21 August 2026.",
      },
      {
        question: "Does Screen Studio still have a lifetime licence?",
        answer:
          "Not for new customers. The one-time licence was withdrawn in October 2025 and Screen Studio is subscription-only now. People who already held one keep their version and were given updates into 2027. Their own FAQ still carries an entry titled 'What happens if I purchased a one-time license in the past?'",
      },
      {
        question: "Is there a Screen Studio alternative without a subscription?",
        answer:
          "That is the reason this page exists. Prequel is bought once and keeps working — the purchase includes a year of updates, and the version you have does not stop when that year ends. There is also a free tier with no watermark.",
      },
      {
        question: "Is Prequel a good Screen Studio alternative?",
        answer:
          "For a Mac recording that needs to look produced, yes — the automatic zooms, the framed camera, the backgrounds and the cursor work are the same job. Screen Studio does two things we do not: it records iPhones and iPads over USB, and it is a mature product with years of releases behind it. Prequel exports higher, at up to 4K 120 against their 4K 60, and is not a subscription.",
      },
      {
        question: "Can I open my Screen Studio recordings in Prequel?",
        answer:
          "Not their project files — those are Screen Studio's own format. An exported MP4 is just a video and can be recorded over or cut alongside anything else, but a finished export has the zooms already burned in, so there is nothing left to re-time.",
      },
    ],
  },
  {
    slug: "loom",
    name: "Loom",
    tagline: "Async video messaging for work, now part of Atlassian.",
    accent: "#625df5",
    mark: "monogram",
    priceSummary: "Free tier, then $18–$24 per user/mo",
    plans: [
      { name: "Starter", price: "$0", cadence: "free, capped" },
      { name: "Business", price: "$18", cadence: "per user, per month" },
      { name: "Business + AI", price: "$24", cadence: "per user, per month" },
    ],
    freeTier: "Free Starter, with a five-minute cap per video and a limited library",
    features: {
      autoZoom: false,
      typingZoom: false,
      smoothCursor: false,
      camera: true,
      backgrounds: "Blur and simple backgrounds",
      timeline: "Trim and transcript-based edits",
      separateTracks: false,
      systemAudio: true,
      verticalReframe: false,
      localOnly: "No — recordings upload to Loom",
      iosCapture: false,
      maxExport: "4K on paid plans",
      platforms: "macOS, Windows, web, Chrome",
      licence: "Per-seat subscription",
    },
    strength:
      "It replaced the meeting. Nothing here is faster at turning a thought into a link somebody can watch, and the sharing, viewer analytics and team library are a whole product we do not have.",
    verifiedOn: "2026-08-21",
    sources: [
      { label: "Loom pricing", url: "https://www.loom.com/pricing" },
      {
        label: "Loom's recent product investments",
        url: "https://support.atlassian.com/loom/docs/looms-recent-product-investments/",
      },
    ],
    heading: "Looking for a Loom alternative?",
    lede: "Loom uploads your recording and gives you a link. Prequel gives you a finished file that never leaves your Mac — and does the editing Loom does not.",
    title: "Loom alternative for Mac",
    description:
      "A Loom alternative for macOS that records locally, edits automatically and exports one MP4 — no upload, no seat pricing, no account needed to watch it.",
    navLabel: "vs Loom",
    faq: [
      {
        question: "What is the best Loom alternative?",
        answer:
          "If you want the share link and the team library, the honest answer is that Loom is still the best at that and the alternatives are Tella and Cap. If what you want is a polished video file — zooms on the work, a framed camera, no upload — that is what Prequel does.",
      },
      {
        question: "How much does Loom cost?",
        answer:
          "There is a free Starter plan capped at five minutes a video. Business is $18 per user per month and Business with AI is $24. Checked on 21 August 2026.",
      },
      {
        question: "Does Loom have a five-minute limit?",
        answer:
          "On the free Starter plan, yes. Worth knowing that this cap is not new and was not introduced by Atlassian — Loom announced it in October 2020, three years before the acquisition.",
      },
      {
        question: "Is there a screen recorder that does not upload my recordings?",
        answer:
          "Prequel records, edits and exports entirely on your Mac, on its own media engine. There is no upload step and no cloud render, so the recording exists as files on your disk and nowhere else.",
      },
      {
        question: "What do I lose by moving off Loom?",
        answer:
          "The instant link, the hosted player, viewer analytics and the shared team library. Those are real and Prequel does not replace them — you would be exporting a file and putting it wherever your team already keeps files. What you gain is that the video is edited rather than raw, and that it is yours.",
      },
      {
        question: "Can I move my existing Loom videos into Prequel?",
        answer:
          "No. Loom videos live in Loom's library and Prequel has no importer for them. Download anything you want to keep before you cancel — that is worth doing regardless of where you go next.",
      },
    ],
  },
  {
    slug: "obs",
    name: "OBS Studio",
    tagline: "Free and open source software for video recording and live streaming.",
    accent: "#302e31",
    mark: "monogram",
    priceSummary: "Free, open source",
    plans: [{ name: "OBS Studio", price: "Free", cadence: "open source, GPL v2 or later" }],
    freeTier: "The whole product, with no limits and no account",
    features: {
      autoZoom: false,
      typingZoom: false,
      smoothCursor: false,
      camera: "Composited by hand in a scene",
      backgrounds: "Add an image source yourself",
      timeline: false,
      separateTracks: true,
      systemAudio: true,
      verticalReframe: "Rebuild the scene at the new size",
      localOnly: true,
      iosCapture: false,
      maxExport: "Whatever you configure",
      platforms: "macOS, Windows, Linux",
      licence: "Free, open source",
    },
    strength:
      "The most capable free compositor and encoder there is, and the only one on this page that live streams. Arbitrary scenes, unlimited sources, filters and hardware encoding, for nothing.",
    verifiedOn: "2026-08-21",
    sources: [
      { label: "obsproject.com", url: "https://obsproject.com/" },
      {
        label: "OBS macOS desktop audio guide",
        url: "https://obsproject.com/kb/macos-desktop-audio-capture-guide",
      },
    ],
    heading: "Looking for an OBS alternative on Mac?",
    lede: "OBS records anything you can configure it to record. Prequel decides the hard parts for you and hands back a finished video instead of a scene graph.",
    title: "OBS alternative for Mac",
    description:
      "An OBS Studio alternative for macOS that needs no scene setup: automatic zooms, a framed camera, a real timeline and one MP4 out. What OBS gives you and what it asks of you.",
    navLabel: "vs OBS",
    faq: [
      {
        question: "Is there an OBS alternative that is easier to set up?",
        answer:
          "That is the whole difference. OBS asks you to build a scene — add a display source, add a webcam source, position and crop both, set an encoder — before you record anything. Prequel asks which screen, and does the rest afterwards on a take you can already see.",
      },
      {
        question: "Does OBS need BlackHole to record system audio on a Mac?",
        answer:
          "Not any more, and this is worth correcting because a lot of comparison pages still say otherwise. OBS 30 and later on macOS 13 and later ship a macOS Audio Capture source that records desktop audio directly, either everything or one application. A virtual driver is only needed on older versions of macOS.",
      },
      {
        question: "Is OBS still better for some things?",
        answer:
          "Yes, and it is not close. If you are live streaming, OBS is the tool and Prequel does not stream at all. If you need a dozen sources, custom filters or an unusual capture setup, OBS will do it and Prequel will not. OBS is also free forever, with no account.",
      },
      {
        question: "Does OBS have automatic zoom?",
        answer:
          "No. OBS records what the scene contains at a fixed framing. Zooms and cursor smoothing are done afterwards in a video editor, or with plugins and manual keyframes. Prequel places them from your clicks and typing while it records.",
      },
      {
        question: "What resolution can OBS record at?",
        answer:
          "Whatever you configure the canvas and encoder for — there is no product-imposed ceiling, which is one of its genuine advantages. Prequel exports up to 4K at 120 frames per second, hardware encoded.",
      },
      {
        question: "Does OBS have a video editor?",
        answer:
          "No. OBS records and streams; editing happens somewhere else. That is the step Prequel is built around — the editor opens on the take with the zooms already placed.",
      },
    ],
  },
  {
    slug: "quicktime",
    name: "QuickTime Player",
    tagline: "Apple's player and recorder, built into macOS.",
    accent: "#4e84f9",
    // Never `asset`. Apple's trademark guidelines prohibit using Apple logos and
    // product icons in third-party marketing material.
    mark: "monogram",
    priceSummary: "Free with macOS",
    plans: [{ name: "QuickTime Player", price: "Free", cadence: "included with macOS" }],
    freeTier: "The whole thing — it comes with the Mac",
    features: {
      autoZoom: false,
      typingZoom: false,
      smoothCursor: false,
      camera: "Recorded separately, not composited",
      backgrounds: false,
      timeline: "Trim, split and rearrange",
      separateTracks: false,
      systemAudio: false,
      verticalReframe: false,
      localOnly: true,
      iosCapture: "Over USB, as a movie recording",
      maxExport: "Your display's own resolution",
      platforms: "macOS",
      licence: "Included with macOS",
    },
    strength:
      "It is already installed, it starts instantly, it records at your display's native resolution and it hands you a plain file you own. Nothing is faster for capture this and send it.",
    verifiedOn: "2026-08-21",
    sources: [
      {
        label: "Apple — Record your screen in QuickTime Player",
        url: "https://support.apple.com/guide/quicktime-player/record-your-screen-qtp97b08e666/mac",
      },
    ],
    heading: "Want more than QuickTime for screen recording?",
    lede: "QuickTime records the screen and trims the ends. Everything that makes a recording worth watching — the zooms, the camera, the system audio — is the part it leaves to you.",
    title: "A QuickTime alternative for screen recording on Mac",
    description:
      "QuickTime records your screen and offers one audio option: a microphone. Prequel adds system audio, a framed camera, automatic zooms and 4K export, all locally.",
    navLabel: "vs QuickTime",
    faq: [
      {
        question: "Can QuickTime record system audio?",
        answer:
          "No. Apple's own documentation for a screen recording lists exactly one audio option, and it is a microphone — there is no system audio setting. That is why the standard advice is to install a virtual driver like BlackHole and route your output through it. Prequel records system audio directly, as its own track.",
      },
      {
        question: "Why is my QuickTime screen recording black?",
        answer:
          "Almost always the Screen Recording permission. macOS hands back empty frames rather than an error when it has not been granted, which reads as a broken app rather than a missing checkbox. Grant it under Privacy and Security in System Settings and start the recording again.",
      },
      {
        question: "Can QuickTime record my screen and my camera at the same time?",
        answer:
          "Not into one frame. It will record a screen, or a camera, and putting both in one video means recording twice and compositing them yourself. Prequel captures both at once as separate tracks, and where the camera sits is decided afterwards.",
      },
      {
        question: "Why are QuickTime screen recordings such large files?",
        answer:
          "It writes a MOV tuned for quality rather than size. Prequel exports hardware H.264 or HEVC at a constant frame rate, which is dramatically smaller for the same seconds — and a constant frame rate is also what keeps audio in sync after an upload.",
      },
      {
        question: "Can I edit a QuickTime recording?",
        answer:
          "A little. QuickTime will trim, split, rotate and rearrange clips. It will not zoom, frame a camera, add a background, clean up the cursor or mix two audio sources, which is most of what a screen recording needs.",
      },
      {
        question: "Is there a free alternative to QuickTime for screen recording?",
        answer:
          "OBS Studio is free and open source and will do far more, at the cost of setting up a scene first. Prequel has a free tier with no watermark, limited on length and export format rather than on the recording being usable.",
      },
    ],
  },
  {
    slug: "cleanshot-x",
    name: "CleanShot X",
    tagline: "Capture your Mac's screen like a pro.",
    accent: "#ff6b35",
    mark: "monogram",
    priceSummary: "$29 once, or $8 per user/mo",
    plans: [
      { name: "App + Cloud Basic", price: "$29", cadence: "one-off, a year of updates" },
      { name: "App + Cloud Pro", price: "$8", cadence: "per user, per month, billed annually" },
    ],
    freeTier: false,
    features: {
      autoZoom: false,
      typingZoom: false,
      smoothCursor: false,
      camera: false,
      backgrounds: "For screenshots",
      timeline: "Trim only",
      separateTracks: false,
      systemAudio: true,
      verticalReframe: false,
      localOnly: "Local, with optional cloud upload",
      iosCapture: false,
      maxExport: "Display resolution, MP4 or GIF",
      platforms: "macOS",
      licence: "One-off, or per-seat for Cloud",
    },
    strength:
      "The best screenshot tool on the Mac, and it is not particularly close — scrolling capture, annotation, OCR, cloud links and a genuinely one-off price. Most people who own it own it for that.",
    verifiedOn: "2026-08-21",
    sources: [{ label: "CleanShot X pricing", url: "https://cleanshot.com/pricing" }],
    heading: "Need more than CleanShot X for video?",
    lede: "CleanShot X is a screenshot tool that also records. Prequel is a recorder that hands back an edited video — the two overlap less than the feature lists suggest.",
    title: "CleanShot X alternative for screen recording",
    description:
      "CleanShot X is unbeatable at screenshots and light on video. Compare its recording against Prequel's automatic zooms, camera framing and 4K export on macOS.",
    navLabel: "vs CleanShot X",
    faq: [
      {
        question: "How much does CleanShot X cost?",
        answer:
          "$29 as a one-off for App and Cloud Basic, which includes the Mac app to keep and a year of updates, with an optional $19 a year to keep updating. Cloud Pro is $8 per user per month billed annually, or $10 monthly. Checked on 21 August 2026.",
      },
      {
        question: "Does CleanShot X have automatic zoom?",
        answer:
          "No. Its video recording is deliberately simple — record, trim, share. There is no automatic zoom, no cursor smoothing and no camera overlay composited into the frame.",
      },
      {
        question: "Should I use both?",
        answer:
          "Plenty of people will. They solve different problems: CleanShot X for screenshots, annotation and a quick clip to drop into a thread, Prequel for a recording that has to look produced. Nothing about owning one argues against the other.",
      },
      {
        question: "Is Prequel also a one-off purchase?",
        answer:
          "Yes, on the same shape — bought once, a year of updates, and the version you have keeps working afterwards. There is also a free tier, which CleanShot X does not have.",
      },
    ],
  },
  {
    slug: "camtasia",
    name: "Camtasia",
    tagline: "TechSmith's screen recorder and video editor for training and tutorials.",
    accent: "#8a56d1",
    mark: "monogram",
    priceSummary: "Subscription only, billed annually",
    plans: [
      { name: "Starter", price: "Paid", cadence: "annual — exports carry a watermark" },
      { name: "Essentials · Create · Pro", price: "Paid", cadence: "annual, tiered" },
    ],
    freeTier: false,
    features: {
      autoZoom: false,
      typingZoom: false,
      smoothCursor: false,
      camera: true,
      backgrounds: true,
      timeline: "A full multi-track editor",
      separateTracks: true,
      systemAudio: true,
      verticalReframe: "Change the canvas and re-position by hand",
      localOnly: true,
      iosCapture: false,
      maxExport: "4K",
      platforms: "macOS 14+, Windows",
      licence: "Subscription only, annual",
    },
    strength:
      "Record and edit in one place, with a real multi-track timeline, quizzing and SCORM output. For a training department that needs interactive courseware, nothing on this page is a substitute.",
    verifiedOn: "2026-08-21",
    sources: [
      {
        label: "TechSmith — transition to subscription pricing",
        url: "https://support.techsmith.com/hc/en-us/articles/27009223314701-TechSmith-Transition-to-Annual-Subscription-Pricing-Model-in-2025",
      },
      {
        label: "Difference between Camtasia Pro, Create and Essentials",
        url: "https://support.techsmith.com/hc/en-us/articles/41688340554765-What-Is-the-Difference-Between-Camtasia-Pro-Create-and-Essentials",
      },
    ],
    heading: "Looking for a lighter Camtasia alternative?",
    lede: "Camtasia is a full video editor you drive by hand. Prequel does the pass a screen recording actually needs and gets out of the way.",
    title: "Camtasia alternative for Mac",
    description:
      "A Camtasia alternative for macOS: automatic zooms instead of manual keyframes, no watermark on the free tier, and a one-off purchase rather than an annual subscription.",
    navLabel: "vs Camtasia",
    faq: [
      {
        question: "Is Camtasia still a one-time purchase?",
        answer:
          "No. TechSmith stopped selling perpetual licences on 1 January 2025 and moved to subscription-only on 12 February 2025, billed annually with no monthly option. Holders of old maintenance agreements were moved to a discounted legacy subscription. Some write-ups date this to autumn 2024; TechSmith's own documentation says February 2025.",
      },
      {
        question: "Does Camtasia's cheapest plan watermark exports?",
        answer:
          "Yes. The Starter tier watermarks exported video until you move up a tier. Prequel's free tier does not watermark anything — its limits are on length and export format, not on the file being usable.",
      },
      {
        question: "Does Camtasia have automatic zoom?",
        answer:
          "It has zoom-and-pan, but you place and time it yourself on the timeline. Prequel records where you click and type and clusters those moments into zooms before the editor opens, which is a different amount of work for the same result.",
      },
      {
        question: "Is Camtasia better for anything?",
        answer:
          "Yes — long-form courseware. It has a full multi-track timeline, quizzing, captions and SCORM export, and it runs on Windows. If you are building an interactive course rather than a demo, that is what it is for.",
      },
      {
        question: "Why is Camtasia slow on long recordings?",
        answer:
          "It is the most repeated complaint about it, and TechSmith documents workarounds themselves — including keeping projects off cloud and network drives. Reviewers describe multi-second stalls after each cut on heavy projects.",
      },
    ],
  },
  {
    slug: "screenflow",
    name: "ScreenFlow",
    tagline: "Telestream's screen recording and video editing software for Mac.",
    accent: "#2f6fdb",
    mark: "monogram",
    priceSummary: "$199.99 once, single machine",
    plans: [{ name: "ScreenFlow 10", price: "$199.99", cadence: "one-off, single machine" }],
    freeTier: "A free trial that watermarks exports",
    features: {
      autoZoom: false,
      typingZoom: false,
      smoothCursor: false,
      camera: true,
      backgrounds: true,
      timeline: "A full multi-track editor",
      separateTracks: true,
      systemAudio: true,
      verticalReframe: "Change the canvas and re-position by hand",
      localOnly: true,
      iosCapture: "Over USB",
      maxExport: "4K",
      platforms: "macOS 15 or macOS 26",
      licence: "One-off, paid major upgrades",
    },
    strength:
      "Twelve years of reviews agree it is the most pleasant screen recorder to actually edit in on a Mac. That reputation is earned and it is still true of the editor itself.",
    verifiedOn: "2026-08-21",
    sources: [
      {
        label: "ScreenFlow version history",
        url: "https://www.telestream.net/screenflow/versions.htm",
      },
      {
        label: "ScreenFlow 10 on the Mac App Store",
        url: "https://apps.apple.com/us/app/screenflow-10/id1568414480?mt=12",
      },
    ],
    heading: "Looking for a ScreenFlow alternative?",
    lede: "ScreenFlow is $199.99 and has not had a major version since June 2021. Prequel is a one-off purchase built for the Macs that shipped since.",
    title: "ScreenFlow alternative for Mac",
    description:
      "A ScreenFlow alternative for macOS with automatic zooms and hardware 4K export. What ScreenFlow costs, what version it is on, and where it has stalled.",
    navLabel: "vs ScreenFlow",
    faq: [
      {
        question: "How much does ScreenFlow cost?",
        answer:
          "$199.99 for ScreenFlow 10, as a one-off licence tied to a single machine — moving between a laptop and a desktop means deactivating one to use the other. Historically, major upgrades were paid. Checked on 21 August 2026.",
      },
      {
        question: "Is ScreenFlow still being developed?",
        answer:
          "It is, but slowly. Version 10 shipped in June 2021 and there has been no version 11 since; the current release is 10.5.2 from February 2026. Version 10.5, in August 2025, was a genuine feature release that moved system audio onto modern macOS APIs and removed the audio driver. Telestream itself has not mentioned ScreenFlow in a press release for two years, and both of its community forums are offline.",
      },
      {
        question: "Does ScreenFlow have automatic zoom?",
        answer:
          "No. It has a capable multi-track timeline where you add zoom-and-pan actions yourself. Prequel places them from your clicks and typing before you open the editor.",
      },
      {
        question: "Does ScreenFlow run on the latest macOS?",
        answer:
          "10.5.2 requires macOS 15 Sequoia or macOS 26 Tahoe. Its release notes are candid about the road there — 10.5.1 fixed recording stopping silently on Tahoe, and 10.5.2 fixed a crash on macOS 26.2.",
      },
      {
        question: "What does Prequel do that ScreenFlow does not?",
        answer:
          "The automatic pass, mainly: zooms from clicks and typing, cursor smoothing and hiding, and a camera framed after the fact. Prequel also exports at up to 120 frames per second. ScreenFlow has the deeper editor and records iOS devices over USB.",
      },
    ],
  },
  {
    slug: "descript",
    name: "Descript",
    tagline: "Edit video by editing the transcript.",
    accent: "#2b8fff",
    mark: "monogram",
    priceSummary: "Free tier, then $16–$50/mo annually",
    plans: [
      { name: "Free", price: "$0", cadence: "720p, watermarked, 60 min transcription a month" },
      { name: "Hobbyist", price: "$16", cadence: "per month, billed annually" },
      { name: "Creator", price: "$24", cadence: "per month, billed annually" },
      { name: "Business", price: "$50", cadence: "per month, billed annually" },
    ],
    freeTier: "Free, but exports at 720p with a watermark",
    features: {
      autoZoom: false,
      typingZoom: false,
      smoothCursor: false,
      camera: "Picture in picture",
      backgrounds: "Green screen removal",
      timeline: "Transcript-based, plus multi-track",
      separateTracks: true,
      systemAudio: true,
      verticalReframe: true,
      localOnly: "No — projects and media are stored on their servers",
      iosCapture: false,
      maxExport: "4K on Creator and above",
      platforms: "macOS, Windows, web",
      licence: "Per-seat subscription",
    },
    strength:
      "Transcript-based editing, and nothing else here is close. Delete a word in the transcript and it is gone from the video — for anything narration-heavy that is a genuinely different way to work.",
    verifiedOn: "2026-08-21",
    sources: [
      { label: "Descript pricing", url: "https://www.descript.com/pricing" },
      { label: "Descript security", url: "https://www.descript.com/security" },
    ],
    heading: "Looking for a Descript alternative for screen recording?",
    lede: "Descript is built around the transcript and stores your media on its servers. Prequel is built around the screen and never leaves your Mac.",
    title: "Descript alternative for Mac screen recording",
    description:
      "A Descript alternative for macOS screen recording: automatic zooms, local-only processing and no watermark on the free tier. Compared on price and features.",
    navLabel: "vs Descript",
    faq: [
      {
        question: "How much does Descript cost?",
        answer:
          "There is a free tier that exports at 720p with a watermark. Paid plans billed annually are Hobbyist at $16 a month, Creator at $24 and Business at $50, with transcription hours and AI credits rising per tier. Checked on 21 August 2026.",
      },
      {
        question: "Does Descript watermark free exports?",
        answer:
          "Yes, and it caps them at 720p. Prequel's free tier has no watermark and exports 1080p — the limits are on length and format rather than on the file being usable.",
      },
      {
        question: "Does Descript store my recordings in the cloud?",
        answer:
          "Yes. Their own security documentation says project information, uploaded files and transcripts are stored on their servers, and that audio, video and transcription data sit on Amazon S3 or Google Cloud after transcription. Prequel records, edits and exports locally with no upload step.",
      },
      {
        question: "Is Descript better for anything?",
        answer:
          "Editing by transcript, without question — plus filler-word removal, Studio Sound and overdub. If your video is mostly you talking, that workflow is hard to give up. Prequel has no transcript editing at all.",
      },
      {
        question: "Does Descript have automatic zoom on clicks?",
        answer:
          "Not as an automatic pass driven by where you clicked. Prequel records clicks and keystrokes during capture and turns them into zooms before the editor opens.",
      },
    ],
  },
  {
    slug: "tella",
    name: "Tella",
    tagline: "Record and share video that looks professionally edited.",
    accent: "#5e51f8",
    mark: "monogram",
    priceSummary: "$13–$19 per user/mo, no free plan",
    plans: [
      { name: "Pro", price: "$13", cadence: "per user, per month" },
      { name: "Premium", price: "$19", cadence: "per user, per month" },
    ],
    freeTier: false,
    features: {
      autoZoom: true,
      typingZoom: false,
      smoothCursor: false,
      camera: true,
      backgrounds: true,
      timeline: true,
      separateTracks: true,
      systemAudio: true,
      verticalReframe: true,
      localOnly: "No — recordings are hosted by Tella",
      iosCapture: false,
      maxExport: "4K; 60 fps on Premium only",
      platforms: "macOS, Windows, web, Chrome",
      licence: "Per-seat subscription, no free plan",
    },
    strength:
      "It closes the whole loop — record, auto-edit, host on a branded page with a custom domain, password protection and per-viewer analytics. Polish and distribution in one product.",
    verifiedOn: "2026-08-21",
    sources: [
      { label: "Tella pricing", url: "https://www.tella.com/pricing" },
      { label: "Tella plans", url: "https://www.tella.com/help/introduction/plans" },
    ],
    heading: "Looking for a Tella alternative?",
    lede: "Tella hosts your video and charges per seat, with no free plan. Prequel exports a file you own, on a Mac app you buy once.",
    title: "Tella alternative for Mac",
    description:
      "A Tella alternative for macOS with automatic zooms and 4K 120 export, recorded and rendered locally. No per-seat subscription and a free tier that is not a trial.",
    navLabel: "vs Tella",
    faq: [
      {
        question: "Does Tella have a free plan?",
        answer:
          "No. Tella's own help pages state it is a paid product with no forever-free plan — there is a seven-day trial, and exporting requires a subscription. Prequel has a free tier that is not time-limited.",
      },
      {
        question: "How much does Tella cost?",
        answer:
          "Pro is $13 per user per month and Premium is $19, with Enterprise priced on request. 60 fps export is Premium only. Checked on 21 August 2026.",
      },
      {
        question: "Is Tella better for anything?",
        answer:
          "Sharing. Hosted pages, custom domains, password protection, CTAs and viewer analytics are a distribution product we do not have, and it runs on Windows and in a browser. If the link matters more than the file, Tella is the stronger choice.",
      },
      {
        question: "Where does Tella process my recordings?",
        answer:
          "In the cloud — every video gets a hosted Tella page. Prequel records and renders on your Mac's own media engine, so nothing is uploaded to produce the file.",
      },
    ],
  },
  {
    slug: "cap",
    name: "Cap",
    tagline: "Open source screen recording, local first.",
    accent: "#4785ff",
    mark: "monogram",
    priceSummary: "Free tier, $29 licence, or $12 per user/mo",
    plans: [
      { name: "Free", price: "$0", cadence: "personal use; shared links capped at 5 minutes" },
      {
        name: "Desktop licence",
        price: "$29",
        cadence: "single user — their page also says billed yearly",
      },
      { name: "Cap Pro", price: "$12", cadence: "per user, per month, or $8.16 billed annually" },
    ],
    freeTier: "Studio Mode and 4K 60 export, for personal use",
    features: {
      autoZoom: true,
      typingZoom: false,
      smoothCursor: true,
      camera: true,
      backgrounds: true,
      timeline: true,
      separateTracks: true,
      systemAudio: true,
      verticalReframe: true,
      localOnly: true,
      iosCapture: false,
      maxExport: "4K, 60 fps",
      platforms: "macOS, Windows",
      licence: "AGPL v3, paid tiers for cloud",
    },
    strength:
      "Genuinely open source and genuinely local. Auto-zoom, cursor smoothing, backgrounds, 4K 60, bring your own S3 bucket, and the whole platform is self-hostable. Of everything on this page it is the closest to what Prequel does.",
    verifiedOn: "2026-08-21",
    sources: [
      { label: "Cap pricing", url: "https://cap.so/pricing" },
      { label: "Cap Studio Mode", url: "https://cap.so/features/studio-mode" },
    ],
    heading: "Cap or Prequel?",
    lede: "Cap is the closest thing to Prequel on this list, and it is open source. The difference is what each one is built out of, and what happens after the free tier.",
    title: "Cap alternative for Mac",
    description:
      "Cap and Prequel compared: both record locally with automatic zooms and 4K export. Where they differ on platform, licence, pricing and the capture pipeline.",
    navLabel: "vs Cap",
    faq: [
      {
        question: "How much does Cap cost?",
        answer:
          "There is a free tier for personal use with Studio Mode and 4K 60 export, and shared links capped at five minutes. A desktop licence is $29 for a single user — their pricing page describes it as both perpetual and billed yearly, which we will not try to resolve for them. Cap Pro is $12 per user per month, or $8.16 billed annually. Checked on 21 August 2026.",
      },
      {
        question: "Is Cap open source?",
        answer:
          "Yes, genuinely — AGPL v3 for most of it, with some crates under MIT, and the platform can be self-hosted with Docker. Prequel is not open source. If that matters to you, it is a real reason to choose Cap and we would rather say so than pretend otherwise.",
      },
      {
        question: "Does Cap record locally?",
        answer:
          "Yes. Cap states that recording and editing happen locally on your device, and it lets you connect your own S3 bucket or Google Drive. This is one of the few comparisons on this site where local-only is not a difference between us.",
      },
      {
        question: "So why choose Prequel over Cap?",
        answer:
          "It is a macOS-only app built on ScreenCaptureKit, AVFoundation, VideoToolbox and Metal, and that focus is the argument: export runs at up to 4K 120 against Cap's 4K 60, and zooms are driven by typing as well as clicking. Cap runs on Windows and is open source, which Prequel is not.",
      },
    ],
  },
  {
    slug: "focusee",
    name: "FocuSee",
    tagline: "Screen recording with automatic zoom, for Windows and Mac.",
    accent: "#ff8a3d",
    mark: "monogram",
    priceSummary: "$49.99 first year, or $199.99 lifetime",
    plans: [
      { name: "Standard", price: "$49.99", cadence: "first year, one computer" },
      { name: "Standard monthly", price: "$19.99", cadence: "per month" },
      { name: "Advanced lifetime", price: "$199.99", cadence: "one-off, up to five computers" },
    ],
    freeTier: "Free, but exports carry a watermark",
    features: {
      autoZoom: true,
      typingZoom: true,
      smoothCursor: true,
      camera: "Picture in picture and full screen",
      backgrounds: true,
      timeline: true,
      separateTracks: "Background music, not a track mixer",
      systemAudio: true,
      verticalReframe: true,
      localOnly: "Partly — it runs a server-side AI credit system",
      iosCapture: false,
      maxExport: "4K, 60 fps",
      platforms: "macOS, Windows",
      licence: "Per-machine, subscription or lifetime",
    },
    strength:
      "The cheapest route to this kind of output, with a real lifetime option — and it runs on Windows, which neither Screen Studio nor Prequel does.",
    verifiedOn: "2026-08-21",
    sources: [{ label: "FocuSee pricing", url: "https://focusee.imobie.com/pricing.htm" }],
    heading: "Looking for a FocuSee alternative on Mac?",
    lede: "FocuSee is cheap and runs on Windows. Prequel is a native Mac app that renders on your machine's own media engine and does not watermark its free tier.",
    title: "FocuSee alternative for Mac",
    description:
      "A FocuSee alternative for macOS: automatic zooms, hardware 4K 120 export and a free tier with no watermark. Compared on price, platform and processing.",
    navLabel: "vs FocuSee",
    faq: [
      {
        question: "How much does FocuSee cost?",
        answer:
          "Standard is $49.99 for the first year on one computer, or $19.99 a month. Advanced adds more machines and an AI credit allowance, and there is a $199.99 lifetime option covering up to five computers. Their pricing page labels one annual plan in a way that reads as a monthly price; treat the annual figure as the real one. Checked on 21 August 2026.",
      },
      {
        question: "Does FocuSee watermark free exports?",
        answer:
          "Yes — the free version watermarks, and paying removes it. Prequel's free tier has no watermark.",
      },
      {
        question: "Does FocuSee work offline?",
        answer:
          "Partly. FocuSee says cursor tracking, click detection and shortcut recognition are processed locally and never uploaded, which is a statement about those signals rather than the whole pipeline — it also runs a server-side AI credit system. Prequel does everything locally, including export.",
      },
      {
        question: "Is FocuSee better for anything?",
        answer:
          "It runs on Windows, and it is cheaper — including a genuine lifetime licence. If you record on both platforms, that settles it.",
      },
    ],
  },
];

export function findCompetitor(slug: string): Competitor | undefined {
  return competitors.find((competitor) => competitor.slug === slug);
}

/** `21 August 2026`, matching the blog's `formatDate`. */
export function formatVerified(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
