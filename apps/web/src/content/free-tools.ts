/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  This is the file you edit to publish a free tool.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  1. Write `src/content/free-tools/<slug>.mdx` — prose only, no frontmatter,
 *     and no `#` heading: the `<h1>` is the hero, and a second one on the page
 *     is the easiest own goal here. Start at `##`.
 *  2. Add an entry below whose `slug` is that filename.
 *
 *  That is the whole of it. The page, its share card, its place in the footer
 *  and its two lines in the sitemap are all read off this array, so there is no
 *  third step to forget.
 *
 *  A tool is a page that does something in the browser, so the registry carries
 *  the `mode` the studio is rendered in alongside the copy. There are three
 *  modes and they are not a growing list: a tool whose work is not "capture a
 *  stream and encode it" is a different component, not a fourth entry.
 *
 *  Every field that ends up on the page obeys `apps/web/COPY.md`. The comments
 *  in this file do not, which is the usual split.
 */

import { Crop, Mic, Monitor, Webcam, type LucideIcon } from "lucide-react";

import type { FaqEntry } from "@/lib/faq";
import type { ToolMode } from "@/lib/free-tools/mode";

export type FreeTool = {
  /** The MDX filename in `src/content/free-tools`, and the URL segment. */
  slug: string;
  /**
   * Which thing the page renders.
   *
   * `recorder` is the studio, parameterised by `mode`; `editor` is the
   * screenshot editor, which opens a file rather than a device. A field rather
   * than a fourth `mode`, because the two share a stage and a dock and nothing
   * else: one records a stream and the other marks up a bitmap.
   */
  surface: "recorder" | "editor";
  /** Which sources the studio opens. Ignored by the editor. */
  mode: ToolMode;
  /** The mark on this tool's card, on the index and in the footer. */
  icon: LucideIcon;
  /** The footer's label. Two words at most. */
  navLabel: string;
  /** Small caps line above the heading, and the kicker on the share card. */
  eyebrow: string;
  /** The `<h1>`. Under about 60 characters, which is what the card can draw. */
  heading: string;
  /**
   * The name the structured data gives the tool.
   *
   * Separate from `heading` because the two are read by different things. The
   * heading is a sentence a person reads; this is what a search engine lists in
   * a result, so it is the phrase the tool would be searched for.
   */
  name: string;
  /** Two sentences under the heading. */
  lede: string;
  /** The meta description. Under 155 characters, term in the first four words. */
  description: string;
  /** The index page's card, in one line. */
  summary: string;
  /** Three or four steps, rendered as a list and as `HowTo` structured data. */
  steps: { name: string; text: string }[];
  /** Three to six cards. Outcome as the title, mechanism in the body. */
  features: { title: string; body: string }[];
  /**
   * The FAQ section's heading, in spoken English about this page.
   *
   * Per tool rather than one string for the set, for the reason the questions
   * are: three pages with the same heading over three different lists reads as
   * one template filled in three times, which is what it would be.
   */
  faqHeading: string;
  /** This tool's own questions, and only this tool's. */
  faq: FaqEntry[];
};

/**
 * The tools, in the order they are listed.
 *
 * Each FAQ is written for its own page. Sharing a single array across the set
 * would be the mistake the use-case pages made and had to undo: a dozen
 * byte-identical answers on three pages whose whole purpose is to rank for
 * different phrases. A fact stated twice is written twice, in the language of
 * the page it is on.
 */
