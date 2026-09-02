/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  This is the only file that carries a price.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Change it here and the cards, the included list, the FAQ, the billing page
 *  and every comparison page follow.
 *
 *  **Two plans, and the app in both is the same app.** Pro is $9 a month, the
 *  lifetime licence is $29 once, and the only thing that differs is how much
 *  may be kept on the shareable-link side: unlimited against 5 GB. Nothing about
 *  recording, editing or exporting is held back on either — no watermark, no
 *  length cap, no resolution tier, no feature behind the more expensive one. So
 *  nothing on this site should describe a feature as "Pro", and any sentence
 *  that makes the two sound like a good tier and a lesser one is wrong about
 *  the product.
 *
 *  **The storage figures have a second home.** `apps/api/src/lib/entitlement.ts`
 *  holds the actual byte counts the uploader checks against. The two cannot
 *  import each other — `apps/web` shares no code with `apps/api` beyond request
 *  and response types — so changing a number here means changing it there, and
 *  the quotas are written in decimal on both sides precisely so "5 GB" is the
 *  same string in the copy and in the dashboard.
 *
 *  **The price is stated, not sold.** No struck-out regular price, because
 *  there is not one to strike out; no countdown; no "introductory" label on the
 *  cards, which only ever asked the reader to hurry. And no promise that a
 *  licence bought today keeps this rate for life — that is a commitment to
 *  honour indefinitely on every licence sold at this price, and it is not
 *  something a page is allowed to invent on the way to a better conversion
 *  rate. The FAQ answers honestly if somebody asks whether it will rise. When
 *  it does, changing it here is the whole change.
 *
 *  **Write the month, and never annualise it.** `$9 a month` is what is
 *  charged. `$108 a year` is a number nobody is billed, and inventing a cadence
 *  we do not sell in order to win a comparison is the same sleight of hand this
 *  site calls out on Screen Studio's own pricing, where `$9` is the yearly rate
 *  and `$29` the monthly one. The lifetime licence is the one number here that
 *  is not a cadence at all, and it should never be divided by anything.
 *
 *  **The comparison pages still argue on the video.** At $9 a month Prequel is
 *  now at or under most of the category rather than over it, which makes the
 *  price safe to state — but it is not the claim those pages are built to make,
 *  and a page that leads with being cheapest invites a reader to re-check that
 *  every time somebody runs a sale. What Prequel hands back is a cinematic
 *  video — zooms that follow the work, a perspective tilt, focus falling away
 *  from the subject, a framed camera — and that is the argument. Where a rival
 *  is still cheaper, they say so.
 */

export const PRICE_MONTHLY = "$9";
export const PRICE_LIFETIME = "$29";
export const TRIAL_DAYS = 14;

/**
 * What each plan may keep on the sharing side. Mirrors `entitlement.ts`.
 *
 * "Unlimited" is the literal truth rather than a round number standing in for
 * one: Pro's quota is a sentinel the upload check cannot reach. If that ever
 * becomes a real cap, this word has to change with it.
 */
export const STORAGE_PRO = "Unlimited";
export const STORAGE_LIFETIME = "5 GB";

export type Plan = {
  name: string;
  price: string;
  cadence: string;
  /** Under the price. Says how it is billed, not what it includes. */
  billing: string;
  /**
   * The pill above the card, on the one we point at.
   *
   * Copy rather than a boolean, because "Recommended" is a claim and it belongs
   * in the file that carries the other claims. Not "Most popular" — that is a
   * fact about sales we do not have, where this is an opinion we do.
   */
  badge?: string;
  summary: string;
  features: string[];
  featured?: boolean;
};

/**
 * The app, in both plans, in the order the cards read.
 *
 * One list shared between them rather than two that drifted: every line here is
 * true of both, and the only difference between the plans is appended below. A
 * feature that appeared in one array and not the other would read as withheld,
 * which is the thing this pricing is built not to do.
 */
const EVERYTHING = [
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
];

export const LIFETIME_PLAN: Plan = {
  name: "Lifetime",
  price: PRICE_LIFETIME,
  cadence: "once",
  billing: `One payment · ${TRIAL_DAYS} days free`,
  summary: `Buy it once. Best if you record now and then.`,
  features: [...EVERYTHING, `${STORAGE_LIFETIME} of shared recordings`],
  featured: true,
  badge: "Recommended",
};

export const PRO_PLAN: Plan = {
  name: "Pro",
  price: PRICE_MONTHLY,
  cadence: "a month",
  billing: `Billed monthly · ${TRIAL_DAYS} days free`,
  summary: `Best if you record for work every week.`,
  features: [...EVERYTHING, "Unlimited shared recordings"],
};

