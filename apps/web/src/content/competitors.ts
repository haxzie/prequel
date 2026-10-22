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
 *  wrong one discredits every other number on every page in the set.
 *
 *  **Both billing figures, always.** Screen Studio is $29/month billed monthly
 *  *and* $9/month billed yearly. Quoting only the monthly number reads as three
 *  times the real annual cost, which is the single most damaging error this
 *  page type can make — and it is checkable in one click.
 *
 *  Our own price is never written into a table here. `PricingCompare` and
 *  `AtAGlance` read `PLANS` from `lib/pricing.ts`, so a change of price is one
 *  edit for every page. It does appear in the prose below, where a sentence
 *  needs it — grep for it there when it moves.
 *
 *  **Argue on the video, not on the price.** Prequel is $9 a month, or $29 once,
 *  which is at or under most of this category rather than over it. That makes
 *  the number safe to state — it did not use to be — but it is still not the
 *  argument these pages are built to make. A page that leads on being cheapest
 *  invites the reader to re-check it the next time somebody runs a sale, and it
 *  takes every other number on every other page with it when they find one. The
 *  claim is the finished video — zooms that follow the work, a perspective
 *  tilt, focus falling away from the subject, a camera framed afterwards — and
 *  where a rival is still cheaper, they say so.
 */

import type { FaqEntry } from "@/lib/faq";

/**
 * The comparison axes, in render order.
 *
 * One list for every page, so a tick means the same thing on all of them and
 * adding another competitor cannot quietly change what we claim about
 * ourselves.
 */
export const FEATURE_ROWS = [
  { key: "autoZoom", label: "Automatic zoom on clicks" },
  { key: "typingZoom", label: "Zoom on what you type" },
  { key: "smoothCursor", label: "Cursor smoothing and resizing" },
  { key: "camera", label: "Camera overlay, shaped and placed after" },
  { key: "backgrounds", label: "Backgrounds, padding and shadow" },
  { key: "layouts", label: "Layouts for the screen and camera" },
  { key: "cameraCutout", label: "Camera cut out of its background" },
  { key: "tiltFocus", label: "Perspective tilt and focus falloff on zooms" },
  { key: "localCaptions", label: "Captions transcribed on your Mac" },
  { key: "timeline", label: "Timeline editing" },
  { key: "separateTracks", label: "Separate audio tracks" },
  { key: "systemAudio", label: "System audio without a virtual driver" },
  { key: "verticalReframe", label: "Reframe to vertical without cropping" },
  { key: "loupe", label: "Magnifying-glass loupe over the work" },
  { key: "looks", label: "Colour looks and filters" },
  { key: "noiseReduction", label: "Microphone noise reduction" },
  { key: "importVideo", label: "Import a video you already have" },
  { key: "localOnly", label: "Records and exports without uploading" },
  { key: "shareLinks", label: "Shareable links" },
  { key: "workspace", label: "Team workspace" },
  { key: "iosCapture", label: "Records an iPhone or iPad" },
  { key: "maxExport", label: "Maximum export" },
  { key: "downloadSize", label: "Download size" },
  { key: "platforms", label: "Platforms" },
  { key: "licence", label: "Licence" },
] as const;

export type FeatureKey = (typeof FEATURE_ROWS)[number]["key"];

/**
 * Our column, written once.
 *
 * Every comparison page reads this. `iosCapture` is deliberately `false` and
 * should stay that way until the app does it: a page that claims a feature we
 * do not have is the fastest way to lose the argument in the thread where it
 * gets posted.
 *
 * `shareLinks` and `workspace` are in both plans, like everything else in
 * `lib/pricing.ts` — the two differ only in how much may be kept on a shared
 * link, never in whether a feature exists. They live here because leaving them off the table did not
 * make the pages more modest, it made them silent on the one axis Loom, Tella,
 * Descript and Cap are bought for — and silence on a comparison table reads as
 * a cross.
 */
