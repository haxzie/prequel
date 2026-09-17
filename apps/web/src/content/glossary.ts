/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  This is the file you edit to add a glossary term.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  1. Write `src/content/glossary/<slug>.mdx` — prose from `##`, no frontmatter.
 *  2. Add an entry below whose `slug` is that filename.
 *
 *  The same arrangement as `posts.ts`, for the same reason: `@next/mdx` reads
 *  no frontmatter, and `/content` lists every term without loading a body.
 *
 *  A term is not a post. It has no reading time, because a definition is read
 *  in the time it takes to read one, and no tag, because "Glossary" is the
 *  tag. What it has instead is a one-sentence `definition`, which does the
 *  work of three things at once: the meta description, the lede under the
 *  heading, and the card on `/content`.
 */

import type { FaqEntry } from "@/lib/faq";

import type { Topic } from "./topics";

export type Term = {
  slug: string;
  /** The term itself, as a heading: "Bitrate", not "What is bitrate?". */
  title: string;
  /**
   * One sentence that defines the term and stops.
   *
   * Under 160 characters, because it is the meta description and a search
   * result cuts it there. Written to stand alone: it is what a snippet shows,
   * and what an assistant quotes, without the page around it.
   */
  definition: string;
  /** ISO date. The sitemap's `lastModified`; update it when the body changes. */
  date: string;
  /**
   * Where the term is filed on `/content`. One or two, never more: a term in
   * four topics turns every filter into "everything", and the filters are the
   * page's whole point.
   */
  topics: Topic[];
  /**
   * Required, as on `Post`: the moment it is optional it is forgotten, and the
   * page renders it *and* emits `FAQPage` off the same array so the two cannot
   * drift. Two or three questions, answered so they stand alone.
   */
  faq: FaqEntry[];
};

