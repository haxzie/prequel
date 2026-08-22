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
  { key: "shareLinks", label: "Shareable links" },
  { key: "workspace", label: "Team workspace" },
  { key: "iosCapture", label: "Records an iPhone or iPad" },
  { key: "maxExport", label: "Maximum export" },
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
 * `shareLinks` and `workspace` are the Pro tier in `lib/pricing.ts`. They live
 * here because leaving them off the table did not make the pages more modest,
 * it made them silent on the one axis Loom, Tella, Descript and Cap are bought
 * for — and silence on a comparison table reads as a cross.
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
  platforms: "macOS 14+, Apple Silicon",
  licence: "$59/user/year, 14-day trial",
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
   * Every entry is currently `true`, and that is a decision rather than a
   * default — each of these six vendors' brand terms was read before its mark
   * went in. Set this to `false` to pull one without deleting the file, and the
   * page falls back to the monogram: the flag is checked before the filesystem,
   * so it is the answer, not a hint.
   *
   * The strictest terms in the set belonged to Apple, whose guidelines spell out
   * a prohibition on reproducing their graphic marks. That entry has since been
   * removed for unrelated reasons; if a QuickTime comparison ever returns, it
   * comes back as a monogram.
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
      timeline: true,
      separateTracks: true,
      systemAudio: true,
      verticalReframe: true,
      localOnly: "Records locally; shareable links upload",
      shareLinks: "Yes, 30-minute cap, branded page",
      workspace: false,
      iosCapture: true,
      maxExport: "4K, 60 fps",
      platforms: "macOS",
      licence: "Subscription only",
    },
    strength:
      "The automatic zoom and cursor smoothing that made this category, and still the output most people are comparing everything else against.",
    verifiedOn: "2026-08-22",
    sources: [
      { label: "Screen Studio", url: "https://screen.studio/" },
      { label: "screen.studio pricing", url: "https://screen.studio/#pricing" },
    ],
    heading: "Looking for a Screen Studio alternative?",
    lede: "Both are paid, and Prequel is $59 a year against Screen Studio's $108. Same automatic zooms, higher export ceiling, and a fourteen-day trial to check before you pay.",
    title: "Screen Studio alternative for Mac",
    description:
      "A Screen Studio alternative for macOS at $59 a year against their $108: the same automatic zooms and a framed camera, exporting at 4K 120. Compared on price, features and licence.",
    navLabel: "vs Screen Studio",
    faq: [
      {
        question: "What is the best Screen Studio alternative?",
        answer:
          "It depends on what pushed you to look. If it was the price, Prequel is $59 per user per year against Screen Studio's $108, and does the same automatic zooms for it. If it was macOS-only, neither of us has a Windows build and you want something cross-platform. And if it was paying at all, there are free recorders in this category — they ask you to set up and edit the thing yourself, which is the work Prequel exists to remove.",
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
          "Not Prequel — it is $59 per user per year, after a fourteen-day trial with the whole app in it. There are free recorders in this category and open-source ones among them, so if free is the hard requirement the answer is one of those rather than either of us. What you give up is the automatic pass: they capture faithfully and leave the zooms, the framing and the cuts to you.",
      },
      {
        question: "Is Prequel a good Screen Studio alternative?",
        answer:
          "For a Mac recording that needs to look produced, yes — the automatic zooms, the framed camera, the backgrounds and the cursor work are the same job, and Prequel exports higher, at up to 4K 120 against their 4K 60. Screen Studio does two things we do not: it records iPhones and iPads over USB, and it is a mature product with years of releases behind it rather than one in development.",
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
      timeline: "Trim and transcript-based edits",
      separateTracks: false,
      systemAudio: true,
      verticalReframe: false,
      localOnly: "No — recordings upload to Loom",
      shareLinks: true,
      workspace: true,
      iosCapture: false,
      maxExport: "4K on paid plans",
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
    ],
    heading: "Looking for a Loom alternative?",
    lede: "Loom uploads first and barely edits at all. Prequel edits first — zooms on the work, the camera framed, the dead air gone — then gives you a link if you want one, and a file you own either way.",
    title: "Loom alternative for Mac",
    description:
      "A Loom alternative for macOS that records locally, edits automatically and exports one MP4 — no upload, no seat pricing, no account needed to watch it.",
    navLabel: "vs Loom",
    faq: [
      {
        question: "What is the best Loom alternative?",
        answer:
          "Prequel, if the video itself matters. Loom is a recorder with sharing attached; the recording it makes is the one you performed, un-zoomed and uncut. Prequel does the edit — automatic zooms on every click, a framed camera, a background, the dead air trimmed — and still gives you a shareable link. What Loom keeps is the analytics and the integrations.",
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
          "Viewer analytics, comments left on the timeline, the integrations into Slack, Jira and the rest, and the browser and Windows clients. Those are real and Prequel does not replace them. The link and the team workspace you keep — they are the Pro tier. What you gain is that the video is edited rather than raw, that it exists as a file you own, and that recording it never required an upload.",
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
      timeline: "A full multi-track editor",
      separateTracks: true,
      systemAudio: true,
      verticalReframe: "Change the canvas and re-position by hand",
      localOnly: true,
      shareLinks: "Via Screencast Pro",
      workspace: true,
      iosCapture: false,
      maxExport: "4K",
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
    ],
    heading: "Looking for a lighter Camtasia alternative?",
    lede: "Camtasia is a full video editor you drive by hand, sold as an annual subscription whose cheapest tier watermarks your exports. Prequel does the pass a screen recording actually needs, gets out of the way, and is $59 a year with nothing held back.",
    title: "Camtasia alternative for Mac",
    description:
      "A Camtasia alternative for macOS at $59 a year: automatic zooms instead of manual keyframes, and 4K export that is never watermarked — where Camtasia's cheapest tier still stamps one on.",
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
          "Yes. The Starter tier watermarks exported video until you move up a tier. Prequel never watermarks anything, on the trial or on a licence — there is one plan at $59 per user per year and the export is always the full file.",
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
      timeline: "A full multi-track editor",
      separateTracks: true,
      systemAudio: true,
      verticalReframe: "Change the canvas and re-position by hand",
      localOnly: true,
      shareLinks: false,
      workspace: false,
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
    lede: "ScreenFlow is $199.99 and has not had a major version since June 2021. Prequel is $59 a year, and built for the Macs that shipped since.",
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
      timeline: "Transcript-based, plus multi-track",
      separateTracks: true,
      systemAudio: true,
      verticalReframe: true,
      localOnly: "No — projects and media are stored on their servers",
      shareLinks: true,
      workspace: true,
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
    lede: "Descript is built around the transcript and keeps your media on its servers as a condition of working at all. Prequel is built around the screen, records and renders on your Mac, and uploads only when you ask it to.",
    title: "Descript alternative for Mac screen recording",
    description:
      "A Descript alternative for macOS screen recording: automatic zooms, local-only processing and exports that are never watermarked or capped. Compared on price and features.",
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
          "Yes, and it caps them at 720p. Prequel has no free tier to compare against — it is $59 per user per year after a fourteen-day trial — but nothing it exports is ever watermarked or capped, on the trial or after it.",
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
      timeline: true,
      separateTracks: true,
      systemAudio: true,
      verticalReframe: true,
      localOnly: "No — recordings are hosted by Tella",
      shareLinks: true,
      workspace: true,
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
    lede: "Tella is $156 a seat a year and hosts your video. Prequel is $59, renders on your own Mac, and the export is a file you own rather than a page you rent.",
    title: "Tella alternative for Mac",
    description:
      "A Tella alternative for macOS with automatic zooms and 4K 120 export, recorded and rendered locally — at $59 a year against Tella's $156 a seat.",
    navLabel: "vs Tella",
    faq: [
      {
        question: "Does Tella have a free plan?",
        answer:
          "No. Tella's own help pages state it is a paid product with no forever-free plan — there is a seven-day trial, and exporting requires a subscription. Prequel works the same way, with a fourteen-day trial rather than seven and one price at the end of it instead of three tiers.",
      },
      {
        question: "How much does Tella cost?",
        answer:
          "Pro is $13 per user per month and Premium is $19, with Enterprise priced on request. 60 fps export is Premium only. Checked on 21 August 2026.",
      },
      {
        question: "Is Tella better for anything?",
        answer:
          "Distribution, specifically. Custom domains, password protection, calls to action and per-viewer analytics go further than a link and a workspace do, and it runs on Windows and in a browser where Prequel does not. If the hosted page is the product you are buying, that is Tella's ground.",
      },
      {
        question: "Where does Tella process my recordings?",
        answer:
          "In the cloud — every video gets a hosted Tella page. Prequel records and renders on your Mac's own media engine, so nothing is uploaded to produce the file.",
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