export const PREQUEL_FEATURES: Record<FeatureKey, boolean | string> = {
  autoZoom: true,
  typingZoom: true,
  smoothCursor: true,
  camera: true,
  backgrounds: true,
  // The count is the one `/features` gives, and it is the one thing on the
  // row a tick would hide: most of the column has layouts of some kind.
  layouts: "Fourteen, per clip",
  // "Remove background" in the Camera panel, 0.0.19 — a segmentation mask made
  // while recording, so it is you over the wallpaper with no card. Not a
  // virtual background inside a bubble, which is what most of the column has.
  cameraCutout: true,
  tiltFocus: true,
  // `SpeechAnalyzer` on macOS 26 and `SFSpeechRecognizer` below it, both
  // on-device — see `main/transcribe/apple.ts`. Nothing leaves the Mac. A tick here is a claim about where the audio goes,
  // not whether captions exist, so every rival with cloud transcription gets
  // a string saying so rather than a tick.
  localCaptions: true,
  timeline: true,
  separateTracks: true,
  systemAudio: true,
  verticalReframe: true,
  // Zoom Method > Loupe, 0.0.35: a lens with curvature, fringing and reflection
  // that follows the pointer or holds a region.
  loupe: true,
  // Seventeen looks over the whole picture, and six for the camera alone.
  looks: true,
  // Light or Strong, 0.0.32 — Apple's sound isolation, on the Mac.
  noiseReduction: true,
  // Add Clip > Import Video, 0.0.30.
  importVideo: true,
  // Still true with Pro in the picture: recording and export never need the
  // network, and the upload is a thing you ask for. That is the distinction
  // worth holding — "local-first" is not "no server exists".
  localOnly: true,
  shareLinks: true,
  workspace: true,
  // Prequel captures a display, a window or a region. There is no device
  // capture — see `TargetKind` in apps/desktop/src/shared/contract.ts.
  iosCapture: false,
  maxExport: "4K, 120 fps",
  // The `.dmg` on the v0.0.35 release, 103,625,550 bytes. Every size on
  // this row is the vendor's own Apple Silicon `.dmg` as served on 2026-09-14
  // — `Content-Length` of the URL the Homebrew cask points at, in decimal
  // megabytes, and the version in the source's label — so a number here can
  // be re-measured with one `curl -I` rather than trusted. Ours moves with
  // every release; re-read it when it is bumped.
  downloadSize: "104 MB",
  platforms: "macOS 14+, Apple Silicon",
  licence: "$9/month or $29 once, 7-day trial",
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
   * Whether this vendor's logo may be shown at all.
   *
   * Not "is there a file" — that is answered by the filesystem, at build time,
   * by `Mark`. This is the separate question of whether we want to, which is a
   * judgement about someone else's trademark rather than anything the code can
   * work out.
   *
   * A `true` here is a decision rather than a default: each vendor's brand
   * terms was read before its mark went in. Set this to `false` to pull one
   * without deleting the file, and the page falls back to the monogram: the
   * flag is checked before the filesystem, so it is the answer, not a hint.
   *
   * QuickTime is the one `false` in the set, and the reason is Apple's own
   * guidelines, which spell out a prohibition on reproducing their graphic
   * marks. That page draws a monogram and always will.
   *
   * `true` here is not a claim that a logo exists. Every slug falls back to its
   * monogram until someone puts a file in `public/logos`.
   */
  logoAllowed: boolean;
  /**
   * The letters on the fallback tile.
   *
   * Authored rather than taken from `name.charAt(0)`, because the first letter
   * is not distinctive across this set: Screen Studio and ScreenFlow both begin
   * with an S. Two pages showing the same square is worse than no mark at all —
   * it reads as a placeholder nobody finished.
   *
   * One or two characters. Three do not fit at this size.
   */
  monogram: string;
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
    logoAllowed: true,
    monogram: "SS",
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
      layouts: "Camera over the screen, or full screen",
      cameraCutout: "Yes, in beta since version 4",
      tiltFocus: false,
      localCaptions: true,
      timeline: true,
      separateTracks: true,
      systemAudio: true,
      verticalReframe: true,
      loupe: "Yes, new in version 4",
      looks: "LUTs",
      noiseReduction: true,
      importVideo: "Yes, an mp4, without cursor animation",
      localOnly: "Records locally; shareable links upload",
      shareLinks: "Yes, 30-minute cap, branded page",
      workspace: false,
      iosCapture: true,
      maxExport: "4K, 60 fps",
      downloadSize: "366 MB",
      platforms: "macOS",
      licence: "Subscription only",
    },
    strength:
      "The automatic zoom and cursor smoothing that made this category, and still the output most people are comparing everything else against.",
    verifiedOn: "2026-10-03",
    sources: [
      { label: "Screen Studio", url: "https://screen.studio/" },
      { label: "screen.studio pricing", url: "https://screen.studio/#pricing" },
      {
        label: "Dynamic camera layouts",
        url: "https://screen.studio/guide/dynamic-camera-layouts-",
      },
      { label: "Screen Studio changelog", url: "https://screen.studio/changelog" },
      {
        label: "Screen Studio 3.7.5 installer",
        url: "https://screenstudioassets.com/releases/3.7.5-4595/Screen%20Studio%203.7.5-4595%20Apple%20Silicon.dmg",
      },
      { label: "Screen Studio roadmap", url: "https://screen.studio/roadmap" },
      {
        label: "Create a project from an existing video",
        url: "https://screen.studio/guide/creating-project-from-existing-video",
      },
    ],
    heading: "Looking for a Screen Studio alternative?",
    lede: "Screen Studio made this category, and Prequel is aimed squarely at the same finished video: automatic zooms, a perspective tilt on the push-in, focus falling away from the subject, and 4K at 120 fps against their 4K 60. $9 a month — the same as their yearly rate and well under their monthly one — or $29 once, which is the lifetime licence they stopped selling in 2025. Seven days free to judge the output before you pay.",
    title: "Screen Studio alternative for Mac",
    description:
      "A Screen Studio alternative for macOS at $9 a month, or $29 once for a lifetime licence: the same automatic zooms, a perspective tilt and framed camera on top, exporting at 4K 120 against their 4K 60. Compared on price, features and licence.",
    navLabel: "vs Screen Studio",
    faq: [
      {
        question: "What is the best Screen Studio alternative?",
        answer:
          "It depends on what pushed you to look. If it was the video, Prequel is the closest thing to it — the same automatic zooms, plus a perspective tilt, focus falling away from whatever the zoom is aimed at, and export at 4K 120 where Screen Studio stops at 4K 60. If it was the price, be careful which number you are comparing: their $29 is the monthly rate and their yearly one works out at $9 a month, which is what Prequel charges monthly — so the two are level if you commit to a year with them, and Prequel is a third of the price if you do not. There is also a $29 lifetime licence here, which is the thing they withdrew in 2025. If it was macOS-only, neither of us has a Windows build and you want something cross-platform.",
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
        question: "Is there a free Screen Studio alternative?",
        answer:
          "Not Prequel — it is $9 a month, or $29 once, after a seven-day trial with the whole app in it. There are free recorders in this category and open-source ones among them, so if free is the hard requirement the answer is one of those rather than either of us. What you give up is the cinematic pass: they capture faithfully and leave the zooms, the tilt, the focus, the framing and the cuts to you.",
      },
      {
        question: "Is Prequel a good Screen Studio alternative?",
        answer:
          "For a Mac recording that needs to look produced, yes — the automatic zooms, the framed camera, the backgrounds and the cursor work are the same job, and Prequel adds the parts that make a take read as directed rather than recorded: a perspective tilt on the push-in, focus falling away from the subject, and export at up to 4K 120 against their 4K 60. Screen Studio does two things we do not: it records iPhones and iPads over USB, and it is a mature product with years of releases behind it rather than a new one. It is also cheaper if you pay for a year up front.",
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
    logoAllowed: true,
    monogram: "L",
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
      layouts: "Screen and camera, screen only, camera only",
      cameraCutout: "Virtual background inside the bubble",
      tiltFocus: false,
      localCaptions: "After upload to Loom",
      timeline: "Trim and transcript-based edits",
      separateTracks: false,
      systemAudio: true,
      verticalReframe: false,
      loupe: false,
      looks: false,
      noiseReduction: "After recording, in the web player only",
      importVideo: "Yes, on paid plans",
      localOnly: "No — recordings upload to Loom",
      shareLinks: true,
      workspace: true,
      iosCapture: false,
      maxExport: "4K on paid plans",
      downloadSize: "228 MB",
      platforms: "macOS, Windows, web, Chrome",
      licence: "Per-seat subscription",
    },
    strength:
      "It replaced the meeting. Nothing is faster at turning a thought into a link somebody can watch, and the viewer analytics, the comments on the timeline and the integrations into every tool a company already runs are a distribution product in their own right.",
    verifiedOn: "2026-08-21",
    sources: [
      { label: "Loom pricing", url: "https://www.loom.com/pricing" },
      {
        label: "Loom's recent product investments",
        url: "https://support.atlassian.com/loom/docs/looms-recent-product-investments/",
      },
      {
        label: "Loom capture modes",
        url: "https://support.atlassian.com/loom/docs/use-looms-different-capture-modes/",
      },
      {
        label: "Loom virtual backgrounds",
        url: "https://support.atlassian.com/loom/docs/add-a-virtual-background-to-your-camera-bubble/",
      },
      {
        label: "Loom 0.374.2 installer",
        url: "https://packages.loom.com/desktop-packages/Loom-0.374.2-arm64.dmg",
      },
      {
        label: "Suppress background noise",
        url: "https://support.atlassian.com/loom/docs/suppress-background-noise/",
      },
      {
        label: "Upload or import videos",
        url: "https://support.atlassian.com/loom/docs/upload-or-import-videos/",
      },
      {
        label: "Edit your Loom video",
        url: "https://support.atlassian.com/loom/docs/edit-your-loom-video/",
      },
    ],
    heading: "Looking for a Loom alternative?",
    lede: "Loom uploads first and barely edits at all. Prequel directs first — zooms that follow the work, a perspective tilt, focus falling away from the subject, the camera framed over a background — then gives you a link if you want one, and a file you own either way. $9 a month against Loom's $18, or $29 once and never again.",
    title: "Loom alternative for Mac",
    description:
      "A Loom alternative for macOS that records locally and hands back a cinematic MP4 — automatic zooms, a perspective tilt, a framed camera — with no upload and no account needed to watch it. $9 a month, or $29 once.",
    navLabel: "vs Loom",
    faq: [
      {
        question: "What is the best Loom alternative?",
        answer:
          "Prequel, if the video itself matters. Loom is a recorder with sharing attached; the recording it makes is the one you performed, un-zoomed and uncut. Prequel does the edit — automatic zooms on every click, a perspective tilt, focus falling away from the subject, a framed camera over a background — and still gives you a shareable link, at $9 a month against Loom's $18 — or $29 once, with nothing to renew. What Loom keeps is the analytics and the integrations.",
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
          "Prequel records, edits and exports entirely on your Mac, on its own media engine. Nothing is uploaded to make the video and nothing is rendered on someone else's server, so a recording exists as files on your disk unless you choose to share one. Sending a link is a thing you ask for, not the price of pressing record.",
      },
      {
        question: "What do I lose by moving off Loom?",
        answer:
          "Viewer analytics, comments left on the timeline, the integrations into Slack, Jira and the rest, and the browser and Windows clients. Those are real and Prequel does not replace them. The link and the team workspace you keep — there is one plan and they are in it. What you gain is that the video is directed rather than raw, that it exists as a file you own, and that recording it never required an upload.",
      },
      {
        question: "Can I move my existing Loom videos into Prequel?",
        answer:
          "No. Loom videos live in Loom's library and Prequel has no importer for them. Download anything you want to keep before you cancel — that is worth doing regardless of where you go next.",
      },
    ],
  },
  {
    slug: "camtasia",
    name: "Camtasia",
    tagline: "TechSmith's screen recorder and video editor for training and tutorials.",
    accent: "#8a56d1",
    logoAllowed: true,
    monogram: "Ct",
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
      layouts: "Rev templates",
      cameraCutout: true,
      tiltFocus: false,
      localCaptions: "After upload to TechSmith",
      timeline: "A full multi-track editor",
      separateTracks: true,
      systemAudio: true,
      verticalReframe: "Change the canvas and re-position by hand",
      loupe: "Cursor magnify, around the pointer",
      looks: true,
      noiseReduction: true,
      importVideo: true,
      localOnly: true,
      shareLinks: "Via Screencast Pro",
      workspace: true,
      iosCapture: false,
      maxExport: "4K",
      downloadSize: "435 MB",
      platforms: "macOS 14+, Windows",
      licence: "Subscription only, annual",
    },
    strength:
      "Record and edit in one place, with a real multi-track timeline, quizzing and SCORM output. For a training department that needs interactive courseware, nothing on this page is a substitute.",
    verifiedOn: "2026-08-22",
    sources: [
      { label: "TechSmith Screencast", url: "https://www.techsmith.com/screencast/" },
      {
        label: "TechSmith — transition to subscription pricing",
        url: "https://support.techsmith.com/hc/en-us/articles/27009223314701-TechSmith-Transition-to-Annual-Subscription-Pricing-Model-in-2025",
      },
      {
        label: "Difference between Camtasia Pro, Create and Essentials",
        url: "https://support.techsmith.com/hc/en-us/articles/41688340554765-What-Is-the-Difference-Between-Camtasia-Pro-Create-and-Essentials",
      },
      { label: "Camtasia features", url: "https://www.techsmith.com/camtasia/features/" },
      {
        label: "Camtasia transcription",
        url: "https://www.techsmith.com/camtasia/features/transcribe-audio-to-text/",
      },
      {
        label: "Camtasia 2026.2.2 installer",
        url: "https://download.techsmith.com/camtasiamac/releases/2026.2.2/Camtasia.dmg",
      },
      {
        label: "Camtasia cursor effects",
        url: "https://www.techsmith.com/learn/tutorials/camtasia/cursor-effects/",
      },
      {
        label: "Camtasia video filters",
        url: "https://www.techsmith.com/camtasia/features/video-filters/",
      },
      {
        label: "Remove background noise",
        url: "https://www.techsmith.com/camtasia/features/remove-background-noise-from-video/",
      },
      {
        label: "Import and manage media",
        url: "https://www.techsmith.com/learn/tutorials/camtasia/import-manage-media/",
      },
    ],
    heading: "Looking for a lighter Camtasia alternative?",
    lede: "Camtasia is a full video editor you drive by hand, sold as an annual subscription whose cheapest tier watermarks your exports. Prequel makes the cinematic pass for you — zooms on the work, a perspective tilt, focus falling away from the subject, a framed camera — then gets out of the way. $9 a month, or $29 once, with nothing held back and no watermark on anything.",
    title: "Camtasia alternative for Mac",
    description:
      "A Camtasia alternative for macOS at $9 a month or $29 once: automatic zooms and a perspective tilt instead of manual keyframes, and 4K export that is never watermarked — where Camtasia's cheapest tier still stamps one on.",
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
          "Yes. The Starter tier watermarks exported video until you move up a tier. Prequel never watermarks anything, on the trial or on either plan — $9 a month or $29 once, and the export is always the full file.",
      },
      {
        question: "Does Camtasia have automatic zoom?",
        answer:
          "It has zoom-and-pan, but you place and time it yourself on the timeline. Prequel records where you click and type and clusters those moments into zooms before the editor opens — with the tilt, the easing and the focus falling away from the subject already applied. That is a different amount of work for a more finished result.",
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
    logoAllowed: true,
    monogram: "SF",
    priceSummary: "$199.99 once, single machine",
    plans: [{ name: "ScreenFlow 10", price: "$199.99", cadence: "one-off, single machine" }],
    freeTier: "A free trial that watermarks exports",
    features: {
      autoZoom: false,
      typingZoom: false,
      smoothCursor: false,
      camera: true,
      backgrounds: true,
      layouts: "Templates you build",
      cameraCutout: true,
      tiltFocus: false,
      localCaptions: "Typed in a caption editor",
      timeline: "A full multi-track editor",
      separateTracks: true,
      systemAudio: true,
      verticalReframe: "Change the canvas and re-position by hand",
      loupe: "Callouts and magnify actions",
      looks: true,
      noiseReduction: true,
      importVideo: true,
      localOnly: true,
      shareLinks: false,
      workspace: false,
      iosCapture: "Over USB",
      maxExport: "4K",
      downloadSize: "89 MB",
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
      { label: "ScreenFlow features", url: "https://www.telestream.net/screenflow/overview.htm" },
      {
        label: "ScreenFlow background removal",
        url: "https://support.telestream.net/s/article/Auto-Background-Removal",
      },
      {
        label: "ScreenFlow captions",
        url: "https://support.telestream.net/s/article/Creating-Captions/",
      },
      {
        label: "ScreenFlow 10.5.2 installer",
        url: "https://www.telestream.net/download-files/screenflow/10-5/ScreenFlow-10.5.2.dmg",
      },
      {
        label: "ScreenFlow audio help",
        url: "https://www.telestream.net/telestream-support/screen-flow/help/Editing.06.21.html",
      },
    ],
    heading: "Looking for a ScreenFlow alternative?",
    lede: "ScreenFlow is a deep manual editor that has not had a major version since June 2021. Prequel is built for the Macs that shipped since, and makes the cinematic pass itself — zooms from your clicks, a perspective tilt, focus falling away from the subject, 4K at 120 fps. $9 a month against their $199.99 once — or $29 once, which is the same kind of purchase for a seventh of the money.",
    title: "ScreenFlow alternative for Mac",
    description:
      "A ScreenFlow alternative for macOS with automatic zooms, a perspective tilt and hardware 4K 120 export, at $9 a month or $29 once. What ScreenFlow costs, what version it is on, and where it has stalled.",
    navLabel: "vs ScreenFlow",
    faq: [
      {
        question: "How much does ScreenFlow cost?",
        answer:
          "$199.99 for ScreenFlow 10, as a one-off licence tied to a single machine — moving between a laptop and a desktop means deactivating one to use the other. Historically, major upgrades were paid. Worth doing the arithmetic honestly, because it no longer runs their way: Prequel is $9 a month, so a ScreenFlow licence only becomes the cheaper of the two after about twenty-two months — and Prequel's own one-off licence is $29, a seventh of theirs and never overtaken. What you are weighing is a stalled editor you drive by hand against one that arrives directed. Checked on 21 August 2026.",
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
          "The cinematic pass, mainly: zooms from clicks and typing, a perspective tilt on the push-in, focus falling away from the subject, cursor smoothing and hiding, and a camera framed after the fact over a background. Prequel also exports at up to 120 frames per second. ScreenFlow has the deeper editor, records iOS devices over USB, and is bought once rather than monthly.",
      },
    ],
  },
  {
    slug: "descript",
    name: "Descript",
    tagline: "Edit video by editing the transcript.",
    accent: "#2b8fff",
    logoAllowed: true,
    monogram: "D",
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
      layouts: "Split-screen and scene layouts",
      cameraCutout: true,
      tiltFocus: false,
      localCaptions: "In the cloud",
      timeline: "Transcript-based, plus multi-track",
      separateTracks: true,
      systemAudio: true,
      verticalReframe: true,
      loupe: false,
      looks: true,
      noiseReduction: true,
      importVideo: true,
      localOnly: "No — projects and media are stored on their servers",
      shareLinks: true,
      workspace: true,
      iosCapture: false,
      maxExport: "4K on Creator and above",
      downloadSize: "255 MB",
      platforms: "macOS, Windows, web",
      licence: "Per-seat subscription",
    },
    strength:
      "Transcript-based editing, and nothing else here is close. Delete a word in the transcript and it is gone from the video — for anything narration-heavy that is a genuinely different way to work.",
    verifiedOn: "2026-08-21",
    sources: [
      { label: "Descript pricing", url: "https://www.descript.com/pricing" },
      { label: "Descript security", url: "https://www.descript.com/security" },
      { label: "Descript tools", url: "https://www.descript.com/tools" },
      {
        label: "Descript 114.0.4 installer",
        url: "https://electron.descript.com/Descript-114.0.4-release.20250509.32955-arm64.dmg",
      },
      {
        label: "Descript effects overview",
        url: "https://help.descript.com/hc/en-us/articles/13593402120333-Effects-overview",
      },
      {
        label: "Descript colour adjustments",
        url: "https://help.descript.com/hc/en-us/articles/10327606944653-Color-adjustments",
      },
      { label: "Descript Studio Sound", url: "https://www.descript.com/studio-sound" },
      {
        label: "Import files into Descript",
        url: "https://help.descript.com/hc/en-us/articles/10119645307789-Import-and-upload-files-into-Descript",
      },
    ],
    heading: "Looking for a Descript alternative for screen recording?",
    lede: "Descript is built around the transcript and keeps your media on its servers as a condition of working at all. Prequel is built around the screen: automatic zooms, a perspective tilt, focus falling away from the subject, recorded and rendered on your own Mac and uploaded only when you ask. $9 a month, or $29 once — under every paid Descript tier either way.",
    title: "Descript alternative for Mac screen recording",
    description:
      "A Descript alternative for macOS screen recording at $9 a month or $29 once: automatic zooms, a perspective tilt, local-only processing and exports that are never watermarked or capped. Compared on price and features.",
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
          "Yes, and it caps them at 720p. Prequel has no free tier to compare against — it is $9 a month, or $29 once, after a seven-day trial, and either is under Descript's cheapest paid plan — but nothing it exports is ever watermarked or capped, on the trial or after it.",
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
          "Not as an automatic pass driven by where you clicked. Prequel records clicks and keystrokes during capture and turns them into zooms before the editor opens — with a perspective tilt and focus falling away from whatever the push-in is aimed at, which is the part that makes a screen recording look shot rather than captured.",
      },
    ],
  },
  {
    slug: "tella",
    name: "Tella",
    tagline: "Record and share video that looks professionally edited.",
    accent: "#5e51f8",
    logoAllowed: true,
    monogram: "T",
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
      layouts: true,
      cameraCutout: "Blur, a colour or an image",
      tiltFocus: false,
      localCaptions: "After upload to Tella",
      timeline: true,
      separateTracks: true,
      systemAudio: true,
      verticalReframe: true,
      loupe: false,
      looks: true,
      noiseReduction: true,
      importVideo: "Yes, on paid plans",
      localOnly: "No — recordings are hosted by Tella",
      shareLinks: true,
      workspace: true,
      iosCapture: false,
      maxExport: "4K; 60 fps on Premium only",
      downloadSize: "25 MB, editor in the browser",
      platforms: "macOS, Windows, web, Chrome",
      licence: "Per-seat subscription, no free plan",
    },
    strength:
      "It closes the whole loop — record, auto-edit, host on a branded page with a custom domain, password protection and per-viewer analytics. Polish and distribution in one product.",
    verifiedOn: "2026-08-21",
    sources: [
      { label: "Tella pricing", url: "https://www.tella.com/pricing" },
      { label: "Tella plans", url: "https://www.tella.com/help/introduction/plans" },
      { label: "Tella features", url: "https://www.tella.com/features" },
      {
        label: "Tella camera background",
        url: "https://www.tella.com/help/recording/blur-your-camera-background",
      },
      { label: "Tella 2.33 installer", url: "https://mac.tella.tv/Tella-2.33-254.dmg" },
      { label: "Tella: add a zoom", url: "https://www.tella.com/help/editing/add-a-zoom" },
      {
        label: "Tella: Studio Voice",
        url: "https://tella.com/help/eliminate-background-noise-mac",
      },
      {
        label: "Tella: upload existing videos",
        url: "https://tella.com/docs/help/recording/upload-existing-videos",
      },
    ],
    heading: "Looking for a Tella alternative?",
    lede: "Tella hosts your video and keeps 60 fps for its Premium tier. Prequel renders on your own Mac at up to 4K 120 — zooms that follow the work, a perspective tilt, focus falling away from the subject — and the export is a file you own rather than a page you rent. $9 a month, under both Tella's $13 Pro and its $19 Premium, or $29 once.",
    title: "Tella alternative for Mac",
    description:
      "A Tella alternative for macOS with automatic zooms, a perspective tilt and 4K 120 export, recorded and rendered locally — $9 a month, or $29 once, against Tella's $13 Pro and $19 Premium.",
    navLabel: "vs Tella",
    faq: [
      {
        question: "Does Tella have a free plan?",
        answer:
          "No. Tella's own help pages state it is a paid product with no forever-free plan — there is a seven-day trial, and exporting requires a subscription. Prequel works the same way, on the same seven days, and two ways to pay at the end of it — $9 a month or $29 once — neither of which decides what your export is allowed to be.",
      },
      {
        question: "How much does Tella cost?",
        answer:
          "Pro is $13 per user per month and Premium is $19, with Enterprise priced on request. 60 fps export is Premium only. Checked on 21 August 2026.",
      },
      {
        question: "Is Tella better for anything?",
        answer:
          "Distribution, specifically. Custom domains, password protection, calls to action and per-viewer analytics go further than a link and a workspace do, and it runs on Windows and in a browser where Prequel does not. Pro is also a dollar a month cheaper. If the hosted page is the product you are buying, that is Tella's ground; if the video is, Prequel exports at 4K 120 where Tella keeps 60 fps for Premium.",
      },
      {
        question: "Where does Tella process my recordings?",
        answer:
          "In the cloud — every video gets a hosted Tella page. Prequel records and renders on your Mac's own media engine, so nothing is uploaded to produce the file.",
      },
    ],
  },
  {
    slug: "screen-charm",
    name: "Screen Charm",
    tagline: "Screen recorder for Mac. Cinematic by default.",
    accent: "#604ef3",
    logoAllowed: true,
    monogram: "SC",
    priceSummary: "$99 once, up to three Macs",
    plans: [{ name: "Lifetime", price: "$99", cadence: "one-off, up to three Macs" }],
    // Their own shape, and the one the alternatives post is built on: the
    // recorder and the editor cost nothing, the export is what the licence
    // unlocks. Not a trial — there is no clock on it and no file at the end.
    freeTier: "Free to download and record with; export needs the licence",
    features: {
      autoZoom: true,
      // "Every click gets its moment" is the claim, and the Show HN describes
      // clicks converted to zoom segments. Nothing on typing anywhere.
      typingZoom: false,
      smoothCursor: true,
      camera: true,
      backgrounds: true,
      layouts: "A floating bubble, or pinned to an edge",
      // Their July 2026 roundup describes "background replacement" on the
      // webcam overlay — a swap inside the bubble, like Loom's, not a cutout.
      cameraCutout: "Background replacement inside the overlay",
      tiltFocus: false,
      // Captions landed in 1.11.4 on 8 September 2026. Neither the feature
      // page nor the changelog says whether the audio leaves the Mac, so the
      // cell says that rather than guessing either way.
      localCaptions: "Generated in the app; where is not stated",
      timeline: "Trim, split, mute and speed, per clip",
      separateTracks: "Not stated",
      // Their own Screen Studio comparison: "Yes (no driver needed)".
      systemAudio: true,
      // The split vertical layout crops the screen to follow the cursor, which
      // is the opposite of reframing without a crop.
      verticalReframe: "A split layout; the screen crops to follow the cursor",
      loupe: false,
      looks: false,
      noiseReduction: true,
      importVideo: false,
      localOnly: "Records locally; shareable links upload",
      // 1.9.5 raised the upload cap to 2 GB.
      shareLinks: "Yes, 2 GB per upload",
      workspace: false,
      iosCapture: false,
      // "30 / 60 FPS export" on their comparison page; 4K on the pricing card.
      maxExport: "4K, 60 fps",
      // `Content-Length` of the 1.11.4 Apple Silicon `.dmg`: 236,673,429 bytes.
      downloadSize: "237 MB",
      platforms: "macOS 14+, Apple Silicon",
      licence: "$99 once, up to three Macs",
    },
    strength:
      "One payment for three Macs, a MacBook frame round the recording, a built-in music library, and a maker who has shipped a release most fortnights since July 2025.",
    verifiedOn: "2026-10-08",
    sources: [
      { label: "Screen Charm", url: "https://screencharm.com/" },
      { label: "Screen Charm changelog", url: "https://screencharm.com/changelog" },
      {
        label: "Screen Charm vs Screen Studio, by Screen Charm",
        url: "https://screencharm.com/vs/screen-studio",
      },
      {
        label: "Screen Charm's Screen Studio alternatives post",
        url: "https://screencharm.com/blog/screen-studio-alternative",
      },
      {
        label: "Screen Charm 1.11.4 installer",
        url: "https://download.screencharm.com/Screen%20Charm-1.11.4-arm64.dmg",
      },
      {
        label: "Screen Charm on Product Hunt",
        url: "https://www.producthunt.com/products/screen-charm",
      },
      {
        label: "Show HN: Mac screen recorder that adds zoom animations from click data",
        url: "https://news.ycombinator.com/item?id=48461381",
      },
    ],
    heading: "Looking for a Screen Charm alternative?",
    lede: "Screen Charm is free to record with and $99 to export from, paid once. Prequel is $29 once for the same kind of licence, or $9 a month, and the seven-day trial has the export in it. The difference is on screen: zooms on what you type as well as where you click, a perspective tilt, focus falling away from the subject, and 4K at 120 fps against their 4K 60.",
    title: "Screen Charm alternative for Mac",
    description:
      "A Screen Charm alternative for macOS at $29 once or $9 a month, with the export in the trial: automatic zooms on clicks and typing, a perspective tilt and a framed camera, exporting at 4K 120 against their 4K 60. Compared on price, features and licence.",
    navLabel: "vs Screen Charm",
    faq: [
      {
        question: "What is the best Screen Charm alternative?",
        answer:
          "Prequel, if what sent you looking was finishing a video and finding the export behind the $99. It makes the same automatic pass on a recording, adds a perspective tilt and focus falling away from the subject, zooms on what you type as well as where you click, and exports at up to 4K and 120 fps where Screen Charm stops at 60. It is $29 once or $9 a month, and the seven-day trial is the whole app with the export in it, so the files you make in that week are yours either way.",
      },
      {
        question: "How much does Screen Charm cost?",
        answer:
          "$99, once, with no subscription. The licence covers up to three Macs, includes future updates, and comes with a 14-day money-back guarantee. There is one tier and no free plan: the app is free to download and record with, and exporting the finished video needs the purchase. It was $79 until the autumn of 2026. Checked on 8 October 2026.",
      },
      {
        question: "Can you export from Screen Charm without paying?",
        answer:
          "No. Recording and editing are free and there is no time limit on them, but the finished video stays inside the app until the $99 licence is bought. Prequel's seven-day trial includes export, with no watermark, on every size and frame rate the paid app has.",
      },
      {
        question: "Is Screen Charm better for anything?",
        answer:
          "A MacBook device frame round the recording, a built-in library of background music, and a licence that covers three Macs. If the laptop-frame look is the point, that is Screen Charm's. Prequel frames the recording with padding, a radius, a border and a shadow over a background instead, and leaves the music to you.",
      },
      {
        question: "Does Screen Charm work on an Intel Mac?",
        answer:
          "No. Screen Charm needs an Apple Silicon Mac on macOS Sonoma 14.0 or later, and so does Prequel. On an Intel Mac, OBS Studio runs on macOS 12 and later on both chips, and QuickTime Player is already installed.",
      },
      {
        question: "Can I open my Screen Charm recordings in Prequel?",
        answer:
          "Not the project files, which are Screen Charm's own format. A video you have already exported is an ordinary MP4 and can be brought into a Prequel project with Add Clip, then cut and framed alongside anything else; its zooms are burned in, so those cannot be re-timed. For a two-minute demo, re-recording the take is usually quicker than working round a finished file.",
      },
    ],
  },
  {
    slug: "quicktime",
    name: "QuickTime Player",
    tagline: "Plays, records and trims video, on every Mac.",
    accent: "#1d1d1f",
    // Apple's guidelines rule out reproducing their graphic marks, so this one
    // is the monogram by decision rather than by a missing file. See the note
    // on `logoAllowed` above.
    logoAllowed: false,
    monogram: "QT",
    priceSummary: "Free, with macOS",
    plans: [{ name: "Included", price: "Free", cadence: "with every Mac" }],
    freeTier: "Everything it does, with no account and no limit",
    features: {
      autoZoom: false,
      typingZoom: false,
      smoothCursor: false,
      camera: false,
      backgrounds: false,
      layouts: false,
      cameraCutout: false,
      tiltFocus: false,
      localCaptions: false,
      timeline: "Trim at either end",
      separateTracks: false,
      // Apple's own page puts Include System Audio in macOS 27. Below that the
      // Mac's own sound needs a virtual audio driver, which is the reason most
      // people meet the limit.
      systemAudio: "From macOS 27; a virtual driver below it",
      verticalReframe: false,
      loupe: false,
      looks: false,
      noiseReduction: false,
      importVideo: "Opens any file it can play",
      localOnly: true,
      shareLinks: false,
      workspace: false,
      // New Movie Recording with an iPhone or iPad attached over USB.
      iosCapture: true,
      // There is no export dialogue at all: the screen is recorded at its own
      // size and saved as a .mov, so a resolution row would be inventing one.
      maxExport: "Screen size, no settings",
      downloadSize: "Built into macOS",
      platforms: "macOS, every Mac",
      licence: "Free with macOS",
    },
    strength:
      "It is already installed, it costs nothing, and for a clip somebody else is going to edit it is the shortest path from idea to file.",
    verifiedOn: "2026-10-22",
    sources: [
      { label: "How to record the screen on Mac", url: "https://support.apple.com/en-us/102618" },
      {
        label: "QuickTime Player User Guide",
        url: "https://support.apple.com/guide/quicktime-player/welcome/mac",
      },
    ],
    heading: "Looking for a QuickTime alternative?",
    lede: "QuickTime records the take and stops there: one distance, no camera, no system audio below macOS 27, and a trim at either end. Prequel opens the editor with the zooms placed, the camera framed and a background behind the window, then exports at 4K and 120 fps. $9 a month, or $29 once.",
    title: "QuickTime alternative for Mac",
    description:
      "A QuickTime Player alternative for macOS that records screen, camera, microphone and system audio as separate tracks, then places the zooms, frames the camera and exports at 4K 120. $9 a month, or $29 once.",
    navLabel: "vs QuickTime",
    faq: [
      {
        question: "What is the best QuickTime alternative for Mac?",
        answer:
          "For a recording that has to look produced, Prequel: it captures screen, camera, microphone and system audio as separate tracks, then opens the editor with zooms already placed on every click and every burst of typing, the camera framed over a background and the cursor smoothed. For a free recording with more control than QuickTime gives, OBS Studio. For screenshots and a quick clip, CleanShot X.",
      },
      {
        question: "Can QuickTime record system audio on a Mac?",
        answer:
          "Only from macOS 27, where the Screenshot toolbar gained an Include System Audio option. On earlier versions the Mac's own sound is not available to the recorder, so capturing a call or an app's audio means installing a virtual audio driver and routing output through it. Prequel records system audio as its own track with no driver to install.",
      },
      {
        question: "Does QuickTime record your webcam and screen at the same time?",
        answer:
          "No. QuickTime records a screen recording or a movie recording, one or the other. Putting your face in the corner of a screen recording means a second app. Prequel records both at once and lets you move, resize, reshape and cut out the camera afterwards.",
      },
      {
        question: "Is Prequel a good QuickTime alternative?",
        answer:
          "Yes, for anything anyone else is going to watch. QuickTime hands back the take; Prequel hands back a finished video, with zooms on the clicks and the typing, a perspective tilt, focus falling away from the subject, a framed camera, a background, a cleaned-up cursor and captions transcribed on your Mac. It is $9 a month or $29 once, after a seven-day trial. QuickTime is free and on every Mac, which is the argument on the other side.",
      },
    ],
  },
  {
    slug: "obs",
    name: "OBS Studio",
    tagline: "Free and open source software for video recording and live streaming.",
    accent: "#302e31",
    logoAllowed: true,
    monogram: "OB",
    priceSummary: "Free, open source",
    plans: [{ name: "OBS Studio", price: "$0", cadence: "free software, GPLv2" }],
    freeTier: "All of it, with no account",
    features: {
      autoZoom: false,
      typingZoom: false,
      smoothCursor: false,
      camera: true,
      backgrounds: "Anything you compose into the scene",
      layouts: "Scenes you build yourself",
      cameraCutout: "Chroma key, or a plugin",
      tiltFocus: false,
      localCaptions: false,
      timeline: false,
      // Up to six audio tracks on a recording, assigned per source.
      separateTracks: true,
      systemAudio: "Yes, on macOS 13 or later",
      verticalReframe: "Set the canvas to a vertical size yourself",
      loupe: false,
      looks: "A LUT filter on a source",
      noiseReduction: true,
      importVideo: "As a media source in a scene",
      localOnly: true,
      shareLinks: false,
      workspace: false,
      iosCapture: false,
      // There is no ceiling to quote: the canvas, the encoder and the frame
      // rate are all fields you fill in. That is the product.
      maxExport: "Whatever you configure",
      // `Content-Length` of the 32.2.2 Apple Silicon `.dmg`: 187,703,709 bytes.
      downloadSize: "188 MB",
      platforms: "macOS 13+, Windows, Linux",
      licence: "Free, GPLv2",
    },
    strength:
      "It is the broadcast desk the streaming world runs on: scenes, sources, transitions, hotkeys, a real audio mixer and a plugin API, free, open source and on every platform.",
    verifiedOn: "2026-10-22",
    sources: [
      { label: "OBS Studio", url: "https://obsproject.com/" },
      { label: "OBS Studio download", url: "https://obsproject.com/download" },
      {
        label: "OBS Studio 32.2.2 installer",
        url: "https://cdn-fastly.obsproject.com/downloads/obs-studio-32.2.2-macos-apple.dmg",
      },
      { label: "OBS Studio on GitHub", url: "https://github.com/obsproject/obs-studio" },
    ],
    heading: "Looking for an OBS alternative?",
    lede: "OBS is a broadcast desk, and a demo is not a broadcast. Prequel records a display, a window or a region with no setup, then opens the editor with the zooms placed, the camera framed and a background behind the window. 4K at 120 fps, $9 a month or $29 once.",
    title: "OBS Studio alternative for Mac",
    description:
      "An OBS Studio alternative for macOS with nothing to configure: screen, camera, microphone and system audio on separate tracks, zooms placed automatically, and 4K 120 export. $9 a month, or $29 once.",
    navLabel: "vs OBS",
    faq: [
      {
        question: "What is the best OBS alternative for recording a Mac screen?",
        answer:
          "Prequel, if the recording is a demo or a tutorial rather than a stream. OBS asks you to choose a canvas, an encoder, a bitrate and an audio layout before the first take and hands back exactly what was on screen; Prequel records with no setup and opens the editor with zooms placed on every click and every burst of typing, the camera framed over a background and the cursor smoothed. If you are going live, keep OBS: nothing here replaces it.",
      },
      {
        question: "Is OBS free?",
        answer:
          "Yes. OBS Studio is free and open source under the GPL, with no account, no tier and no watermark, on macOS 13 or later, Windows and Linux. Prequel is $9 a month or $29 once after a seven-day trial, and what it sells is the finished video rather than the capture.",
      },
      {
        question: "Can OBS zoom in on clicks automatically?",
        answer:
          "Not on its own. Zoom in OBS is a scene transform you animate yourself, or a community plugin, and neither reads where you clicked. Prequel places a zoom on every click and every burst of typing while it writes the recording, tilts the push-in, and lets focus fall away from whatever it is aimed at.",
      },
      {
        question: "Is OBS better for anything?",
        answer:
          "Live streaming, multiple cameras, capture cards, a virtual camera for calls, and total control over the encoder. It is also free, open source and cross-platform, and it runs on Intel Macs and macOS 13. Prequel needs an Apple Silicon Mac on macOS 14 or later and does not stream at all.",
      },
    ],
  },
  {
    slug: "cleanshot",
    name: "CleanShot X",
    tagline: "The Mac-native toolkit for screenshots, recordings and collaboration.",
    accent: "#f2864c",
    logoAllowed: true,
    monogram: "CX",
    priceSummary: "$35 once, or $10/user/mo",
    plans: [
      { name: "Basic", price: "$35", cadence: "once, with a year of updates" },
      { name: "Pro", price: "$10", cadence: "per user, per month, billed yearly" },
    ],
    // The one-off licence keeps working after the year; what stops is the
    // updates, and $19 a year resumes them. Worth stating plainly, because
    // "pay once" and "a year of updates" are both true and read differently.
    freeTier: false,
    features: {
      // "Smart zooms" on their recording page: automatically generated zooms
      // that highlight detail.
      autoZoom: true,
      typingZoom: false,
      smoothCursor: false,
      camera: true,
      // The background tool with padding and shadows is the screenshot half of
      // the app. A recording does not get one.
      backgrounds: "On screenshots",
      layouts: "A camera bubble over the screen",
      cameraCutout: false,
      tiltFocus: false,
      // Automatic transcripts are a CleanShot Cloud feature, so the audio goes
      // up before the text comes back.
      localCaptions: "Transcripts in the cloud",
      timeline: "Studio Mode: trim, and zooms",
      separateTracks: false,
      systemAudio: true,
      verticalReframe: false,
      loupe: false,
      looks: false,
      noiseReduction: false,
      importVideo: false,
      localOnly: "Records locally; the cloud uploads",
      shareLinks: true,
      workspace: "On the Pro plan",
      iosCapture: false,
      // Nothing on their site states a ceiling, and inventing one here would
      // be the kind of number this file exists to keep out.
      maxExport: "Not published",
      // `Content-Length` of the 5.0.1 `.dmg`: 50,557,562 bytes.
      downloadSize: "51 MB",
      platforms: "macOS",
      licence: "$35 once, a year of updates, $19/yr after",
    },
    strength:
      "The best screenshot tool on the Mac by a distance: scrolling capture, annotation, redaction, text recognition, pinned shots and a capture history, with recording alongside it.",
    verifiedOn: "2026-10-22",
    sources: [
      { label: "CleanShot X", url: "https://cleanshot.com/" },
      { label: "CleanShot X pricing", url: "https://cleanshot.com/pricing" },
      { label: "CleanShot X screen recording", url: "https://cleanshot.com/screen-recording" },
      { label: "CleanShot Cloud", url: "https://cleanshot.com/product/cloud" },
      {
        label: "CleanShot X 5.0.1 installer",
        url: "https://updates.getcleanshot.com/v3/CleanShot-X-5.0.1.dmg",
      },
    ],
    heading: "Looking for a CleanShot X alternative?",
    lede: "CleanShot X is a screenshot tool that also records, and the recording half stops at a bubble and a trim. Prequel frames the camera, cuts it out of the room, puts a background behind the window and places the zooms, then exports at 4K and 120 fps. $9 a month, or $29 once with every update in it.",
    title: "CleanShot X alternative for Mac",
    description:
      "A CleanShot X alternative for macOS aimed at the video: automatic zooms on clicks and typing, a framed camera cut out of its background, captions transcribed on your Mac and 4K 120 export. $9 a month, or $29 once.",
    navLabel: "vs CleanShot X",
    faq: [
      {
        question: "What is the best CleanShot X alternative?",
        answer:
          "It depends which half you use. For screenshots, annotation, scrolling capture and OCR, nothing on the Mac replaces CleanShot X and this page is not pretending otherwise. For recording, Prequel: zooms placed on every click and every burst of typing, a perspective tilt, focus falling away from the subject, a camera framed and cut out of the room, a background behind the window, and export at 4K and 120 fps.",
      },
      {
        question: "How much does CleanShot X cost?",
        answer:
          "$35 once for the Mac app with 1 GB of cloud storage and a year of updates, with an optional $19 a year to keep updating after that. CleanShot Pro is $10 per user per month billed annually and adds the cloud. There is no free tier. Checked on 22 October 2026.",
      },
      {
        question: "Does CleanShot X zoom in automatically?",
        answer:
          "Yes. Smart zooms are generated for you and Studio Mode lets you adjust them. What it does not do is read what you type, tilt the push-in, or pull focus away from the subject of the zoom, which is where Prequel's pass differs.",
      },
      {
        question: "Is Prequel a good CleanShot X alternative?",
        answer:
          "For video, yes, and most people keep both: CleanShot for screenshots, Prequel for anything that has to be watched. Prequel records screen, camera, microphone and system audio as separate tracks, opens the editor with the first pass made, transcribes captions on your Mac and exports at up to 4K and 120 frames a second. It is $9 a month or $29 once, with updates for as long as you hold the licence.",
      },
    ],
  },
  {
    slug: "cap",
    name: "Cap",
    tagline: "Open source screen recording, local or shared.",
    accent: "#4785ff",
    logoAllowed: true,
    monogram: "Cp",
    priceSummary: "Free for personal use; $58 once, or $12/user/mo",
    plans: [
      { name: "Free", price: "$0", cadence: "personal use, links capped at 5 minutes" },
      { name: "Desktop Licence", price: "$29", cadence: "per year, or $58 once" },
      { name: "Cap Pro", price: "$12", cadence: "per user, per month, or $8.16 billed annually" },
    ],
    freeTier: "Unlimited local recording for personal use; commercial work needs a licence",
    features: {
      autoZoom: true,
      typingZoom: false,
      smoothCursor: true,
      camera: true,
      backgrounds: true,
      layouts: "Camera over the screen, resized and moved",
      cameraCutout: false,
      tiltFocus: false,
      // Transcriptions are listed under Cap Pro's AI features, which run on
      // the recording after it is uploaded.
      localCaptions: "Transcripts on Cap Pro, after upload",
      timeline: true,
      separateTracks: false,
      systemAudio: true,
      verticalReframe: false,
      loupe: false,
      looks: false,
      noiseReduction: false,
      importVideo: false,
      localOnly: "Records locally; sharing uploads, or self-host it",
      shareLinks: "Yes, 5 minutes on free and Desktop, unlimited on Pro",
      workspace: true,
      iosCapture: false,
      maxExport: "4K, 60 fps",
      downloadSize: "Not published",
      platforms: "macOS, Windows",
      licence: "Open source; $58 once or $12/user/mo",
    },
    strength:
      "Open source, self-hostable, and the only recorder here a team can run end to end on its own infrastructure with its own S3 bucket behind it.",
    verifiedOn: "2026-10-22",
    sources: [
      { label: "Cap", url: "https://cap.so/" },
      { label: "Cap pricing", url: "https://cap.so/pricing" },
      { label: "Cap commercial licence", url: "https://cap.so/docs/commercial-license" },
      { label: "Cap on GitHub", url: "https://github.com/CapSoftware/Cap" },
    ],
    heading: "Looking for a Cap alternative?",
    lede: "Cap records cleanly and shares fast, and free stops at personal use. Prequel directs the take: zooms on what you click and what you type, a perspective tilt, focus falling away from the subject, a camera cut out of the room. 4K at 120 fps against their 4K 60, $9 a month or $29 once.",
    title: "Cap alternative for Mac",
    description:
      "A Cap alternative for macOS at $29 once, commercial use included: automatic zooms on clicks and typing, a perspective tilt, a camera cut out of its background, and 4K 120 export against Cap's 4K 60.",
    navLabel: "vs Cap",
    faq: [
      {
        question: "What is the best Cap alternative?",
        answer:
          "Prequel, if the finished video is the point. It makes the same kind of automatic pass and takes it further: zooms on what you type as well as where you click, a perspective tilt on the push-in, focus falling away from the subject, a camera cut out of the room behind you, seventeen colour looks and captions transcribed on your Mac. It exports at up to 4K and 120 frames a second where Cap stops at 4K 60, and it is $29 once with commercial use included.",
      },
      {
        question: "Is Cap free?",
        answer:
          "For personal use, yes, with no time limit on local recordings and shareable links capped at five minutes. Commercial use needs a Desktop Licence at $29 a year or $58 once, and Cap Pro is $12 per user per month, or $8.16 a month billed annually, for unlimited cloud sharing, analytics and AI transcripts. Checked on 22 October 2026.",
      },
      {
        question: "Can I self-host Cap?",
        answer:
          "Yes, and it is the strongest reason to choose it. Cap is open source and can run on your own infrastructure with a custom S3 bucket or Google Drive behind it. Prequel has no self-hosted mode: recording and export never touch the network, and sharing a link is a thing you ask for.",
      },
      {
        question: "Is Prequel cheaper than Cap?",
        answer:
          "On the one-off licence, yes: $29 against $58, both covering commercial work. On a subscription, $9 a month against $12, or $8.16 if you pay Cap for a year up front. Cap is free for personal use and Prequel is not, so for recordings nobody is paid for, Cap is cheaper.",
      },
    ],
  },
  {
    slug: "snagit",
    name: "Snagit",
    tagline: "Screen capture and screen recording for Windows and Mac.",
    accent: "#e8762d",
    logoAllowed: true,
    monogram: "Sn",
    priceSummary: "$39 per user, per year",
    plans: [{ name: "Snagit", price: "$39", cadence: "per user, per year" }],
    freeTier: "A free trial, then a licence",
    features: {
      autoZoom: false,
      typingZoom: false,
      smoothCursor: false,
      camera: true,
      backgrounds: false,
      layouts: "Camera and screen, or either alone",
      cameraCutout: false,
      tiltFocus: false,
      localCaptions: false,
      timeline: "Trim, cut and combine clips",
      separateTracks: false,
      systemAudio: true,
      verticalReframe: false,
      loupe: false,
      looks: false,
      noiseReduction: false,
      importVideo: true,
      localOnly: "Records locally; Screencast sharing uploads",
      shareLinks: true,
      workspace: "Through TechSmith Screencast",
      iosCapture: false,
      maxExport: "Not published",
      downloadSize: "Not published",
      platforms: "macOS, Windows",
      licence: "Subscription, per user",
    },
    strength:
      "Twenty years of being the screenshot tool at work: scrolling capture, annotation, numbered steps, templates, and a step-by-step guide built out of a sequence of captures.",
    verifiedOn: "2026-10-22",
    sources: [
      { label: "Snagit", url: "https://www.techsmith.com/snagit/" },
      { label: "Buy Snagit", url: "https://www.techsmith.com/store/snagit" },
    ],
    heading: "Looking for a Snagit alternative?",
    lede: "Snagit documents a screen beautifully and records one plainly: no zooms, no framing, no background, no cursor work. Prequel opens the editor with all four already done and exports at 4K and 120 fps. $9 a month, or $29 once with nothing to renew.",
    title: "Snagit alternative for Mac",
    description:
      "A Snagit alternative for macOS aimed at video: automatic zooms on clicks and typing, a framed camera over a background, captions transcribed on your Mac, 4K 120 export. $9 a month, or $29 once.",
    navLabel: "vs Snagit",
    faq: [
      {
        question: "What is the best Snagit alternative on a Mac?",
        answer:
          "For video, Prequel: it records screen, camera, microphone and system audio as separate tracks and opens the editor with zooms placed on every click and every burst of typing, the camera framed over a background and the cursor smoothed. For screenshots, annotation and step-by-step guides, CleanShot X is the closest Mac equivalent, and Snagit itself is still the one that runs on both platforms.",
      },
      {
        question: "How much does Snagit cost?",
        answer:
          "$39 per user per year on TechSmith's store, which is a subscription rather than the perpetual licence Snagit used to sell. Checked on 22 October 2026.",
      },
      {
        question: "Does Snagit record video with zoom effects?",
        answer:
          "No. Snagit records the screen with a webcam and a microphone and lets you trim, cut and combine clips afterwards. Zooms, cursor smoothing, backgrounds and camera framing are not part of it, and TechSmith's answer to that is Camtasia, a separate and dearer product.",
      },
      {
        question: "Is Prequel a good Snagit alternative?",
        answer:
          "For anything that will be watched rather than read, yes. Prequel makes the cinematic pass automatically, cuts and retimes on a timeline, blurs anything private and exports at up to 4K and 120 frames a second for $9 a month or $29 once. It does not take screenshots, so a team writing documentation keeps Snagit for that half.",
      },
    ],
  },
  {
    slug: "screenpal",
    name: "ScreenPal",
    tagline: "One app to capture, create, share and engage. Formerly Screencast-O-Matic.",
    accent: "#101429",
    logoAllowed: true,
    monogram: "SP",
    priceSummary: "Free, then $4–$10/mo billed annually",
    plans: [
      { name: "Free", price: "$0", cadence: "15-minute recordings, no watermark" },
      { name: "Deluxe", price: "$4", cadence: "per month, paid annually" },
      { name: "Max", price: "$10", cadence: "per month, paid annually" },
      { name: "Team Business", price: "$8", cadence: "per user, per month, paid annually" },
    ],
    freeTier: "Free forever, with a 15-minute limit on a recording and no watermark",
    features: {
      autoZoom: false,
      typingZoom: false,
      smoothCursor: false,
      camera: true,
      backgrounds: "Virtual backgrounds behind the camera",
      layouts: "Camera and screen, resized and placed",
      cameraCutout: "Blur or replace the camera's background",
      tiltFocus: false,
      localCaptions: "Speech-to-text in their editor",
      timeline: true,
      separateTracks: "Multiple audio tracks in the editor",
      systemAudio: true,
      verticalReframe: false,
      loupe: false,
      looks: false,
      noiseReduction: "Automatic levels, and silence detection",
      importVideo: true,
      localOnly: "Hosted; the editor and the library are theirs",
      shareLinks: true,
      workspace: true,
      iosCapture: "Records on an iPhone or iPad, as its own app",
      maxExport: "Not published",
      downloadSize: "Not published",
      platforms: "macOS, Windows, Chromebook, Android, iOS",
      licence: "Subscription, or a capped free plan",
    },
    strength:
      "Fifteen minutes free with no watermark, a full editor, hosting, quizzing and analytics, on five platforms, at a price a school or a department can sign off without a meeting.",
    verifiedOn: "2026-10-22",
    sources: [
      { label: "ScreenPal", url: "https://screenpal.com/" },
      { label: "ScreenPal plans", url: "https://screenpal.com/plans" },
      { label: "ScreenPal screen recorder", url: "https://screenpal.com/screen-recorder" },
    ],
    heading: "Looking for a ScreenPal alternative?",
    lede: "ScreenPal edits, hosts and quizzes, and every zoom in it is one you placed. Prequel places them from where you click and what you type, frames the camera, applies a background and exports at 4K and 120 fps on your own Mac. $9 a month, or $29 once.",
    title: "ScreenPal alternative for Mac",
    description:
      "A ScreenPal alternative for macOS that finishes the video for you: automatic zooms, a framed camera cut out of the room, captions transcribed on your Mac and 4K 120 export, with nothing uploaded. $9 a month, or $29 once.",
    navLabel: "vs ScreenPal",
    faq: [
      {
        question: "What is the best ScreenPal alternative?",
        answer:
          "On a Mac, Prequel, if the video has to look produced: zooms placed on every click and every burst of typing, a perspective tilt, focus falling away from the subject, a camera framed and cut out of the room, and export at up to 4K and 120 frames a second. If what you need is hosting, quizzing and class analytics, ScreenPal is doing a job Prequel does not attempt.",
      },
      {
        question: "How much does ScreenPal cost?",
        answer:
          "There is a free plan with a fifteen-minute limit on each recording and no watermark. Deluxe is $4 a month paid annually, Max is $10, and Team Business is $8 per user per month. Checked on 22 October 2026.",
      },
      {
        question: "Is ScreenPal the same as Screencast-O-Matic?",
        answer:
          "Yes, renamed. Same product line, same company, same hosting and quizzing, under a name that no longer says what the tool does.",
      },
      {
        question: "Is Prequel a good ScreenPal alternative?",
        answer:
          "For making the video on a Mac, yes, and the work happens on your own machine: recording, editing and export never need the network, and captions are transcribed on device. It is $9 a month or $29 once. What it does not do is host your videos, put a quiz inside one, or run on a Chromebook.",
      },
    ],
  },
  {
    slug: "screencastify",
    name: "Screencastify",
    tagline: "Screen recording that runs in your browser.",
    accent: "#f5c518",
    logoAllowed: true,
    monogram: "Sy",
    priceSummary: "Free for 10 videos, then $7–$10/user/mo billed annually",
    plans: [
      { name: "Free", price: "$0", cadence: "10 videos, 30 minutes each" },
      {
        name: "Starter",
        price: "$7",
        cadence: "per user, per month, billed annually, or $19 monthly",
      },
      {
        name: "Pro",
        price: "$10",
        cadence: "per user, per month, billed annually, or $25 monthly",
      },
    ],
    freeTier: "Ten videos in total, thirty minutes each",
    features: {
      autoZoom: false,
      typingZoom: false,
      smoothCursor: false,
      camera: true,
      backgrounds: false,
      layouts: "Tab, desktop or camera only",
      cameraCutout: false,
      tiltFocus: false,
      localCaptions: "Auto-captions after upload",
      timeline: "Trim, stitch, text and blur boxes",
      separateTracks: false,
      // A browser extension records a tab's audio, not the machine's.
      systemAudio: "Tab audio, not the Mac's own",
      verticalReframe: false,
      loupe: false,
      looks: false,
      noiseReduction: false,
      importVideo: "Upload a video to the library",
      localOnly: "No, recordings go to Drive or their library",
      shareLinks: true,
      workspace: true,
      iosCapture: false,
      maxExport: "Not published",
      downloadSize: "A browser extension",
      platforms: "Chrome, Edge",
      licence: "Per-seat subscription, or a capped free plan",
    },
    strength:
      "Nothing to install beyond an extension, videos that land in Google Drive, and questions and polls inside a lesson. On a classroom of Chromebooks it is unbeatable.",
    verifiedOn: "2026-10-22",
    sources: [
      { label: "Screencastify", url: "https://www.screencastify.com/" },
      { label: "Screencastify pricing", url: "https://www.screencastify.com/pricing" },
    ],
    heading: "Looking for a Screencastify alternative?",
    lede: "Screencastify records in a tab, caps the free plan at ten videos and leaves the picture exactly as you performed it. Prequel records the Mac itself and opens the editor with the zooms placed, the camera framed and a background behind the window. $9 a month, or $29 once.",
    title: "Screencastify alternative for Mac",
    description:
      "A Screencastify alternative for macOS with no extension and no upload: screen, camera, microphone and system audio on separate tracks, automatic zooms, captions on your Mac, 4K 120 export.",
    navLabel: "vs Screencastify",
    faq: [
      {
        question: "What is the best Screencastify alternative?",
        answer:
          "On a Mac, Prequel: a native recorder with no extension, recording screen, camera, microphone and system audio as separate tracks and opening the editor with zooms already placed on every click and every burst of typing. If you are on a Chromebook, the answer is another extension, because a Mac app is no use to you.",
      },
      {
        question: "Is Screencastify really free?",
        answer:
          "For ten videos, with a thirty-minute cap on each. That is ten in total rather than ten a month. After that, Starter is $7 per user per month billed annually, or $19 monthly, and Pro is $10, or $25 monthly. Checked on 22 October 2026.",
      },
      {
        question: "Can Screencastify record system audio on a Mac?",
        answer:
          "It records the audio of the tab you are recording, which is what a browser extension has access to. The Mac's own sound, from any app, is not available to it. Prequel records system audio as a separate track with no virtual driver to install.",
      },
      {
        question: "Is Prequel a good Screencastify alternative?",
        answer:
          "If you are on a Mac and the video is a demo rather than a lesson, yes: automatic zooms, a perspective tilt, a framed camera, a background, a cleaned-up cursor, captions transcribed on device, and export at up to 4K and 120 frames a second for $9 a month or $29 once. It has no quizzing, no Google Drive integration and no Chromebook build.",
      },
    ],
  },
  {
    slug: "vidyard",
    name: "Vidyard",
    tagline: "Video for sales teams, with the analytics attached.",
    accent: "#00b296",
    logoAllowed: true,
    monogram: "V",
    priceSummary: "Free for 5 videos a month, then $59/seat/mo",
    plans: [
      { name: "Free", price: "$0", cadence: "5 recordings a month, 30 minutes each" },
      { name: "Starter", price: "$59", cadence: "per seat, per month, billed annually" },
      { name: "Teams", price: "Custom", cadence: "contact them" },
    ],
    freeTier: "Five recordings a month, capped at thirty minutes, without hosting",
    features: {
      autoZoom: false,
      typingZoom: false,
      smoothCursor: false,
      camera: true,
      backgrounds: "Behind the camera bubble",
      layouts: "Screen and camera, or either alone",
      cameraCutout: "Virtual background inside the bubble",
      tiltFocus: false,
      localCaptions: "Transcribed after upload",
      timeline: "Trim and stitch",
      separateTracks: false,
      systemAudio: "In the desktop app",
      verticalReframe: false,
      loupe: false,
      looks: false,
      noiseReduction: false,
      importVideo: true,
      localOnly: "No, recordings upload to Vidyard",
      shareLinks: true,
      workspace: true,
      iosCapture: false,
      maxExport: "Not published",
      downloadSize: "Not published",
      platforms: "macOS, Windows, web, Chrome",
      licence: "Per-seat subscription",
    },
    strength:
      "It is a pipeline tool, not a recorder: who watched, how far they got, written straight back into Salesforce or HubSpot, with sequences and landing pages round it.",
    verifiedOn: "2026-10-22",
    sources: [
      { label: "Vidyard", url: "https://www.vidyard.com/" },
      { label: "Vidyard pricing", url: "https://www.vidyard.com/pricing/" },
    ],
    heading: "Looking for a Vidyard alternative?",
    lede: "Vidyard sells the analytics and charges $59 a seat for them. If what you need is the video, Prequel places the zooms, frames the camera, applies a background and exports at 4K and 120 fps on your own Mac, for $9 a month or $29 once.",
    title: "Vidyard alternative for Mac",
    description:
      "A Vidyard alternative for macOS at $9 a month or $29 once: automatic zooms on clicks and typing, a framed camera, captions transcribed on your Mac and 4K 120 export, with no seat to pay for.",
    navLabel: "vs Vidyard",
    faq: [
      {
        question: "What is the best Vidyard alternative?",
        answer:
          "It depends what you are buying. For the recording, Prequel: zooms placed on every click and every burst of typing, a perspective tilt, a camera framed and cut out of the room, and export at up to 4K and 120 frames a second, for $9 a month or $29 once. For viewer analytics written back into a CRM, Vidyard is the product and nothing here replaces it.",
      },
      {
        question: "How much does Vidyard cost?",
        answer:
          "The free plan records five videos a month at up to thirty minutes each, without hosting. Starter is $59 per seat per month billed annually, and Teams and Enterprise are quoted. Checked on 22 October 2026.",
      },
      {
        question: "Does Vidyard add zoom effects to a recording?",
        answer:
          "No. A Vidyard recording is the screen as you performed it with your camera in a bubble over it, and the editing is a trim. Prequel places the zooms while it writes the file, tilts the push-in and lets focus fall away from whatever it is aimed at.",
      },
      {
        question: "Is Prequel a good Vidyard alternative?",
        answer:
          "For making a demo that will be watched, yes, and for a sixth of the price of a seat. It records locally, finishes the video automatically and shares a link when you want one. What it does not carry is the sales layer: no CRM write-back, no email sequences, no landing pages, no prospecting avatars.",
      },
    ],
  },
  {
    slug: "zoom",
    name: "Zoom",
    tagline: "Meetings, and the recorder most people already have.",
    accent: "#0b5cff",
    logoAllowed: true,
    monogram: "Z",
    priceSummary: "Free, 40-minute meetings; Pro $14.16/user/mo billed annually",
    plans: [
      { name: "Basic", price: "$0", cadence: "free, 40 minutes a group meeting" },
      { name: "Pro", price: "$14.16", cadence: "per user, per month, billed annually" },
      { name: "Business", price: "$18.33", cadence: "per user, per month, billed annually" },
    ],
    freeTier: "Free Basic, with a 40-minute cap on a group meeting",
    features: {
      autoZoom: false,
      typingZoom: false,
      smoothCursor: false,
      camera: true,
      backgrounds: "Virtual backgrounds behind you",
      layouts: "Speaker, gallery, or screen with a thumbnail",
      cameraCutout: "Virtual background, with or without a green screen",
      tiltFocus: false,
      localCaptions: "Live captions, and transcripts in the cloud",
      timeline: false,
      // A cloud recording can be split into audio files per speaker, which is
      // not the same thing as a local recording with separate tracks.
      separateTracks: "Per-speaker audio on a cloud recording",
      systemAudio: true,
      verticalReframe: false,
      loupe: false,
      looks: "Studio effects and filters",
      noiseReduction: true,
      importVideo: false,
      localOnly: "Local recording on paid plans; cloud recording uploads",
      shareLinks: "From a cloud recording",
      workspace: true,
      iosCapture: false,
      maxExport: "1080p on a cloud recording",
      downloadSize: "Not published",
      platforms: "macOS, Windows, Linux, web, iOS, Android",
      licence: "Per-seat subscription, or a capped free plan",
    },
    strength:
      "Everyone already has it, and it does the thing Prequel does not do at all: put other people in the room.",
    verifiedOn: "2026-10-22",
    sources: [
      { label: "Zoom Workplace pricing", url: "https://zoom.us/pricing" },
      {
        label: "Local recording",
        url: "https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0063691",
      },
    ],
    heading: "Looking for a Zoom alternative for recording?",
    lede: "A recorded meeting looks like a recorded meeting: one distance, a rectangle in the corner, call-grade compression. Prequel records the screen and the camera as separate tracks, places the zooms, frames the camera and exports at 4K and 120 fps. $9 a month, or $29 once.",
    title: "Zoom alternative for recording a Mac screen",
    description:
      "A Zoom alternative for recording on macOS: screen, camera, microphone and system audio on separate tracks, automatic zooms, a framed camera over a background, and 4K 120 export instead of a 1080p meeting file.",
    navLabel: "vs Zoom",
    faq: [
      {
        question: "Is Zoom a good screen recorder?",
        answer:
          "It is a convenient one. Start a meeting with nobody in it, share your screen and press record, and you have a file. What you get is a meeting recording: one fixed distance, your camera in a corner rectangle, the compression a call uses, and no editing. For anything a customer will watch, that is the reason people look elsewhere.",
      },
      {
        question: "How much does Zoom cost?",
        answer:
          "Basic is free with a forty-minute cap on group meetings. Pro is $14.16 per user per month billed annually and includes local recording and 10 GB of cloud recording, and Business is $18.33. Checked on 22 October 2026.",
      },
      {
        question: "What resolution does a Zoom recording export at?",
        answer:
          "A cloud recording is 1080p. Prequel exports at up to 4K and 120 frames a second, encoded by the Mac's own media engine, because it is recording your screen rather than a video call.",
      },
      {
        question: "Is Prequel a good Zoom alternative?",
        answer:
          "For recording a demo on a Mac, yes: it captures screen, camera, microphone and system audio as separate tracks, so the camera can be reframed and cut out of the room afterwards and each track can be balanced on its own, and it opens the editor with the zooms already placed. It is not a meeting platform, so Zoom stays on the Mac for talking to people.",
      },
    ],
  },
  {
    slug: "clipchamp",
    name: "Clipchamp",
    tagline: "Microsoft's video editor, in Windows and in the browser.",
    accent: "#6a2fa0",
    logoAllowed: true,
    monogram: "Cc",
    priceSummary: "Free at 1080p; $3–$7/user/mo paid yearly",
    plans: [
      { name: "Free", price: "$0", cadence: "watermark-free, up to 1080p" },
      { name: "Editor Standard", price: "$3", cadence: "per user, per month, paid yearly" },
      { name: "Editor Premium", price: "$7", cadence: "per user, per month, paid yearly" },
    ],
    freeTier: "Unlimited watermark-free exports, up to 1080p",
    features: {
      autoZoom: false,
      typingZoom: false,
      smoothCursor: false,
      camera: true,
      backgrounds: "Stock backgrounds on a layer",
      layouts: "Whatever you build on the timeline",
      cameraCutout: "Background removal on a clip",
      tiltFocus: false,
      localCaptions: "Auto-captions, in the cloud",
      timeline: true,
      separateTracks: true,
      systemAudio: "In the Windows app",
      verticalReframe: "Change the aspect ratio and reposition by hand",
      loupe: false,
      looks: "Filters and effects",
      noiseReduction: true,
      importVideo: true,
      localOnly: "No, projects live in the browser or the Microsoft account",
      shareLinks: true,
      workspace: "Through Microsoft 365",
      iosCapture: false,
      maxExport: "1080p free and Standard, 4K on Premium",
      downloadSize: "A Windows app, or a browser tab",
      platforms: "Windows 11, Windows 10 via the Store, Chrome, Edge",
      licence: "Free tier, or a Microsoft 365 subscription",
    },
    strength:
      "Already on Windows 11, free at 1080p with no watermark, and a real timeline editor with stock footage and music behind it.",
    verifiedOn: "2026-10-22",
    sources: [
      {
        label: "Clipchamp on Microsoft 365",
        url: "https://www.microsoft.com/en-us/microsoft-365/clipchamp",
      },
      { label: "Clipchamp", url: "https://clipchamp.com/en/" },
    ],
    heading: "Looking for a Clipchamp alternative on a Mac?",
    lede: "Clipchamp has no Mac app, keeps 4K for Premium and leaves every zoom to you. Prequel records the Mac natively and opens the editor with the pass made: zooms placed, camera framed, background applied, cursor cleaned up. 4K at 120 fps, $9 a month or $29 once.",
    title: "Clipchamp alternative for Mac",
    description:
      "A Clipchamp alternative for macOS: a native recorder with automatic zooms on clicks and typing, a framed camera over a background, captions transcribed on your Mac, and 4K 120 export with no Premium tier.",
    navLabel: "vs Clipchamp",
    faq: [
      {
        question: "Is there a Clipchamp for Mac?",
        answer:
          "Not as an app. Clipchamp is a Windows 11 app, available on Windows 10 through the Store, and otherwise a web editor in Chrome or Edge. On a Mac it runs in a browser tab, with everything that implies for recording the machine it is running on. Prequel is a native Mac app on Apple Silicon.",
      },
      {
        question: "How much does Clipchamp cost?",
        answer:
          "The free plan exports up to 1080p with no watermark. Editor Standard is $3 per user per month paid yearly, and Editor Premium is $7 and brings 4K export. Checked on 22 October 2026.",
      },
      {
        question: "Can Clipchamp zoom in on clicks automatically?",
        answer:
          "No. Clipchamp is a general-purpose editor, so a zoom is a keyframe you set on a clip. Prequel places a zoom on every click and every burst of typing while it writes the recording, tilts the push-in, and lets focus fall away from whatever it is aimed at.",
      },
      {
        question: "Is Prequel a good Clipchamp alternative?",
        answer:
          "On a Mac, for screen recordings, yes: it records screen, camera, microphone and system audio as separate tracks, finishes the first pass automatically and exports at up to 4K and 120 frames a second for $9 a month or $29 once. It is not a general-purpose editor, so footage from a camera roll with stock music under it is Clipchamp's job, or iMovie's.",
      },
    ],
  },
  {
    slug: "movavi",
    name: "Movavi Screen Recorder",
    tagline: "Screen capture with a scheduler, for Windows and Mac.",
    accent: "#8b5cf6",
    logoAllowed: true,
    monogram: "Mv",
    priceSummary: "$44.95 a year, or $74.95 once",
    plans: [
      { name: "1-year licence", price: "$44.95", cadence: "per year" },
      { name: "Lifetime licence", price: "$74.95", cadence: "one-off" },
    ],
    freeTier: "A trial that watermarks the export",
    features: {
      autoZoom: false,
      typingZoom: false,
      smoothCursor: false,
      camera: true,
      backgrounds: false,
      layouts: "Camera over the screen",
      cameraCutout: false,
      tiltFocus: false,
      localCaptions: false,
      timeline: "Trim and join",
      separateTracks: false,
      systemAudio: true,
      verticalReframe: false,
      loupe: false,
      looks: false,
      noiseReduction: true,
      importVideo: "In Movavi Video Editor, sold separately",
      localOnly: true,
      shareLinks: false,
      workspace: false,
      iosCapture: false,
      maxExport: "4K",
      downloadSize: "Not published",
      platforms: "macOS, Windows",
      licence: "$44.95/yr or $74.95 once",
    },
    strength:
      "A scheduler that records a webinar while you sleep, keystrokes and clicks drawn on screen, and drawing on the picture while the recording runs.",
    verifiedOn: "2026-10-22",
    sources: [
      { label: "Movavi Screen Recorder", url: "https://www.movavi.com/screen-recorder/" },
      {
        label: "Movavi Screen Recorder for Mac",
        url: "https://www.movavi.com/screen-recorder-mac/",
      },
    ],
    heading: "Looking for a Movavi alternative?",
    lede: "Movavi captures the take, watermarks the trial and points at a second product for the editing. Prequel finishes the video where it recorded it: zooms placed, camera framed, background applied, cursor cleaned up, 4K at 120 fps. $9 a month, or $29 once.",
    title: "Movavi Screen Recorder alternative for Mac",
    description:
      "A Movavi Screen Recorder alternative for macOS with no watermark in the trial: automatic zooms on clicks and typing, a framed camera over a background, captions on your Mac, 4K 120 export.",
    navLabel: "vs Movavi",
    faq: [
      {
        question: "What is the best Movavi Screen Recorder alternative on a Mac?",
        answer:
          "Prequel, if the recording is a demo or a tutorial: it records screen, camera, microphone and system audio as separate tracks and opens the editor with zooms already placed on every click and every burst of typing, the camera framed over a background and the cursor smoothed, then exports at up to 4K and 120 frames a second.",
      },
      {
        question: "How much does Movavi Screen Recorder cost?",
        answer:
          "$44.95 for a one-year licence or $74.95 for a lifetime one, with a free trial that puts a watermark on the export. Checked on 22 October 2026.",
      },
      {
        question: "Does the Movavi trial watermark your video?",
        answer:
          "Yes, which means the first clean export is after the purchase. Prequel's seven-day trial is the whole app with export in it, at every size and frame rate, and nothing it writes is ever watermarked.",
      },
      {
        question: "Is Prequel a good Movavi alternative?",
        answer:
          "On a Mac, yes, and for less: $29 once against $74.95, or $9 a month. It makes the cinematic pass automatically, cleans the microphone with Apple's own sound isolation and transcribes captions on device. What Movavi keeps is Windows, the recording scheduler and drawing on the screen while you record.",
      },
    ],
  },
  {
    slug: "bandicam",
    name: "Bandicam",
    tagline: "High frame rate screen and game recording, for Windows.",
    accent: "#00a0e9",
    logoAllowed: true,
    monogram: "B",
    priceSummary: "$33.26 a year, or $53.90 perpetual. Windows only",
    plans: [
      { name: "Personal, annual", price: "$33.26", cadence: "per year, one PC" },
      { name: "Personal, perpetual", price: "$53.90", cadence: "one-off, one PC" },
      { name: "Business, annual", price: "$49.46", cadence: "per year, one PC" },
    ],
    freeTier: "Free with a watermark and a ten-minute cap",
    features: {
      autoZoom: false,
      typingZoom: false,
      smoothCursor: false,
      camera: true,
      backgrounds: "Chroma key behind the camera",
      layouts: "Camera over the screen",
      cameraCutout: "Chroma key, with a green screen",
      tiltFocus: false,
      localCaptions: false,
      timeline: false,
      separateTracks: "Two audio tracks, separated on export",
      systemAudio: true,
      verticalReframe: false,
      loupe: false,
      looks: false,
      noiseReduction: false,
      importVideo: false,
      localOnly: true,
      shareLinks: false,
      workspace: false,
      iosCapture: "A device over HDMI, with a capture card",
      maxExport: "4K, up to 480 fps",
      downloadSize: "Windows only",
      platforms: "Windows",
      licence: "$33.26/yr or $53.90 perpetual",
    },
    strength:
      "Game capture through DirectX and OpenGL at frame rates nothing else here reaches, twenty-four-hour sessions, and a device over HDMI.",
    verifiedOn: "2026-10-22",
    sources: [
      { label: "Bandicam", url: "https://www.bandicam.com/" },
      { label: "Buy Bandicam", url: "https://www.bandicam.com/buy/" },
    ],
    heading: "Looking for a Bandicam alternative on a Mac?",
    lede: "Bandicam is Windows software, so moving to a Mac means choosing again. Prequel records a display, a window or a region with the camera and system audio, places the zooms, frames the camera and exports at 4K and 120 fps, with no watermark anywhere. $9 a month, or $29 once.",
    title: "Bandicam alternative for Mac",
    description:
      "A Bandicam alternative for macOS: screen, camera, microphone and system audio on separate tracks, automatic zooms on clicks and typing, no watermark at any point, and 4K 120 export.",
    navLabel: "vs Bandicam",
    faq: [
      {
        question: "Is there a Bandicam for Mac?",
        answer:
          "No. Bandicam is Windows software and no macOS build exists. On a Mac, the nearest free equivalent for high frame rate and game capture is OBS Studio, and for demos and tutorials Prequel records a display, a window or a region and finishes the video automatically.",
      },
      {
        question: "How much does Bandicam cost?",
        answer:
          "A personal licence is $33.26 a year or $53.90 perpetual for one PC, and a business licence is $49.46 a year. The free version watermarks the recording and stops after ten minutes. Checked on 22 October 2026.",
      },
      {
        question: "Does Prequel watermark recordings?",
        answer:
          "No, at any point. The seven-day trial exports at every size and frame rate the paid app does, with nothing drawn on top, so the files you make in that week are usable whether or not you buy it.",
      },
      {
        question: "Is Prequel good for recording games?",
        answer:
          "It records what the Mac draws, which covers most games in a window, but game capture is not what it is built for and there is no hook into a graphics API. For gameplay, OBS Studio is the better Mac answer and it is free.",
      },
    ],
  },
  {
    slug: "sharex",
    name: "ShareX",
    tagline: "The free and open source capture tool for Windows.",
    accent: "#174974",
    logoAllowed: true,
    monogram: "SX",
    priceSummary: "Free, open source. Windows only",
    plans: [{ name: "ShareX", price: "$0", cadence: "free software, GPLv3" }],
    freeTier: "All of it, with no account",
    features: {
      autoZoom: false,
      typingZoom: false,
      smoothCursor: false,
      camera: false,
      backgrounds: false,
      layouts: false,
      cameraCutout: false,
      tiltFocus: false,
      localCaptions: false,
      timeline: false,
      separateTracks: false,
      systemAudio: true,
      verticalReframe: false,
      loupe: false,
      looks: false,
      noiseReduction: false,
      importVideo: false,
      localOnly: "Local, until a workflow uploads it",
      shareLinks: "To dozens of destinations you choose",
      workspace: false,
      iosCapture: false,
      maxExport: "Whatever you configure, MP4 or GIF",
      downloadSize: "Windows only",
      platforms: "Windows",
      licence: "Free, GPLv3",
    },
    strength:
      "One hotkey from a capture to a link, an upload pipeline with dozens of destinations, workflows you define yourself, and not a penny to anyone.",
    verifiedOn: "2026-10-22",
    sources: [
      { label: "ShareX", url: "https://getsharex.com/" },
      { label: "ShareX on GitHub", url: "https://github.com/ShareX/ShareX" },
    ],
    heading: "Looking for a ShareX alternative on a Mac?",
    lede: "ShareX is Windows only, and the video half of it is capture with no zooms, no camera and no timeline. Prequel records the Mac, places the zooms, frames the camera over a background and exports at 4K and 120 fps, with a link when you want one. $9 a month, or $29 once.",
    title: "ShareX alternative for Mac",
    description:
      "A ShareX alternative for macOS on the video side: screen, camera, microphone and system audio on separate tracks, automatic zooms, a framed camera, 4K 120 export, and a shareable link in one click.",
    navLabel: "vs ShareX",
    faq: [
      {
        question: "Is there a ShareX for Mac?",
        answer:
          "No. ShareX is Windows only and there is no port. On a Mac the capture half is covered by CleanShot X or the built-in Screenshot app, and for recording a demo Prequel records screen, camera, microphone and system audio as separate tracks and finishes the video automatically.",
      },
      {
        question: "Is there a free ShareX alternative for Mac?",
        answer:
          "The Screenshot app is already installed and records the screen, and OBS Studio is free and open source if you need more control. Prequel is $9 a month or $29 once after a seven-day trial, and what it sells is the finished video: zooms on clicks and typing, a framed camera, a background and a cleaned-up cursor.",
      },
      {
        question: "Does Prequel upload my recordings anywhere?",
        answer:
          "Only if you ask it to. Recording, editing and export happen on your Mac and never need the network, and captions are transcribed on device. Sharing a link is a separate action rather than the price of pressing record.",
      },
      {
        question: "Is Prequel a good ShareX alternative?",
        answer:
          "For the recording half on a Mac, yes. For screenshots, OCR, the colour picker and the custom upload workflows, nothing replaces ShareX and Prequel does not try: it records a display, a window or a region and makes a finished video out of it.",
      },
    ],
  },
  {
    slug: "flashback",
    name: "FlashBack",
    tagline: "Screen recorder and editor for Windows, with a free edition.",
    accent: "#ff6b35",
    logoAllowed: true,
    monogram: "FB",
    priceSummary: "Free Starter; $39 a year or $65 once. Windows only",
    plans: [
      { name: "Starter", price: "$0", cadence: "free, no time limit, no watermark" },
      { name: "1-Year", price: "$39", cadence: "per year, $29 on their current offer" },
      { name: "Lifetime", price: "$65", cadence: "one-off, $49 on their current offer" },
      { name: "Creator", price: "$89", cadence: "one-off, $63 on their current offer" },
    ],
    freeTier: "Starter records screen, camera and audio across monitors, with no watermark",
    features: {
      autoZoom: false,
      typingZoom: false,
      smoothCursor: false,
      camera: true,
      backgrounds: false,
      layouts: "Camera over the screen",
      cameraCutout: false,
      tiltFocus: false,
      localCaptions: false,
      timeline: true,
      separateTracks: true,
      systemAudio: true,
      verticalReframe: false,
      loupe: false,
      looks: false,
      noiseReduction: true,
      importVideo: true,
      localOnly: true,
      shareLinks: "Publish to a video platform",
      workspace: false,
      iosCapture: false,
      maxExport: "Not published",
      downloadSize: "Windows only",
      platforms: "Windows 10, Windows 11",
      licence: "Free edition, or $39/yr and $65 once",
    },
    strength:
      "A free edition with no watermark and no time limit, and a training-video editor above it with callouts, arrows, blur and zoom and pan.",
    verifiedOn: "2026-10-22",
    sources: [
      { label: "FlashBack", url: "https://www.flashbackrecorder.com/" },
      { label: "FlashBack pricing", url: "https://www.flashbackrecorder.com/pricing" },
    ],
    heading: "Looking for a FlashBack alternative on a Mac?",
    lede: "FlashBack is Windows software, and every zoom in it is one you place on a timeline. Prequel records the Mac and opens the editor with the zooms already there, the camera framed and a background behind the window. 4K at 120 fps, $9 a month or $29 once.",
    title: "FlashBack alternative for Mac",
    description:
      "A FlashBack alternative for macOS: screen, camera, microphone and system audio on separate tracks, zooms placed automatically on clicks and typing, blur regions, captions on your Mac, 4K 120 export.",
    navLabel: "vs FlashBack",
    faq: [
      {
        question: "Is there a FlashBack for Mac?",
        answer:
          "No. FlashBack runs on Windows 10 and 11 only. On a Mac, Prequel records a display, a window or a region with the camera, the microphone and system audio, and opens the editor with zooms already placed on every click and every burst of typing.",
      },
      {
        question: "How much does FlashBack cost?",
        answer:
          "The Starter edition is free with no watermark and no time limit. The paid editions list at $39 a year and $65 for a lifetime licence, with a Creator edition at $89, and all three were on offer at $29, $49 and $63 when this page was checked on 22 October 2026.",
      },
      {
        question: "Is there a free screen recorder for Mac like FlashBack Starter?",
        answer:
          "The Screenshot app is built into macOS and records with no watermark and no limit, and OBS Studio is free, open source and far more capable. Neither finishes the video: the zooms, the framing and the cuts are yours to make, which is what Prequel does for you at $9 a month or $29 once.",
      },
      {
        question: "Is Prequel a good FlashBack alternative?",
        answer:
          "On a Mac, for demos, tutorials and training clips, yes. The cinematic pass is automatic, blur regions cover anything private, captions are transcribed on device and export runs at up to 4K and 120 frames a second. What FlashBack keeps is Windows, a genuinely free edition, and annotation drawn over the picture.",
      },
    ],
  },
  {
    slug: "icecream",
    name: "Icecream Screen Recorder",
    tagline: "A small screen recorder for Windows and Mac.",
    accent: "#2d9cdb",
    logoAllowed: true,
    monogram: "Ic",
    priceSummary: "$29.95 a year, or $59.95 once",
    plans: [
      { name: "1 Year", price: "$29.95", cadence: "billed annually" },
      { name: "Lifetime", price: "$59.95", cadence: "one-off, listed at $79.93" },
    ],
    freeTier: "Free, with a watermark and a cap on how long a recording runs",
    features: {
      autoZoom: false,
      typingZoom: false,
      smoothCursor: false,
      camera: true,
      backgrounds: false,
      layouts: "Camera over the screen",
      cameraCutout: false,
      tiltFocus: false,
      localCaptions: false,
      timeline: "Trim",
      separateTracks: false,
      systemAudio: true,
      verticalReframe: false,
      loupe: false,
      looks: false,
      noiseReduction: false,
      importVideo: false,
      localOnly: "Local, with 10 GB of cloud storage on PRO",
      shareLinks: true,
      workspace: false,
      iosCapture: false,
      maxExport: "Not published",
      downloadSize: "Not published",
      platforms: "macOS, Windows, Android",
      licence: "$29.95/yr or $59.95 once",
    },
    strength:
      "Two clicks from opening it to recording, drawing on the screen while it runs, and a screenshot from the same toolbar.",
    verifiedOn: "2026-10-22",
    sources: [
      { label: "Icecream Screen Recorder", url: "https://icecreamapps.com/Screen-Recorder/" },
      {
        label: "Screen Recorder: Upgrade to PRO",
        url: "https://icecreamapps.com/Screen-Recorder/upgrade.html",
      },
    ],
    heading: "Looking for an Icecream Screen Recorder alternative?",
    lede: "Icecream watermarks the free version and trims the paid one. Prequel exports without a watermark from the first day of the trial, and opens the editor with the zooms placed, the camera framed and a background behind the window. 4K at 120 fps, $9 a month or $29 once.",
    title: "Icecream Screen Recorder alternative for Mac",
    description:
      "An Icecream Screen Recorder alternative for macOS with no watermark anywhere: automatic zooms on clicks and typing, a framed camera over a background, captions on your Mac, and 4K 120 export.",
    navLabel: "vs Icecream",
    faq: [
      {
        question: "How much does Icecream Screen Recorder cost?",
        answer:
          "PRO is $29.95 for a year or $59.95 for a lifetime licence, listed at $79.93. The free version adds a watermark and limits how long a recording can run, which is what PRO removes. Checked on 22 October 2026.",
      },
      {
        question: "Is there a screen recorder for Mac with no watermark?",
        answer:
          "The Screenshot app built into macOS records without one, and so does OBS Studio. Prequel never watermarks anything either, including during the seven-day trial, and what it adds is the finished video: zooms on clicks and typing, a framed camera, a background and a cleaned-up cursor.",
      },
      {
        question: "Is Prequel a good Icecream Screen Recorder alternative?",
        answer:
          "On a Mac, yes. It records screen, camera, microphone and system audio as separate tracks, makes the cinematic pass automatically, cuts and retimes on a timeline, transcribes captions on device and exports at up to 4K and 120 frames a second, for $9 a month or $29 once.",
      },
      {
        question: "Is Icecream better for anything?",
        answer:
          "Windows, a screenshot tool in the same toolbar, and drawing on the screen while you record. It is also the cheaper annual licence. Prequel is macOS on Apple Silicon and does none of the three.",
      },
    ],
  },
  {
    slug: "focusee",
    name: "FocuSee",
    tagline: "Screen recording with automatic zoom, for Windows and Mac.",
    accent: "#ff7a45",
    logoAllowed: true,
    monogram: "FS",
    priceSummary: "$49.99 a year, up to $199.99 once",
    plans: [
      { name: "Standard", price: "$49.99", cadence: "per year, or $19.99 a month" },
      { name: "Advanced", price: "$79.99", cadence: "per year, or $24.99 a month" },
      { name: "Advanced, lifetime", price: "$199.99", cadence: "one-off, for the 2.x line" },
    ],
    freeTier: "A trial that exports one video",
    features: {
      autoZoom: true,
      typingZoom: false,
      smoothCursor: true,
      camera: true,
      backgrounds: true,
      layouts: "Camera over the screen, or beside it",
      cameraCutout: false,
      tiltFocus: false,
      localCaptions: "Generated in the app; where is not stated",
      timeline: true,
      separateTracks: "Not stated",
      systemAudio: true,
      verticalReframe: "A vertical layout, cropped to follow the cursor",
      loupe: false,
      looks: false,
      noiseReduction: true,
      importVideo: true,
      localOnly: true,
      shareLinks: false,
      workspace: false,
      iosCapture: false,
      maxExport: "4K",
      downloadSize: "Not published",
      platforms: "macOS, Windows",
      licence: "$49.99/yr, or $199.99 once for 2.x",
    },
    strength:
      "One of the few automatic-zoom recorders that is the same product on Windows and on a Mac, from a company with a catalogue behind it.",
    verifiedOn: "2026-10-22",
    sources: [
      { label: "FocuSee", url: "https://www.gemoo.com/focusee/" },
      { label: "FocuSee pricing", url: "https://www.gemoo.com/focusee/pricing.htm" },
    ],
    heading: "Looking for a FocuSee alternative?",
    lede: "FocuSee's lifetime licence is $199.99 and covers one version line. Prequel is $29 once, or $9 a month, and takes the pass further: zooms on what you type as well as where you click, a perspective tilt, focus falling away from the subject, and 4K at 120 fps.",
    title: "FocuSee alternative for Mac",
    description:
      "A FocuSee alternative for macOS at $29 once: automatic zooms on clicks and typing, a perspective tilt, a camera cut out of its background, captions transcribed on your Mac and 4K 120 export.",
    navLabel: "vs FocuSee",
    faq: [
      {
        question: "What is the best FocuSee alternative?",
        answer:
          "On a Mac, Prequel. It does the same job, automatic zooms on a screen recording, and adds the parts that make a take read as directed: zooms on what you type as well as where you click, a perspective tilt on the push-in, focus falling away from the subject, a camera cut out of the room behind you, and export at up to 4K and 120 frames a second. It is $29 once against $199.99.",
      },
      {
        question: "How much does FocuSee cost?",
        answer:
          "Standard is $49.99 a year or $19.99 a month. Advanced is $79.99 a year, $24.99 a month, or $199.99 once for a lifetime licence to the 2.x line. The trial exports a single video. Checked on 22 October 2026.",
      },
      {
        question: "Does FocuSee put a watermark on your video?",
        answer:
          "The trial exports one high-quality video and the licence is what removes the limit after that. Prequel's seven-day trial exports as many videos as you like, at every size and frame rate, with nothing drawn on top.",
      },
      {
        question: "Is Prequel a good FocuSee alternative?",
        answer:
          "For a Mac, yes, and the pass is deeper: typing triggers a zoom as well as clicking, the push-in is tilted with focus falling away from it, the camera is cut out of the room by a model running on your Mac, and seventeen colour looks sit over the picture. FocuSee keeps Windows, which Prequel has no answer to.",
      },
    ],
  },
  {
    slug: "cursorful",
    name: "Cursorful",
    tagline: "A browser recorder that adds zooms and pans automatically.",
    accent: "#111827",
    logoAllowed: true,
    monogram: "Cf",
    priceSummary: "Free for non-commercial use; $79 once",
    plans: [
      { name: "Free", price: "$0", cadence: "non-commercial use" },
      { name: "Pro", price: "$79", cadence: "once, per seat, listed at $119" },
    ],
    freeTier: "Free for non-commercial use",
    features: {
      autoZoom: true,
      // Their own description: two or more clicks inside a three-second window.
      // Typing is not a trigger.
      typingZoom: false,
      smoothCursor: true,
      camera: true,
      layouts: "A webcam docked in a corner, per scene",
      backgrounds: true,
      cameraCutout: false,
      tiltFocus: false,
      localCaptions: true,
      timeline: "Segments for zoom, speed, camera and blur",
      separateTracks: false,
      systemAudio: "Tab audio from the extension",
      verticalReframe: "Ten aspect ratios, cropped",
      loupe: false,
      looks: false,
      noiseReduction: true,
      importVideo: true,
      localOnly: "Renders locally; sharing uploads",
      shareLinks: true,
      workspace: false,
      iosCapture: false,
      maxExport: "4K",
      downloadSize: "Not published",
      platforms: "macOS, Windows, and a Chrome, Edge or Brave extension",
      licence: "$79 once, per seat",
    },
    strength:
      "The shortest path from a browser tab to a zoomed recording: an extension in the browser the demo is already open in, with local rendering and a one-off price.",
    verifiedOn: "2026-10-22",
    sources: [
      { label: "Cursorful", url: "https://cursorful.com/" },
      { label: "Cursorful pricing", url: "https://cursorful.com/#pricing" },
    ],
    heading: "Looking for a Cursorful alternative?",
    lede: "Cursorful zooms when two clicks land inside three seconds, and free stops at non-commercial use. Prequel zooms on every click and every burst of typing, tilts the push-in, pulls focus off the subject and exports at 4K and 120 fps. $9 a month, or $29 once against their $79.",
    title: "Cursorful alternative for Mac",
    description:
      "A Cursorful alternative for macOS at $29 once: a native recorder with automatic zooms on clicks and typing, a perspective tilt, a camera cut out of its background, and 4K 120 export.",
    navLabel: "vs Cursorful",
    faq: [
      {
        question: "What is the best Cursorful alternative?",
        answer:
          "On a Mac, Prequel. It captures a display, a window or a region through ScreenCaptureKit rather than a browser tab, places zooms on every click and every burst of typing, tilts the push-in, pulls focus away from the subject and exports at up to 4K and 120 frames a second. It is $29 once against Cursorful's $79, or $9 a month.",
      },
      {
        question: "Is Cursorful free?",
        answer:
          "For non-commercial use. Recording a demo for a product you sell is commercial, so that needs Pro at $79 once per seat, listed at $119. Checked on 22 October 2026.",
      },
      {
        question: "Can Cursorful record anything outside the browser?",
        answer:
          "The Mac and Windows apps record the desktop, and the extension records a tab. Prequel is a native Mac app throughout: a display, a window or a region, with the camera, the microphone and system audio on separate tracks.",
      },
      {
        question: "Is Prequel a good Cursorful alternative?",
        answer:
          "For a Mac, yes. The automatic pass covers more of the take, the camera can be reframed, reshaped and cut out of the room afterwards, captions are transcribed by Apple's own speech framework on device, and export runs at 120 frames a second. Cursorful keeps the browser extension and the Windows and Linux installs that come with it.",
      },
    ],
  },
  {
    slug: "recordly",
    name: "Recordly",
    tagline: "Open-source app for incredible screen recordings.",
    accent: "#6366f1",
    logoAllowed: true,
    monogram: "R",
    priceSummary: "Free, open source",
    plans: [{ name: "Recordly", price: "$0", cadence: "free and open source" }],
    freeTier: "All of it, with no watermark",
    features: {
      autoZoom: true,
      typingZoom: false,
      smoothCursor: true,
      camera: true,
      backgrounds: true,
      layouts: "A webcam bubble that grows and shrinks",
      cameraCutout: false,
      tiltFocus: false,
      localCaptions: false,
      timeline: "Speed, zooms, annotations and audio tracks",
      separateTracks: "Imports audio and webcam as their own tracks",
      systemAudio: true,
      verticalReframe: false,
      loupe: false,
      looks: false,
      noiseReduction: false,
      importVideo: "Audio and webcam footage",
      localOnly: true,
      shareLinks: false,
      workspace: false,
      iosCapture: false,
      maxExport: "MP4 or a looping GIF",
      // `Content-Length` of the 1.4.0 arm64 `.dmg`: 187,987,169 bytes.
      downloadSize: "188 MB",
      platforms: "macOS, Windows, Linux",
      licence: "Free, open source",
    },
    strength:
      "The cinematic pass, free and open source, on three platforms, with no watermark and nothing held back for a paid tier.",
    verifiedOn: "2026-10-22",
    sources: [
      { label: "Recordly", url: "https://recordly.dev/" },
      {
        label: "Recordly 1.4.0 installer",
        url: "https://github.com/webadderallorg/Recordly/releases/download/v1.4.0/Recordly-arm64.dmg",
      },
    ],
    heading: "Looking for a Recordly alternative?",
    lede: "Recordly is free, open source and good at the basics of the cinematic pass. Prequel takes it further: zooms on what you type, a perspective tilt, focus falling away from the subject, a camera cut out of the room, captions on device, 4K at 120 fps. $9 a month, or $29 once.",
    title: "Recordly alternative for Mac",
    description:
      "A Recordly alternative for macOS: automatic zooms on clicks and typing, a perspective tilt, a camera cut out of its background, captions transcribed on your Mac, and 4K 120 export through the Mac's media engine.",
    navLabel: "vs Recordly",
    faq: [
      {
        question: "What is the best Recordly alternative?",
        answer:
          "If you want another free one, OpenScreen is the closest: MIT-licensed, on three platforms, with click zooms, cursor packs and captions from whisper.cpp. If the video is going in front of customers, Prequel: zooms on clicks and typing, a perspective tilt, focus falling away from the subject, a camera cut out of the room, and export at up to 4K and 120 frames a second for $9 a month or $29 once.",
      },
      {
        question: "Is Recordly free?",
        answer:
          "Yes, free and open source, on macOS, Windows and Linux, with no watermark and no paid tier. Checked on 22 October 2026.",
      },
      {
        question: "Is Prequel worth paying for when Recordly is free?",
        answer:
          "It depends how much the output matters. Recordly gives you auto-zoom, an animated cursor and a background, which is most of the look. Prequel adds zooms on what you type, a tilted push-in with focus falling away from it, a camera framed and cut out of the room, seventeen colour looks, captions transcribed on device, and export at 4K and 120 frames a second through the Mac's own media engine. For a launch video, that is $29. For a weekly clip for a team chat, Recordly is a good answer.",
      },
    ],
  },
  {
    slug: "openscreen",
    name: "OpenScreen",
    tagline: "Free, open-source screen recorder and video editor.",
    accent: "#22c55e",
    logoAllowed: true,
    monogram: "OS",
    priceSummary: "Free, MIT licensed",
    plans: [{ name: "OpenScreen", price: "$0", cadence: "free software, MIT" }],
    freeTier: "All of it, with no watermark and no paid tier",
    features: {
      autoZoom: true,
      typingZoom: false,
      smoothCursor: true,
      camera: true,
      backgrounds: true,
      layouts: "Picture in picture, dual frame, vertical stack, or none",
      // A segmentation model that runs on your own machine, which is the same
      // claim Prequel makes for its cutout.
      cameraCutout: true,
      // Their zoom can turn the screen in 3D with depth of field on the far
      // side, which is a different move from a tilted push-in with focus
      // falling away from the subject. A tick here would blur the two.
      tiltFocus: "A 3D camera move, with depth of field",
      // whisper.cpp ships with the app and the model downloads once.
      localCaptions: true,
      timeline: true,
      separateTracks: "Not stated",
      systemAudio: true,
      verticalReframe: false,
      loupe: false,
      looks: false,
      noiseReduction: false,
      importVideo: false,
      localOnly: true,
      shareLinks: false,
      workspace: false,
      iosCapture: false,
      maxExport: "Source size, 60 fps, H.264",
      downloadSize: "Not published",
      platforms: "macOS, Windows, Linux",
      licence: "Free, MIT",
    },
    strength:
      "Free and MIT-licensed, with a 3D camera move on every zoom, five cursor packs, a local cutout model and captions from whisper.cpp running on your own machine.",
    verifiedOn: "2026-10-22",
    sources: [
      { label: "OpenScreen", url: "https://getopenscreen.com/" },
      { label: "OpenScreen on GitHub", url: "https://github.com/siddharthvaddem/openscreen" },
    ],
    heading: "Looking for an OpenScreen alternative?",
    lede: "OpenScreen is free, MIT-licensed and stops at 60 frames a second in H.264. Prequel captures through ScreenCaptureKit and encodes on the Mac's own media engine: 4K at 120 fps, zooms on clicks and typing, a tilted push-in and focus falling away from the subject. $9 a month, or $29 once.",
    title: "OpenScreen alternative for Mac",
    description:
      "An OpenScreen alternative for macOS: a native recorder with automatic zooms on clicks and typing, a perspective tilt, seventeen colour looks, captions from Apple's speech framework, and 4K 120 export.",
    navLabel: "vs OpenScreen",
    faq: [
      {
        question: "What is the best OpenScreen alternative?",
        answer:
          "Another free one is Recordly, which is open source on the same three platforms. If the recording is work, Prequel: a native Mac app that captures through ScreenCaptureKit, places zooms on every click and every burst of typing, tilts the push-in, pulls focus away from the subject and exports at up to 4K and 120 frames a second. It is $9 a month or $29 once.",
      },
      {
        question: "Is OpenScreen free?",
        answer:
          "Yes, free and MIT-licensed, on macOS, Windows and Linux, with no paid tiers and no watermark. Captions run locally through whisper.cpp and the cutout model runs on your own machine too. Checked on 22 October 2026.",
      },
      {
        question: "What frame rate does OpenScreen export at?",
        answer:
          "MP4 from 720p up to the source size, at 24, 30 or 60 frames a second, in H.264. Prequel exports at up to 4K and 120 frames a second, in H.264 or HEVC, encoded by the Mac's own media engine.",
      },
      {
        question: "Is Prequel worth paying for when OpenScreen is free?",
        answer:
          "If the video is a launch, a demo or a tutorial that represents your product, the differences are the ones people notice: 120 frames a second, a tilted push-in with focus falling away from the subject, zooms triggered by typing as well as clicking, seventeen colour looks, a loupe over the work, and Apple's sound isolation on the microphone. If it is a clip for a colleague, OpenScreen costs nothing and does the job.",
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
