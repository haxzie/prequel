/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  This is the file you edit to publish an article.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  1. Write `src/content/articles/<slug>.mdx` — prose only, no frontmatter.
 *  2. Add an entry below whose `slug` is that filename.
 *
 *  An article is a post that is not on the blog. The blog is the set of pages
 *  we would put in front of somebody choosing a recorder: comparisons, buying
 *  guides, the pillars. Articles are everything else worth writing down — a
 *  fix for one symptom, a checklist, a note on one setting — and they are
 *  listed on `/content` beside the glossary rather than at `/blog`, so the
 *  blog index stays the short list it should be.
 *
 *  Same shape as `Post` minus `tag` (they are all "Article") and `pillar`
 *  (they belong to no cluster), plus `topics` for the filters on `/content`.
 */

import type { FaqEntry } from "@/lib/faq";

import type { Topic } from "./topics";

export type Article = {
  slug: string;
  title: string;
  excerpt: string;
  /** ISO date. Sorted on, and rendered with `formatDate` from `posts.ts`. */
  date: string;
  readingMinutes: number;
  /** Where the article is filed on `/content`. One or two. */
  topics: Topic[];
  /**
   * The quote card whose picture is the article's social card, by slug in
   * `public/blog/quotes/`.
   *
   * An article about what people post on Reddit or GitHub is shared with a
   * picture of that post, and a title on a dark panel is not that. Optional,
   * because an article with no thread behind it has nothing to show, and a
   * card drawn from a post that is not about the subject would be a
   * decoration pretending to be evidence. The route reads
   * `public/articles/og/<slug>.png`: Satori cannot decode WebP, so each card
   * used here has a PNG beside it.
   */
  reference?: string;
  /**
   * Other articles worth reading next, by slug.
   *
   * Listed under the FAQ. Written by hand and checked in both directions by
   * `scripts/check-articles.sh`: a link that goes one way leaves the page it
   * points at looking orphaned to a reader who arrived there first.
   */
  related?: string[];
  /**
   * Required, for the reason `Post.faq` is: the page renders it and emits
   * `FAQPage` off the same array, and an optional field is the one that gets
   * left off the next entry.
   */
  faq: FaqEntry[];
};

