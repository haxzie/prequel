/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  This is the only file that carries a price.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Change it here and the cards, the included list, the FAQ, the billing page
 *  and every comparison page follow.
 *
 *  **The rate is introductory.** Every surface that shows it says so, and none
 *  of them says more than that: there is no struck-out regular price, because
 *  there is not one to strike out, and no promise that an early licence keeps
 *  this rate for life. That last one is a commitment to honour indefinitely on
 *  every licence sold at this price, and it is not something a page is allowed
 *  to invent on the way to a better conversion rate. When the price rises
 *  again, raising it here is the whole change.
 *
 *  One plan, one price, a trial in front of it. There is no free tier and no
 *  second tier, which means nothing on this site should describe a feature as
 *  "paid" or "included" — everything is included, and the only question is
 *  whether the fourteen days have run out.
 *
 *  **Write the month, and never annualise it.** `$14 a month` is what is
 *  charged and there is no yearly plan, so `$168 a year` is a number nobody is
 *  billed. It exists only as ammunition — a figure to set against a competitor
 *  who bills yearly — and inventing a cadence we do not sell in order to win a
 *  comparison is the same sleight of hand this site calls out on Screen
 *  Studio's own pricing, where `$9` is the yearly rate and `$29` the monthly
 *  one.
 *
 *  **The comparison pages argue on the video, not on the price.** At $14 a
 *  month Prequel is no longer the cheapest thing in its category, and a page
 *  that says otherwise is checkable in one click by exactly the reader it is
 *  aimed at. What it is instead is the one that hands back a cinematic video —
 *  zooms that follow the work, a perspective tilt, focus falling away from the
 *  subject, a framed camera — and that is the claim those pages are built to
 *  make. Where a rival is cheaper, they say so.
 */

export const PRICE_MONTHLY = "$14";
export const TRIAL_DAYS = 14;

export type Plan = {
  name: string;
  price: string;
  cadence: string;
  summary: string;
  features: string[];
  featured?: boolean;
};

export const PLANS: Plan[] = [
  {
    name: "Prequel",
    price: PRICE_MONTHLY,
    cadence: "per user, per month",
    summary: `Everything, for everyone on the licence. ${TRIAL_DAYS} days free to begin with.`,
    features: [
      "Automatic zooms from clicks and typing",
      "Perspective tilt and focus falling away from the subject",
      "A camera you frame after the take, over a background",
      "Screen, window and region capture",
      "Webcam, microphone and system audio",
      "Cuts on a real timeline, with waveforms",
      "4K and HEVC export, up to 120 fps",
      "Every frame preset, including the social sizes",
      "Transcripts, uploads and shareable links",
      "No length limit and no watermark",
    ],
  },
];

/**
 * What the licence covers.
 *
 * A list rather than a table: with one plan there is no second column to
 * compare against, and a tick beside every row in a table of one is noise.
 *
 * The look comes first — the zooms, the tilt, the focus, the shadow. They are
 * the reason the export is worth watching, and burying them under the capture
 * rows describes a screen recorder rather than the thing this one makes.
 */
export const INCLUDED: [string, string][] = [
  ["Zooms", "Automatic, from clicks and typing"],
  ["Perspective", "Tilt and yaw on the push-in"],
  ["Depth of field", "Focus falling away from the subject"],
  ["Camera", "Shaped, placed and sized afterwards"],
  ["Backgrounds", "Wallpaper, presets, gradients, solids"],
  ["Shadow", "Under the screen and the camera"],
  ["Capture", "Screen, window or region"],
  ["Sources", "Webcam, microphone, system audio"],
  ["Editor", "Cuts on a timeline, with waveforms"],
  ["Resolution", "Up to 4K"],
  ["Frame rate", "Up to 120 fps"],
  ["Codecs", "H.264 · HEVC"],
  ["Presets", "Every frame and social size"],
  ["Length", "No limit"],
  ["Watermark", "None"],
  ["Transcripts", "Included"],
  ["Sharing", "Uploads and shareable links"],
  ["Rendering", "On your Mac, never uploaded"],
];

export const FAQ: { question: string; answer: string }[] = [
  {
    question: "Why is it called introductory pricing?",
    answer: `Because it is going up. ${PRICE_MONTHLY} per user per month is what Prequel costs while it is new, and the rate is set here rather than promised anywhere — there is no struck-out "regular" price to compare it against and no claim that signing up today locks it in forever. When it rises, it rises.`,
  },
  {
    question: "Is there a free plan?",
    answer: `No. There is a ${TRIAL_DAYS}-day free trial with the whole app in it, and after that Prequel is ${PRICE_MONTHLY} per user per month. We would rather charge one honest price than run a free tier that quietly withholds the part you actually needed.`,
  },
  {
    question: "What makes the video cinematic rather than just recorded?",
    answer:
      "A raw screen recording sits at one distance from the viewer for its whole length, with the thing that matters too small to see. Prequel watches where you click and type while it records, and opens the editor with the pass already made: pushes in on the work, a perspective tilt so the frame has a direction, focus falling away from whatever the zoom is aimed at, a camera framed afterwards over a background with a shadow under it. That is the part you would otherwise do by hand, and it is what the price is for.",
  },
  {
    question: "What is in the trial?",
    answer:
      "All of it. The trial is the full app rather than a preview of it — 4K at 120 frames per second, every frame preset, transcripts, no length limit and no watermark. A video you export during the trial is yours, and it keeps working afterwards whether or not you subscribe.",
  },
  {
    question: "Is there a yearly plan?",
    answer: `Not at the moment. Prequel is billed monthly at ${PRICE_MONTHLY} per user, and rather than advertise a yearly rate we do not sell, the page says the number you are actually charged.`,
  },
  {
    question: "Why only one plan?",
    answer:
      "Because tiers make you read a table before you can decide anything, and the feature you want is always one row below the one you were going to buy. One price, everything in it.",
  },
  {
    question: "Is the export watermarked?",
    answer: "No, on the trial or on a licence. The file is yours at full quality.",
  },
  {
    question: "What do I need to run it?",
    answer:
      "An Apple Silicon Mac on macOS 14 or later, and the Screen Recording permission. Capture is built on ScreenCaptureKit, so there is no Intel build and no Windows build planned.",
  },
  {
    question: "Does anything leave my machine?",
    answer:
      "Not to make a video. Recording, editing and export all happen locally, on your Mac's own media engine — there is no upload step and no cloud render. Uploading a finished export to get a shareable link is a thing you ask for, on a file you have already made.",
  },
];
