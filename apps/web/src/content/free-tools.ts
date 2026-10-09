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

import {
  AudioLines,
  Crop,
  Download,
  FileVideo,
  Mic,
  Monitor,
  Webcam,
  type LucideIcon,
} from "lucide-react";

import type { FaqEntry } from "@/lib/faq";
import type { FormatId } from "@/lib/free-tools/formats";
import type { ToolMode } from "@/lib/free-tools/mode";

/**
 * Which thing a page renders, and what that thing needs to know.
 *
 * A union rather than a string and a pile of optional fields. The recorders need
 * a mode, the converters need a pair of formats and the editor needs neither,
 * and the shape that admits that is the one where a converter cannot be written
 * without its formats. It replaced `surface: "recorder" | "editor"` beside a
 * required `mode`, which left the editor carrying a capture mode it ignored and
 * would have left every converter carrying one too.
 */
export type ToolSurface =
  | { kind: "recorder"; mode: ToolMode }
  | { kind: "editor" }
  | { kind: "converter"; from: FormatId; to: FormatId }
  /**
   * A tool that fetches a video rather than making one. `source` is carried even
   * though there is one of them, because the thing that varies between any
   * second one is the service — and a bare `{ kind: "downloader" }` would put
   * that choice in the component instead, where the registry cannot see it.
   */
  | { kind: "downloader"; source: "x" };