const ENTRIES: Article[] = [
  {
    slug: "cap-cpu-memory-recording",
    title: "Why Cap uses so much CPU and memory while recording",
    excerpt:
      "Cap's issue about memory climbing past 5 GB has been open since October 2024 with a $350 bounty. What the maintainers reproduced, three related CPU and heat reports that were closed as reworked, and how to check your own recording.",
    date: "2026-10-05",
    readingMinutes: 4,
    topics: ["fixes", "recording"],
    reference: "cap-109-cpu-memory",
    related: [
      "screen-studio-overheating",
      "cap-crash-lost-recording",
      "cap-export-problems",
      "how-to-cancel-cap",
      "cap-no-microphone-audio",
      "cap-window-capture-region",
    ],
    faq: [
      {
        question: "Why does Cap use so much memory while recording?",
        answer:
          "Cap's maintainer filed an issue in October 2024 saying some users saw memory creep to 5 GB or more in recordings longer than about two minutes. He reproduced it himself on an iMac with 8 GB, where memory passed 8 GB and the app crashed. That issue is still open.",
      },
      {
        question: "Is the Cap high CPU problem fixed?",
        answer:
          "Partly, according to the maintainers. Three related issues about CPU use and heat were closed in August 2026 with a note that recording performance on macOS had been substantially reworked and should be re-tested on the latest version. The memory issue, number 109, remains open.",
      },
      {
        question: "Does Cap use the GPU to encode video?",
        answer:
          "A Cap developer said in 2025 that it encodes display video through VTEncoder in AVFoundation because that is meant to be hardware accelerated, and that 4K might need different configuration. In August 2026 the maintainer said hardware encoder usage had been substantially reworked.",
      },
      {
        question: "How do I check how much memory my screen recorder uses?",
        answer:
          "Open Activity Monitor, choose the Memory tab and sort by memory while you record for several minutes. Watch the recorder and its helper processes, because the total is what your Mac is paying.",
      },
      {
        question: "Which Mac screen recorder encodes with the hardware encoder?",
        answer:
          "Prequel encodes with VideoToolbox, the Mac's hardware video encoder, and composes frames with Metal. It needs an Apple Silicon Mac on macOS 14 or later.",
      },
    ],
  },
  {
    slug: "cap-crash-lost-recording",
    title: "Cap crashed mid-recording: what you can recover",
    excerpt:
      "Cap's WriterFailed crash was reported for months and the maintainer says it was fixed in August 2026. What caused it for different users, what to keep and where the logs are, and how to avoid losing a take.",
    date: "2026-10-05",
    readingMinutes: 4,
    topics: ["fixes", "recording"],
    reference: "cap-1535-writerfailed",
    related: [
      "loom-lost-recording-recovery",
      "cap-cpu-memory-recording",
      "cap-no-microphone-audio",
      "cap-export-problems",
      "how-to-cancel-cap",
      "cap-window-capture-region",
    ],
    faq: [
      {
        question: 'Why did Cap crash with "Task mux-video failed"?',
        answer:
          "The error read Task mux-video failed: Error queueing video frame, WriterFailed. Users hit it one to 15 minutes in. One traced it to a combination of display scaling and the audio input device, and another hit it recording camera only in studio mode. Cap's maintainer said in August 2026 that the instant mode muxer had been fixed.",
      },
      {
        question: "Can I recover a Cap recording after a crash?",
        answer:
          "Do not delete the .cap folder. In one Windows report the folder was left without project-config.json and only orphaned DASH segments, which is the state to keep for a bug report. Cap's desktop logs on a Mac are in ~/Library/Logs/so.cap.desktop.",
      },
      {
        question: "Has Cap fixed the WriterFailed crash?",
        answer:
          "Its maintainer said on 2 August 2026 that the instant mode muxer and microphone recovery handling were fixed, which addressed this crash, and that it should be in the latest release. He asked anyone still seeing it to reopen the issue.",
      },
      {
        question: "How do I avoid losing a screen recording to a crash?",
        answer:
          "Record a 15-second test with your exact setup first, play it back, and keep the app and macOS up to date. For long sessions, check the file after the first few minutes rather than at the end.",
      },
      {
        question: "Where does Prequel keep a recording while it is made?",
        answer:
          "In a folder under ~/Movies/Prequel on your Mac, as ordinary files for the screen, camera, microphone and system audio. It needs an Apple Silicon Mac on macOS 14 or later.",
      },
    ],
  },
  {
    slug: "cap-no-microphone-audio",
    title: "Why Cap recorded no microphone audio",
    excerpt:
      "The microphone meter moved, and the file had no audio. The pattern 19 comments on Cap's issue 1740 found, which modes were affected, the toggle workaround, the maintainer's fix, and how to check before a long take.",
    date: "2026-10-05",
    readingMinutes: 3,
    topics: ["fixes", "recording"],
    reference: "cap-1740-no-microphone",
    related: [
      "cap-cpu-memory-recording",
      "cap-crash-lost-recording",
      "screen-recording-audio-out-of-sync",
      "cap-export-problems",
      "cap-window-capture-region",
    ],
    faq: [
      {
        question: "Why is there no microphone audio in my Cap recording?",
        answer:
          "Users on Cap's issue 1740 saw the microphone shown as active during recording and no waveform in the studio afterwards. Reports pointed to camera-only, area and display modes, and to a second recording in a session. Cap's maintainer closed it on 30 June 2026 saying there should be no audio issues in the latest versions.",
      },
      {
        question: "How do I know whether Cap recorded my audio?",
        answer:
          "Open the .cap package after a test recording and look in segment-0 for an audio file. One user found no audio file there and no mention of one in the recording metadata. Another saw has_audio=false in the logs.",
      },
      {
        question: "Does Cap record system audio in camera-only mode?",
        answer:
          "A user who confirmed version 0.5.1 fixed the lost-audio problem added that system audio does not record in camera-only mode, but does in the screen capture modes.",
      },
      {
        question: "How do I check my microphone is recording before a long take?",
        answer:
          "Record 10 seconds, play it back with sound, and check the waveform in the editor. In Prequel the microphone's icon fills with the live level while it is on, and the Audio panel shows the microphone track once the take exists. It needs an Apple Silicon Mac on macOS 14 or later.",
      },
    ],
  },
  {
    slug: "cap-export-problems",
    title: "Cap's export flickers, or never finishes",
    excerpt:
      "Three open Cap issues about export: flickering and lag in the exported file, an export stuck at the last frame, and a panic before rendering starts. Which macOS and Cap versions, what users tried, and what is still open.",
    date: "2026-10-05",
    readingMinutes: 3,
    topics: ["export", "fixes"],
    reference: "cap-1557-flicker",
    related: [
      "screen-studio-export-slow",
      "cap-cpu-memory-recording",
      "cap-crash-lost-recording",
      "cap-no-microphone-audio",
      "cap-window-capture-region",
      "how-to-cancel-cap",
    ],
    faq: [
      {
        question: "Why does my Cap export flicker?",
        answer:
          "Issue 1557, open since January 2026, reports exported video that flashes constantly and plays back at a low frame rate. Users say the editor looks fine and the problem appears only in the exported file. One suggested workaround is downgrading to version 0.4.0 and re-exporting.",
      },
      {
        question: "Why is my Cap export stuck at the last frame?",
        answer:
          "A user on a Mac mini M4 Pro running macOS 26.2 reported that Cap 0.5.1 could not export any video and stuck at the last frame when finishing. The issue, number 1940, is open.",
      },
      {
        question: "Does Cap export fail on macOS 26?",
        answer:
          "Issue 2163 reports that on macOS 26.3, version 0.5.9 panics before rendering starts because the save panel returns null, freezing the editor so a GUI export is impossible. It was opened on 29 August 2026 and is open.",
      },
      {
        question: "What is a screen recorder that exports on the Mac's video hardware?",
        answer:
          "Prequel renders each export with Metal and encodes with VideoToolbox, shows progress on the Export button and lets you keep editing while it runs. It needs an Apple Silicon Mac on macOS 14 or later.",
      },
    ],
  },
  {
    slug: "cap-window-capture-region",
    title: "Why Cap records what's on top of your window",
    excerpt:
      "Cap's window capture can record the screen region a window occupies, so another window dragged over it appears in the video. Issue 1754, a user who lost an hour-long workshop, and what Prequel's Window mode records.",
    date: "2026-10-05",
    readingMinutes: 3,
    topics: ["recording", "fixes"],
    reference: "cap-1754-window-capture",
    related: [
      "cap-cpu-memory-recording",
      "cap-crash-lost-recording",
      "cap-no-microphone-audio",
      "cap-export-problems",
    ],
    faq: [
      {
        question: "Why does Cap record other windows when I choose one window?",
        answer:
          "Issue 1754 reports that Cap captures the screen region the chosen window occupies, not the window's own content. Switching tabs or moving another window over the top is then recorded. A comment on the issue describes Cap as using display capture with crop bounds.",
      },
      {
        question: "Is the Cap window capture bug fixed?",
        answer:
          "No. Issue 1754 was opened on 22 April 2026 and was still open on 5 October 2026. A user reported on 23 August that it still reproduced with Cap's bundled command-line tool, and another on 3 September.",
      },
      {
        question: "What happens if I move the window while Cap records it?",
        answer:
          "A user reported moving the target window about 120 pixels at the start of a workshop and finding after an hour that the whole session was ruined and had to be recorded again, because Cap kept recording the original region.",
      },
      {
        question: "What does Prequel's Window mode record?",
        answer:
          "One window, wherever it moves. Choose Window on the dock, click a window and press Start recording. It needs an Apple Silicon Mac on macOS 14 or later.",
      },
    ],
  },
  {
    slug: "how-to-cancel-cap",
    title: "How to cancel Cap Pro or the Cap Desktop Licence",
    excerpt:
      "Cap has a free plan, a Desktop Licence and Cap Pro. What each costs, what its own site says about cancelling, what it does not document, and what happens to your recordings and shared links. Checked 5 October 2026.",
    date: "2026-10-05",
    readingMinutes: 3,
    topics: ["pricing"],
    related: [
      "cap-cpu-memory-recording",
      "cap-crash-lost-recording",
      "cap-export-problems",
      "how-to-cancel-a-screen-recorder-subscription",
    ],
    faq: [
      {
        question: "How do I cancel Cap Pro?",
        answer:
          "Cap's pricing page says you can cancel anytime but gives no click path, and its documentation has no billing section. The only billing address it states is the organisation settings in your dashboard, labelled for managing add-ons. If you cannot find it, email hello@cap.so.",
      },
      {
        question: "Do my Cap recordings disappear if I cancel Pro?",
        answer:
          "No. Cap says your recordings are yours forever, that existing shares remain active if you cancel Pro, and that you can always export everything. It says you can drop to the free plan to keep recording locally.",
      },
      {
        question: "Does Cap offer refunds?",
        answer:
          "Its terms of service, last updated on 24 April 2024, contain no refund, cancellation or billing clause. The terms say Cap may terminate your access at any time. Any promise about refunds would be on the pricing page, so ask before you pay.",
      },
      {
        question: "How much does Cap cost?",
        answer:
          "Free for personal use. The Desktop Licence is $29 a year per licence, or $58 once for one that never renews. Cap Pro is $12 per user a month, or $8.16 a month billed annually. SAML SSO is $199 a month and a signed BAA is $99 a month.",
      },
      {
        question: "Is there a Mac screen recorder with nothing to cancel?",
        answer:
          "Prequel's lifetime licence is $29 once, with no renewal and nothing to cancel. The subscription is $9 a month, after a 7-day free trial with the whole app in it. It needs an Apple Silicon Mac on macOS 14 or later.",
      },
    ],
  },
  {
    slug: "loom-bill-went-up",
    title: "Why your Loom bill went up, and how to leave",
    excerpt:
      "Loom's billing moved to Atlassian and free Creator Lite seats became paid ones. What changed, what people report paying, the step that stops the charge before the next invoice, and what to use if you are leaving.",
    date: "2026-10-05",
    readingMinutes: 4,
    topics: ["pricing"],
    reference: "loom-atlassian-opt-out-billing",
    related: [
      "how-to-cancel-loom",
      "loom-free-plan-limits",
      "loom-login-atlassian",
      "how-to-cancel-a-screen-recorder-subscription",
      "download-loom-video-mp4",
    ],
    faq: [
      {
        question: "Why did my Loom bill go up in 2026?",
        answer:
          "Atlassian took over Loom's billing and discontinued the free Creator Lite role. Loom's migration page says every Creator Lite user is upgraded to a full, paid Creator on the date the workspace moves, and any user not deactivated by the next billing date goes onto that invoice.",
      },
      {
        question: "How do I stop Loom charging me for Creator Lite seats?",
        answer:
          "Deactivate the users you do not want to pay for before your next billing date. Downgrading does not help in time, because Loom says a downgrade takes effect at the next renewal date, which is when you are billed. Deactivating a user takes effect immediately.",
      },
      {
        question: "Can I keep my old Loom price?",
        answer:
          "Loom's migration page answers this directly: no, you cannot stay on your current pricing once the workspace has moved to Atlassian billing.",
      },
      {
        question: "Will I lose my videos if I leave Loom?",
        answer:
          "Not on cancelling. Loom says that if your video count is over 25 you keep access to all of your videos after dropping to the free Starter plan, but you cannot record new ones until you delete down to the limit or upgrade. Deleting your account is different: it deletes every video and cannot be undone.",
      },
      {
        question: "What can I use instead of Loom on a Mac?",
        answer:
          "Prequel records your screen and camera, edits the take and exports an MP4 on your Mac, with a 7-day free trial and no watermark. After the trial it is $9 a month or $29 once. It needs an Apple Silicon Mac on macOS 14 or later.",
      },
    ],
  },
  {
    slug: "how-to-cancel-loom",
    title: "How to cancel Loom, including after the Atlassian move",
    excerpt:
      "Loom now has two cancellation routes: Atlassian Administration and Loom's own settings. How to tell which you are on, the clicks for each, what you lose, and why downgrading does not stop the charge. Checked 5 October 2026.",
    date: "2026-10-05",
    readingMinutes: 5,
    topics: ["pricing"],
    reference: "loom-bill-18-to-220",
    related: [
      "loom-bill-went-up",
      "loom-free-plan-limits",
      "download-loom-video-mp4",
      "loom-login-atlassian",
      "how-to-cancel-a-screen-recorder-subscription",
    ],
    faq: [
      {
        question: "How do I cancel my Loom subscription?",
        answer:
          'It depends on your account. If Loom\'s workspace settings say "Loom is now a part of Atlassian", cancel in Atlassian Administration under Billing, then Subscriptions. If not, cancel in Loom under Plan and Billing, then Manage Subscription, then Downgrade to Starter.',
      },
      {
        question: "Why does Loom say I do not have permission to cancel?",
        answer:
          "Loom says only Atlassian billing admins and Atlassian organisation admins can cancel an Atlassian-managed Loom subscription. If you are not one of them, the person who set up billing has to do it, or has to make you one.",
      },
      {
        question: "Will Loom refund me if I cancel?",
        answer:
          "No. Loom's billing policy says a prorated refund for unused time is not issued, and that you keep premium features until the end of your billing cycle. On annual plans it says no refund or credit is processed.",
      },
      {
        question: "What happens to my Loom videos when I cancel?",
        answer:
          "They are kept. Loom says that if you have more than 25 videos you still have access to all of them, but you cannot record new ones until you delete down to 25 or upgrade. Deleting the account is separate and permanently deletes every video.",
      },
      {
        question: "Does deleting my Loom account cancel the subscription?",
        answer:
          "Yes, Loom says deleting the account cancels any paid subscription, but it also deletes all of your videos and view counts and they cannot be recovered. Download anything you need first.",
      },
    ],
  },
  {
    slug: "loom-lost-recording-recovery",
    title: "Loom crashed and lost your recording: what you can get back",
    excerpt:
      "Loom's own help pages say what can be recovered. Desktop recordings sometimes, Chrome extension and mobile recordings never. The page to try first, the folder to check on a Mac, and how to lower the risk.",
    date: "2026-10-05",
    readingMinutes: 3,
    topics: ["fixes", "recording"],
    reference: "loom-ongoing-bugs",
    related: [
      "loom-stuck-in-processing",
      "loom-video-quality",
      "cap-crash-lost-recording",
      "loom-login-atlassian",
    ],
    faq: [
      {
        question: "Can I recover a Loom recording that crashed?",
        answer:
          "Sometimes. Loom says recordings made with its desktop app may be recoverable from files stored on your computer. Recordings made with the Chrome extension or the mobile apps have no recovery method, according to Loom's help pages.",
      },
      {
        question: "Where does Loom store unfinished recordings on a Mac?",
        answer:
          "In ~/Movies/Loom/Temporary/, in a folder named after the video ID. In Finder, choose Go, then Go to Folder, and paste that path. On Windows the folder is %userprofile%\\Videos\\Loom\\Temporary\\.",
      },
      {
        question: "How long should I wait before treating a Loom video as lost?",
        answer:
          "Loom says to wait at least 30 minutes and not close the tab until the video plays. It also says a recording that has not processed after 24 hours is filtered out of your dashboard view.",
      },
      {
        question: "How often does Loom lose a recording?",
        answer:
          "Loom says a crash during recording or a video stuck in processing happens to less than 0.1% of all videos. That is a small share of a very large number of recordings, and a certain loss for the person it happens to.",
      },
      {
        question: "Which Mac screen recorder keeps recordings on disk while it records?",
        answer:
          "Prequel keeps each take as a folder under ~/Movies/Prequel on your Mac, with the screen, camera, microphone and system audio as separate files, and does not need the internet to record or export. It needs an Apple Silicon Mac on macOS 14 or later.",
      },
    ],
  },
  {
    slug: "loom-stuck-in-processing",
    title: "Loom stuck in processing: how to recover your video",
    excerpt:
      "How long Loom takes to process a video, when to stop waiting, and Loom's own steps for the desktop app, the Chrome extension and mobile. What the failed upload message means and where the files are.",
    date: "2026-10-05",
    readingMinutes: 3,
    topics: ["fixes"],
    reference: "loom-ongoing-bugs",
    related: [
      "loom-lost-recording-recovery",
      "loom-video-quality",
      "tella-export-stuck",
      "download-loom-video-mp4",
    ],
    faq: [
      {
        question: "How long should a Loom video take to process?",
        answer:
          "Loom says on a strong, stable connection a video under 10 minutes at 720p should not take more than a few minutes. Longer videos, higher quality and slow upload all add time, and Loom recommends at least 5 Mbps of upload speed.",
      },
      {
        question: "What do I do if my Loom video is stuck in processing?",
        answer:
          "Wait at least 30 minutes without closing the tab. For the desktop app, quit and reopen it and try loom.com/recover-videos with the video ID. For the Chrome extension and mobile apps, Loom says there is no recovery method.",
      },
      {
        question: 'What does "We experienced an error while uploading your video" mean?',
        answer:
          "Loom says it usually means your internet connection was interrupted and the upload failed. On a Mac, some of the video may still be in ~/Movies/Loom/Temporary/ in a folder named after the video ID.",
      },
      {
        question: "Why did my Loom video disappear from my dashboard?",
        answer:
          "Loom says a recording that has not processed successfully after 24 hours is filtered out of your dashboard view. The files for a desktop recording may still be on your computer.",
      },
      {
        question: "Can Prequel get stuck processing a video?",
        answer:
          "Prequel does not upload to make a video. It records and exports on your Mac, and the export button fills as it renders. Uploading is a separate step you choose, after the file exists. It needs an Apple Silicon Mac on macOS 14 or later.",
      },
    ],
  },
  {
    slug: "loom-free-plan-limits",
    title: "Loom's free plan limits: five minutes and 25 videos",
    excerpt:
      "What Loom's free Starter plan allows, what counts toward the 25 videos, what happens when you hit the limit, and the ways around it. Plus what changes if you downgrade from a paid plan.",
    date: "2026-10-05",
    readingMinutes: 2,
    topics: ["pricing"],
    reference: "loom-five-minutes",
    related: [
      "loom-bill-went-up",
      "how-to-cancel-loom",
      "download-loom-video-mp4",
      "tella-no-free-plan",
    ],
    faq: [
      {
        question: "How long can I record on Loom's free plan?",
        answer: "Five minutes per video. Loom's Starter plan caps each recording at five minutes.",
      },
      {
        question: "How many videos can I have on Loom's free plan?",
        answer:
          "Up to 25 videos and screenshots. Loom says the video count includes archived videos, so archiving does not free space.",
      },
      {
        question: "What happens when I reach 25 videos on Loom?",
        answer:
          "You can still watch and share your videos but you cannot record new ones until you delete some or upgrade. Loom says that if your count is over 25 after a downgrade you keep access to every video.",
      },
      {
        question: "Is there a screen recorder with no time limit on a Mac?",
        answer:
          "Yes. Prequel has no length cap on a recording and no watermark on exports, with a 7-day free trial and then $9 a month or $29 once. It needs an Apple Silicon Mac on macOS 14 or later.",
      },
    ],
  },
  {
    slug: "download-loom-video-mp4",
    title: "How to download a Loom video as an MP4",
    excerpt:
      "Loom only offers downloads on its two top paid plans, and asks for a wait before the file is ready. Who can download, why the button is missing, and the cleanest route if you are on the free plan.",
    date: "2026-10-05",
    readingMinutes: 2,
    topics: ["export", "sharing"],
    related: [
      "loom-bill-went-up",
      "how-to-cancel-loom",
      "loom-stuck-in-processing",
      "loom-free-plan-limits",
    ],
    faq: [
      {
        question: "Why can't I download my Loom video?",
        answer:
          "Loom's help page says downloads are only available to admins and creators in a Business or Business + AI workspace, and to admins and members in an Enterprise workspace. On the free Starter plan the option is not offered.",
      },
      {
        question: "Why does Loom say my video is not available for download yet?",
        answer:
          "Loom prepares the file after the video finishes processing and says it can take around 30 minutes before the download is ready. Wait and try again.",
      },
      {
        question: "Can I download my Loom videos before I cancel?",
        answer:
          "Yes, and you should. Once you downgrade to the free Starter plan the download option goes with the paid tier, so download everything you need while you still have access.",
      },
      {
        question: "How do I get a video file out of a recorder without an upload step?",
        answer:
          "Use a recorder that saves the file on your Mac. Prequel exports an MP4 to a place you choose, and exports to your own Mac are never counted, never expire and have no limit. It needs an Apple Silicon Mac on macOS 14 or later.",
      },
    ],
  },
  {
    slug: "loom-login-atlassian",
    title: "Can't log in to Loom since the Atlassian move",
    excerpt:
      "Login loops, a support form that asks for a workspace URL you cannot see, and an account that is now an Atlassian one. The fix a user reported that worked, and how to tell which login you need.",
    date: "2026-10-05",
    readingMinutes: 3,
    topics: ["fixes"],
    reference: "loom-login-takeover",
    related: [
      "loom-bill-went-up",
      "how-to-cancel-loom",
      "loom-lost-recording-recovery",
      "loom-video-quality",
    ],
    faq: [
      {
        question: "Why does Loom keep redirecting me when I try to log in?",
        answer:
          "Since the move to Atlassian, Loom signs in through Atlassian's single sign-on, and stale session data on atlassian.com can send the page round in a loop. A user on r/atlassian said clearing local storage, session storage and cookies for atlassian.com and id.atlassian.com got them out of it.",
      },
      {
        question: "Is my Loom account an Atlassian account now?",
        answer:
          'Loom says you are in Atlassian if you signed up after February 2026, or if your older account has been integrated. Your Loom account settings page says "Your Profile is linked to Atlassian" if so.',
      },
      {
        question: "Why does Loom support ask for a workspace URL?",
        answer:
          "Its contact form asks for one. People who cannot log in do not know theirs, which a user on r/atlassian named as a problem that did not exist before Atlassian. A teammate who can still sign in can read it from their address bar.",
      },
      {
        question: "Who can cancel a Loom subscription after the move?",
        answer:
          "Only Atlassian billing admins and organisation admins can cancel an Atlassian-managed Loom subscription, according to Loom's documentation.",
      },
    ],
  },
  {
    slug: "loom-video-quality",
    title: "Why your Loom recording isn't the quality you set",
    excerpt:
      "Users report Loom recordings that go fuzzy after pausing, a 1080p setting that does not hold, and a webcam that lags only on an external camera. What they saw, and how to record at the full size of your screen instead.",
    date: "2026-10-05",
    readingMinutes: 3,
    topics: ["recording", "fixes"],
    reference: "loom-ongoing-bugs",
    related: ["loom-lost-recording-recovery", "loom-stuck-in-processing", "loom-login-atlassian"],
    faq: [
      {
        question: "Why does my Loom video look blurry?",
        answer:
          "A user on r/techsupport reported Loom video going fuzzy after using the pause feature, and the quality not always matching a preset of 1080p. A blurry result can also come from recording at fewer pixels than your screen has, which the page on blurry screen recordings explains.",
      },
      {
        question: "Does pausing a Loom recording lower the quality?",
        answer:
          "One user documented exactly that on r/techsupport: video quality going fuzzy after using Loom's pause feature. Loom support classed it as an ongoing bug, according to the same post. It is one report from 2022, so check on your current version.",
      },
      {
        question: "Why is my webcam laggy in Loom?",
        answer:
          "The same r/techsupport poster saw laggy video only with a Logitech webcam, not the MacBook's built-in camera, starting on a specific date. Try the built-in camera to see whether the lag follows the device.",
      },
      {
        question: "What resolution does Prequel record at?",
        answer:
          "Up to 4K. Prequel records at the display's full pixel size and exports at that size or scaled to 1080p, 720p or 480p. It needs an Apple Silicon Mac on macOS 14 or later.",
      },
    ],
  },
  {
    slug: "screencharm-subscription-refund",
    title: "Screen Charm refund and cancellation: it is $79 once",
    excerpt:
      "Screen Charm has no subscription to cancel. What its terms say about the $79 lifetime price, the 14-day refund and how to ask for one, the Apple Silicon requirement that caught one buyer, and how the one-off price compares.",
    date: "2026-10-05",
    readingMinutes: 3,
    topics: ["pricing"],
    reference: "screen-charm-show-hn",
    related: [
      "screen-studio-without-subscription",
      "screen-studio-lifetime-licence",
      "how-to-cancel-a-screen-recorder-subscription",
      "tella-no-free-plan",
    ],
    faq: [
      {
        question: "Does Screen Charm have a subscription?",
        answer:
          "No. Screen Charm's terms, last updated on 31 January 2026, say the lifetime deal costs $79 and gives unlimited access to video export features with no recurring fees. Its site says no subscription and no renewals.",
      },
      {
        question: "How do I get a Screen Charm refund?",
        answer:
          "Its terms offer a full refund within 14 days of purchase, no questions asked. You request it by emailing the address given on its terms page.",
      },
      {
        question: "What Macs does Screen Charm run on?",
        answer:
          "Apple Silicon only, on macOS Sonoma 14.0 or later. A buyer on r/SideProject wrote that they bought it before trying it and found their older Intel Mac could not run it, and a reply in the thread said the refund had been made.",
      },
      {
        question: "Can I try Screen Charm before paying?",
        answer:
          "Screen Charm says its free tier records, and that export is what needs the lifetime licence.",
      },
      {
        question: "What is a Mac screen recorder I can pay for once?",
        answer:
          "Prequel's lifetime licence is $29 once, with no renewal and nothing to cancel, after a 7-day free trial with the whole app. It needs an Apple Silicon Mac on macOS 14 or later.",
      },
    ],
  },
  {
    slug: "screen-recording-audio-out-of-sync",
    title: "Why your screen recording's audio drifts out of sync",
    excerpt:
      "A fixed delay and a drift have different causes. What Tella, Cap and Screen Charm document about microphone, camera and cursor sync, a clap test that tells the two apart, and what to change.",
    date: "2026-10-05",
    readingMinutes: 4,
    topics: ["audio", "fixes"],
    reference: "tella-lag-sound-image",
    related: [
      "cap-no-microphone-audio",
      "tella-audio-out-of-sync",
      "tella-system-audio-not-recording",
    ],
    faq: [
      {
        question: "Why is my screen recording's audio out of sync?",
        answer:
          "Usually because two devices record on separate clocks. Tella's help centre says a microphone and camera deliver to the computer at slightly different rates. A Bluetooth headset or a USB interface adds delay of its own, and a long recording can let a small difference grow.",
      },
      {
        question: "How do I tell sync drift from a fixed delay?",
        answer:
          "Record 20 seconds, clap at the start and again at the end, and compare both claps against the picture. The same gap both times is a fixed delay. A gap that grows is drift.",
      },
      {
        question: "Does audio sync get worse in longer recordings?",
        answer:
          "It can. A Cap user reported that the cursor was synchronised at the start of a recording and drifted out of sync once it ran past about five minutes, and a Cap contributor who diagnosed it wrote that the frame's own timestamp is thrown away after capture.",
      },
      {
        question: "Can I fix out of sync audio after recording?",
        answer:
          "Tella's help centre says it cannot be fixed in its editor and the fix is to re-record. In tools that let you offset a track, a fixed delay can be corrected. Drift needs the cause removed.",
      },
      {
        question: "Does Prequel record audio as separate tracks?",
        answer:
          "Yes. The microphone, the Mac's system audio and the camera are separate files, and a manifest records when each started. It needs an Apple Silicon Mac on macOS 14 or later.",
      },
    ],
  },
  {
    slug: "how-to-cancel-a-screen-recorder-subscription",
    title: "Where the cancel button is in every screen recorder",
    excerpt:
      "Loom cancels in Atlassian, Tella in Stripe, Screen Studio in Lemon Squeezy, and Cap does not say. Where each cancel control lives, when access ends, who refunds, and the one rule that applies to all of them: export first. Checked 5 October 2026.",
    date: "2026-10-05",
    readingMinutes: 4,
    topics: ["pricing"],
    reference: "loom-bill-18-to-220",
    related: [
      "loom-bill-went-up",
      "how-to-cancel-loom",
      "how-to-cancel-screen-studio",
      "how-to-cancel-cap",
      "how-to-cancel-tella",
      "screencharm-subscription-refund",
    ],
    faq: [
      {
        question: "Where do I cancel Loom, Tella and Screen Studio?",
        answer:
          "Loom cancels in Atlassian Administration for accounts that moved, or in Loom's settings for older ones. Tella cancels in a Stripe portal opened from its Plans and Billing settings. Screen Studio cancels through Lemon Squeezy, on its orders page.",
      },
      {
        question: "Which screen recorders give refunds?",
        answer:
          "Tella refunds a first purchase within 14 days, plus billing errors and accidental renewals reported within 7 days. Screen Charm refunds within 14 days by email. Loom and Screen Studio both state that fees are not refunded.",
      },
      {
        question: "What happens to my videos when I cancel a screen recorder?",
        answer:
          "It varies. Loom and Tella keep them but stop new recording or export. Screen Studio's files are on your Mac and the app licence ends. Cap says shares stay active and you can always export everything.",
      },
      {
        question: "What should I do before cancelling any screen recorder?",
        answer:
          "Export every video you want as a file, cancel before the renewal date because refunds are rare, check for a second account that bills separately, and keep the confirmation email.",
      },
      {
        question: "Is there a screen recorder with nothing to cancel?",
        answer:
          "Prequel's lifetime licence is $29 once, with no renewal and nothing to cancel, and exports to your own Mac are never counted and never expire. It needs an Apple Silicon Mac on macOS 14 or later.",
      },
    ],
  },
  {
    slug: "screen-studio-export-slow",
    title: "Why Screen Studio exports take so long",
    excerpt:
      "Users report a 10-minute recording taking about half an hour to export. What they say, what drives export time in any Mac recorder, what you can change, and how Prequel renders on the Mac's video hardware.",
    date: "2026-10-05",
    readingMinutes: 3,
    topics: ["export", "fixes"],
    related: [
      "screen-studio-overheating",
      "cap-export-problems",
      "tella-export-stuck",
      "screen-studio-zoom-too-much",
    ],
    faq: [
      {
        question: "Why is Screen Studio export so slow?",
        answer:
          "One user on r/screenrecorders said that for every 10 minutes of recording they spend about half an hour exporting. Export time depends on the length, the resolution, the frame rate, how many effects are drawn on each frame, and whether encoding runs on the Mac's video hardware.",
      },
      {
        question: "How can I make a screen recording export faster?",
        answer:
          "Export a review copy at a lower resolution and frame rate, keep the Mac plugged in and close other apps. Final exports at full size take longest, so do them last.",
      },
      {
        question: "Does Screen Studio export 4K?",
        answer:
          "Yes. Screen Studio exports up to 4K at 60 fps. A 4K export has more pixels to compose and encode than a 1080p one, so it takes longer on the same Mac.",
      },
      {
        question: "Does Prequel export on the GPU?",
        answer:
          "Prequel composes each frame with Metal and encodes with VideoToolbox, the Mac's hardware video encoder. The export runs while you keep editing and closing the dialog does not stop it. It needs an Apple Silicon Mac on macOS 14 or later.",
      },
    ],
  },
  {
    slug: "screen-studio-overheating",
    title: "Why Screen Studio makes your MacBook run hot",
    excerpt:
      "A r/mac thread with 376 upvotes shows a MacBook Air M3 reaching 101°C while Screen Studio rendered a 3-minute 1080p export. What the poster measured, why exports are heavy, and what to change.",
    date: "2026-10-05",
    readingMinutes: 3,
    topics: ["export", "fixes"],
    reference: "screen-studio-101c",
    related: [
      "screen-studio-export-slow",
      "cap-cpu-memory-recording",
      "screen-studio-zoom-too-much",
    ],
    faq: [
      {
        question: "Why does my MacBook get so hot when I export a screen recording?",
        answer:
          "An export composes and encodes every frame, which keeps the processor and video encoder busy for the whole render. A MacBook Air has no fan, so a long export raises its temperature until the system slows itself down to protect the chip.",
      },
      {
        question: "Is 101°C normal for a MacBook Air during export?",
        answer:
          "The poster on r/mac asked exactly that. They measured CPU efficiency cores at 96 to 101°C and an average CPU temperature of 97°C while rendering a 3-minute 1080p recording in Screen Studio, in a 25°C room, and were worried by it.",
      },
      {
        question: "How do I stop my Mac overheating while exporting video?",
        answer:
          "Put it on a hard, flat surface, plug it in, close other apps, and export a lower resolution while drafting. For a fanless Air, expect a long 4K export to run warm however it is done.",
      },
      {
        question: "Does Prequel use the video encoder?",
        answer:
          "Yes. Prequel encodes with VideoToolbox, the Mac's hardware video encoder, and composes frames with Metal. It needs an Apple Silicon Mac on macOS 14 or later.",
      },
    ],
  },
  {
    slug: "screen-studio-without-subscription",
    title: "Screen Studio without a subscription: what your options are",
    excerpt:
      "Screen Studio is $29 a month, or $9 a month billed yearly, with no free tier and export behind the paywall. The four options if you do not want a subscription, including the one for a project already recorded.",
    date: "2026-10-05",
    readingMinutes: 3,
    topics: ["pricing"],
    reference: "screen-studio-export-one-video",
    related: [
      "screen-studio-lifetime-licence",
      "how-to-cancel-screen-studio",
      "tella-no-free-plan",
      "screencharm-subscription-refund",
      "screen-studio-zoom-too-much",
    ],
    faq: [
      {
        question: "How much does Screen Studio cost?",
        answer:
          "$29 a month billed monthly, or $9 a month billed yearly, which is $108 a year. Every feature is in both plans and there is no free tier. Prices checked on 5 October 2026 on Screen Studio's own site.",
      },
      {
        question: "Can I export from Screen Studio without paying?",
        answer:
          "No. Screen Studio has no free plan. One user on r/macapps recorded a video and found they would have to pay $29 to export it, so the cheapest route for a single export is one month on the monthly plan, cancelled before it renews.",
      },
      {
        question: "Is there a one-time purchase for Screen Studio?",
        answer:
          "Not for new customers. Screen Studio says one-time licences were sold in the past and are no longer available for new purchases. Existing holders keep a valid licence, but updates lapse and renewing access costs extra.",
      },
      {
        question: "What Mac screen recorder can I buy once?",
        answer:
          "Prequel's lifetime licence is $29 once, with no renewal, and its subscription is $9 a month. Both include the whole app with no watermark, after a 7-day free trial. It needs an Apple Silicon Mac on macOS 14 or later.",
      },
    ],
  },
  {
    slug: "screen-studio-lifetime-licence",
    title: "Screen Studio's lifetime licence is one year of updates",
    excerpt:
      "Screen Studio's one-time licence stays valid, but access to updates ends. What Screen Studio says, what holders report on r/macapps and Hacker News, what is not documented, and what a buy-once licence means elsewhere.",
    date: "2026-10-05",
    readingMinutes: 3,
    topics: ["pricing"],
    reference: "screen-studio-lifetime-rip",
    related: [
      "screen-studio-without-subscription",
      "how-to-cancel-screen-studio",
      "screencharm-subscription-refund",
      "screen-studio-zoom-too-much",
    ],
    faq: [
      {
        question: "Does Screen Studio's lifetime licence expire?",
        answer:
          "The licence itself does not. Screen Studio says a one-time licence is still valid, but access to the latest updates and features can expire, and holders can renew it at any time. The renewal price is not stated on its site.",
      },
      {
        question: "Can I still buy a Screen Studio lifetime licence?",
        answer:
          "No. Screen Studio says one-time licences were possible in the past and are no longer available for new purchases.",
      },
      {
        question: "How much does it cost to renew a Screen Studio licence?",
        answer:
          "Screen Studio does not publish it. Commenters on r/macapps reported $49 or $89 for people who bought before the price change and $109 for the later tier. These are what people said they were told, so confirm with Screen Studio before you rely on them.",
      },
      {
        question: "What does a lifetime licence mean for Prequel?",
        answer:
          "Prequel's lifetime licence is one payment of $29 with no renewal and nothing to cancel. It includes the whole app and 5 GB of shared recordings. The price may change in future, and the pricing page always says what it is today.",
      },
    ],
  },
  {
    slug: "screen-studio-zoom-too-much",
    title: "Screen Studio zooms too much: how to calm it down",
    excerpt:
      "Users on Hacker News and Reddit describe constant zooming as distracting and dizzying. What they said, and how to lower the level, slow the move, delete the zooms you do not want or swap them for a loupe in Prequel.",
    date: "2026-10-05",
    readingMinutes: 3,
    topics: ["editing"],
    reference: "openscreen-hn",
    related: [
      "screen-studio-export-slow",
      "screen-studio-overheating",
      "screen-studio-without-subscription",
      "screen-studio-lifetime-licence",
    ],
    faq: [
      {
        question: "Why is the automatic zoom in my screen recording so distracting?",
        answer:
          "Automatic zoom places a push-in on every click, so a demo with many clicks has many moves. Users on Hacker News and Reddit called the constant panning and zooming distracting and almost dizzying. Fewer, slower and shallower zooms read as calmer.",
      },
      {
        question: "How do I reduce the zoom level in a screen recording?",
        answer:
          "In Prequel, select the zoom and lower Level on the Zoom tab, lengthen Speed so it eases in more slowly, and pick a gentler Ease such as Slow in or Slow out. Press Backspace to delete a zoom you do not want.",
      },
      {
        question: "Is there a zoom that does not move the whole picture?",
        answer:
          "Yes. Prequel's Loupe method lays a magnifying glass on the frame, so the rest of the screen stays where it is and stays readable. Set Method to Loupe on the Zoom tab.",
      },
      {
        question: "Does Prequel add zooms automatically?",
        answer:
          "Yes. The first time a recording opens, Prequel adds a zoom for each place you clicked or typed, if the Accessibility permission was granted while recording. You then edit, move or delete any of them. It needs an Apple Silicon Mac on macOS 14 or later.",
      },
    ],
  },
  {
    slug: "how-to-cancel-screen-studio",
    title: "How to cancel Screen Studio",
    excerpt:
      "Screen Studio bills through Lemon Squeezy, not the app. Where to cancel, what the terms say about refunds and renewal, what happens to a one-time licence, and how to avoid a lookalike site. Checked 5 October 2026.",
    date: "2026-10-05",
    readingMinutes: 3,
    topics: ["pricing"],
    reference: "screen-studio-yearly-worth-it",
    related: [
      "screen-studio-without-subscription",
      "screen-studio-lifetime-licence",
      "how-to-cancel-a-screen-recorder-subscription",
    ],
    faq: [
      {
        question: "How do I cancel my Screen Studio subscription?",
        answer:
          "Screen Studio says to manage your subscription on its Lemon Squeezy orders page, at app.lemonsqueezy.com/my-orders. Sign in with the email you bought with, find the Screen Studio order and use the cancel option. If you cannot, email team@screen.studio.",
      },
      {
        question: "Does Screen Studio give refunds?",
        answer:
          "No. Its terms say fees are non-refundable and that it has no liability to refund fees charged or paid. Cancelling before the renewal date is the way to avoid another charge.",
      },
      {
        question: "When does my Screen Studio access end after I cancel?",
        answer:
          "At the end of the current subscription term. Screen Studio's terms say a cancellation takes effect at the end of the term you have paid for, and that the right to use the product then ends.",
      },
      {
        question: "Do I need to cancel a Screen Studio lifetime licence?",
        answer:
          "No. A one-time licence has no subscription to cancel. Screen Studio says it stays valid, and what can expire is access to updates.",
      },
      {
        question: "Is screenstudio.net the real Screen Studio?",
        answer:
          "No. The real product is at screen.studio. A different site on screenstudio.net advertises a 30-day refund that Screen Studio does not offer, so check the address before you pay or try to cancel.",
      },
    ],
  },
  {
    slug: "tella-cloud-editing",
    title: "Why Tella makes you wait before you can edit",
    excerpt:
      "Tella records on your Mac, uploads, and edits in a browser tab. What its own help centre says about the order, the upload speed it asks for, the two sign-ins, and what editing on your Mac looks like instead.",
    date: "2026-10-05",
    readingMinutes: 3,
    topics: ["fixes", "editing"],
    related: [
      "tella-editor-slow",
      "tella-recording-storage-limits",
      "tella-cant-find-recording",
      "tella-export-stuck",
      "tella-editor-wont-load",
    ],
    faq: [
      {
        question: "Does Tella edit in the cloud?",
        answer:
          "Tella's help centre says the editor is a web page that draws your video with your computer's graphics processor through WebGPU. The Mac app records, saves the file to local storage, then uploads it, and the editor works on the uploaded video. Editing is desktop-only.",
      },
      {
        question: "What upload speed does Tella need?",
        answer:
          "Tella's help centre says the minimum upload speed for reliable use is between 2.5 and 5 Mbps. Tella has a help page titled Why is my video taking so long to upload for when it is slower.",
      },
      {
        question: "Can I edit a Tella recording offline?",
        answer:
          "Tella's documentation describes no offline editor. The recording is uploaded and edited in a browser, and mobile devices can view videos and record in quick mode but cannot edit.",
      },
      {
        question: "What Mac screen recorder edits without uploading?",
        answer:
          "Prequel opens its editor on your Mac as soon as you stop recording, on the take you just made, with nothing to upload first. It needs an Apple Silicon Mac on macOS 14 or later, and has a 7-day free trial.",
      },
    ],
  },
  {
    slug: "tella-editor-slow",
    title: "Why Tella's editor feels slow",
    excerpt:
      "Tella's editor runs in a browser on your graphics hardware and ships a Low-res mode that is on by default. What its help centre says, what users report on Reddit, and how to find out whether it is your Mac or your browser.",
    date: "2026-10-05",
    readingMinutes: 3,
    topics: ["fixes", "editing"],
    reference: "tella-lag-sound-image",
    related: [
      "tella-cloud-editing",
      "tella-editor-wont-load",
      "tella-export-stuck",
      "tella-recording-storage-limits",
    ],
    faq: [
      {
        question: "Why is the Tella editor laggy?",
        answer:
          "Tella's help centre says the editor draws your video with your computer's graphics processor through WebGPU, so it depends on your browser and graphics hardware. It ships Low-res mode, which plays lower-resolution copies while you edit, and says it is on by default.",
      },
      {
        question: "What is Tella's Low-res mode?",
        answer:
          "A setting that plays lower-resolution copies of your video while you edit to make the editor faster. Tella says it is on by default. It also says that if you hear pops while editing on Windows but not on the share page, turning on low-res mode is the fix.",
      },
      {
        question: "Does Tella's editor need hardware acceleration?",
        answer:
          "Yes. Tella says hardware (graphics) acceleration must be on in your browser, and that the editor does not run in virtual machines or remote desktop sessions.",
      },
      {
        question: "Is there a Mac screen recorder whose editor is not in a browser?",
        answer:
          "Prequel's editor is part of the Mac app. It opens on your recording when you stop, and exports run on the Mac's video hardware. It needs an Apple Silicon Mac on macOS 14 or later.",
      },
    ],
  },
  {
    slug: "tella-no-free-plan",
    title: "Tella has no free plan: what to use instead",
    excerpt:
      "Tella is $13 or $19 per user a month billed annually, after a 7-day trial that exports at HD and 30 fps. What its help centre and pricing page say, why older reviews still mention a free tier, and what else costs nothing to try.",
    date: "2026-10-05",
    readingMinutes: 3,
    topics: ["pricing"],
    related: [
      "loom-free-plan-limits",
      "screen-studio-without-subscription",
      "how-to-cancel-tella",
      "tella-export-limits",
      "screencharm-subscription-refund",
    ],
    faq: [
      {
        question: "Does Tella have a free plan?",
        answer:
          "No. Tella's help centre says it has two paid plans, Pro and Premium, billed per user, and that every new workspace starts with a 7-day free trial. It states there is no forever-free plan.",
      },
      {
        question: "How much does Tella cost?",
        answer:
          "Tella's pricing page shows Pro at $13 and Premium at $19 per user a month, billed annually. It has a monthly option marked with annual at 50% off, so billing monthly costs more. Checked on 5 October 2026.",
      },
      {
        question: "What are Tella's trial limits?",
        answer:
          "Tella's help centre says trial exports are HD at 30 fps and trial clips are capped at 2 hours.",
      },
      {
        question: "Does Tella put a watermark on exports?",
        answer:
          "No. Tella's help centre says it never puts its logo or a watermark on your videos and that exported files are always clean. Premium removes Tella's branding from video pages.",
      },
      {
        question: "What can I use instead of Tella for free?",
        answer:
          "Prequel has a 7-day free trial with the whole app and no watermark, then $9 a month or $29 once. It needs an Apple Silicon Mac on macOS 14 or later.",
      },
    ],
  },
  {
    slug: "tella-export-stuck",
    title: "Tella export stuck: why it happens and what to try",
    excerpt:
      "Tella has a help page for an export that gets stuck at a percentage or a download window that never finishes. What it says to try, why re-rendering is the first fix, and how exporting on your own Mac avoids the problem.",
    date: "2026-10-05",
    readingMinutes: 2,
    topics: ["export", "fixes"],
    related: [
      "loom-stuck-in-processing",
      "screen-studio-export-slow",
      "tella-cloud-editing",
      "tella-editor-slow",
      "tella-export-limits",
    ],
    faq: [
      {
        question: "Why is my Tella export stuck?",
        answer:
          "Tella's help centre describes it: the progress bar gets stuck at a percentage, or the Preparing download window stays open and nothing happens. It has a page titled Export or download fails, errors out, or gets stuck.",
      },
      {
        question: "How do I fix a Tella export that will not finish?",
        answer:
          "Tella's help pages point to re-rendering the video. A re-render is triggered by making a small edit so Tella builds a fresh version, and its page on audio pops says a fresh render usually fixes those too.",
      },
      {
        question: "What is the Preparing download window in Tella?",
        answer:
          "It is the window Tella shows while it gets an export ready to download. Tella's help centre says that if it stays open and nothing happens, the export has got stuck, and a re-render is the first fix.",
      },
      {
        question: "Where does Prequel export?",
        answer:
          "On your Mac. The export runs on the Mac's video hardware, fills the Export button as it goes, and saves to a place you choose. It needs an Apple Silicon Mac on macOS 14 or later.",
      },
    ],
  },
  {
    slug: "tella-audio-out-of-sync",
    title: "Tella audio out of sync: what its own help centre says",
    excerpt:
      "Tella's help centre says it cannot resync audio in the editor and the fix is to re-record. What it documents about microphone delay, a user's report of lag on both apps, and a clap test that tells drift from fixed delay.",
    date: "2026-10-05",
    readingMinutes: 3,
    topics: ["fixes", "audio"],
    reference: "tella-lag-sound-image",
    related: [
      "screen-recording-audio-out-of-sync",
      "tella-editor-limits",
      "tella-system-audio-not-recording",
      "tella-iphone-black-rectangle",
    ],
    faq: [
      {
        question: "Can I fix audio sync in the Tella editor?",
        answer:
          "No. Tella's help centre says it does not have a way to nudge or realign audio against video inside the editor, and that if a recording came out of sync, the reliable fix is to correct it at the source and re-record.",
      },
      {
        question: "Why is my voice out of sync with my mouth in Tella?",
        answer:
          "A user on r/ProductivityApps reported lag between sound and image in both the web and desktop apps and suspected their own MacBook. Tella's help pages describe the cause as microphone and camera arriving at slightly different rates, and offer a per-microphone delay in the Mac app.",
      },
      {
        question: "How do I tell sync drift from a fixed delay?",
        answer:
          "Record 20 seconds, clap at the start and again at the end, and look at both claps in the waveform. If the sound is the same distance from the picture both times, it is a fixed delay. If the gap grows, the two devices run at different speeds.",
      },
      {
        question: "Does Prequel record the microphone as its own track?",
        answer:
          "Yes. The microphone, system audio and camera are separate files in the take folder, and a manifest records when each track started. It needs an Apple Silicon Mac on macOS 14 or later.",
      },
    ],
  },
  {
    slug: "tella-editor-wont-load",
    title: "Tella editor won't load: the four errors and what they mean",
    excerpt:
      "Tella's editor shows four named errors when it cannot start. What each means, why Safari needs a newer version for editing than for recording, what a virtual machine does, and what to change.",
    date: "2026-10-05",
    readingMinutes: 3,
    topics: ["fixes"],
    related: [
      "tella-cloud-editing",
      "tella-editor-slow",
      "tella-cant-find-recording",
      "tella-recording-storage-limits",
    ],
    faq: [
      {
        question: "Why does Tella say Hardware acceleration isn't available?",
        answer:
          "Tella's editor draws video with your computer's graphics processor through WebGPU. Tella says hardware (graphics) acceleration must be turned on in your browser, and that the editor does not run in virtual machines or remote desktop sessions.",
      },
      {
        question: "Why does Tella say Update your browser to use the editor?",
        answer:
          "The editor needs a newer browser than recording and watching do. Tella says Safari needs version 26 or later for the editor, far newer than the Safari 16.4 that recording needs.",
      },
      {
        question: "Does Tella work on Linux?",
        answer:
          "Tella's help centre says people have used it on Linux and Ubuntu in the past, but there were issues with accessing the screen, camera and microphone.",
      },
      {
        question: "What does Tella's Something went wrong error mean?",
        answer:
          "It covers a recording that cannot start, stop or finish. Tella's help centre also names a client-side exception, usually caused by a browser extension, and Failed to start camera: Access is denied, usually a Windows privacy setting.",
      },
    ],
  },
  {
    slug: "tella-recording-storage-limits",
    title: "Tella stopped recording: browser storage and disk space limits",
    excerpt:
      "Tella needs 2 GB of free browser storage to start recording and the desktop apps refuse to start below 512 MB of disk. What each limit is, what happens to the part already recorded, and how to recover a take.",
    date: "2026-10-05",
    readingMinutes: 3,
    topics: ["fixes", "recording"],
    related: [
      "tella-cloud-editing",
      "tella-editor-slow",
      "tella-editor-wont-load",
      "tella-cant-find-recording",
    ],
    faq: [
      {
        question: "How much free space does Tella need to record?",
        answer:
          "Tella's help centre says the browser recorder needs at least 2 GB of free browser storage, and that a browser can run out even when the disk has space. The Mac and Windows apps will not start a recording with less than 512 MB of disk free and stop below 256 MB. Tella recommends keeping 5 to 10 GB free.",
      },
      {
        question: "What happens if my disk fills while Tella records?",
        answer:
          "The app stops safely when free space drops below 256 MB. Tella says the recording will be shorter than planned, but that it keeps and uploads the part recorded before it stopped.",
      },
      {
        question: "Can I recover a cancelled or crashed Tella recording?",
        answer:
          "Tella says a recording that was cancelled, crashed or errored before saving can usually still be recovered by its support. Do not delete it, do not clear browser site data, keep the desktop app installed and contact support quickly.",
      },
      {
        question: "Why does Tella need so much space?",
        answer:
          "Tella's help centre says the app temporarily saves each recording to local storage in full before it uploads it to the cloud, so the disk must hold the whole take.",
      },
    ],
  },
  {
    slug: "tella-iphone-black-rectangle",
    title: "Your iPhone demo records as a black rectangle: how to fix it",
    excerpt:
      "Tella's own tip page says AirPlay mirroring records as a black rectangle. The cable-and-QuickTime route that works, step by step, and how to record that window with Prequel in Window mode.",
    date: "2026-10-05",
    readingMinutes: 2,
    topics: ["recording", "fixes"],
    related: ["tella-audio-out-of-sync", "tella-system-audio-not-recording", "tella-editor-limits"],
    faq: [
      {
        question: "Why does my iPhone screen record as a black rectangle?",
        answer:
          "Tella's help centre says AirPlay mirroring records as a black rectangle. The route it gives instead is to connect the iPhone by cable and record a QuickTime Player window.",
      },
      {
        question: "How do I show my iPhone on my Mac with a cable?",
        answer:
          "Connect the iPhone with a cable and open QuickTime Player. Choose File, then New Movie Recording, click the arrow beside the record button and choose the iPhone as the camera. The phone's screen appears in the window.",
      },
      {
        question: "Can I record the QuickTime window with a screen recorder?",
        answer:
          "Yes. It is an ordinary window. In Prequel, choose Window on the dock, click the QuickTime window and press Start recording.",
      },
      {
        question: "How is sound recorded in the iPhone demo?",
        answer:
          "Prequel records the microphone you choose on its dock, and the Mac's own sound as a separate track. Check a 10-second test with sound before the real take.",
      },
    ],
  },
  {
    slug: "tella-system-audio-not-recording",
    title: "Tella is not recording computer audio: why, and what to use",
    excerpt:
      "In Tella's browser recorder and Chrome extension, desktop sound is only captured when you share a browser tab. What Tella's help centre says about each app, and how Prequel records the Mac's own sound without a driver.",
    date: "2026-10-05",
    readingMinutes: 2,
    topics: ["audio", "fixes"],
    related: [
      "tella-audio-out-of-sync",
      "tella-iphone-black-rectangle",
      "screen-recording-audio-out-of-sync",
    ],
    faq: [
      {
        question: "Why is Tella not recording my computer audio?",
        answer:
          "Tella's help centre says the Also share tab audio option only appears when sharing a browser tab. The web app and Chrome extension can only capture the audio of a single Chrome tab, so sharing a window or a whole display from the browser records no desktop sound.",
      },
      {
        question: "Does the Tella Mac app record system audio?",
        answer:
          "Yes. Tella says system audio is on by default in the Mac app. In the Windows app it is off by default and sits in settings rather than the control bar.",
      },
      {
        question: "Can QuickTime record system audio on a Mac?",
        answer:
          "QuickTime records the microphone. It does not record the Mac's own sound without extra software, which the guide to recording internal audio covers.",
      },
      {
        question: "How does Prequel record system audio?",
        answer:
          "Prequel records the Mac's sound as its own track every time, with no virtual audio driver. In the editor you can include or drop it and set its volume separately from your voice. It needs an Apple Silicon Mac on macOS 14 or later.",
      },
    ],
  },
  {
    slug: "tella-cant-find-recording",
    title: "Can't find your Tella recording: accounts and workspaces",
    excerpt:
      "Tella says a recording that will not open for editing usually means the Mac app and browser are signed in to different accounts, and a missing one usually landed in another workspace. What it says about moving videos and merging accounts.",
    date: "2026-10-05",
    readingMinutes: 3,
    topics: ["fixes"],
    related: [
      "tella-cloud-editing",
      "tella-editor-wont-load",
      "tella-recording-storage-limits",
      "tella-editor-limits",
    ],
    faq: [
      {
        question: "Why won't my Tella Mac app recording open for editing?",
        answer:
          "Tella's help centre says the Mac app and your browser are usually signed in to different Tella accounts. Compare the two email addresses and, if they differ, sign in to the browser with the one the Mac app uses.",
      },
      {
        question: "Where did my Tella recording go?",
        answer:
          "Tella says videos belong to the workspace they were recorded in, so a recording lands in whichever workspace was active when you pressed record. Switch workspaces and look there.",
      },
      {
        question: "Can I move a Tella video to another workspace?",
        answer:
          "Tella says no: there is no button to move a single video. You download it and upload it again, and the upload is a new video, so edits, layouts and analytics do not carry over. For more than a few, Tella says to ask support.",
      },
      {
        question: "Can I merge two Tella accounts?",
        answer:
          "Tella says no. Two logins for the same person, such as a Google login and an email login, cannot be merged automatically, and each workspace bills separately.",
      },
      {
        question: "Where does Prequel keep my recordings?",
        answer:
          "In folders under ~/Movies/Prequel on your Mac, which Show Recordings in Finder opens from the menu bar. They are listed in the library inside the app. It needs an Apple Silicon Mac on macOS 14 or later.",
      },
    ],
  },
  {
    slug: "tella-editor-limits",
    title: "What Tella's editor can't do after you record",
    excerpt:
      "Tella's help centre says you cannot add your screen or camera to a clip afterwards, record a voice-over onto it, or blur the camera background in the editor. Plus a G2 reviewer's note on the exported background, and what Prequel's editor does with tracks.",
    date: "2026-10-05",
    readingMinutes: 3,
    topics: ["editing"],
    reference: "tella-g2-export-background",
    related: [
      "tella-audio-out-of-sync",
      "tella-iphone-black-rectangle",
      "tella-cant-find-recording",
      "tella-export-limits",
    ],
    faq: [
      {
        question: "Can I add my camera to a Tella video after recording?",
        answer:
          "Not to the same clip. Tella's help centre says that if you forgot to share your screen or turn on your camera, you cannot add it afterwards to that clip. You can place a second file in the other layout slot, but it is a separate clip that is not synced to yours.",
      },
      {
        question: "Can I record a voice-over in the Tella editor?",
        answer:
          "No. Tella says you can add an audio file but cannot record a voice-over onto a clip inside Tella.",
      },
      {
        question: "Can I blur my camera background after recording in Tella?",
        answer:
          "No. Tella says to set your background before you start recording and that blur cannot be added in the editor afterwards. Blur and highlight work on footage in a layout's Screen slot, and the Camera slot is unaffected.",
      },
      {
        question: "How many music tracks can a Tella video have?",
        answer:
          "One. Tella says background music applies to the whole video, not to a single clip, and plays across every clip. It also says one clip cannot be layered on top of another, and layouts can only arrange tracks that belong to the same clip.",
      },
      {
        question: "What does Prequel's editor do with separate tracks?",
        answer:
          "Prequel records the screen, camera, microphone and system audio as separate tracks and places the camera in the finished video afterwards, with a choice of 14 layouts per clip. It needs an Apple Silicon Mac on macOS 14 or later.",
      },
    ],
  },
  {
    slug: "tella-export-limits",
    title: "Tella export limits: 4K, 60 fps and clip length",
    excerpt:
      "What Tella's pricing page and help centre say about export: 4K in Pro, 60 fps in Premium, a 6 hour clip limit, a 5 GB upload cap, and a trial that exports at HD and 30 fps. Checked 5 October 2026.",
    date: "2026-10-05",
    readingMinutes: 3,
    topics: ["export", "pricing"],
    related: [
      "tella-no-free-plan",
      "tella-export-stuck",
      "tella-editor-limits",
      "how-to-cancel-tella",
    ],
    faq: [
      {
        question: "Does Tella export in 4K?",
        answer:
          "Yes. Tella's pricing page lists export in 4K under Pro, which is $13 per user a month billed annually, and recording up to 4K on every plan.",
      },
      {
        question: "Which Tella plan exports at 60 fps?",
        answer:
          "Tella's pricing page lists Export at 60 FPS under Premium, at $19 per user a month billed annually. Its comparison table also shows an Up to 5 mins limit beside some export rows, so read the table for your plan before you buy.",
      },
      {
        question: "How long can a Tella recording be?",
        answer:
          "Tella's pricing page says one clip can be up to 6 hours, and that you can combine clips for longer. Trial clips are capped at 2 hours.",
      },
      {
        question: "What does the Tella trial export at?",
        answer:
          "HD at 30 fps, according to Tella's help centre, with trial clips capped at 2 hours.",
      },
      {
        question: "Is there a length limit on Prequel exports?",
        answer:
          "No. Prequel has no length cap on a recording and nothing held back by plan, with no watermark. It needs an Apple Silicon Mac on macOS 14 or later.",
      },
    ],
  },
  {
    slug: "how-to-cancel-tella",
    title: "How to cancel Tella",
    excerpt:
      "Tella's cancel button is in Stripe, only workspace owners can reach it, and export stops working when the subscription does. Where to click, what the refund policy covers, and why the 30-day notice story is out of date. Checked 5 October 2026.",
    date: "2026-10-05",
    readingMinutes: 3,
    topics: ["pricing"],
    related: [
      "tella-no-free-plan",
      "tella-export-limits",
      "how-to-cancel-a-screen-recorder-subscription",
    ],
    faq: [
      {
        question: "How do I cancel Tella?",
        answer:
          "As the workspace owner, open your workspace name, then Settings, then Plans and Billing, then Manage, which opens Stripe. Choose Cancel subscription there. Only workspace owners can open the Stripe portal, and on a free trial there is nothing to cancel.",
      },
      {
        question: "Does Tella need 30 days notice to cancel?",
        answer:
          "Not now. A 2024 review said it did, but Tella's pricing page says your subscription stops at the end of the current billing period and you will not be charged for the next one, and its refund policy says you can cancel at any time from your account settings.",
      },
      {
        question: "Can I pause a Tella subscription?",
        answer: "No. Tella's help centre says it does not offer a way to pause a subscription.",
      },
      {
        question: "Does Tella give refunds?",
        answer:
          "Yes, in some cases. Tella's refund policy offers a full refund within 14 days of your initial purchase, for first-time purchases only. Outside that it covers billing errors, technical problems its support could not resolve, and accidental renewals reported within 7 days.",
      },
      {
        question: "What happens to my Tella videos if I cancel?",
        answer:
          "They are not deleted. Tella says you can still view and share them, but you cannot record, edit or export until you subscribe again. Export what you need before you cancel.",
      },
    ],
  },
  {
    slug: "make-screen-recordings-look-high-quality",
    title: "How to make a screen recording look high quality",
    excerpt:
      "The most upvoted screen recording question we found on Reddit this year is why a 4K capture still looks soft. Six settings decide it, settled before the edit: pixel size, window size, zooms, frame rate, a frame, and the export.",
    date: "2026-09-17",
    readingMinutes: 6,
    topics: ["recording", "editing"],
    faq: [
      {
        question: "Why does my 4K screen recording still look blurry?",
        answer:
          "Usually because the whole display was recorded and then played in a small box, so every control is a few pixels tall, or because a Retina display was captured at its point size rather than its pixel size. Record the one window that matters at about 1400 pixels wide, capture at the display's full pixel size, and zoom to the part being used.",
      },
      {
        question: "How do YouTubers make screen recordings look so clean?",
        answer:
          "Full-pixel capture, a window sized so text is large in the player, zooms on whatever is being clicked, 60 fps where anything moves, and the recording placed in a frame with padding, rounded corners and a shadow. Some animate a vector export of the page in After Effects instead of recording, which is why a few look sharper than any capture can.",
      },
      {
        question: "Does 60 fps make a screen recording look better?",
        answer:
          "For scrolling, dragging, animation and a camera, yes; text and clicks look the same at 30. In a measured test at 1080p, 60 fps made the file about 55 percent larger than 30 fps.",
      },
      {
        question: "Should I export a screen recording at 4K or 1080p?",
        answer:
          "At the frame's full size for YouTube and other platforms that re-encode uploads, because a larger upload is served at a higher bitrate. At 1080p for a file going straight to a person, where it is a quarter of the size and as readable.",
      },
    ],
  },
  {
    slug: "reduce-screen-recording-file-size-mac",
    title: "How to reduce the size of a screen recording on a Mac",
    excerpt:
      "An hour from the built-in Mac recorder is about 13 GB, according to the people asking. We measured a real take at every size and codec Prequel exports: the raw file was 61 MB a minute and the 1080p export was 2. Four settings and a chart.",
    date: "2026-09-17",
    readingMinutes: 6,
    topics: ["export"],
    faq: [
      {
        question: "Why is my Mac screen recording so large?",
        answer:
          "A recorder writes frames as fast as the screen produces them and cannot spend long compressing each one, so it records at a high fixed quality and leaves the compression for the export. Readers report about 13 GB an hour from the macOS recorder, which is roughly 29 Mbps. Export a copy and send that.",
      },
      {
        question: "How big should a 1080p screen recording be?",
        answer:
          "About 2 MB a minute in H.264 for a recording of an app being used, or 1.6 MB in HEVC, measured on a real take with x264 and x265 at their default quality. A take with video playing in it comes out larger.",
      },
      {
        question: "Is HEVC smaller than H.264 for screen recordings?",
        answer:
          "Yes, by about a fifth at the same picture quality in our test at every size. HEVC plays on every Apple device and most browsers; some Windows machines need an extension, so use H.264 for a mixed audience.",
      },
      {
        question: "How do I compress a QuickTime screen recording?",
        answer:
          "File, Export As in QuickTime re-encodes it at 1080p or 720p with HEVC as an option. HandBrake, which is free, gives control over the bitrate. For new recordings, export at 1080p from the recorder and there is nothing to compress afterwards.",
      },
    ],
  },
  {
    slug: "record-zoom-google-meet-calls-mac",
    title: "How to record a Zoom or Google Meet call on a Mac with both sides' audio",
    excerpt:
      "QuickTime records your microphone and none of what the other person said. Three routes to a recording with both sides: the meeting's own recorder, a screen recorder that captures system audio, and local recording for a podcast. Say you are recording first.",
    date: "2026-09-17",
    readingMinutes: 5,
    topics: ["audio", "recording"],
    faq: [
      {
        question:
          "Why does my screen recording of a Zoom call have no audio from the other person?",
        answer:
          "QuickTime and the Cmd+Shift+5 toolbar record a microphone, and the other side of a call comes out of the speakers as system audio, which they do not capture. Use Zoom's own Record button if you are the host, or a screen recorder that captures system audio, such as Prequel, which records it as a separate track.",
      },
      {
        question: "Can I record a Google Meet call on a free account?",
        answer:
          "Meet's own Record meeting option is only on paid Workspace plans, only when the administrator has enabled it, and only for the host or someone the host permits. A screen recorder that captures system audio records the call from any account. Tell the other participants first.",
      },
      {
        question: "Do I have to tell people I am recording a call?",
        answer:
          "Yes. Zoom and Meet announce their own recordings; a screen recorder does not, so say it at the start and put it in the invite for a client. In some places consent from every party is required by law.",
      },
    ],
  },
  {
    slug: "record-software-training-videos",
    title: "How to record training videos for software that changes every release",
    excerpt:
      "One task per video, the window rather than the desktop, a zoom where a callout would go, captions on, one saved look for the whole library, and the takes kept so a release means re-recording one video. Built from three r/instructionaldesign threads.",
    date: "2026-09-17",
    readingMinutes: 6,
    topics: ["recording", "editing"],
    faq: [
      {
        question: "How long should a software training video be?",
        answer:
          "One to three minutes, covering one task, named for that task in the words a user would search for. A video that needs longer is two videos. Short single-task videos are watched to the end and can be replaced one at a time when the product changes.",
      },
      {
        question: "How do you keep training videos up to date when the software changes?",
        answer:
          "Keep each video to one task so a UI change affects one video, keep the recording takes so a video can be re-cut and re-exported without re-recording, name files for the task and the version, and put the version on the first frame. Move reference material to written documentation and keep video for onboarding and the key features.",
      },
      {
        question: "Should I use callouts and freeze-frames in a software tutorial?",
        answer:
          "A zoom on the control being used does the same job with less work, and a focus effect that blurs everything outside a region replaces the red outline box when you need the viewer to look at one area while you talk. Text callouts are rarely needed when there is a voiceover.",
      },
    ],
  },
  {
    slug: "how-long-does-it-take-to-make-a-demo-video",
    title: "How long does it take to make a product demo video, and how to make it faster",
    excerpt:
      "About an hour of work per minute of video, when it is recorded and edited by hand: a product manager on Reddit timed four hours for a four-minute demo. Here is where the time goes, stage by stage, and how a shorter video, one long take and an automatic first pass cut most of it.",
    date: "2026-09-17",
    readingMinutes: 5,
    topics: ["editing", "recording"],
    faq: [
      {
        question: "How long does it take to make a product demo video?",
        answer:
          "Recorded and edited by hand, about an hour of work per minute of video: one product manager on Reddit reported four hours for a four-minute demo, across scripting, setup, takes, editing and interruptions. A shorter video, one long take cut on a timeline, and a recorder that places the zooms, frames the camera and applies the background on its own bring it down to well under an hour.",
      },
      {
        question: "How long should a product demo video be?",
        answer:
          "As short as the one thing you want the viewer to believe allows. The most upvoted reply in the thread suggests a thirty-second teaser with a link to a longer, informal walkthrough for an all-hands. Length multiplies every other cost: more script, more takes, more editing.",
      },
      {
        question: "Should I re-record a demo when I make a mistake?",
        answer:
          "No. Keep going, say the sentence again, and cut the stumble out on the timeline afterwards. One long take with a few cuts takes a fraction of the time of several full takes, and the cuts are invisible to the viewer.",
      },
    ],
  },
  {
    slug: "why-your-screen-recording-looks-blurry",
    title: "Why your screen recording looks blurry, and how to fix it",
    excerpt:
      "Soft text in a screen recording comes from one of four places: the capture size, the export size, the bitrate, or the upload. Here is how to tell which, and what to change.",
    date: "2026-09-17",
    readingMinutes: 6,
    topics: ["recording", "export"],
    faq: [
      {
        question: "Why is text blurry in my screen recording?",
        answer:
          "Usually because the recording was captured or exported at fewer pixels than the display has. A Retina Mac draws the interface at twice the pixel size it reports, and a recorder that captures at the reported size records half the detail. Check the file's dimensions: a 1440 by 900 display should produce a 2880 by 1800 recording.",
      },
      {
        question: "Does a higher bitrate fix blurry video?",
        answer:
          "Only if the bitrate was the problem. A recording that is already sharp but breaks into blocks around moving parts needs more bitrate. A recording where the text is soft everywhere was captured or scaled too small, and no bitrate recovers detail that was never recorded.",
      },
      {
        question: "Why does my video look fine on my Mac but blurry on YouTube?",
        answer:
          "YouTube re-encodes every upload at its own bitrate, and for 1080p that bitrate is low. Uploading at 4K, even from a 1080p source scaled up, puts the video in a higher-bitrate tier, and the 1080p version YouTube serves from it comes out cleaner.",
      },
    ],
  },
  {
    slug: "before-you-press-record",
    title: "Before you press record: a screen recording checklist",
    excerpt:
      "Nine things to check in the minute before a screen recording, so the take you get is the one you send. Notifications, the desktop, the window, the audio, the camera and the grants.",
    date: "2026-09-17",
    readingMinutes: 5,
    topics: ["recording", "audio"],
    faq: [
      {
        question: "How do I stop notifications appearing in a screen recording?",
        answer:
          "Turn on a Focus mode before you record. Do Not Disturb from Control Centre silences banners for every app; a custom Focus can allow one or two through.",
      },
      {
        question: "Should I record the whole screen or one window?",
        answer:
          "One window if the demo lives in one app and you want it to fill the frame, with no dock, no menu bar and nothing behind it. The whole screen if you move between apps or need the menu bar in shot. A window recording is also smaller and easier to zoom into.",
      },
      {
        question: "Why is my microphone silent in the recording?",
        answer:
          "Either the microphone was off when the recording started, the wrong device was selected, or the app was not granted the Microphone permission. Check the level meter before you start: a recorder that shows one tells you it hears you before a word is lost.",
      },
    ],
  },
];

/** Newest first. `articles` below is sorted, so order here is not load-bearing. */
export const articles: Article[] = [...ENTRIES].sort((a, b) => b.date.localeCompare(a.date));

export function findArticle(slug: string): Article | undefined {
  return articles.find((article) => article.slug === slug);
}