export const freeTools: FreeTool[] = [
  {
    slug: "screen-recorder",
    surface: "recorder",
    mode: "screen",
    icon: Monitor,
    navLabel: "Screen recorder",
    eyebrow: "Free browser tool",
    heading: "Record your screen in the browser",
    name: "Free online screen recorder",
    lede: "Share a screen, a window or a tab, put your camera in the corner, then download the file. It runs in this tab and nothing is uploaded.",
    description:
      "Free online screen recorder. Record your screen, your camera and the sound in your browser, then download the video. No sign up, no upload, no watermark.",
    summary: "Your screen, your camera and the sound, recorded in a tab and downloaded as a video.",
    steps: [
      {
        name: "Choose what to record",
        text: "Click Choose what to record and pick a screen, a window or a tab. Tick Share audio to include what it is playing.",
      },
      {
        name: "Set the frame",
        text: "Pick a frame and turn the camera on in the dock. The preview is the file: whatever you see here is what gets encoded.",
      },
      {
        name: "Record",
        text: "Start recording, work through what you are showing, then stop. Three seconds of countdown gives you time to switch over.",
      },
      {
        name: "Download",
        text: "Play the take back and download it. The file is already on your machine, so saving it is instant.",
      },
    ],
    features: [
      {
        title: "Keep the recording on your own machine",
        body: "Your browser captures the screen, composites the frame in a canvas and encodes it with MediaRecorder. There is no upload step, because there is no server in the path.",
      },
      {
        title: "Put yourself in the corner",
        body: "Your camera sits in a circle, a squircle, a rounded box or a wide one, in any corner, at any size. Drag the size while the preview is running.",
      },
      {
        title: "Post it in the shape the platform wants",
        body: "Landscape 1080p, vertical 9:16, square and portrait 4:5, or whatever you shared. The camera is sized as a proportion of the frame, so a frame change keeps it where you put it.",
      },
      {
        title: "Press one red button",
        body: "The dock under the preview holds the camera, the microphone and Record. Three seconds of countdown, then a clock and the file size as it grows.",
      },
      {
        title: "Record the sound as well as the picture",
        body: "Your microphone and the shared screen's own audio land in one mix, each with its own level. Both sliders keep working while the take runs.",
      },
      {
        title: "Start with no account",
        body: "No sign up, no email, no watermark on anything you download. Close the tab and there is nothing left behind.",
      },
    ],
    faqHeading: "Sound, formats and where the file goes",
    faq: [
      {
        question: "Is this screen recorder really free?",
        answer:
          "Yes. There is no account, no trial and no watermark, and nothing on the page asks for a card. The recording is made by your browser, so there is no server cost to pass on.",
      },
      {
        question: "Does my recording get uploaded anywhere?",
        answer:
          "No. The screen capture, the frame you see and the file you download are all produced in the tab. The video exists as a blob in your browser's memory until you save it, and closing the tab discards it.",
      },
      {
        question: "Can it record the sound from my screen as well as my voice?",
        answer:
          "Chrome and Edge offer screen audio for a tab or a window: tick Share audio in the picker and it lands in the recording alongside your microphone, each with its own level. Safari and Firefox share the picture without the sound, and the page says so when that happens.",
      },
      {
        question: "What format is the file?",
        answer:
          "MP4 with H.264 where your browser can write it, which covers current Chrome, Edge and Safari. Firefox writes WebM instead. The panel names the format before you record and again on the finished file.",
      },
      {
        question: "How long can one recording be?",
        answer:
          "Thirty minutes. Every second of a browser recording is held in the tab until you save it, so the limit is memory rather than policy: the tool stops cleanly at the ceiling and hands you the file.",
      },
      {
        question: "Does it work on Windows, on a Mac and on a Chromebook?",
        answer:
          "Yes. It needs a desktop browser with screen capture, which Chrome, Edge, Firefox and Safari 17 all have on every platform. Phones and tablets have no screen capture API, so use the camera recorder there.",
      },
      {
        question: "Can I record a video call?",
        answer:
          "You can share the call's tab or window and record what is on it. Tell the other people first: in most places recording someone without telling them is against the law, and it is against the terms of most meeting tools.",
      },
      {
        question: "Why does the recording freeze when I switch tabs?",
        answer:
          "It does not. Browsers stop serving animation frames to a hidden tab, which freezes a canvas recording on its last frame, so this tool keeps its clock in a worker that the browser leaves running. Switch away, work, come back, and the whole take is there.",
      },
      {
        question: "What does Prequel do that this page does not?",
        answer:
          "Prequel records on your Mac rather than in a tab, so it captures at your display's full resolution and exports at up to 4K and 120 fps. It also places the zooms for you, frames the camera, balances the audio and gives you a timeline to cut on.",
      },
    ],
  },
  {
    slug: "webcam-recorder",
    surface: "recorder",
    mode: "camera",
    icon: Webcam,
    navLabel: "Webcam recorder",
    eyebrow: "Free browser tool",
    heading: "Record yourself in the browser",
    name: "Free online webcam recorder",
    lede: "Turn on your camera, pick the frame you are posting to, then record and download the file. Your face never leaves the tab.",
    description:
      "Free online webcam recorder. Record your camera and microphone in the browser, in vertical or landscape, then download the video. No sign up and no upload.",
    summary: "Your camera and microphone, recorded in a tab, in whatever frame you are posting to.",
    steps: [
      {
        name: "Turn on your camera",
        text: "Click Turn on camera and allow access. You see yourself straight away, mirrored, the way you expect to look.",
      },
      {
        name: "Pick the frame",
        text: "Vertical for a Reel or a Short, square for a feed, landscape for anything else. Your face stays centred in all of them.",
      },
      {
        name: "Record and download",
        text: "Record, stop, play it back and save it. Record again as many times as you like: nothing is kept between takes.",
      },
    ],
    features: [
      {
        title: "Record vertical without reframing afterwards",
        body: "The camera is cropped to the middle of the frame rather than squeezed into it, so a 16:9 webcam fills a 9:16 video with your face still in the centre.",
      },
      {
        title: "Use the camera you meant to",
        body: "Every camera your browser can see is in the picker: a built in one, a USB webcam, a capture card, an iPhone on Continuity Camera. Switch with the preview running.",
      },
      {
        title: "Hear yourself before you commit",
        body: "The level moves as you speak, before the countdown. Picking the wrong microphone is the fault you only notice after a ten minute take.",
      },
      {
        title: "Keep your face on your own machine",
        body: "The camera stream is composited and encoded in the tab. Nothing is uploaded, and there is no account to attach a recording to.",
      },
    ],
    faqHeading: "Cameras, frames and the file",
    faq: [
      {
        question: "Where does the video of me go?",
        answer:
          "Into your browser's memory, and then into your downloads folder if you save it. The camera stream is drawn into a canvas in the tab and encoded there, so no frame of it is sent anywhere.",
      },
      {
        question: "Can I record a vertical video for Reels or Shorts?",
        answer:
          "Yes. Pick Vertical 9:16 and the recording is 1080 by 1920. Your camera is cropped to the centre of its frame rather than squashed, so you stay in the middle at any shape.",
      },
      {
        question: "Why am I the wrong way round?",
        answer:
          "Mirror is on by default, because that is the version of your face you know from a mirror. Turn it off in the Camera group and the recording matches what everyone else sees, which is what you want for text on a shirt or a whiteboard behind you.",
      },
      {
        question: "Can I use an external camera?",
        answer:
          "Yes. Every camera your browser can see is in the Camera picker, including a USB webcam, a capture card and an iPhone on Continuity Camera. Switch between them while the preview is running.",
      },
      {
        question: "Is my microphone recorded too?",
        answer:
          "Yes, on the same file, with a level slider that keeps working while the take runs. Turn it off in the Sound group for a silent clip.",
      },
      {
        question: "Does it work on a phone?",
        answer:
          "Yes. A phone browser has a camera and a microphone, so the tool records and downloads as it does on a laptop. Where a phone cannot help is a screen recording, which has no mobile API at all.",
      },
      {
        question: "How long can I record for?",
        answer:
          "Thirty minutes a take. The whole recording is held in the tab until you save it, so the ceiling is there to hand you a file rather than run the tab out of memory.",
      },
      {
        question: "What does Prequel add on a Mac?",
        answer:
          "Prequel records your camera and your screen as separate tracks, so the shape, the size and the corner of your camera are still yours once the take is finished. It also exports at up to 4K.",
      },
    ],
  },
  {
    slug: "voice-recorder",
    surface: "recorder",
    mode: "audio",
    icon: Mic,
    navLabel: "Voice recorder",
    eyebrow: "Free browser tool",
    heading: "Record your voice in the browser",
    name: "Free online voice recorder",
    lede: "Turn on your microphone, watch the level move, then record and download the audio. No account and no upload.",
    description:
      "Free online voice recorder. Record audio in your browser and download it as M4A or WebM. No sign up, no upload, no watermark, nothing installed.",
    summary: "A microphone, a level you can watch, and an audio file at the end of it.",
    steps: [
      {
        name: "Turn on your microphone",
        text: "Click Turn on microphone and allow access. The level moves as you speak, so you know the right device is live.",
      },
      {
        name: "Set the level",
        text: "Speak at the volume you will use and watch the bars. Raise or lower the microphone slider until they move without filling the meter.",
      },
      {
        name: "Record and download",
        text: "Record, pause whenever you need to think, then stop and save. The file is ready the moment the recording ends.",
      },
    ],
    features: [
      {
        title: "Know the microphone is working before you talk for ten minutes",
        body: "The meter reads the device you selected, from the moment it opens. It follows the microphone slider, so what you see is what is being recorded.",
      },
      {
        title: "Stop to think without starting again",
        body: "Pause holds the recording where it is and Resume carries on into the same file. The clock counts recorded time rather than wall clock time.",
      },
      {
        title: "Keep what you said to yourself",
        body: "The audio is encoded by your browser and held in the tab until you download it. There is no upload, no transcript and no account.",
      },
      {
        title: "Get a file anything will open",
        body: "M4A with AAC where your browser can write it, WebM with Opus otherwise. Both open in every editor and both attach to an email.",
      },
    ],
    faqHeading: "Levels, formats and privacy",
    faq: [
      {
        question: "Is anything recorded sent to a server?",
        answer:
          "No. Your microphone goes through an audio graph in the tab and straight into your browser's encoder. The file sits in memory until you download it, and closing the tab discards it.",
      },
      {
        question: "What format is the audio?",
        answer:
          "M4A with AAC in Chrome, Edge and Safari, and WebM with Opus in Firefox. Both are 128 kbps, which is past the point where speech stops gaining anything from more.",
      },
      {
        question: "Can I pause and carry on?",
        answer:
          "Yes. Pause stops the recording and Resume continues into the same file, so a take with three pauses in it is still one download. The clock counts only what was recorded.",
      },
      {
        question: "Why is my recording quiet or distorted?",
        answer:
          "Watch the meter while you speak at your normal volume. Bars that barely move mean the microphone slider is too low, and bars that sit at the ends mean it is too high. Both are fixed before you record rather than after.",
      },
      {
        question: "Can I record a phone call or a meeting?",
        answer:
          "This tool records your microphone, so it captures your side and whatever your microphone can hear in the room. Tell anyone else first: recording a person without telling them is against the law in most places.",
      },
      {
        question: "How long can one recording be?",
        answer:
          "Thirty minutes. Audio is small, but the recording is held in the tab until you save it, so the same ceiling applies as to the video tools.",
      },
      {
        question: "Does it transcribe what I say?",
        answer:
          "No. This page records and nothing else. Prequel transcribes on your Mac, with the model running locally, and writes captions onto a recording.",
      },
      {
        question: "Does it work on a phone?",
        answer:
          "Yes. Safari on iOS and Chrome on Android both record and download. Keep the tab in front: a browser is allowed to suspend a backgrounded page on a phone, and a suspended page stops recording.",
      },
    ],
  },
  {
    slug: "screenshot-editor",
    surface: "editor",
    // Unused by this tool. The field is required rather than optional so that a
    // tool cannot be added without an answer, which is what keeps the three
    // recorders honest about which devices they open.
    mode: "screen",
    icon: Crop,
    navLabel: "Screenshot editor",
    eyebrow: "Free browser tool",
    heading: "Make a screenshot worth looking at",
    name: "Free online screenshot editor",
    lede: "Paste or drop a screenshot, mark it up, put a background behind it, then copy or download it. It opens in this tab and stays there.",
    description:
      "Free online screenshot editor. Add arrows, text, highlights and a background to a screenshot in your browser, then copy or download the PNG. No sign up.",
    summary: "Arrows, text, redactions and a background, on a screenshot you paste in.",
    steps: [
      {
        name: "Bring a screenshot in",
        text: "Paste one with Command V, drag an image onto the panel, or open a file. Nothing is uploaded.",
      },
      {
        name: "Mark it up",
        text: "Arrows, rectangles, a highlighter, text, and a redaction that pixelates what is under it. Undo with Command Z.",
      },
      {
        name: "Put it on a ground",
        text: "Six backgrounds from the Prequel palette, with padding, a corner radius and a shadow under the picture.",
      },
      {
        name: "Copy or download",
        text: "Copy puts the PNG straight on your clipboard, ready to paste into Slack or a ticket. Download saves it at full size.",
      },
    ],
    features: [
      {
        title: "Go from screenshot to posted in one paste",
        body: "Take a shot with Command Shift 4, paste it here, mark it up and copy it out. No file is written to disk unless you ask for one.",
      },
      {
        title: "Point at the thing you are talking about",
        body: "Arrows, outlined rectangles and a highlighter that multiplies rather than greys out the words underneath. Five colours, sized against the image so a mark never vanishes on a Retina capture.",
      },
      {
        title: "Hide what should not be in the picture",
        body: "Redact pixelates the region into blocks and the export is made from that canvas, so the original pixels are not in the file you download.",
      },
      {
        title: "Make it look placed rather than grabbed",
        body: "Six grounds from the Prequel palette, with padding, a corner radius and a shadow. All of it is drawn into the file.",
      },
      {
        title: "Keep every pixel you started with",
        body: "The screenshot is never scaled to fit a frame. The export is your original pixels with the padding around them, so small text stays as sharp as it was captured.",
      },
      {
        title: "Edit without an account",
        body: "No sign up, no upload, no watermark, and no extension to install. Close the tab and the image is gone.",
      },
    ],
    faqHeading: "Marks, privacy and the file",
    faq: [
      {
        question: "Is my screenshot uploaded anywhere?",
        answer:
          "No. The file is read by your browser, drawn into a canvas on your machine and read back out as a PNG. Nothing in the page can send it, and closing the tab discards it.",
      },
      {
        question: "Can I paste a screenshot straight in?",
        answer:
          "Yes. Take one with Command Shift 4 on a Mac or the Snipping Tool on Windows, then paste with Command V or Control V anywhere on the page. Dragging an image onto the panel and opening a file both work too.",
      },
      {
        question: "Does the redaction really remove the information?",
        answer:
          "It pixelates the region into large blocks and draws them back over the picture, and the export is made from that canvas, so the original pixels are not in the file you download. It is not a blur, which can sometimes be undone.",
      },
      {
        question: "What resolution is the export?",
        answer:
          "Your screenshot's own, plus the padding you added. The image is never scaled down to fit a frame, so small text in the export is exactly as sharp as it was in the capture.",
      },
      {
        question: "Can I copy the result straight into Slack?",
        answer:
          "Yes. Copy puts a PNG on your clipboard, so it pastes into Slack, a ticket, a document or an email. Chrome, Edge and Safari all take it, and Download is there for the browser that will not.",
      },
      {
        question: "Can I undo a mark?",
        answer:
          "Command Z steps back through the marks, and selecting one and pressing Backspace removes it. Click a mark with the Select tool to move it, or pick another colour to recolour it.",
      },
      {
        question: "Does it work on any image, or only screenshots?",
        answer:
          "Any image your browser can open: PNG, JPEG, WebP and GIF. A photo takes a background and a shadow the same way a screenshot does.",
      },
      {
        question: "What does Prequel do beyond this?",
        answer:
          "Prequel records your Mac's screen as video, places the zooms on every click, frames your camera and exports at up to 4K. This page is for the times a still is enough.",
      },
    ],
  },
];

export function findFreeTool(slug: string): FreeTool | undefined {
  return freeTools.find((tool) => tool.slug === slug);
}