const ENTRIES: Term[] = [
  {
    slug: "frame-rate",
    title: "Frame rate",
    definition:
      "The number of still pictures a video shows each second, written as fps. Screen recordings are usually made at 30 or 60.",
    date: "2026-09-17",
    topics: ["recording", "export"],
    faq: [
      {
        question: "Is 30 fps enough for a screen recording?",
        answer:
          "For most screen recordings, yes. Text, clicks and typing look the same at 30 and 60. The difference shows on smooth scrolling, animation and a camera, where 60 fps looks noticeably more fluid.",
      },
      {
        question: "Does a higher frame rate make the file bigger?",
        answer:
          "Yes, though not in proportion. Twice the frames at the same bitrate means each frame gets half the data; twice the frames at the same quality means roughly a larger file. Most encoders land somewhere between the two.",
      },
      {
        question: "What frame rate does Prequel export at?",
        answer:
          "60 or 30 fps for MP4 and HEVC, chosen in the export dialog. GIF exports are 20 or 10 fps, because a GIF stores every frame in full and gets very large very quickly.",
      },
    ],
  },
  {
    slug: "bitrate",
    title: "Bitrate",
    definition:
      "How much data a video spends per second of playback, measured in megabits per second. It is the main control over file size and picture quality.",
    date: "2026-09-17",
    topics: ["export"],
    faq: [
      {
        question: "What bitrate should a 1080p screen recording have?",
        answer:
          "Around 8 to 12 Mbps keeps sharp text at 1080p and 60 fps. Screen content compresses well because most of the frame is still between changes, so it needs less than camera footage of the same size.",
      },
      {
        question: "Why does my video look worse after uploading it?",
        answer:
          "Every video platform re-encodes what you upload at its own bitrate, and that bitrate is lower than yours. Uploading at a higher bitrate and resolution than you need gives the platform more to work from, which is why a 4K upload often plays back cleaner at 1080p than a 1080p upload does.",
      },
    ],
  },
  {
    slug: "codec",
    title: "Codec",
    definition:
      "The method used to compress video into a file and decompress it for playback. H.264 and HEVC are the two you meet when recording a screen.",
    date: "2026-09-17",
    topics: ["export"],
    faq: [
      {
        question: "Should I export as H.264 or HEVC?",
        answer:
          "H.264 if the file is going to somebody else or somewhere you do not control, because everything plays it. HEVC if you are keeping the file or know where it will play, because it is smaller at the same quality.",
      },
      {
        question: "Is MP4 a codec?",
        answer:
          "No. MP4 is a container, the file format that holds the video and audio streams. The codec is what those streams are encoded with. An MP4 usually holds H.264 video, and can hold HEVC.",
      },
      {
        question: "Why will my HEVC file not play on Windows?",
        answer:
          "Windows does not ship an HEVC decoder in every edition; it is a paid extension in the Microsoft Store on some. If a recording is going to Windows users, export it as MP4 with H.264.",
      },
    ],
  },
  {
    slug: "resolution",
    title: "Resolution",
    definition:
      "The size of a video's picture in pixels, width by height. 1080p is 1920 by 1080; 4K is 3840 by 2160.",
    date: "2026-09-17",
    topics: ["recording", "export"],
    faq: [
      {
        question: "Is 4K worth it for a screen recording?",
        answer:
          "If the recording is going to YouTube or anywhere that re-encodes uploads, yes: the platform has more to work with and the 1080p version it serves comes out sharper. If it is going straight to a person, 1080p is usually plenty and a quarter of the size.",
      },
      {
        question: "Why is my recording 2880 by 1800 and not 1080p?",
        answer:
          "A Retina Mac has twice as many pixels as its resolution in System Settings suggests, and a recorder that captures every one of them records at that size. A 1440 by 900 display is 2880 by 1800 pixels. That is a good thing: text stays sharp, and you can scale down on export.",
      },
    ],
  },
  {
    slug: "aspect-ratio",
    title: "Aspect ratio",
    definition:
      "The proportion of a video's width to its height. 16:9 is landscape and the default for screens; 9:16 is vertical and what Shorts, Reels and TikTok want.",
    date: "2026-09-17",
    topics: ["editing", "sharing"],
    faq: [
      {
        question: "Can I turn a landscape screen recording into a vertical one?",
        answer:
          "Yes. Keep the screen at its own proportions inside a vertical frame, with a background above and below and the camera in the spare space. Prequel does this with a frame preset; the screen and the camera keep their proportions and the layout moves around them.",
      },
      {
        question: "Which aspect ratio should a product demo be?",
        answer:
          "16:9 for a website, a docs page, YouTube or an email. 9:16 for Shorts, Reels and TikTok. 1:1 or 4:5 for a feed post on LinkedIn or Instagram, where a square or portrait video takes more of the screen than a landscape one.",
      },
    ],
  },
  {
    slug: "retina-hidpi",
    title: "Retina and HiDPI",
    definition:
      "A display that draws each point of the interface with four physical pixels, so text is sharp. A screen recording of one is twice the width and height it looks.",
    date: "2026-09-17",
    topics: ["recording"],
    faq: [
      {
        question: "Why does my screen recording look blurry on a Retina Mac?",
        answer:
          "The recorder captured at the display's logical size rather than its pixel size, so every point of the interface got one pixel instead of four. Text drawn that way is soft when played back on a Retina screen. Use a recorder that captures the display's full pixel size.",
      },
      {
        question: "What is the difference between points and pixels?",
        answer:
          "A point is the unit macOS lays the interface out in; a pixel is what the display physically has. On a Retina display there are two pixels per point in each direction, so a 100 point wide button is 200 pixels wide.",
      },
    ],
  },
  {
    slug: "system-audio",
    title: "System audio",
    definition:
      "The sound the Mac itself plays, from any app, captured as part of a screen recording. macOS records it only through the screen capture API, and not every recorder asks.",
    date: "2026-09-17",
    topics: ["audio", "recording"],
    faq: [
      {
        question: "Does QuickTime record system audio?",
        answer:
          "No. QuickTime Player and the Cmd+Shift+5 toolbar record the screen and a microphone. Capturing the Mac's own sound with them needs a virtual audio device such as BlackHole routed through Audio MIDI Setup.",
      },
      {
        question: "Can I record system audio and my voice as separate tracks?",
        answer:
          "With a recorder that keeps them apart, yes. Prequel records the microphone and system audio as two tracks, so each can be included, dropped or set to its own level in the editor afterwards.",
      },
    ],
  },
  {
    slug: "picture-in-picture",
    title: "Picture-in-picture",
    definition:
      "A camera feed drawn as a small window over a screen recording, so the viewer sees the presenter and the screen at the same time.",
    date: "2026-09-17",
    topics: ["audio", "editing"],
    faq: [
      {
        question: "Where should the camera go in a screen recording?",
        answer:
          "A bottom corner, over a part of the screen that does not matter, is the convention. Which corner depends on the app being recorded: put the camera where the sidebar or empty space is, never over the part being demonstrated.",
      },
      {
        question: "Can I move the camera after recording?",
        answer:
          "Only if the recorder kept the camera as its own track. A recorder that composites the camera into the frames while recording has baked it in, and it cannot be moved, resized or removed afterwards. Prequel records the camera separately, so it can be moved at any point in the edit.",
      },
    ],
  },
  {
    slug: "zoom-and-pan",
    title: "Zoom and pan",
    definition:
      "Pushing the picture in on part of the screen, then moving it to follow the action, so a viewer sees what the presenter is doing without squinting at a full screen.",
    date: "2026-09-17",
    topics: ["editing"],
    faq: [
      {
        question: "Why do screen recordings zoom in on clicks?",
        answer:
          "A full 1440 by 900 screen played back in a 640 pixel wide player makes every menu item a few pixels tall. Zooming in on where the click happened shows the viewer the control at a size they can read, and the pull back out puts it in context again.",
      },
      {
        question: "How does Prequel place zooms automatically?",
        answer:
          "It records where you click and type while capturing, then when the editor opens on the take, those moments have already been turned into zooms: pushed in on what you were doing, pulled back out when you moved on. Each one can be moved, resized or deleted, and more can be drawn by hand.",
      },
    ],
  },
  {
    slug: "screencast",
    title: "Screencast",
    definition:
      "A recording of a computer screen with narration, made to show somebody how something works. The word predates screen recording as a category and still means the same thing.",
    date: "2026-09-17",
    topics: ["recording"],
    faq: [
      {
        question: "What is the difference between a screencast and a screen recording?",
        answer:
          "A screen recording is the raw capture. A screencast is the finished thing: a recording with a voice over it, made to be watched by somebody else. The words are used interchangeably now, but screencast still implies narration.",
      },
      {
        question: "How long should a screencast be?",
        answer:
          "As short as the task allows. Two to three minutes is a good ceiling for a demo or a how-to sent to a colleague; anything longer is better split into a few recordings a viewer can pick from.",
      },
    ],
  },
  {
    slug: "captions-and-subtitles",
    title: "Captions and subtitles",
    definition:
      "Words on the frame that show what is being said. Subtitles carry the dialogue; captions also describe the sounds. In screen recording the two words are used for the same thing.",
    date: "2026-09-17",
    topics: ["captions"],
    faq: [
      {
        question: "Should captions be burned in or a separate file?",
        answer:
          "Burned in if the video is going to a feed, a chat or anywhere the viewer cannot turn subtitles on. A separate SRT or VTT file if it is going to a player that supports them, because the viewer can then switch them off and a search engine can read the text.",
      },
      {
        question: "Does macOS add captions to a screen recording?",
        answer:
          "No. QuickTime Player and the Cmd+Shift+5 toolbar record the screen and microphone and do nothing with the words. Captions come from a recorder that transcribes, a video editor, or a service you upload to.",
      },
      {
        question: "Where does Prequel transcribe?",
        answer:
          "On the Mac, using Apple's speech recognition. Nothing is uploaded. The transcript appears in the editor as text you can type into, and the captions are drawn from it.",
      },
    ],
  },
  {
    slug: "screen-recording-permission",
    title: "Screen Recording permission",
    definition:
      "The macOS grant an app needs before it can see the contents of your screen. Without it a recorder captures the wallpaper and nothing on top of it.",
    date: "2026-09-17",
    topics: ["recording"],
    faq: [
      {
        question: "Why is my screen recording just the desktop wallpaper?",
        answer:
          "The app has not been granted Screen Recording. macOS still lets it record, but hands it a frame with every window stripped out. Grant it under System Settings, Privacy and Security, then Screen Recording, and restart the app.",
      },
      {
        question: "Does an app need Screen Recording to record its own window?",
        answer:
          "No. An app can record what it draws itself without the grant. It needs Screen Recording the moment it captures any pixel that belongs to another app or to the system.",
      },
      {
        question: "Why does macOS keep asking me to allow screen recording?",
        answer:
          "Since macOS 15, the system re-confirms a Screen Recording grant every so often for apps that use it, with a dialog that says the app can access the screen. Clicking Continue to Allow keeps it working. It is a reminder; the grant is still in place.",
      },
    ],
  },
  {
    slug: "share-link",
    title: "Share link",
    definition:
      "A URL that plays a recording in the browser, sent instead of the file. The viewer needs nothing installed and the sender can take it down later.",
    date: "2026-09-17",
    topics: ["sharing"],
    faq: [
      {
        question: "Is a share link better than sending the file?",
        answer:
          "For anyone watching on a phone or in a chat, yes: the link opens and plays, where a 200 MB file has to download first. A file is better when the viewer needs to keep a copy or edit it further.",
      },
      {
        question: "Can I stop a share link working?",
        answer:
          "With most tools, yes, by deleting the recording from your library. In Prequel, open the shared library at prequel.sh/app and delete the recording; its link stops working at once.",
      },
    ],
  },
];

/**
 * Alphabetical. A glossary is looked up, not browsed by date, and a reader
 * who knows the word they want expects to find it where a dictionary would
 * put it.
 */
export const terms: Term[] = [...ENTRIES].sort((a, b) => a.title.localeCompare(b.title, "en-GB"));

export function findTerm(slug: string): Term | undefined {
  return terms.find((term) => term.slug === slug);
}

/**
 * Other terms filed under any of this one's topics, up to four.
 *
 * Derived from `topics` rather than listed by hand on each entry, for the
 * reason `pillar` on a post is one field and not two: a hand-written list of
 * related terms is the one thing nobody updates when the thirteenth term is
 * added, and every page then has a stale set that looks fine on its own.
 */
export function relatedTerms(slug: string): Term[] {
  const term = findTerm(slug);
  if (!term) return [];

  return terms
    .filter((other) => other.slug !== slug && other.topics.some((t) => term.topics.includes(t)))
    .slice(0, 4);
}
