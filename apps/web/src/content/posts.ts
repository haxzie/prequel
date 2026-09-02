/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  This is the file you edit to publish a post.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  1. Write `src/content/blog/<slug>.mdx` — prose only, no frontmatter.
 *  2. Add an entry below whose `slug` is that filename.
 *
 *  Metadata lives here rather than in the MDX because `@next/mdx` does not read
 *  frontmatter, and the alternative — exporting it from each file and importing
 *  every file to build an index — pulls every post's body into the listing
 *  page's bundle. This file *is* the frontmatter; it just lives one directory
 *  up and is typechecked.
 */

import type { FaqEntry } from "@/lib/faq";

export type Post = {
  slug: string;
  title: string;
  excerpt: string;
  /** ISO date. Sorted on, and rendered with `toLocaleDateString`. */
  date: string;
  tag: string;
  readingMinutes: number;
  /**
   * Questions a reader still has at the end, answered under the post.
   *
   * Required rather than optional, which is the whole point: "every post should
   * have an FAQ" as a convention is a thing somebody forgets on the next post
   * and nobody notices for a year. As a non-optional field it is a typecheck
   * failure the moment an entry is added without one.
   *
   * The template renders these *and* emits them as `FAQPage` structured data
   * off the same array, so the visible copy and the JSON-LD cannot drift. An
   * answer that differs between the two is exactly the mismatch search engines
   * penalise, and it happens the first time somebody edits one and not the
   * other.
   *
   * Write answers that stand alone. They are extracted and shown without the
   * post around them, by search engines and by assistants, so an answer that
   * only makes sense after the preceding paragraph is an answer nobody sees.
   */
  faq: FaqEntry[];
  /**
   * The pillar this post sits under, by slug.
   *
   * One field, both directions. The template turns it into a "Part of" link at
   * the top of the post *and* into the list of posts on the pillar page itself,
   * so the two can never disagree. Writing the links by hand in both places is
   * how a cluster ends up with a pillar that forgets one of its posts, and
   * nobody notices because each page looks fine on its own.
   *
   * Absent on a pillar page, which is what makes it a pillar.
   */
  pillar?: string;
};