export type FreeTool = {
  /** The MDX filename in `src/content/free-tools`, and the URL segment. */
  slug: string;
  /** What the page renders, and what it needs. */
  surface: ToolSurface;
  /** The mark on this tool's card, on the index and in the footer. */
  icon: LucideIcon;
  /** The footer's label. Two words at most. */
  navLabel: string;
  /** Small caps line above the heading, and the kicker on the share card. */
  eyebrow: string;
  /**
   * The `<h1>`. Under about 60 characters, which is what the card can draw.
   *
   * It says what the page is searched for, in those words: "Convert MOV to
   * MP4 online for free", not "Make a MOV play everywhere". The clever line
   * read well and ranked for nothing, because the phrase people type was on
   * the page nowhere a crawler weights. Kept imperative, since the `HowTo`
   * name is built from it as "How to …".
   */
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
    slug: "twitter-video-downloader",
    surface: { kind: "downloader", source: "x" },
    icon: Download,
    navLabel: "Video downloader",
    eyebrow: "Free browser tool",
    heading: "Download Twitter and X videos online for free",
    name: "Free Twitter and X video downloader",
    lede: "Paste a link to a post and save its video as an MP4, at the size you pick. Old twitter.com links work as well as new ones.",
    description:
      "Twitter and X video downloader. Save a post's video as an MP4 in your browser, up to 1080p, with no sign up and no watermark.",
    summary: "A post link in, the MP4 out, at whatever size the video was stored in.",
    steps: [
      {
        name: "Copy the link to the post",
        text: "Use Copy link on the post. An x.com address and an older twitter.com one both work, and the tracking parameters on the end are ignored.",
      },
      {
        name: "Paste it in and find the video",
        text: "The post is looked up and every size its video was stored at is listed, biggest first.",
      },
      {
        name: "Pick a size",
        text: "The file downloads to your machine, named after the account and the post so it is findable later.",
      },
    ],
    features: [
      {
        title: "Save at the size you want",
        body: "A post's video is stored several times over at different sizes. All of them are offered, so a clip for a slide need not be the full 1080p file.",
      },
      {
        title: "The video does not pass through us",
        body: "We read the post and hand your browser the addresses the video already sits at. It travels from their servers to yours and is never copied onto ours.",
      },
      {
        title: "Old links are not broken links",
        body: "The rename changed the address bar, not the posts. twitter.com, mobile.twitter.com and x.com all point at the same thing and all three are accepted.",
      },
      {
        title: "Nothing is re-encoded",
        body: "What you get is the file being served, byte for byte. There is no quality setting to get wrong, no watermark and no wait while something re-compresses.",
      },
      {
        title: "Looping clips too",
        body: "What a post shows as a GIF is stored as a silent video, and that is the file you get rather than a conversion of it.",
      },
      {
        title: "Nothing to sign up for",
        body: "No account, no email and nothing kept once the page is closed.",
      },
    ],
    faqHeading: "Old links, private posts and file sizes",
    faq: [
      {
        question: "Do twitter.com links still work now the site is called X?",
        answer:
          "Yes. The rename changed the address, not the posts. A link from an old bookmark, a Slack thread or a document written years ago resolves here exactly as a fresh one does.",
      },
      {
        question: "Which posts can it not download?",
        answer:
          "Anything that is not public. A protected account's posts, a deleted post, one from a suspended account and an age-restricted post all come back as unreachable, because this reads a post the same way any website embedding it does.",
      },
      {
        question: "Why is the biggest size sometimes 720p and not 1080p?",
        answer:
          "Because that is as large as the video was ever stored. What gets listed is what is actually being served for that post, which depends on the original upload rather than on this page.",
      },
      {
        question: "Does the video go through your server?",
        answer:
          "No. We look up the post and send your browser the file addresses on their own video host, and your browser downloads from there. The only thing that reaches us is the link you paste.",
      },
      {
        question: "Is a watermark added?",
        answer:
          "No. The file is passed through untouched, so nothing is added to it and nothing is lost from it.",
      },
      {
        question: "Can I download someone else's video and post it myself?",
        answer:
          "That is between you and the person who made it. Saving a video to watch, to quote or to keep is ordinary use; reposting someone's work as your own is not, whatever tool produced the file.",
      },
      {
        question: "Why did a very long video open in a tab instead of saving?",
        answer:
          "Files above about 600 MB are too large to assemble inside a browser tab, so the video opens instead. Right-click it and choose Save Video As, which does the same thing without the memory.",
      },
      {
        question: "Is there a version of this for my own recordings?",
        answer:
          "Prequel records your Mac's screen straight to MP4, at up to 4K and 120 fps, and opens an editor on the take with the zooms already placed.",
      },
    ],
  },
  {
    slug: "screen-recorder",
    surface: { kind: "recorder", mode: "screen" },
    icon: Monitor,
    navLabel: "Screen recorder",
    eyebrow: "Free browser tool",
    heading: "Record your screen online for free",
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
    surface: { kind: "recorder", mode: "camera" },
    icon: Webcam,
    navLabel: "Webcam recorder",
    eyebrow: "Free browser tool",
    heading: "Record your webcam online for free",
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
    surface: { kind: "recorder", mode: "audio" },
    icon: Mic,
    navLabel: "Voice recorder",
    eyebrow: "Free browser tool",
    heading: "Record your voice online for free",
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
    surface: { kind: "editor" },
    icon: Crop,
    navLabel: "Screenshot editor",
    eyebrow: "Free browser tool",
    heading: "Edit a screenshot online for free",
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
  {
    slug: "video-to-mp3",
    surface: { kind: "converter", from: "any", to: "mp3" },
    icon: AudioLines,
    navLabel: "Video to MP3",
    eyebrow: "Free browser tool",
    heading: "Convert a video to MP3 online for free",
    name: "Free video to MP3 converter",
    lede: "Drop a video in and get an MP3 back. It converts in this tab, on your own machine, so there is no upload and no queue.",
    description:
      "Free video to MP3 converter. Pull the audio out of any video in your browser and download an MP3. No upload, no sign up, no queue, no watermark.",
    summary: "Any video in, an MP3 out, converted in the tab rather than on a server.",
    steps: [
      {
        name: "Drop a video in",
        text: "MP4, MOV, WebM, AVI, MKV: anything ffmpeg reads, up to 300 MB. Drag it onto the panel or open a file.",
      },
      {
        name: "Convert",
        text: "The encoder downloads once, then the audio track is decoded and written as a 192 kbps MP3 on your machine.",
      },
      {
        name: "Download",
        text: "The MP3 is ready the moment the run finishes, named after the video it came from.",
      },
    ],
    features: [
      {
        title: "Keep the video on your own machine",
        body: "Every other online converter uploads your file, converts it on a server and emails you a link. This one runs ffmpeg compiled to WebAssembly inside the tab, so the video never leaves your computer.",
      },
      {
        title: "Skip the queue entirely",
        body: "There is no server to be busy, no daily limit and no waiting list. The only thing between you and the file is your own processor.",
      },
      {
        title: "Get audio worth listening to",
        body: "192 kbps, which is past the point where speech or a lecture gains anything from more, and small enough to email. The sample rate is whatever the video had.",
      },
      {
        title: "Convert anything your video came from",
        body: "A screen recording, a Zoom export, a phone video, a DSLR clip. The audio track is taken out as it is found, whatever container it arrived in.",
      },
      {
        title: "Start without an account",
        body: "No sign up, no email for the link, no watermark and nothing installed. Close the tab and both files are gone.",
      },
    ],
    faqHeading: "Quality, size and where the file goes",
    faq: [
      {
        question: "Is my video uploaded to convert it?",
        answer:
          "No. The converter is ffmpeg compiled to WebAssembly, running in this tab on your own processor. Your video is read out of your file system by the page and never sent anywhere, which is also why there is no queue and no link to wait for.",
      },
      {
        question: "What quality is the MP3?",
        answer:
          "192 kbps, at whatever sample rate the video's audio was recorded at. That is comfortably past the point where speech, a lecture or a screen recording gains anything from a higher bitrate, and about a megabyte a minute.",
      },
      {
        question: "Why does it take a moment to start the first time?",
        answer:
          "The encoder is a 32 MB WebAssembly build of ffmpeg, and it downloads the first time you convert something. After that it is cached for the rest of your visit, so a second file starts immediately.",
      },
      {
        question: "How big a video can I convert?",
        answer:
          "About 300 MB. The converter runs inside the tab's memory, which is where that ceiling comes from: the video, the MP3 and the encoder all have to fit in it at once. A long recording is better split first.",
      },
      {
        question: "Which video formats does it take?",
        answer:
          "MP4, MOV, WebM, AVI, MKV, M4V, FLV and most things a camera or a screen recorder writes. If your player opens it, this almost certainly reads it.",
      },
      {
        question: "Does converting to MP3 lose quality?",
        answer:
          "Some, because MP3 is lossy and the audio in your video already was. At 192 kbps the loss is not audible on speech, which is what most people are extracting. For a master, convert to WAV instead and keep the original.",
      },
      {
        question: "Can I convert a YouTube video?",
        answer:
          "Only one you have already downloaded and have the right to use. This page converts a file on your computer; it cannot fetch anything from the web, and downloading other people's videos is between you and their terms.",
      },
      {
        question: "What if I want the video as well as the audio?",
        answer:
          "Keep the original: nothing here changes it. If you are recording something to publish, Prequel records your Mac's screen with the microphone and the system audio on separate tracks, so the two are already apart when you start editing.",
      },
    ],
  },
  {
    slug: "mp4-to-mp3",
    surface: { kind: "converter", from: "mp4", to: "mp3" },
    icon: AudioLines,
    navLabel: "MP4 to MP3",
    eyebrow: "Free browser tool",
    heading: "Convert MP4 to MP3 online for free",
    name: "Free MP4 to MP3 converter",
    lede: "Drop an MP4 in and keep only the sound. It converts in this tab, on your own machine, with no upload and no queue.",
    description:
      "Free MP4 to MP3 converter. Keep the audio from an MP4 and drop the video, in your browser. No upload, no sign up, no queue, no watermark.",
    summary: "An MP4 in, the audio out as an MP3, converted in the tab.",
    steps: [
      {
        name: "Drop the MP4 in",
        text: "Drag it onto the panel or open a file. Up to 300 MB, which is a couple of hours of a screen recording.",
      },
      {
        name: "Convert",
        text: "The AAC audio inside the MP4 is decoded and written out as a 192 kbps MP3, on your own processor.",
      },
      {
        name: "Download",
        text: "The MP3 keeps the MP4's name, so a folder of converted files still tells you which is which.",
      },
    ],
    features: [
      {
        title: "Lose the picture, keep the sound",
        body: "An MP4 is usually H.264 video next to AAC audio. The video track is dropped and the audio is re-encoded, which is why a 400 MB screen recording becomes a 20 MB MP3.",
      },
      {
        title: "Convert without handing over the file",
        body: "The conversion is ffmpeg compiled to WebAssembly, running in this tab. No server sees the MP4, which matters when it is a client call or an internal demo.",
      },
      {
        title: "Get a file anything will play",
        body: "MP3 at 192 kbps opens in every player, every car, every podcast app and every editor, which is the only reason to convert an MP4 that already plays everywhere.",
      },
      {
        title: "Convert as many as you like",
        body: "No daily cap, no sign up, no email for a link. The encoder loads once and every file after it starts immediately.",
      },
    ],
    faqHeading: "Sound, size and privacy",
    faq: [
      {
        question: "Does this upload my MP4 anywhere?",
        answer:
          "No. The page runs ffmpeg inside your browser, so the MP4 is read from your disk, converted on your own processor and written back to your downloads folder. Nothing is sent to a server at any point.",
      },
      {
        question: "How much smaller is the MP3?",
        answer:
          "Usually ten to twenty times. An MP4 spends almost all of its bytes on the picture, so a 400 MB recording of a one hour call lands around 20 to 25 MB as audio at 192 kbps.",
      },
      {
        question: "Will the audio sound worse?",
        answer:
          "Slightly, and not audibly on speech. The AAC inside your MP4 is decoded and re-encoded as MP3 at 192 kbps, which is a second lossy pass; for a call, a lecture or a screen recording it is inaudible. For music you are mastering, keep the original.",
      },
      {
        question: "Can I keep the original quality instead?",
        answer:
          "Convert to WAV if you need the decoded audio with nothing thrown away, or keep the MP4 itself. The file on your disk is untouched by this page either way.",
      },
      {
        question: "What if my MP4 has no sound?",
        answer:
          "The run stops and the page says so. A screen recording made without a microphone or system audio has no audio track at all, so there is nothing to extract.",
      },
      {
        question: "How long does it take?",
        answer:
          "About as long as it takes to read the file, plus a one-off 32 MB download of the encoder on your first conversion. An hour of audio is a minute or two on a current laptop.",
      },
      {
        question: "Does it work on a phone?",
        answer:
          "Yes, on a modern iPhone or Android browser, with a smaller file. A phone has less memory to spare for the encoder, so stay well under the 300 MB ceiling there.",
      },
      {
        question: "Can Prequel record the audio separately in the first place?",
        answer:
          "Yes. Prequel records your microphone and your Mac's system audio as separate tracks with separate gains, so you never have to pull one back out of a finished video.",
      },
    ],
  },
  {
    slug: "mov-to-mp4",
    surface: { kind: "converter", from: "mov", to: "mp4" },
    icon: FileVideo,
    navLabel: "MOV to MP4",
    eyebrow: "Free browser tool",
    heading: "Convert MOV to MP4 online for free",
    name: "Free MOV to MP4 converter",
    lede: "Drop a QuickTime MOV in and get an MP4 back, usually in about a second. It converts in this tab, on your own machine.",
    description:
      "Free MOV to MP4 converter. Turn a QuickTime file into an MP4 in your browser, often without re-encoding. No upload, no sign up, no watermark.",
    summary: "QuickTime in, MP4 out, rewrapped rather than re-encoded wherever it can be.",
    steps: [
      {
        name: "Drop the MOV in",
        text: "A Mac screen recording, an iPhone video, a QuickTime export. Up to 300 MB.",
      },
      {
        name: "Convert",
        text: "The streams are copied into an MP4 container when they can be, which takes a second and loses nothing. Anything else is re-encoded as H.264.",
      },
      {
        name: "Download",
        text: "The MP4 plays on Windows, Android, every browser and every editor, which the MOV often would not.",
      },
    ],
    features: [
      {
        title: "Finish in a second, not a minute",
        body: "A Mac screen recording is already H.264 and AAC inside a QuickTime wrapper, which is the inside of an MP4. The streams are copied across rather than decoded and re-encoded, so nothing is lost and nothing is re-compressed.",
      },
      {
        title: "Keep the quality you recorded",
        body: "A rewrap is byte for byte the same video and the same audio. Where the codecs do not fit in MP4, the fallback is H.264 at CRF 23, which is the quality setting people use for delivery.",
      },
      {
        title: "Send it to somebody on Windows",
        body: "MOV is QuickTime's container and Windows has not shipped QuickTime since 2016. MP4 is the one video file you can send anybody without a conversation about players.",
      },
      {
        title: "Convert without an upload",
        body: "ffmpeg runs in this tab, so a recording of an internal system or a client call is converted on your own machine and never leaves it.",
      },
    ],
    faqHeading: "Speed, quality and players",
    faq: [
      {
        question: "Why was that so fast?",
        answer:
          "Because most MOV files do not need converting, only rewrapping. QuickTime and MP4 can hold the same H.264 video and AAC audio, so the streams are copied into the new container untouched. That is a file copy rather than an encode, and it is lossless.",
      },
      {
        question: "Does converting MOV to MP4 lose quality?",
        answer:
          "Not when it rewraps, which is most of the time: the picture and the sound are the same bytes in a different box. When the MOV holds something MP4 cannot carry, such as ProRes from a camera or a professional editor, it is re-encoded to H.264 and the page takes a little longer.",
      },
      {
        question: "Why is my MOV so large?",
        answer:
          "Screen recordings and camera files are often recorded at a high bitrate to stay editable, and a ProRes export is enormous by design. Rewrapping keeps the size the same; re-encoding to H.264 is what makes it smaller, and that happens automatically when the streams will not fit.",
      },
      {
        question: "Will the MP4 play on Windows?",
        answer:
          "Yes. H.264 in an MP4 plays in Windows Media Player, on Android, in every browser and in every editor. That is usually the reason somebody is on this page.",
      },
      {
        question: "Is my video uploaded?",
        answer:
          "No. The conversion runs inside this tab using ffmpeg compiled to WebAssembly. Your MOV is never sent anywhere, which is not true of most converters at the top of this search.",
      },
      {
        question: "Can I convert an iPhone video?",
        answer:
          "Yes. An iPhone writes H.264 or HEVC in a MOV. H.264 rewraps instantly; HEVC is re-encoded to H.264, which takes longer and makes the file play in more places.",
      },
      {
        question: "What is the size limit?",
        answer:
          "About 300 MB, because the file, the output and the encoder share the tab's memory. A rewrap of a larger file would work in principle, but the ceiling is set where a re-encode stops being safe.",
      },
      {
        question: "Can I skip this step next time?",
        answer:
          "Yes. Prequel records your Mac's screen straight to MP4 with H.264 or HEVC, so what you export is already the file you were going to convert it to.",
      },
    ],
  },
  {
    slug: "mov-to-mp3",
    surface: { kind: "converter", from: "mov", to: "mp3" },
    icon: AudioLines,
    navLabel: "MOV to MP3",
    eyebrow: "Free browser tool",
    heading: "Convert MOV to MP3 online for free",
    name: "Free MOV to MP3 converter",
    lede: "Drop a MOV in and keep only the sound. The conversion happens in this tab, so the recording stays on your machine.",
    description:
      "Free MOV to MP3 converter. Pull the audio out of a QuickTime recording in your browser and download an MP3. No upload and no sign up.",
    summary: "A QuickTime recording in, its audio out as an MP3.",
    steps: [
      {
        name: "Drop the MOV in",
        text: "A Mac screen recording, an iPhone video or a QuickTime export, up to 300 MB.",
      },
      {
        name: "Convert",
        text: "The audio track is decoded out of the QuickTime container and written as a 192 kbps MP3.",
      },
      {
        name: "Download",
        text: "The MP3 arrives named after the recording it came from, ready to send or transcribe.",
      },
    ],
    features: [
      {
        title: "Turn a recorded call into something sendable",
        body: "A one hour QuickTime screen recording is often several hundred megabytes. Its audio is about 25 MB, which attaches to an email and uploads to a transcription service in seconds.",
      },
      {
        title: "Keep the recording to yourself",
        body: "The file is decoded in this tab by ffmpeg compiled to WebAssembly. A recording of an internal call or a customer's screen is never handed to a server.",
      },
      {
        title: "Work with what QuickTime recorded",
        body: "Mac screen recordings carry AAC audio inside a MOV. It is decoded and re-encoded at 192 kbps, which is past the point speech gains anything from more.",
      },
      {
        title: "Nothing to install",
        body: "No sign up, no app, no extension. The encoder downloads once per visit and the conversion runs on your own processor.",
      },
    ],
    faqHeading: "QuickTime, quality and privacy",
    faq: [
      {
        question: "Is a MOV recording uploaded to convert it?",
        answer:
          "No. ffmpeg runs in this tab, so the QuickTime file is read from your disk and converted on your own machine. That is the difference between this page and most of the converters above it in search results.",
      },
      {
        question: "Which MOV files does it handle?",
        answer:
          "Anything with an audio track: a Mac screen recording, an iPhone video, a QuickTime export from an editor. Even a ProRes master works, because only the audio is being decoded.",
      },
      {
        question: "What bitrate is the MP3?",
        answer:
          "192 kbps at the recording's own sample rate, which for a Mac screen recording is 48 kHz. That is about a megabyte a minute and comfortably transparent for speech.",
      },
      {
        question: "Can I transcribe the result?",
        answer:
          "Yes, and an MP3 is what most transcription services want. If the recording is on your Mac, Prequel transcribes it locally and writes captions onto the video instead.",
      },
      {
        question: "Why is there no sound in my MOV?",
        answer:
          "A Mac screen recording made without the microphone or system audio enabled has no audio track at all, so there is nothing to extract. QuickTime's own recorder captures the microphone only unless you add something to route system audio.",
      },
      {
        question: "Does it work with a two hour recording?",
        answer:
          "Up to about 300 MB, which is the tab's memory rather than a policy. A long screen recording is usually larger than that, so split it first or extract the audio on your machine.",
      },
      {
        question: "Is the original changed?",
        answer:
          "No. Nothing here writes to the file you dropped in. You end up with the MOV you had and an MP3 beside it.",
      },
      {
        question: "Can I record the audio separately next time?",
        answer:
          "Yes. Prequel records your microphone and your Mac's system audio on separate tracks with separate gains, so the audio is already its own thing when the take finishes.",
      },
    ],
  },
  {
    slug: "avi-to-mp4",
    surface: { kind: "converter", from: "avi", to: "mp4" },
    icon: FileVideo,
    navLabel: "AVI to MP4",
    eyebrow: "Free browser tool",
    heading: "Convert AVI to MP4 online for free",
    name: "Free AVI to MP4 converter",
    lede: "Drop an AVI in and get an MP4 that plays on a phone, in a browser and in every editor. It converts in this tab.",
    description:
      "Free AVI to MP4 converter. Convert an old AVI to H.264 MP4 in your browser, with no upload and no sign up. Plays on phones and in browsers.",
    summary: "Old AVI in, H.264 MP4 out, converted on your own machine.",
    steps: [
      {
        name: "Drop the AVI in",
        text: "A dash cam clip, an old camcorder file, a DivX download, a capture from screen recording software from the DVD era.",
      },
      {
        name: "Convert",
        text: "The video is re-encoded to H.264 and the audio to AAC, because an AVI almost never holds either already.",
      },
      {
        name: "Download",
        text: "The MP4 is usually smaller than the AVI it came from, and it plays everywhere the AVI did not.",
      },
    ],
    features: [
      {
        title: "Play it on a phone at last",
        body: "AVI is a container from 1992, usually holding DivX or Xvid. No phone plays it and no browser plays it. H.264 in an MP4 plays on everything made this century.",
      },
      {
        title: "Usually come out smaller",
        body: "DivX and Xvid are two codec generations behind H.264, so re-encoding at CRF 23 typically lands at half the size with no visible difference.",
      },
      {
        title: "Edit it afterwards",
        body: "Premiere, Resolve, Final Cut and every browser editor take H.264 MP4 without arguing. Most of them will not import an AVI at all.",
      },
      {
        title: "Convert it without sending it anywhere",
        body: "Old AVI files are usually personal footage. This page converts yours in the tab, on your own processor, and uploads nothing.",
      },
    ],
    faqHeading: "Codecs, size and how long it takes",
    faq: [
      {
        question: "Why does an AVI take longer to convert than a MOV?",
        answer:
          "Because it has to be re-encoded rather than rewrapped. An AVI holds DivX or Xvid, which an MP4 cannot carry, so every frame is decoded and encoded again as H.264. A MOV usually already holds H.264 and is just put in a new box.",
      },
      {
        question: "Will the MP4 look worse than the AVI?",
        answer:
          "Barely, and often better per megabyte. It is re-encoded at CRF 23, a delivery-quality setting, and H.264 is two generations ahead of the codec your AVI is in. A second encode always costs something; at this setting it is hard to see.",
      },
      {
        question: "Why is the MP4 smaller?",
        answer:
          "H.264 compresses far better than DivX or Xvid at the same quality, so the same picture needs fewer bits. Halving the size is normal.",
      },
      {
        question: "How long will it take?",
        answer:
          "Roughly the length of the clip on a current laptop, sometimes longer, because the encoder is WebAssembly on a single thread. A three minute dash cam clip is a few minutes; an hour-long file is better converted on your machine.",
      },
      {
        question: "Is my file uploaded?",
        answer:
          "No. ffmpeg runs in this tab and the AVI never leaves your computer. There is no queue and no link waiting in an inbox.",
      },
      {
        question: "What size can I convert?",
        answer:
          "Up to about 300 MB. The AVI, the MP4 and the encoder share the tab's memory, and that is where a long transcode starts failing part way through.",
      },
      {
        question: "My AVI will not open. What now?",
        answer:
          "A few AVI files hold codecs this build does not carry, usually something proprietary from a camera. VLC will play almost anything and can export an MP4, and the file stays on your machine either way.",
      },
      {
        question: "Does the audio survive?",
        answer:
          "Yes. Whatever the AVI holds, usually MP3 or AC-3, is re-encoded to AAC at 160 kbps inside the MP4.",
      },
    ],
  },
  {
    slug: "webm-to-mp4",
    surface: { kind: "converter", from: "webm", to: "mp4" },
    icon: FileVideo,
    navLabel: "WebM to MP4",
    eyebrow: "Free browser tool",
    heading: "Convert WebM to MP4 online for free",
    name: "Free WebM to MP4 converter",
    lede: "Drop a WebM in and get an H.264 MP4 back. It converts in this tab, so the file stays on your machine.",
    description:
      "Free WebM to MP4 converter. Convert VP8 or VP9 WebM video to H.264 MP4 in your browser. No upload, no sign up, no watermark.",
    summary: "WebM in, H.264 MP4 out, for the players and editors that refuse WebM.",
    steps: [
      {
        name: "Drop the WebM in",
        text: "A browser recording, a download from a web app, an export from an online editor. Up to 300 MB.",
      },
      {
        name: "Convert",
        text: "VP8 or VP9 video is re-encoded to H.264 and Opus or Vorbis audio to AAC, because MP4 holds neither of the originals.",
      },
      {
        name: "Download",
        text: "The MP4 imports into Premiere, Final Cut and Resolve, and plays on a phone, which a WebM often will not.",
      },
    ],
    features: [
      {
        title: "Get a file your editor will import",
        body: "Premiere and Final Cut do not take WebM. H.264 in an MP4 is the format every editor on every platform opens without a plugin.",
      },
      {
        title: "Play it on hardware that will not",
        body: "WebM depends on VP8 or VP9, which older iPhones, smart TVs and set-top boxes do not decode. H.264 has been in silicon everywhere for fifteen years.",
      },
      {
        title: "Keep it off a server",
        body: "A WebM is usually something you just recorded in a browser. It is converted here in the same browser, by ffmpeg compiled to WebAssembly, and uploaded nowhere.",
      },
      {
        title: "Start playing before it finishes downloading",
        body: "The MP4 is written with its index at the front, so a file posted to a site or sent in a chat starts playing immediately rather than after the whole download.",
      },
    ],
    faqHeading: "Codecs, speed and quality",
    faq: [
      {
        question: "Why does WebM need converting at all?",
        answer:
          "Because of what is inside it. WebM holds VP8 or VP9 video and Opus audio, which browsers decode and most editors, phones and televisions do not. MP4 holds H.264 and AAC, which everything decodes.",
      },
      {
        question: "Does the conversion lose quality?",
        answer:
          "A little, as any second encode does. It re-encodes at CRF 23, a delivery-quality setting, so the result is visually very close to the WebM at a similar or smaller size.",
      },
      {
        question: "Why is it slower than converting a MOV?",
        answer:
          "A MOV usually holds H.264 already and is simply rewrapped. Nothing in a WebM can go into an MP4 untouched, so every frame is decoded and encoded again, on one thread in WebAssembly.",
      },
      {
        question: "Is the file uploaded?",
        answer:
          "No. It is converted in this tab on your own processor, which is why there is no queue and no link to wait for.",
      },
      {
        question: "Can it convert a browser screen recording?",
        answer:
          "Yes, and that is the common case. Browser recorders write WebM in Chrome and Firefox, which is exactly what will not import into an editor afterwards.",
      },
      {
        question: "How large a file can it take?",
        answer:
          "About 300 MB. The input, the output and the encoder share the tab's memory, so the ceiling is set where a long transcode stops being reliable.",
      },
      {
        question: "What happens to the audio?",
        answer:
          "Opus or Vorbis is decoded and re-encoded as AAC at 160 kbps, which is what an MP4 can carry and what every player expects.",
      },
      {
        question: "How do I avoid the conversion next time?",
        answer:
          "Record somewhere that writes MP4 to begin with. Prequel records your Mac's screen straight to H.264 or HEVC in an MP4, at up to 4K, with no conversion step afterwards.",
      },
    ],
  },
  {
    slug: "mp4-to-webm",
    surface: { kind: "converter", from: "mp4", to: "webm" },
    icon: FileVideo,
    navLabel: "MP4 to WebM",
    eyebrow: "Free browser tool",
    heading: "Convert MP4 to WebM online for free",
    name: "Free MP4 to WebM converter",
    lede: "Drop an MP4 in and get a WebM back, converted in this tab. Useful when a site, a wiki or a web app will only take WebM.",
    description:
      "Free MP4 to WebM converter. Convert H.264 MP4 to VP8 WebM in your browser, with no upload and no sign up. For sites that only accept WebM.",
    summary: "MP4 in, WebM out, for the places that insist on a royalty-free codec.",
    steps: [
      {
        name: "Drop the MP4 in",
        text: "Anything up to 300 MB. A short clip is the right shape for this one.",
      },
      {
        name: "Convert",
        text: "The video is encoded as VP8 and the audio as Vorbis, which is the pair every browser has decoded for a decade.",
      },
      {
        name: "Download",
        text: "The WebM is ready to upload wherever the MP4 was refused.",
      },
    ],
    features: [
      {
        title: "Satisfy a site that refuses MP4",
        body: "Wikipedia, some forums and a number of open-source projects accept only royalty-free formats. WebM is what they mean, and this produces one without an account.",
      },
      {
        title: "Convert a clip while you wait",
        body: "VP8 at 1 Mbit is the setting here, chosen so a short clip finishes in about its own length rather than in four times it. VP9 would be smaller and far slower in a browser.",
      },
      {
        title: "Keep the video off a server",
        body: "The whole encode runs in this tab, so an unreleased product video is converted on your own machine rather than uploaded to somebody's queue.",
      },
      {
        title: "Nothing to sign up for",
        body: "No account, no email, no watermark and no cap on how many files you convert.",
      },
    ],
    faqHeading: "Speed, quality and when to use WebM",
    faq: [
      {
        question: "Why is this conversion slower than the others?",
        answer:
          "Because every frame has to be encoded with VP8, and video encoding is the slowest thing a browser can be asked to do. It runs single-threaded in WebAssembly, so expect roughly the length of the clip, and keep to short ones.",
      },
      {
        question: "Why VP8 rather than VP9?",
        answer:
          "VP9 makes smaller files and takes around four times as long to encode. In a tab, on one thread, that is the difference between waiting and giving up. VP8 plays in every browser that plays VP9.",
      },
      {
        question: "Should I be converting to WebM at all?",
        answer:
          "Only if something is asking for it. Every browser has played H.264 MP4 for years, so WebM is for places with a royalty-free policy, such as Wikipedia, or for a specific web app that insists.",
      },
      {
        question: "Does the file get smaller?",
        answer:
          "Not necessarily. At the bitrate used here a WebM is usually close to the MP4 it came from, and sometimes larger. Size is not the reason to convert; compatibility with a particular site is.",
      },
      {
        question: "Is my video uploaded?",
        answer: "No. ffmpeg runs inside this tab and the MP4 never leaves your computer.",
      },
      {
        question: "What is the size limit?",
        answer:
          "About 300 MB, and in practice you want far less for this conversion: it is the slowest of the set, so a clip of a minute or two is the right size.",
      },
      {
        question: "What happens to the audio?",
        answer:
          "AAC is decoded and re-encoded as Vorbis, which is the audio codec WebM carries and every browser decodes.",
      },
      {
        question: "Is there a version of this that does not need converting?",
        answer:
          "The browser recorder on this site writes WebM directly in Chrome and Firefox, so a recording made there needs no conversion at all.",
      },
    ],
  },
  {
    slug: "mkv-to-mp4",
    surface: { kind: "converter", from: "mkv", to: "mp4" },
    icon: FileVideo,
    navLabel: "MKV to MP4",
    eyebrow: "Free browser tool",
    heading: "Convert MKV to MP4 online for free",
    name: "Free MKV to MP4 converter",
    lede: "Drop an MKV in and get an MP4 back, usually in a second. It converts in this tab, on your own machine.",
    description:
      "Free MKV to MP4 converter. Turn a Matroska file into an MP4 in your browser, often without re-encoding. No upload and no sign up.",
    summary: "Matroska in, MP4 out, rewrapped in a second where the codecs allow.",
    steps: [
      {
        name: "Drop the MKV in",
        text: "A recording from OBS, a download, an export that came out as Matroska. Up to 300 MB.",
      },
      {
        name: "Convert",
        text: "When the video and audio are already H.264 and AAC, they are copied into an MP4 container untouched. Anything else is re-encoded.",
      },
      {
        name: "Download",
        text: "The MP4 opens in every editor and plays on every phone, which is what the MKV would not do.",
      },
    ],
    features: [
      {
        title: "Finish almost immediately",
        body: "An MKV from OBS is usually H.264 and AAC already, which is exactly what an MP4 holds. The streams are copied into the new container rather than re-encoded, so it takes about a second and loses nothing.",
      },
      {
        title: "Stop depending on VLC",
        body: "Matroska plays in VLC and in very little else. MP4 plays in QuickTime, in Windows, on every phone, in every browser and in every editor.",
      },
      {
        title: "Recover a recording that will not import",
        body: "OBS writes MKV because an interrupted recording survives it. Rewrapping to MP4 is the step that was always meant to follow, and it is the same lossless copy OBS does itself.",
      },
      {
        title: "Convert without an upload",
        body: "Everything happens in this tab. A recording of a game, a call or an internal demo is never sent to a server.",
      },
    ],
    faqHeading: "Speed, tracks and compatibility",
    faq: [
      {
        question: "Why was that nearly instant?",
        answer:
          "Because an MKV usually needs rewrapping rather than converting. Matroska and MP4 can both hold H.264 and AAC, so the streams are copied into the new container untouched. It is a file copy, and it is lossless.",
      },
      {
        question: "Does it lose quality?",
        answer:
          "Not when it rewraps, which is the common case. When the MKV holds something MP4 cannot carry, the video is re-encoded to H.264 at CRF 23 and the page takes longer.",
      },
      {
        question: "What happens to subtitles and extra audio tracks?",
        answer:
          "They are dropped. Matroska can carry several audio tracks and subtitle streams; this conversion keeps the first video and the first audio track, which is what an MP4 is normally expected to hold.",
      },
      {
        question: "Why does OBS record MKV instead of MP4?",
        answer:
          "Because an MP4 that loses power mid-recording is often unreadable, while an MKV survives it. OBS recommends recording to MKV and remuxing afterwards, which is exactly what this page does.",
      },
      {
        question: "Is my recording uploaded?",
        answer:
          "No. ffmpeg runs in this tab, so the MKV is converted on your own processor and never sent anywhere.",
      },
      {
        question: "What size can it handle?",
        answer:
          "About 300 MB. Game and gameplay recordings are often much larger, and those are better remuxed on your machine with ffmpeg or with OBS's own remux tool.",
      },
      {
        question: "Will the MP4 play on a TV or a console?",
        answer:
          "Where the MKV did not, usually yes. H.264 in an MP4 is the most widely decoded combination there is.",
      },
      {
        question: "Is there a recorder that writes MP4 to start with?",
        answer:
          "Prequel records your Mac's screen straight to MP4, at up to 4K and 120 fps, with the zooms already placed and the camera framed when the editor opens.",
      },
    ],
  },
];

export function findFreeTool(slug: string): FreeTool | undefined {
  return freeTools.find((tool) => tool.slug === slug);
}
