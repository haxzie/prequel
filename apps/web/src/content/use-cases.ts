/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  This is the file you edit to publish a use-case page.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  1. Write `src/content/create/<slug>.mdx` — prose only, no frontmatter, and
 *     no `#` heading: the `<h1>` is the hero, and a second one on the page is
 *     the easiest own goal here. Start at `##`.
 *  2. Add an entry below whose `slug` is that filename.
 *
 *  Aim for 250–450 words of MDX, two or three `##` sections. Below that the
 *  page is thin content sitting on a body every other page shares, which is the
 *  whole failure mode of a set like this. Much above it and the screenshot
 *  falls off the first two scrolls.
 *
 *  Metadata lives here rather than in the MDX for the same reason it does for
 *  blog posts — see the header of `posts.ts`. `@next/mdx` does not read
 *  frontmatter.
 */

import type { FaqEntry } from "@/lib/faq";

export type UseCase = {
  /** The MDX filename in `src/content/create`, and the URL segment. */
  slug: string;
  /** Small caps line above the heading. Also the kicker on the OG card. */
  eyebrow: string;
  /**
   * The `<h1>`.
   *
   * Keep it under about 60 characters. `ogCard` draws it at 64px inside 1200px
   * with 72px of padding — roughly 30 characters a line — and satori neither
   * truncates nor shrinks to fit, so a third line runs off the card.
   */
  heading: string;
  /** The paragraph under the heading. */
  lede: string;
  /** Short page title; the layout template appends ` · Prequel`. */
  title: string;
  /** The meta description, and the description on both share cards. */
  description: string;
  /** Label in the footer's Use cases column. Shorter than `heading`. */
  navLabel: string;
  /**
   * This page's entire FAQ, not a prefix to a shared one.
   *
   * Six or seven questions, written in the language of the phrase this page is
   * for. They used to be two or three specific ones followed by the home page's
   * thirteen, which put the same answers on all sixteen pages — as visible copy
   * and again as `FAQPage` structured data, so a couple of hundred duplicated
   * Q&A blocks across a set of pages that exist to rank for different things.
   *
   * So a fact that is true everywhere gets written out again here, in this
   * page's words. That is the cost and it is the point: an answer phrased for
   * someone recording a bug report is not the answer for someone recording a
   * course lesson, even when the underlying fact is identical.
   */
  faq: FaqEntry[];
};

/**
 * Declaration order is the footer's order, so unlike `posts` it is
 * load-bearing: there is no date to sort on and no index page to re-order
 * things. The money pages come first and the two capability pages last —
 * those compete with the home page's own intent and should not outrank it.
 */