/** Newest first. `posts` below is sorted, so order here is not load-bearing. */
const ENTRIES: Post[] = [
  {
    slug: "screen-recording-on-mac",
    title: "The complete guide to screen recording on Mac",
    excerpt:
      "Everything we have learned about recording a Mac screen: what macOS can and cannot do on its own, the four decisions that actually change how a recording turns out, and which tool to pick for each.",
    date: "2026-09-02",
    tag: "Guide",
    readingMinutes: 8,
    faq: [
      {
        question: "How do I record my screen on a Mac?",
        answer:
          "Press Cmd+Shift+5 for the built-in toolbar, or open QuickTime Player and choose File then New Screen Recording. Both record the screen and your microphone. Neither captures system audio or your webcam at the same time, so recording with your Mac's own sound or a camera overlay needs a third-party app.",
      },
      {
        question: "Can macOS record the screen and webcam at the same time?",
        answer:
          "No. QuickTime Player and the Cmd+Shift+5 toolbar record a screen capture or a camera movie, never both into one file. Apps that can include Prequel, Screen Studio, Loom, Cap and OBS Studio. Prequel keeps the camera as a separate file, so its size and position stay editable after you stop.",
      },
      {
        question: "Why is there no sound in my Mac screen recording?",
        answer:
          "Because macOS does not expose system audio to the built-in recorders. QuickTime offers you a microphone and nothing else, so the sound coming out of your Mac never reaches the file. Recorders built on ScreenCaptureKit, including Prequel and OBS Studio on Ventura or later, capture it directly with no extra software.",
      },
      {
        question: "What is the best screen recorder for Mac?",
        answer:
          "It depends what the recording is for. OBS Studio if you want free and unlimited and do not mind half an hour of setup. QuickTime or Loom for something quick to a colleague. Prequel if the video is going in front of customers, because it hands back a recording that is already zoomed, framed and edited, at $29 once or $9 a month.",
      },
      {
        question: "How do I record a long screen recording on a Mac?",
        answer:
          "Check the tool's length cap first, since that is where most free tiers stop. Loom and Cap both limit free recordings to five minutes. QuickTime, OBS Studio and Prequel have no cap on the length of a take. For long recordings, disk space and thermal throttling matter more than the app, so record to an internal drive where possible.",
      },
    ],
  },
  {
    slug: "product-demo-videos",
    title: "How to record a product demo video that people finish",
    excerpt:
      "The demo goes on your landing page, in the launch post and in every sales email, and it is usually a one-take screen recording. Here is what we do differently, and most of it happens before you press record.",
    date: "2026-09-02",
    tag: "Guide",
    readingMinutes: 7,
    faq: [
      {
        question: "How long should a product demo video be?",
        answer:
          "Between sixty and ninety seconds for a landing page or launch post. Record loosely and cut hard: remove every pause, page load and moment you spent reading rather than doing. A ninety-second demo that moves is watched to the end far more often than a four-minute one that covers everything.",
      },
      {
        question: "How do I make a screen recording look professional?",
        answer:
          "Three things do most of the work. Zoom in on each action so the viewer knows where to look, cut every pause so the pacing stays tight, and record system audio alongside your narration so the product sounds like software. A camera in the corner during the introduction and close, but small or absent through the dense middle, raises how far people watch.",
      },
      {
        question: "Should I show my face in a product demo?",
        answer:
          "Usually at the start and the end, and not through the detailed middle. A person on screen increases retention, but a fixed bubble in the corner gets in the way once the demo becomes dense. That is only possible if your recorder keeps the camera as a separate layer rather than compositing it into the screen while recording.",
      },
      {
        question: "What software should I use to record a product demo?",
        answer:
          "Loom is built for speed rather than polish and is the wrong choice for a landing page. OBS Studio captures anything and leaves every edit to you. Camtasia and ScreenFlow are manual editors where each zoom is a keyframe you place. Screen Studio, FocuSee and Prequel make the cinematic pass automatically, which removes most of the editing time.",
      },
      {
        question: "What resolution should a product demo be recorded at?",
        answer:
          "Record at your display's full resolution and export at 4K, even if you publish at 1080p. Screen recordings are full of hard edges and small text, which is the hardest case for a video codec, so the extra detail survives compression better. Scale the app or browser up before recording rather than shrinking the video afterwards.",
      },
    ],
  },
  {
    slug: "screen-recording-for-youtube",
    title: "Screen recording for YouTube: settings that survive the upload",
    excerpt:
      "YouTube's encoder is brutal to screen recordings. Here is what to set at capture time so your video still looks sharp after the upload, and what actually keeps people watching once it does.",
    date: "2026-09-02",
    tag: "Guide",
    readingMinutes: 6,
    faq: [
      {
        question: "What resolution should I record my screen at for YouTube?",
        answer:
          "Record at your display's full resolution and export at 4K, even if most viewers watch at 1080p. YouTube gives 4K uploads a better codec and a much higher bitrate, and that quality is passed through to people watching at lower resolutions. Screen recordings benefit more than most footage because hard edges and small text are what compression damages first.",
      },
      {
        question: "What frame rate is best for a YouTube screen recording?",
        answer:
          "Sixty frames per second at minimum, and more if the video contains fast zooms. Screen content sits still and then moves suddenly, which is exactly where 30 fps judders. Many recorders in this category stop at 60 fps; Prequel exports at up to 120 fps on every plan.",
      },
      {
        question: "Why does my screen recording look blurry on YouTube?",
        answer:
          "Almost always because it was uploaded at 1080p or below. YouTube assigns a lower bitrate and an older codec to those tiers, and screen recordings with small text show that loss immediately. Export the same footage at 4K and the 1080p version YouTube serves will look noticeably sharper.",
      },
      {
        question: "Do free screen recorders watermark YouTube videos?",
        answer:
          "Some do. Descript's free tier watermarks exports and caps them at 720p, Camtasia's cheapest tier watermarks, and FocuSee's trial watermarks. OBS Studio and QuickTime never watermark, and Prequel does not watermark on any plan or during its fourteen-day trial.",
      },
      {
        question: "Can I make a YouTube Short from the same screen recording?",
        answer:
          "Yes, if your recorder can reframe rather than crop. Cropping a landscape recording to vertical usually cuts out the thing the video was about. Reframing keeps the whole recording and lets you choose what sits in the vertical frame, so one take produces both the main video and the Shorts cut. Prequel includes every frame preset on both plans.",
      },
    ],
  },
  {
    slug: "screen-recorder-no-watermark-mac",
    title: "Screen recorders for Mac with no watermark",
    excerpt:
      "A watermark is the one limitation you cannot edit around. We checked which Mac screen recorders stamp your exports and which never do, including on their free tiers and trials.",
    date: "2026-09-02",
    tag: "Comparison",
    readingMinutes: 6,
    faq: [
      {
        question: "Which Mac screen recorders have no watermark?",
        answer:
          "Prequel, OBS Studio, QuickTime Player and Cap never watermark exports. Prequel does not watermark on any plan or during its fourteen-day trial and costs $29 once. OBS Studio and QuickTime are free with no watermark and no time limit. Cap does not watermark but caps free recordings at five minutes.",
      },
      {
        question: "Does Camtasia put a watermark on videos?",
        answer:
          "Yes, on its cheapest tier. Camtasia's entry plan stamps a watermark on exported video until you move up a tier. Camtasia is also subscription only and billed annually, since TechSmith stopped selling perpetual licences in early 2025.",
      },
      {
        question: "Does Descript watermark the free plan?",
        answer:
          "Yes. Descript's free tier watermarks exports and caps them at 720p, so anything made while evaluating it cannot be published. Paid plans start at roughly $16 a month billed annually and remove both limits.",
      },
      {
        question: "How do I record my Mac screen without a watermark for free?",
        answer:
          "Use OBS Studio or QuickTime Player. Both are free, neither watermarks, and neither imposes a time limit. OBS also records your webcam and system audio, though it takes about half an hour to set up the first time. QuickTime is instant but cannot record the screen and camera together or capture system audio without a virtual driver.",
      },
      {
        question: "Does a free trial usually watermark exports?",
        answer:
          "It varies, and it is worth checking before you record anything real. FocuSee's trial watermarks its exports. Prequel's fourteen-day trial does not: it is the whole app at 4K up to 120 fps with no watermark, and a video exported during the trial stays yours whether or not you buy.",
      },
    ],
    pillar: "screen-recording-for-youtube",
  },
  {
    slug: "record-mac-screen-with-internal-audio",
    title: "How to record your Mac screen with internal audio",
    excerpt:
      "Your Mac will not record its own sound, and QuickTime cannot do it at all. Here is why, which recorders capture system audio natively, and the BlackHole workaround if you are stuck with QuickTime.",
    date: "2026-09-02",
    tag: "Guide",
    readingMinutes: 6,
    faq: [
      {
        question: "How do I record internal audio on a Mac?",
        answer:
          "Use a recorder built on ScreenCaptureKit, which gets system audio directly with no extra software. Prequel records it as its own separate track alongside the screen, camera and microphone, with nothing to configure. OBS Studio captures it natively on macOS Ventura and later. Cap captures it too, though its free tier caps recordings at five minutes.",
      },
      {
        question: "Why can't QuickTime record system audio?",
        answer:
          "macOS has never exposed system audio to apps through the older recording APIs, so QuickTime's screen recording offers you a microphone and nothing else. Recording the sound coming out of your Mac requires either a virtual audio driver such as BlackHole, or a recorder built on ScreenCaptureKit, the API Apple shipped in macOS 12.3.",
      },
      {
        question: "Do I need BlackHole to record system audio?",
        answer:
          "Only if you are using QuickTime or the Cmd+Shift+5 toolbar. BlackHole creates a virtual output your Mac plays into and a recorder can listen to, which means creating a Multi-Output Device in Audio MIDI Setup so you can still hear the sound, then switching everything back afterwards. Prequel, OBS on Ventura or later, and Cap all capture system audio without it.",
      },
      {
        question: "Can I record system audio and my microphone separately?",
        answer:
          "In Prequel, yes. System audio and your microphone are written as separate tracks with their own waveforms, so you can duck music under your narration, cut one without touching the other, or drop the microphone and keep the app audio. Recorders that mix both into one track make that decision permanent.",
      },
      {
        question: "Does recording system audio reduce quality?",
        answer:
          "Not when it is captured natively. ScreenCaptureKit provides the audio stream directly, so nothing is re-encoded through a loopback device. Routing through a virtual driver such as BlackHole is also lossless, but it changes your Mac's audio routing for the length of the recording, which is the part people forget to undo.",
      },
    ],
    pillar: "screen-recording-on-mac",
  },
  {
    slug: "screen-recorder-webcam-overlay-mac",
    title: "Screen recorders for Mac with a webcam overlay",
    excerpt:
      "macOS cannot put your face on a screen recording, so we went through the apps that can. The real difference is not whether they show your camera, but whether you can still move it after you stop.",
    date: "2026-09-02",
    tag: "Comparison",
    readingMinutes: 6,
    faq: [
      {
        question: "Can macOS record the screen and webcam at the same time?",
        answer:
          "Not on its own. QuickTime Player and the Cmd+Shift+5 toolbar record a screen capture or a camera movie, but never both into one file. Recording your screen with a webcam overlay needs a third-party app such as Prequel, Screen Studio, Loom, Cap or OBS Studio.",
      },
      {
        question: "What is the best screen recorder with a facecam for Mac?",
        answer:
          "Prequel, if the video is going in front of people. It records the camera as a separate file at full resolution, so its position, size and shape are decided after the take rather than before it, and it applies zooms, a perspective tilt and depth of field automatically. It is $29 once or $9 a month with fourteen days free.",
      },
      {
        question: "Can I move the webcam overlay after recording?",
        answer:
          "Only if the recorder kept the camera separate. Loom, OBS, Cap and Screen Studio composite the camera into the screen while recording, so its position and size are permanent once you stop. Prequel writes the screen, camera, microphone and system audio as four separate files, so the camera can be moved, resized, reshaped or removed afterwards with no loss of quality.",
      },
      {
        question: "What is the best free screen recorder with a webcam?",
        answer:
          "OBS Studio, if you will spend about half an hour building the scene: it is free, open source, unlimited and never watermarks. Cap is much easier and has ready-made camera layouts, but its free tier stops recordings at five minutes, as does Loom's.",
      },
      {
        question: "Can I change the shape of the webcam bubble?",
        answer:
          "In most tools you pick a shape before recording and keep it. Prequel treats the camera as its own layer in the editor, so the shape, size, position and shadow are all adjustable after the take, and can change between sections of the same video.",
      },
    ],
    pillar: "screen-recording-on-mac",
  },
  {
    slug: "loom-alternatives-mac",
    title: "The best Loom alternatives for Mac",
    excerpt:
      "People leave Loom for three reasons: the price, the five-minute free cap, or videos that live on someone else's servers. Here is where to go for each, and which one we would actually pick.",
    date: "2026-09-02",
    tag: "Comparison",
    readingMinutes: 7,
    faq: [
      {
        question: "What is the best Loom alternative for Mac?",
        answer:
          "Prequel, if you are sending video to customers rather than colleagues. It records locally and hands back a video that is already edited, with zooms on your clicks and typing, a perspective tilt and a camera you frame after the take. There is no cap on recording length on any plan, against Loom's five minutes on free, and it is $9 a month against Loom's $18, or $29 once.",
      },
      {
        question: "Is there a free alternative to Loom?",
        answer:
          "Cap and OBS Studio. Cap is open source and gives you the same instant-link workflow, though its free tier caps recordings at five minutes, the same limit as Loom's. OBS Studio is free with no limits at all, but has no sharing layer and no editor, so both the link and the edit happen elsewhere.",
      },
      {
        question: "Is there an open source alternative to Loom?",
        answer:
          "Cap. It is open source, offers instant hosted links and a local Studio mode with an editor, and you can point it at your own S3 bucket or Google Drive so recordings stay on infrastructure you control. Note it uses a custom licence rather than a standard OSI one.",
      },
      {
        question: "How much does Loom cost?",
        answer:
          "There is a free Starter plan capped at five minutes a video, then Business at $18 per user per month and Business with AI at $24. Checked on 2 September 2026.",
      },
      {
        question: "Can I download my videos instead of sharing a link?",
        answer:
          "That depends on the tool. Loom, Tella and Descript are built around a hosted page, so the link is the product. Prequel, OBS Studio and Cap's Studio mode all record locally, so you get a file you own and uploading is something you ask for rather than a condition of the recording working.",
      },
    ],
    pillar: "product-demo-videos",
  },
  {
    slug: "open-source-screen-recorders-mac",
    title: "5 best open source screen recorders for Mac",
    excerpt:
      "We went through the open-source screen recorders that actually run on a Mac and still get commits, and here are the five worth your time, with the licence and the last release date for each.",
    date: "2026-09-02",
    tag: "Comparison",
    readingMinutes: 7,
    faq: [
      {
        question: "What is the best open source screen recorder for Mac?",
        answer:
          "OBS Studio. It is GPL-2.0, free, has no watermark or time limit, records screen and webcam together, captures system audio natively on macOS Ventura and later, and is still actively developed with over 75,000 stars on GitHub. The trade is that it has no editor, so zooms, cuts and framing happen in another app afterwards.",
      },
      {
        question: "Is there an open source alternative to Screen Studio?",
        answer:
          "Cap is the closest. It is open source, records locally in Studio mode, and its editor includes automatic zoom, backgrounds and camera layouts. Its free tier caps recordings at five minutes and a commercial desktop licence is $29 a year. Note that Cap uses a custom licence rather than a standard OSI one, so read the terms if licensing is your reason for choosing it.",
      },
      {
        question: "Is Kap still maintained?",
        answer:
          "Not actively. Kap is MIT licensed with around 19,000 GitHub stars, but its last commit was November 2024. The app still runs and the licence lets you fork it, but nobody is shipping fixes. It remains a good choice for short clips and GIFs if that limitation is acceptable.",
      },
      {
        question: "Is Prequel open source?",
        answer:
          "No. Prequel is proprietary, priced at $29 once or $9 a month with a fourteen-day free trial. It is included in this comparison because it produces a finished, directed video rather than raw footage, which none of the open-source options do, but if an auditable licence is a hard requirement then OBS Studio, Cap, Screenity, QuickRecorder and Kap are the genuine options.",
      },
      {
        question: "Can open source screen recorders export in 4K?",
        answer:
          "Yes. OBS Studio exports at whatever resolution and frame rate your Mac can encode, and Cap exports up to 4K at 60 fps. Screenity records at browser tab resolution, and QuickRecorder and Kap are aimed at lighter clips. For 4K at up to 120 fps you need Prequel, which is proprietary.",
      },
    ],
    pillar: "screen-recording-on-mac",
  },
  {
    slug: "screen-recorder-mouse-zoom-mac",
    title: "Screen recorders with automatic mouse zoom for Mac",
    excerpt:
      "We tested the Mac screen recorders that zoom on your cursor automatically, and here is how their zooms actually differ: what triggers them, how the movement feels, and what else moves with them.",
    date: "2026-09-02",
    tag: "Comparison",
    readingMinutes: 6,
    faq: [
      {
        question: "Which Mac screen recorder has automatic mouse zoom?",
        answer:
          "Prequel, Screen Studio, FocuSee, Cap and Tella all zoom automatically or semi-automatically on a Mac. Prequel is the only one that zooms on typing as well as clicks, and the only one that adds a perspective tilt and depth of field to the push-in. It is $29 once or $9 a month with fourteen days free.",
      },
      {
        question: "How does automatic zoom in a screen recording work?",
        answer:
          "The recorder tracks your cursor and your input while it captures, then clusters those moments into zooms when the recording opens in the editor. It pushes in on what you were doing and pulls back out when you move on. There is nothing to set up before you record and no keyframes to place afterwards.",
      },
      {
        question: "Can I edit or remove the automatic zooms?",
        answer:
          "In Prequel, yes. Every generated zoom is an ordinary slice on the timeline, identical to one you add by hand, so you can retime it, point it somewhere else or delete it. Nothing about the automatic pass is baked into the recording.",
      },
      {
        question: "Does zooming into a screen recording make it blurry?",
        answer:
          "It depends on the resolution you capture and export at. Recording a Retina display and exporting at 4K leaves enough detail that a two-times zoom is still sharp. Frame rate matters as much: a fast push-in at 30 fps judders, which is why Prequel exports at up to 120 fps on every plan where most of this category stops at 60.",
      },
      {
        question: "Is there a free screen recorder with auto zoom?",
        answer:
          "Cap is the only genuinely free one, and its free tier caps recordings at five minutes. FocuSee has a trial that watermarks exports. Prequel gives you fourteen days with the whole app and no watermark, then costs $29 once.",
      },
    ],
    pillar: "product-demo-videos",
  },
  {
    slug: "free-screen-recorder-mac-camera",
    title: "Free screen recorders for Mac that record your camera too",
    excerpt:
      "macOS cannot record your screen and webcam at once, so we went through the free tools that can. Here is what each one costs you in setup time, recording length, or a camera you cannot move afterwards.",
    date: "2026-09-02",
    tag: "Comparison",
    readingMinutes: 6,
    faq: [
      {
        question: "Can QuickTime record the screen and webcam at the same time?",
        answer:
          "No. QuickTime Player does a screen recording or a movie recording from your camera, but not both at once and not into the same file. The usual workaround is two separate recordings lined up in an editor afterwards. QuickTime also cannot capture system audio without installing a virtual audio driver.",
      },
      {
        question: "What is the best free screen recorder for Mac with a webcam?",
        answer:
          "OBS Studio, if you are willing to spend half an hour building the scene. It is free, open source, has no watermark or time limit, and records screen and webcam together at whatever quality your Mac can encode. Cap is friendlier and has ready-made camera layouts, but its free tier caps recordings at five minutes.",
      },
      {
        question: "Can I move the webcam overlay after recording?",
        answer:
          "Only if the recorder kept the camera as a separate file. OBS, Loom and most free tools composite the camera into the screen while they record, so its position, size and shape are permanent. Prequel writes the screen, camera, microphone and system audio as four separate files, so the camera can be moved, resized, reshaped or removed afterwards at full quality.",
      },
      {
        question: "Do free screen recorders add a watermark?",
        answer:
          "OBS Studio, QuickTime, Cap and Loom's free plans do not watermark. What they limit instead is length: Cap and Loom both stop free recordings at five minutes. Other tools do watermark their free tiers, including Descript, whose free plan also caps exports at 720p, and FocuSee's trial.",
      },
      {
        question: "How do I record system audio on a Mac?",
        answer:
          "OBS Studio captures system audio natively on macOS Ventura and later, and Prequel records it as its own track. QuickTime cannot, and needs a virtual audio driver such as BlackHole installed to route sound back into it.",
      },
    ],
    pillar: "screen-recording-on-mac",
  },
  {
    slug: "best-screen-recorders-for-mac",
    title: "The 12 best screen recorders for Mac in 2026",
    excerpt:
      "We tried 12 of the best screen recorders for Mac, and here is our ranking: what each one is actually for, what it costs, and the one we reach for ourselves. Every price checked against the vendor's own page.",
    date: "2026-09-02",
    tag: "Comparison",
    readingMinutes: 9,
    faq: [
      {
        question: "What is the best screen recorder for Mac in 2026?",
        answer:
          "Prequel, if the video is going in front of anyone. It records your screen and hands back a video that is already directed: zooms that follow your clicks and typing, a perspective tilt, focus falling away from the subject and a camera you frame after the take. It is $29 once or $9 a month, exports 4K at up to 120 fps with no watermark, and renders on your own Mac. Screen Studio is the closest alternative, Loom is faster for a quick link to a colleague, and OBS is the answer if free is a hard requirement.",
      },
      {
        question: "What is the best free screen recorder for Mac?",
        answer:
          "OBS Studio, or QuickTime Player if you only need to press record and send a file. OBS is free, open source and has no limit on recording length, though it has no editor, so the zooms, cuts and framing are all jobs you take somewhere else afterwards. QuickTime is already installed and records the screen with nothing added, but it cannot capture system audio without a virtual driver.",
      },
      {
        question: "Which Mac screen recorder has automatic zoom?",
        answer:
          "Prequel, Screen Studio and FocuSee all zoom automatically on what you click and type. Prequel additionally adds a perspective tilt and depth of field, and exports at up to 120 fps where Screen Studio stops at 60. FocuSee is the one of the three that also runs on Windows.",
      },
      {
        question: "How much does a Mac screen recorder cost?",
        answer:
          "Anywhere from nothing to $199.99. OBS and QuickTime are free. Prequel is $29 once or $9 a month. Tella is $13 to $19 a month, Loom is $18 to $24 per user per month, Descript is $16 to $50 a month, and ScreenFlow and FocuSee both sell one-off licences at $199.99. Prices were checked against each vendor's own page on 2 September 2026.",
      },
      {
        question: "Do I need a separate video editor?",
        answer:
          "It depends which recorder you pick. OBS, QuickTime and CleanShot X hand you the raw take, so the zooms, cuts and framing happen in another app. Prequel, Screen Studio and FocuSee make that pass while they record, so the recording arrives edited and the timeline is there for changes rather than for building it from nothing.",
      },
      {
        question: "Can I record a screen recording without a watermark?",
        answer:
          "Yes, but not on every tool. Prequel never watermarks anything on either plan or during the fourteen-day trial. Camtasia's cheapest tier watermarks exports until you move up, Descript's free tier watermarks and caps at 720p, and FocuSee's trial watermarks what it exports. OBS and QuickTime are free and never watermark.",
      },
    ],
    pillar: "screen-recording-on-mac",
  },
];

export const posts: Post[] = [...ENTRIES].sort((a, b) => b.date.localeCompare(a.date));

export function findPost(slug: string): Post | undefined {
  return posts.find((post) => post.slug === slug);
}

/** The posts filed under a pillar, newest first. Empty for an ordinary post. */
export function clusterOf(slug: string): Post[] {
  return posts.filter((post) => post.pillar === slug);
}

export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
