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
   * Required, for the reason `Post.faq` is: the page renders it and emits
   * `FAQPage` off the same array, and an optional field is the one that gets
   * left off the next entry.
   */
  faq: FaqEntry[];
};

const ENTRIES: Article[] = [
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
