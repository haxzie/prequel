/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  This is the only file that carries a price.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Change them here and the cards, the included list, the FAQ, the billing
 *  page and every comparison page follow.
 *
 *  **The rate is introductory.** Every surface that shows it says so, and none
 *  of them says more than that: there is no struck-out regular price, because
 *  there is not one to strike out, and no promise that an early licence keeps
 *  this rate for life. That last one is a commitment to honour indefinitely on
 *  every licence sold at this price, and it is not something a page is allowed
 *  to invent on the way to a better conversion rate. When the price does rise,
 *  raising it here is the whole change.
 *
 *  One plan, one price, a trial in front of it. There is no free tier and no
 *  second tier, which means nothing on this site should describe a feature as
 *  "paid" or "included" — everything is included, and the only question is
 *  whether the fourteen days have run out.
 *
 *  **Write the year, not the month.** `$59 a year` is what is charged; the
 *  monthly figure is arithmetic and is only ever shown beside it. Leading with
 *  `$4.92` would be the same sleight of hand this site calls out on Screen
 *  Studio's own pricing, where `$9` is the yearly rate and `$29` the monthly
 *  one. `PRICE_MONTHLY_EQUIVALENT` exists so that figure is derived in one
 *  place rather than recalculated by hand in copy.
 */

export const PRICE_YEARLY = "$59";
export const PRICE_MONTHLY_EQUIVALENT = "$4.92";
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
    price: PRICE_YEARLY,
    cadence: "per user, per year",
    summary: `Everything, for everyone on the licence. ${TRIAL_DAYS} days free to begin with.`,
    features: [
      "Screen, window and region capture",
      "Webcam, microphone and system audio",
      "Automatic zooms from clicks and typing",
      "Cuts, backgrounds and the camera bubble",
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
 */
export const INCLUDED: [string, string][] = [
  ["Capture", "Screen, window or region"],
  ["Sources", "Webcam, microphone, system audio"],
  ["Zooms", "Automatic, from clicks and typing"],
  ["Editor", "Cuts, backgrounds, camera, cursor"],
  ["Resolution", "Up to 4K"],
  ["Frame rate", "Up to 120 fps"],
  ["Codecs", "H.264 · HEVC"],
  ["Presets", "Every frame and social size"],
  ["Length", "No limit"],
  ["Watermark", "None"],
  ["Transcripts", "Included"],
  ["Sharing", "Uploads and shareable links"],
];

export const FAQ: { question: string; answer: string }[] = [
  {
    question: "Why is it called introductory pricing?",
    answer: `Because it is going up. ${PRICE_YEARLY} a year is what Prequel costs while it is new, and the rate is set here rather than promised anywhere — there is no struck-out "regular" price to compare it against and no claim that signing up today locks it in forever. When it rises, it rises.`,
  },
  {
    question: "Is there a free plan?",
    answer: `No. There is a ${TRIAL_DAYS}-day free trial with the whole app in it, and after that Prequel is ${PRICE_YEARLY} per user per year. We would rather charge one honest price than run a free tier that quietly withholds the part you actually needed.`,
  },
  {
    question: "What is in the trial?",
    answer:
      "All of it. The trial is the full app rather than a preview of it — 4K at 120 frames per second, every frame preset, transcripts, no length limit and no watermark. A video you export during the trial is yours, and it keeps working afterwards whether or not you subscribe.",
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