export const useCases: UseCase[] = [
  {
    slug: "product-demo-video",
    eyebrow: "Product demos",
    heading: "Record a product demo that looks produced",
    lede: "Walk through the product once. Prequel pushes in on every click, frames your camera, sets it on a background and exports one MP4 at up to 4K.",
    title: "Record a product demo video on Mac",
    description:
      "Make a product demo on macOS without opening an editor. Automatic zooms on every click, a framed camera, a background worth shipping, and a 4K MP4 at the end.",
    navLabel: "Product demos",
    faq: [
      {
        question: "How long does a product demo take to make?",
        answer:
          "About as long as the demo runs, plus the time you spend changing your mind. The editor opens on the take with the zooms already placed, the camera framed and a background applied, so the first thing you see is close to the finished video rather than raw footage waiting for an hour of work.",
      },
      {
        question: "How long should a product demo video be?",
        answer:
          "Two to three minutes for a demo someone chose to watch, under ninety seconds for one embedded on a landing page. Cutting to length is a scrub and a blade rather than a re-record, so the honest answer is to record the whole walkthrough and decide afterwards where it stops earning attention.",
      },
      {
        question: "Can I fix one step without recording the whole demo again?",
        answer:
          "Yes. The take is a timeline, so trim the part that went wrong and record a replacement. Layout, background and audio can all change mid-take, which means a re-recorded step does not have to match the framing of the one it replaces.",
      },
      {
        question: "Will the small text in my product be readable?",
        answer:
          "That is what the zooms are for. Capture runs at your display's native resolution, so a Retina Mac exporting at 1080p has roughly three times the pixels it needs and a 2x push still lands on real detail. Region zooms hold still, which is what you want over a form or a settings panel.",
      },
      {
        question: "Do I need to know how to edit video?",
        answer:
          "No, and that is the point of the automatic first pass. What usually needs an editor — deciding where to push in, framing the webcam, putting the recording on a background, balancing the audio — has already happened by the time the window opens. Everything it decided is an ordinary slice you can move, retime or delete.",
      },
      {
        question: "What do I need to record a product demo on my Mac?",
        answer:
          "An Apple Silicon Mac running macOS 14 or later, and the Screen Recording permission. If the demo involves typing into your product, granting Accessibility as well lets the zooms follow the field you are filling in — leave it off and clicks still drive them.",
      },
      {
        question: "Does my demo footage get uploaded anywhere?",
        answer:
          "Not to make the video. Recording, editing and export all happen on your Mac's own media engine, so a demo full of customer data or an unreleased product never leaves the machine it was recorded on. There is no upload step and no cloud render.",
      },
    ],
  },
  {
    slug: "app-demo-video",
    eyebrow: "App demos",
    heading: "Show your app the way the store would",
    lede: "Record the app on your own machine and let Prequel do the part that usually needs an editor — the pushes, the framing, the background, the cuts.",
    title: "Record an app demo video on Mac",
    description:
      "Record a demo of your Mac app and get back something shaped like a store listing. Automatic zooms, a framed camera, and export at up to 4K.",
    navLabel: "App demos",
    faq: [
      {
        question: "Can I record an iPhone app with Prequel?",
        answer:
          "Not directly. Prequel captures a display, a window or a region of your Mac, so the app has to be on screen already — mirroring the device to your Mac and capturing that window works, and everything after the capture is identical.",
      },
      {
        question: "Can I record just the app window instead of the whole screen?",
        answer:
          "Yes. A window is one of the three things you can point Prequel at, alongside a whole display and a region you drag. Recording the window keeps the rest of your desktop — and whatever is in your menu bar — out of the take entirely, which is usually easier than cropping it back out.",
      },
      {
        question: "Can I get a vertical version for the store listing?",
        answer:
          "Yes, from the same take. Framing is stored as proportions of the frame's shorter edge rather than in pixels, so switching a recording from 16:9 to 9:16 keeps the camera and the padding where you put them instead of sliding them off the edge.",
      },
      {
        question: "How do I show a feature that takes a lot of clicks?",
        answer:
          "Record it at the pace you would actually use it and let the cuts do the compression. Every click becomes a zoom, so the viewer is pushed in on the thing being pressed rather than watching a pointer cross an unchanged screen, and the stretches in between are the first thing to trim.",
      },
      {
        question: "Will the app's interface be sharp in the export?",
        answer:
          "Capture is at your display's native resolution, so a Retina Mac has real detail to push into rather than an upscale. Export runs at up to 4K through your Mac's own media engine in H.264 or HEVC, at a constant frame rate.",
      },
      {
        question: "What do I need to record an app demo on macOS?",
        answer:
          "An Apple Silicon Mac running macOS 14 or later, and the Screen Recording permission granted in System Settings. Nothing else is installed and nothing runs in the background between recordings.",
      },
      {
        question: "Is the recording processed in the cloud?",
        answer:
          "No. Capture, editing and export all run locally on your Mac. An unreleased app being demonstrated a fortnight before launch stays on the machine that recorded it.",
      },
    ],
  },
  {
    slug: "sales-demo-video",
    eyebrow: "Sales",
    heading: "Send the demo instead of booking the call",
    lede: "Record the walkthrough once, at the quality you would want on a call, and let it answer the question while you are asleep.",
    title: "Record a sales demo video on Mac",
    description:
      "Record a sales demo on macOS that holds up without you narrating it live. Zooms on the part that matters, your camera in the corner, exported as one MP4.",
    navLabel: "Sales demos",
    faq: [
      {
        question: "Does my face have to be in it?",
        answer:
          "No, and you can decide after recording. The webcam is written as its own track rather than burned into the screen, so a take recorded with the camera on can ship without it — and its shape, size and corner are all still yours if you keep it.",
      },
      {
        question: "How long should a sales demo video be?",
        answer:
          "Shorter than the call it replaces. Three to five minutes covers a product properly when the prospect asked for it; a video attached to a cold email has under a minute to earn the rest. Record the full walkthrough and cut down — the timeline makes several lengths out of one take.",
      },
      {
        question: "Can I make one demo and cut it for different prospects?",
        answer:
          "Yes. Cuts are slices on a timeline, so a long walkthrough is the source for several shorter ones. Nothing is baked in until you export, and each export is an ordinary MP4.",
      },
      {
        question: "Can I talk over the demo while I record it?",
        answer:
          "Yes. Your microphone and the system audio are captured alongside the screen as separate tracks, so the narration is recorded in the same pass as the walkthrough and the two are still independent afterwards.",
      },
      {
        question: "Will the prospect see a watermark?",
        answer:
          "No. The export is your video, at whatever resolution you chose, with nothing added to it.",
      },
      {
        question: "Is the customer data in my demo safe?",
        answer:
          "It never leaves your Mac to become a video. Recording, editing and export are all local, so a demo recorded against a real account is not uploaded anywhere as part of making it. What you do with the finished MP4 is then an ordinary file decision.",
      },
      {
        question: "What do I need to record a sales demo on a Mac?",
        answer:
          "An Apple Silicon Mac on macOS 14 or later, and the Screen Recording permission. Recording your microphone alongside it asks for the Microphone permission the first time.",
      },
    ],
  },
  {
    slug: "onboarding-video",
    eyebrow: "Onboarding",
    heading: "Onboarding that customers actually finish",
    lede: "A recording that pushes in on the thing being clicked is a recording people watch to the end. Prequel places those pushes for you.",
    title: "Record a customer onboarding video on Mac",
    description:
      "Record onboarding videos on macOS that people finish. Automatic zooms on every click, a framed camera, balanced audio and a 4K MP4 — no editor required.",
    navLabel: "Onboarding videos",
    faq: [
      {
        question: "How long should an onboarding video be?",
        answer:
          "Under two minutes for the one that plays on first launch, and one video per job rather than one covering everything. Completion falls off a cliff somewhere around the three-minute mark, which is an argument for cutting a long take into several short ones — the same take can produce all of them.",
      },
      {
        question: "How do I keep an onboarding video current?",
        answer:
          "Re-record the step that changed rather than the whole video. The take is a timeline of slices, so replacing ninety seconds in the middle is a trim and a new recording, not a fresh start.",
      },
      {
        question: "Can I make a short version for the in-app tour?",
        answer:
          "Trim the take down and export it again at a different frame preset. The look survives the change, because the geometry is stored in proportions rather than pixels.",
      },
      {
        question: "Can I record onboarding videos without being on camera?",
        answer:
          "Yes. The webcam is optional and, when it is on, it is recorded as its own track — so a video can ship with the camera, without it, or with it appearing only for the introduction.",
      },
      {
        question: "How do I make the interface readable in a small embedded player?",
        answer:
          "Let the zooms do it. Prequel pushes in on what you clicked, so the control being explained fills the frame rather than sitting as twelve pixels of text in a corner. A region zoom holds still over a form, which is what a signup step usually needs.",
      },
      {
        question: "Can I fix the sound if a notification lands mid-recording?",
        answer:
          "Yes. The microphone and system audio are separate tracks with separate gains, so a notification arriving over your voice is a slider afterwards rather than a reason to start again.",
      },
      {
        question: "What does Prequel need to run?",
        answer:
          "An Apple Silicon Mac on macOS 14 or later and the Screen Recording permission. Zooms that follow what you type also use Accessibility; without it that input is absent rather than broken.",
      },
    ],
  },
  {
    slug: "training-video",
    eyebrow: "Training",
    heading: "Record the training video once",
    lede: "Do the process on your screen while Prequel watches where you click and type. What comes back is the video you would have spent an afternoon editing.",
    title: "Record a training video on Mac",
    description:
      "Record internal training and process videos on macOS. Zooms placed automatically, the cursor cleaned up, microphone and system audio on separate gains.",
    navLabel: "Training videos",
    faq: [
      {
        question: "How long does it take to turn a screen recording into a training video?",
        answer:
          "The recording, plus the trimming. There is no import step, no render queue and no zooms to place by hand — the editor opens on the take with those already decided, so the work left is deciding what to cut.",
      },
      {
        question: "Can I record a process that spans several apps?",
        answer:
          "Record the whole screen and the take follows you between them. Cursor zooms track the pointer across the display, so moving from a browser to a spreadsheet does not lose the viewer.",
      },
      {
        question: "What about the notification that lands mid-recording?",
        answer:
          "It lands on the system audio track, not on your voice. The two are captured separately and mixed only at export, so pulling the alert down is a gain on one clip — no part of the narration has to be recorded twice.",
      },
      {
        question: "Can I narrate a training video as I record it?",
        answer:
          "Yes. The microphone is captured in the same pass as the screen, on its own track, so the narration and the demonstration are recorded together and mixed separately.",
      },
      {
        question: "How do I keep internal data out of a training video?",
        answer:
          "Two ways, both decided before you record: point Prequel at a single window rather than the whole display, or drag a region around the part of the screen you want captured. Anything outside it was never recorded. If something slips through mid-take, the timeline is the other answer — cut those seconds out.",
      },
      {
        question: "Can I pause partway through a long process?",
        answer:
          "Yes, with a global shortcut that works while another app has focus. Paused spans are removed from the recording rather than left as a freeze, so a ten-minute take paused for half an hour is still a ten-minute file.",
      },
      {
        question: "Does it work on macOS Sonoma?",
        answer:
          "Yes — macOS 14 is the floor, and Sonoma is 14. An Apple Silicon Mac and the Screen Recording permission are the other two requirements.",
      },
    ],
  },
  {
    slug: "online-course-video",
    eyebrow: "Courses",
    heading: "Record course lessons that hold attention",
    lede: "One distance from the viewer for forty minutes is what makes a lesson hard to watch. Prequel varies it for you, on the moments that earn it.",
    title: "Record online course videos on Mac",
    description:
      "Record course lessons on macOS with the zooms, the camera framing and the cuts already done. Export at up to 4K, or vertical for a course promo.",
    navLabel: "Course lessons",
    faq: [
      {
        question: "Can I keep the framing consistent across a whole course?",
        answer:
          "The camera shape, size, corner and the background are settings on the take, so a lesson recorded in week six can be given the same treatment as one from week one. Nothing about the look is decided while you record.",
      },
      {
        question: "Can I pause in the middle of a lesson?",
        answer:
          "Yes, from a global shortcut, so you can stop to find a file or answer the door without leaving it in the recording. Paused spans are subtracted from the timeline rather than frozen into it — the file is as long as the lesson, not as long as the session.",
      },
      {
        question: "Is a long lesson going to be an enormous file?",
        answer:
          "Export is hardware H.264 or HEVC through your Mac's own media engine at a constant frame rate, which is a great deal more efficient than the MOV a plain screen recording leaves you with.",
      },
      {
        question: "What resolution should I export course lessons at?",
        answer:
          "1080p is right for most course platforms and keeps the file small enough to upload comfortably. Export at 4K when the lesson is mostly code or dense interface, where the extra pixels are doing real work. Both come off the same take.",
      },
      {
        question: "How do I stop a forty-minute lesson feeling flat?",
        answer:
          "By not holding one distance from the viewer for forty minutes. The automatic pass varies it for you — pushing in when you click or type and pulling back when you move on — and zoom level, speed and easing are set per zoom if a particular moment wants more or less.",
      },
      {
        question: "Can I make a short promo clip from a lesson?",
        answer:
          "Yes, from the same recording. Trim to the ninety seconds worth showing, switch the frame preset to 9:16 or 1:1, and export again. The framing survives the change because it is stored in proportions rather than pixels.",
      },
      {
        question: "What do I need to record course videos on a Mac?",
        answer:
          "An Apple Silicon Mac on macOS 14 or later, and the Screen Recording permission. Your microphone and webcam are asked for the first time you record with them.",
      },
    ],
  },
  {
    slug: "software-tutorial",
    eyebrow: "Tutorials",
    heading: "Software tutorials people can follow",
    lede: "Record the steps once. The zooms land on what you clicked, the cursor stops wandering, and the result is a tutorial rather than a screen capture.",
    title: "Record a software tutorial on Mac",
    description:
      "Record software tutorials on macOS with zooms on every click and a cursor that behaves. No editor, no watermark, and a 4K MP4 at the end.",
    navLabel: "Software tutorials",
    faq: [
      {
        question: "How do I record a software tutorial on a Mac?",
        answer:
          "Pick a display, a window or a dragged region, and start. Prequel records the screen along with your webcam, microphone and system audio, then opens an editor on the take with the zooms already placed on what you clicked. Trim what you fumbled and export one MP4.",
      },
      {
        question: "Do I have to place the zooms myself?",
        answer:
          "No. Prequel records where you click and type as it captures, and those moments are clustered into zooms before the editor opens. Every one of them is an ordinary slice afterwards, so moving, retiming or deleting one is the same work as adding your own.",
      },
      {
        question: "Can I zoom in on a form rather than the cursor?",
        answer:
          "Draw a region zoom over it. A region is one of three things a zoom can aim at, and it is the one that stays put — which is what a form wants, because the viewer is reading it rather than watching the pointer. Aim at the cursor instead and the frame travels with the mouse.",
      },
      {
        question: "The cursor is tiny once I export. Can I fix that?",
        answer:
          "There are four pointer styles and the cursor is resized to survive a zoom. It also leaves the frame after a few seconds of stillness, rather than sitting parked over the thing you are explaining.",
      },
      {
        question: "Can I record one window instead of the whole screen?",
        answer:
          "Yes. A window and a dragged region are both capture targets alongside a full display, which keeps the rest of your desktop out of the tutorial without cropping it back out afterwards.",
      },
      {
        question: "Can I just use QuickTime for this?",
        answer:
          "For a plain screen capture, yes. What QuickTime will not do is record your camera in the same pass, capture system audio without a virtual audio driver, or push in on what you are doing — all of which are the difference between a screen capture and a tutorial someone can follow.",
      },
      {
        question: "What do I need to record a software tutorial?",
        answer:
          "An Apple Silicon Mac running macOS 14 or later and the Screen Recording permission. Accessibility is optional and only feeds the zooms that follow what you type.",
      },
    ],
  },
  {
    slug: "youtube-tutorial",
    eyebrow: "YouTube",
    heading: "Screen recordings ready for YouTube",
    lede: "Record, look at a take that already has the pushes and the framing, trim what you fumbled, and export at 4K.",
    title: "Record a screen tutorial for YouTube on Mac",
    description:
      "Record screen tutorials for YouTube on macOS. Automatic zooms, a framed webcam, backgrounds, and export at up to 4K and 120fps with no watermark.",
    navLabel: "YouTube tutorials",
    faq: [
      {
        question: "Is there a watermark?",
        answer: "No. The export is your video.",
      },
      {
        question: "Can I record at 4K60 without dropping frames?",
        answer:
          "Capture and export both run on your Mac's own media engine — hardware H.264 or HEVC, composited in Metal — so 1080p60 records without dropping frames and 4K is a setting rather than a compromise. Up to 120fps, at a constant frame rate.",
      },
      {
        question: "What size should I export a YouTube tutorial at?",
        answer:
          "1920 by 1080 for most tutorials and 4K when the video is mostly code or dense interface. Both are frame presets, and there is a YouTube preset that is 16:9 at 1080p if you would rather not think about it.",
      },
      {
        question: "Do I need to upload anything to edit it?",
        answer:
          "No. Recording, editing and export all happen on your Mac. There is no upload step and no cloud render, so a forty-minute take does not begin with a forty-minute wait.",
      },
      {
        question: "Can I record my face and my screen at the same time?",
        answer:
          "Yes, in one pass and as separate tracks. That is what lets you decide afterwards whether the camera is in the video at all, what shape it is, which corner it sits in and whether it appears for the whole runtime or only the introduction.",
      },
      {
        question: "How do I make a screen recording look less flat?",
        answer:
          "Put it on a background. Padding, corner radius, a border and a drop shadow are all settings on the take, over a solid colour, a gradient, your own desktop picture or an image you supply — which is most of the difference between a raw capture and something that looks made.",
      },
      {
        question: "Can I make a Short out of the same recording?",
        answer:
          "Yes. Trim to the section worth clipping, switch the frame preset to 9:16 and export again. The framing is stored in proportions rather than pixels, so the camera and the padding stay where you put them.",
      },
    ],
  },
  {
    slug: "youtube-shorts-video",
    eyebrow: "Vertical",
    heading: "The same take, vertical",
    lede: "Record once in landscape and switch the frame to 9:16. The camera and the padding stay where you put them instead of sliding off the edge.",
    title: "Make vertical screen recordings for Shorts and Reels",
    description:
      "Turn a landscape screen recording into a vertical one on macOS. Framing is stored in proportions, so the look survives the switch to 9:16, 1:1 or 4:5.",
    navLabel: "Shorts and Reels",
    faq: [
      {
        question: "Why does the layout not break when I switch to vertical?",
        answer:
          "Because none of it is stored in pixels. Every geometry setting is a fraction of the frame's shorter edge, so a camera sized a quarter of the way across a 16:9 frame is sized the same way in 9:16 rather than being cropped out of it.",
      },
      {
        question: "Which vertical sizes are there?",
        answer:
          "Vertical 9:16, square 1:1 and portrait 4:5, plus named presets for Shorts, TikTok, Reels, X and LinkedIn. Landscape 16:9 and 4K are on the same list.",
      },
      {
        question: "Can I make a vertical cut of something I recorded in landscape?",
        answer:
          "Yes, and it is the ordinary way to work — record once at whatever suits your screen, then switch the frame preset. Nothing is re-recorded and nothing is re-cropped by hand; the layout is re-solved for the new frame.",
      },
      {
        question: "Can I import a video I recorded somewhere else?",
        answer:
          "No. Prequel edits takes it recorded itself, because the editor depends on things a finished file does not carry — the webcam as its own track, the microphone and system audio kept apart, and where the pointer was at every moment. A rendered MP4 has none of that left in it.",
      },
      {
        question: "Where does the webcam sit in a vertical frame?",
        answer:
          "Wherever you put it, and it stays there. Its position is a fraction of the frame rather than a pixel offset, so a camera in the bottom-right of a landscape take is in the bottom-right of the vertical one instead of off the edge. Size, shape and corner are all still adjustable afterwards.",
      },
      {
        question: "How long can a Short be?",
        answer:
          "Up to three minutes on YouTube Shorts now, though the ones that hold up are far shorter. Trimming to length is a scrub and a blade cut, with a waveform under every clip to find where you stopped talking.",
      },
      {
        question: "What do I need to make vertical screen recordings on a Mac?",
        answer:
          "An Apple Silicon Mac on macOS 14 or later and the Screen Recording permission. The vertical frame is an export setting, so there is nothing to decide before you record.",
      },
    ],
  },
  {
    slug: "app-store-preview-video",
    eyebrow: "App Store",
    heading: "App previews, sized for the store",
    lede: "Record the app, let the zooms land on the moments worth seeing, and export at the shape the listing wants.",
    title: "Record an App Store preview video on Mac",
    description:
      "Record an app preview on macOS and export it at the frame the store asks for. Automatic zooms, a background, and hardware 4K export.",
    navLabel: "App previews",
    faq: [
      {
        question: "How long should an App Store preview be?",
        answer:
          "Apple takes previews between 15 and 30 seconds, which is less time than it sounds. Record the app properly and cut down to it — the timeline has a waveform under every clip, so finding the thirty seconds that carry the app is a scrub rather than a guess.",
      },
      {
        question: "Can I export at the exact frame the store asks for?",
        answer:
          "Frame presets cover 16:9, 4K, vertical 9:16, square, 4:5 and the usual social sizes, and switching between them keeps the framing intact rather than cropping it.",
      },
      {
        question: "Can I record without the cursor in shot?",
        answer:
          "The cursor leaves the frame after a few seconds of stillness on its own, and its style and size are yours to set. A preview that is meant to look like a product film rather than a screen capture is what that setting is for.",
      },
      {
        question: "How do I fit several features into thirty seconds?",
        answer:
          "Let the zooms carry the transitions. Each push in and pull back reads as a beat, so three features become three moments rather than one continuous pan, and the seconds in between are the first thing to trim.",
      },
      {
        question: "Will a preview recorded on a Retina display be sharp enough?",
        answer:
          "Capture runs at your display's native resolution and export runs at up to 4K on your Mac's own media engine, so there is genuine detail behind a push rather than an upscale.",
      },
      {
        question: "Can I record an iOS app for a preview?",
        answer:
          "Not from the device directly — Prequel captures your Mac. Mirroring the device to your Mac and recording that window works, and everything after the capture is the same.",
      },
      {
        question: "What do I need to record an app preview on macOS?",
        answer:
          "Apple Silicon, macOS 14 at the oldest, and Screen Recording switched on under Privacy & Security. Nothing about the preview itself is set up in advance — the frame size, the background and the thirty-second cut are all chosen after the take exists.",
      },
    ],
  },
  {
    slug: "product-launch-video",
    eyebrow: "Launches",
    heading: "A launch video worth the front page",
    lede: "The video on a launch post is doing the selling. Record it once and let Prequel hand back something that looks like it took a week.",
    title: "Record a product launch video on Mac",
    description:
      "Record a launch video on macOS for Product Hunt, Show HN or a release post. Automatic zooms, a framed camera, a background, and a 4K MP4.",
    navLabel: "Launch videos",
    faq: [
      {
        question: "How long should a product launch video be?",
        answer:
          "Sixty to ninety seconds for the video on a launch post, and under thirty for the clip that goes with the tweet. Both come off one take — record the walkthrough properly, then cut two lengths out of it.",
      },
      {
        question: "How short can I get it without it feeling rushed?",
        answer:
          "Cuts are slices on a timeline with a waveform under every clip, so trimming to sixty seconds is a scrub and a few blade cuts. Zoom level and speed are set per zoom, which is how a fast cut still reads as deliberate rather than jumpy.",
      },
      {
        question: "Can I make a vertical cut for social at the same time?",
        answer:
          "Yes, from the same take. Switch the frame preset and export again — the framing survives because it is stored in proportions rather than pixels.",
      },
      {
        question: "How quickly can I turn one around on launch day?",
        answer:
          "Fast enough to redo it if the first attempt is wrong. There is no import, no render queue and no zooms to place, so the loop is record, trim, export — and export runs on your Mac's media engine rather than a queue somewhere else.",
      },
      {
        question: "Will it look like a screen recording?",
        answer:
          "Only if you want it to. The recording sits on a background with padding, a corner radius, a border and a shadow, the webcam is framed rather than parked in a corner, and the camera moves through the video instead of holding one distance for ninety seconds.",
      },
      {
        question: "Can I record a launch video without appearing on camera?",
        answer:
          "Yes, and you can decide after the fact. The webcam is a separate track, so a take recorded with it on can ship without it.",
      },
      {
        question: "What do I need to record a launch video on a Mac?",
        answer:
          "An Apple Silicon Mac on macOS 14 or later and the Screen Recording permission. Everything else — the background, the framing, the cuts — is decided after the recording rather than before it.",
      },
    ],
  },
  {
    slug: "bug-report-recording",
    eyebrow: "Bug reports",
    heading: "Show the bug instead of describing it",
    lede: "A recording that pushes in on the thing that went wrong saves the round trip that starts with which button did you press.",
    title: "Record a bug report on Mac",
    description:
      "Record a reproducible bug on macOS with the zooms already on the clicks. Trim to the part that matters and export one MP4 that fits in an issue.",
    navLabel: "Bug reports",
    faq: [
      {
        question: "How do I keep the file small enough to attach?",
        answer:
          "Trim to the reproduction and export at 1080p rather than 4K. Export is hardware H.264 at a constant frame rate, which is dramatically smaller than the MOV a plain screen recording produces for the same seconds.",
      },
      {
        question: "Can I export a bug report as a GIF?",
        answer:
          "Yes. GIF is one of the export formats, which is often the right one for an issue tracker — it plays inline in GitHub and Linear instead of asking someone to download a file. It carries no audio, so keep the MP4 if the narration matters.",
      },
      {
        question: "Can I cut out the part where I fumbled the setup?",
        answer:
          "Yes. The take is a timeline with a playhead that scrubs and a waveform under every clip, so cutting the first ninety seconds is a blade and a delete.",
      },
      {
        question: "Does the recording show what I actually clicked?",
        answer:
          "Yes, and more clearly than a raw capture does. Prequel records where the pointer went and where you pressed, then pushes in on those moments — so the answer to which button did you press is in the video rather than in the reply.",
      },
      {
        question: "How do I record the console and the interface together?",
        answer:
          "Record the whole display rather than a single window. Cursor zooms follow the pointer across it, so moving from the app to the console and back keeps whoever is watching with you.",
      },
      {
        question: "Can I record system audio so an error sound is captured?",
        answer:
          "Yes. System audio is recorded alongside your microphone as its own track, with no virtual audio driver to install first.",
      },
      {
        question: "My recording came out black. What happened?",
        answer:
          "The Screen Recording permission, nearly always. macOS hands back empty frames instead of an error when it has not been granted, so the app looks broken rather than blocked. Grant it under Privacy & Security in System Settings and record the reproduction again.",
      },
    ],
  },
  {
    slug: "code-walkthrough-video",
    eyebrow: "Code",
    heading: "Walk through code at a readable size",
    lede: "Prequel places a zoom on every burst of typing, so the line you are talking about is the line filling the frame.",
    title: "Record a code walkthrough on Mac",
    description:
      "Record code walkthroughs and pull request reviews on macOS. Zooms follow what you type, region zooms hold still over a diff, and export runs at up to 4K.",
    navLabel: "Code walkthroughs",
    faq: [
      {
        question: "Will a 13-inch screen recording be readable?",
        answer:
          "With a zoom on it, yes. Capture runs at your display's native resolution, so there is real detail to push into rather than an upscale — and the zooms land on what you were typing without you placing them.",
      },
      {
        question: "How does Prequel know which line I am talking about?",
        answer:
          "It records where you type as well as where you click. A typing zoom targets the field you are actually editing, so the frame follows the caret through a file rather than sitting on a fixed rectangle you drew before you knew where you would end up.",
      },
      {
        question: "Do I need to grant anything extra for the typing zooms?",
        answer:
          "Accessibility, in System Settings under Privacy & Security. It is what lets Prequel see which text area is focused. Without it the typing input is simply absent — clicks still drive zooms, and nothing else changes.",
      },
      {
        question: "Can I hold a zoom steady over a diff?",
        answer:
          "Draw a region zoom. It holds still on the area you drew, which is what a diff or a stack trace needs; a cursor zoom over the same thing follows the pointer around while the viewer is trying to read.",
      },
      {
        question: "Can I record a terminal session?",
        answer:
          "Yes — a terminal is a window like any other, and recording just that window keeps the rest of your desktop out of it. A region zoom over the output is usually better than a cursor zoom, since a terminal is read rather than clicked.",
      },
      {
        question: "What is the best way to record a pull request review?",
        answer:
          "Record the browser window, talk through the diff, and let the region zooms hold on each hunk while you do. Cutting the parts where you were scrolling to find something is a blade cut afterwards.",
      },
      {
        question: "What do I need to record a code walkthrough on a Mac?",
        answer:
          "An Apple Silicon Mac on macOS 14 or later and the Screen Recording permission, plus Accessibility if you want the zooms to follow what you type.",
      },
    ],
  },
  {
    slug: "changelog-video",
    eyebrow: "Changelog",
    heading: "Ship the changelog as a clip",
    lede: "Thirty seconds of the feature actually working, recorded in the time it takes to write the paragraph about it.",
    title: "Record a changelog video on Mac",
    description:
      "Record short changelog and feature release clips on macOS. Zooms placed automatically, your camera framed, exported as one MP4 at any frame preset.",
    navLabel: "Changelog clips",
    faq: [
      {
        question: "Is this quick enough to do on every release?",
        answer:
          "That is the point of the automatic pass. There is nothing to set up before you record and nothing to import afterwards — the editor opens on the take with the zooms placed, so a thirty-second clip is a recording and a trim.",
      },
      {
        question: "How long should a changelog video be?",
        answer:
          "Fifteen to thirty seconds, showing the feature working rather than explaining it. Anything longer is a demo, which is a different video with a different job.",
      },
      {
        question: "Can I export a changelog clip as a GIF?",
        answer:
          "Yes. GIF is one of the export formats, which is what you want when the clip is going in a release note or a pull request and should play without anyone pressing anything. It carries no audio; export the MP4 as well if there is narration worth keeping.",
      },
      {
        question: "Can I keep every clip looking the same?",
        answer:
          "Background, padding, radius, border, shadow and the camera framing are settings rather than decisions you make in an editor each time, so a clip from this release matches one from three releases ago.",
      },
      {
        question: "Can I make the clip vertical for social?",
        answer:
          "Switch the frame preset and export again. The framing is stored in proportions rather than pixels, so a clip that reads well in 16:9 still reads well in 9:16 rather than losing half of itself.",
      },
      {
        question: "Do I need to be on camera for a changelog clip?",
        answer:
          "No. The webcam is optional, and because it is recorded as its own track you can leave it out of a clip even if it was on while you recorded.",
      },
      {
        question: "What do I need installed to record one?",
        answer:
          "Prequel and the Screen Recording permission, on an Apple Silicon Mac running macOS 14 or later. There is no capture driver and nothing running in the background between recordings.",
      },
    ],
  },
  {
    slug: "screen-record-with-webcam",
    eyebrow: "Screen and camera",
    heading: "Record your screen and your camera at once",
    lede: "Both at the same time, as separate tracks — so where the camera sits, what shape it is and whether it is there at all are decided afterwards.",
    title: "Record your screen and webcam at the same time on Mac",
    description:
      "Record screen, webcam, microphone and system audio together on macOS, as separate tracks. Frame the camera after the take, not before it.",
    navLabel: "Screen with webcam",
    faq: [
      {
        question: "Can QuickTime do this?",
        answer:
          "Not in one pass. QuickTime records a screen or a camera, and putting them in one frame means recording twice and compositing them yourself. Prequel captures both at once and keeps them apart until you export.",
      },
      {
        question: "Can I move the webcam after recording?",
        answer:
          "Yes, because it was never drawn into the screen footage in the first place. The two are separate files on disk until the moment you export, which is why the corner it sits in, how large it is, which shape it takes and whether it is flipped are all still open questions when the editor opens.",
      },
      {
        question: "Can I have the camera on screen for only part of it?",
        answer:
          "Yes. Layout can change mid-take, so the camera can open the video, disappear while you demonstrate something, and come back for the last twenty seconds.",
      },
      {
        question: "What shapes can the webcam be?",
        answer:
          "Circle, squircle, rounded rectangle or wide. The squircle is the superellipse macOS itself draws, which is why a camera bubble in that shape sits on a Mac screenshot without looking borrowed from somewhere else.",
      },
      {
        question: "Which cameras work?",
        answer:
          "The built-in camera, anything plugged in, and an iPhone through Continuity Camera or Desk View. Which one to use is picked before you record, and the choice is remembered by name rather than by identifier — so it survives a restart and a reconnected cable.",
      },
      {
        question: "Does recording both at once slow my Mac down?",
        answer:
          "Capture runs on your Mac's own media engine through ScreenCaptureKit and AVFoundation, with the encode in hardware rather than on the CPU. Recording the screen and the camera together is what the pipeline is built for, not two recordings fighting each other.",
      },
      {
        question: "What do I need to record screen and webcam together?",
        answer:
          "An Apple Silicon Mac on macOS 14 or later, the Screen Recording permission, and the Camera permission the first time you record with it. The microphone is asked for separately and only if you want it.",
      },
    ],
  },
  {
    slug: "screen-recorder-with-audio",
    eyebrow: "System audio",
    heading: "Screen recording with system audio and mic",
    lede: "Both recorded, on separate tracks with separate gains, with no virtual audio driver to install first.",
    title: "Record your screen with system audio on Mac",
    description:
      "Record system audio and your microphone alongside the screen on macOS, as separate tracks with separate gains. No BlackHole, no virtual audio driver.",
    navLabel: "Screen with audio",
    faq: [
      {
        question: "Do I need to install BlackHole or a virtual audio driver?",
        answer:
          "No. macOS gives no route to system audio through QuickTime, which is why the usual advice is to install a virtual driver and route your output through it. Prequel captures system audio directly, so there is nothing to install and nothing to switch back afterwards.",
      },
      {
        question: "Are the microphone and system audio recorded separately?",
        answer:
          "Yes — two tracks, two files, two gains, kept apart all the way to the export. That is what makes the balance an adjustment rather than a re-record: nothing is mixed down until you ask for the MP4.",
      },
      {
        question: "Can I record system audio without my microphone?",
        answer:
          "Yes — each is switched on independently before you record. A recording with system audio and no microphone is the usual shape for capturing a video call playing on your screen or a piece of software making a sound worth hearing.",
      },
      {
        question: "Why is there no sound in my screen recording?",
        answer:
          "Either the source was not switched on before recording, or the Microphone permission was never granted. System audio rides the Screen Recording grant, so it works as soon as the screen does; the microphone is a separate permission macOS asks for the first time you use it.",
      },
      {
        question: "Can I fix the balance after recording?",
        answer:
          "Yes, and that is why they are kept apart. Each track has its own gain and its own mute, set per clip, so the music under a demo can drop for the sentence that matters and come back afterwards.",
      },
      {
        question: "Why is my screen recording black?",
        answer:
          "Almost always the Screen Recording permission. macOS returns empty frames rather than an error when it has not been granted, which reads as a broken app. Grant it in System Settings under Privacy & Security, then start the recording again.",
      },
      {
        question: "What do I need to record system audio on a Mac?",
        answer:
          "An Apple Silicon Mac on macOS 14 or later and the Screen Recording permission — that one grant carries system audio as well as the picture. Recording your microphone alongside it needs macOS 15 or later, where it rides the same capture stream, plus the Microphone permission.",
      },
    ],
  },
];

export function findUseCase(slug: string): UseCase | undefined {
  return useCases.find((useCase) => useCase.slug === slug);
}
