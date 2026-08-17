/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  Prices are placeholders. This is the only file that carries them.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Nothing is for sale yet — every plan's action is the waitlist — so these
 *  numbers exist to give the page a shape rather than to be paid. Change them
 *  here and the cards, the table and the FAQ all follow.
 *
 *  Two of the three are a one-off purchase rather than a subscription, which is
 *  the whole shape of this page: the app is bought once and keeps working, and
 *  the only recurring charge is for the part that costs money to run every month
 *  — storage and bandwidth for a team's uploads.
 */

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
    name: "Free",
    price: "$0",
    cadence: "forever",
    summary: "The whole recorder, and enough editor to publish something.",
    features: [
      "Screen, window and region capture",
      "Webcam, microphone and system audio",
      "Cuts, backgrounds and the camera bubble",
      "Export to 1080p, H.264",
      "Up to 10 minutes a recording",
    ],
  },
  {
    name: "Personal",
    price: "$39",
    // Spelled out rather than left as "one-off", because the question anyone
    // asks about a one-time licence is what stops working when the year is up.
    cadence: "once · one Mac · a year of updates",
    summary: "Buy it once. It keeps working after the update year ends.",
    featured: true,
    features: [
      "Everything in Free, without the length limit",
      "4K and HEVC export, up to 120 fps",
      "Automatic zooms from clicks and typing",
      "Every frame preset, including the social sizes",
      "Per-slice overrides and keyframed zooms",
      "One year of updates, and the version you have forever",
    ],
  },
  {
    name: "Team",
    price: "$19",
    cadence: "per user, per month",
    summary: "Everything in Personal, plus somewhere to put the finished file.",
    features: [
      "Everything in Personal, on every seat",
      "Cloud uploads straight from the editor",
      "Shareable links, with no download required to watch",
      "Updates for as long as the subscription runs",
      "Centralised billing and seat management",
    ],
  },
];

/** Rows are `[feature, free, personal, team]`; `true` renders as a tick. */
export const COMPARISON: [string, boolean | string, boolean | string, boolean | string][] = [
  ["Screen, window and region capture", true, true, true],
  ["Webcam and both audio sources", true, true, true],
  ["Recording length", "10 min", "Unlimited", "Unlimited"],
  ["Maximum export", "1080p60", "4K120", "4K120"],
  ["Codecs", "H.264", "H.264 · HEVC", "H.264 · HEVC"],
  ["Automatic zooms", false, true, true],
  ["Keyframed zooms and per-slice overrides", false, true, true],
  ["Frame and social presets", "16:9 only", true, true],
  ["Macs per licence", "Any", "One", "One per seat"],
  ["Updates", "While it is free", "One year", "While subscribed"],
  ["Cloud uploads and shareable links", false, false, true],
  ["Centralised billing and seat management", false, false, true],
];

export const FAQ: { question: string; answer: string }[] = [
  {
    question: "When can I actually buy this?",
    answer:
      "Not yet. Prequel is in development and nothing is for sale, which is why every button on this page joins the waitlist instead. The plans are here so it is clear what will be free when it does ship.",
  },
  {
    question: "What happens after my year of updates?",
    answer:
      "Nothing stops. Personal is a one-off purchase, not a rental: the version you have keeps working for as long as macOS runs it. The year buys the updates released during it, and renewing is optional rather than the price of keeping what you paid for.",
  },
  {
    question: "Is the free plan watermarked?",
    answer:
      "No. Free exports carry nothing that a paid export does not — the limits are on length and output format, not on the file being usable.",
  },
  {
    question: "What do I need to run it?",
    answer:
      "An Apple Silicon Mac on macOS 14 or later, and the Screen Recording permission. Capture is built on ScreenCaptureKit, so there is no Intel build and no Windows build planned.",
  },
  {
    question: "Does anything leave my machine?",
    answer:
      "On Free and Personal, no: recording, editing and export all happen locally, on your Mac's own media engine. Team adds uploading — and only when you ask for it, on the file you have already exported. Nothing is sent anywhere to make a recording or to render one.",
  },
];