/**
 * Card order on the pricing page, and nothing else.
 *
 * `Comparison.tsx` and the dashboard's upgrade card used to index this array,
 * so reordering it would have silently changed the price quoted on all six
 * comparison pages. They import `PRO_PLAN` by name instead, which is what makes
 * this order a layout decision rather than a pricing one.
 */
export const PLANS: Plan[] = [LIFETIME_PLAN, PRO_PLAN];

/**
 * What both plans cover.
 *
 * A list rather than a table: the two plans differ in one row, and a table of
 * ticks that are identical everywhere but `Storage` says less than a sentence
 * would. Storage is the last row for the same reason — it is the only line a
 * reader has to compare.
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
  ["Storage", `Unlimited on Pro, ${STORAGE_LIFETIME} on Lifetime`],
];

export const FAQ: { question: string; answer: string }[] = [
  {
    question: "What is the difference between the two plans?",
    answer: `Storage, and nothing else. Both are the whole app — 4K at 120 frames per second, every preset, transcripts, no watermark and no limit on a take — and both export the same file. Buy the lifetime licence once for ${PRICE_LIFETIME} and you keep ${STORAGE_LIFETIME} of shared recordings, which is plenty if you make a video now and then. Pro is ${PRICE_MONTHLY} a month with unlimited storage, which is the one to pick if you are sharing recordings for work every week. Storage only counts recordings you upload for a shareable link — what you export to your own Mac is never counted and has no limit.`,
  },
  {
    question: "Will the price go up?",
    answer: `It might. ${PRICE_MONTHLY} a month and ${PRICE_LIFETIME} once are what Prequel costs today, and we would rather say that plainly than dress it up with a countdown — there is no struck-out "regular" price to compare it against, and no claim that signing up today locks the rate in forever. If it rises, it rises, and the page will say the new number.`,
  },
  {
    question: "Is the lifetime licence really for life?",
    answer: `It is one payment for the app, with no renewal and nothing to cancel. What it does not do is grow: it comes with ${STORAGE_LIFETIME} of shared recordings and stays there. If you outgrow that — which usually means you have started recording for work rather than occasionally — you can subscribe to Pro at ${PRICE_MONTHLY} a month for unlimited storage, and stopping that subscription later puts you back on the ${STORAGE_LIFETIME} you already own rather than on nothing.`,
  },
  {
    question: "Is there a free plan?",
    answer: `No. There is a ${TRIAL_DAYS}-day free trial with the whole app in it, and after that Prequel is ${PRICE_MONTHLY} a month or ${PRICE_LIFETIME} once. We would rather charge one honest price than run a free tier that quietly withholds the part you actually needed.`,
  },
  {
    question: "What makes the video cinematic rather than just recorded?",
    answer:
      "A raw screen recording sits at one distance from the viewer for its whole length, with the thing that matters too small to see. Prequel watches where you click and type while it records, and opens the editor with the pass already made: pushes in on the work, a perspective tilt so the frame has a direction, focus falling away from whatever the zoom is aimed at, a camera framed afterwards over a background with a shadow under it. That is the part you would otherwise do by hand, and it is what the price is for.",
  },
  {
    question: "What is in the trial?",
    answer:
      "All of it. The trial is the full app rather than a preview of it — 4K at 120 frames per second, every frame preset, transcripts, no length limit and no watermark. A video you export during the trial is yours, and it keeps working afterwards whether or not you pay.",
  },
  {
    question: "Is there a yearly plan?",
    answer: `Not as such. Prequel is billed monthly at ${PRICE_MONTHLY}, and the alternative to paying monthly is the ${PRICE_LIFETIME} lifetime licence rather than a discounted year — one payment instead of a cheaper cadence, so there is no renewal date to be surprised by.`,
  },
  {
    question: "Is the export watermarked?",
    answer: "No, on the trial or on either plan. The file is yours at full quality.",
  },
  {
    question: "What do I need to run it?",
    answer:
      "An Apple Silicon Mac on macOS 14 or later, and the Screen Recording permission. Capture is built on ScreenCaptureKit, so there is no Intel build and no Windows build planned.",
  },
  {
    question: "Does anything leave my machine?",
    answer:
      "Not to make a video. Recording, editing and export all happen locally, on your Mac's own media engine — there is no upload step and no cloud render. Uploading a finished export to get a shareable link is a thing you ask for, on a file you have already made, and it is the only thing storage counts.",
  },
];
