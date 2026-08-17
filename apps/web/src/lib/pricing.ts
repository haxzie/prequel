/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  Prices are placeholders. This is the only file that carries them.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Nothing is for sale yet — every plan's action is the waitlist — so these
 *  numbers exist to give the page a shape rather than to be paid. Change them
 *  here and the cards, the table and the FAQ all follow.
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
    price: "£0",
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
    name: "Pro",
    price: "£8",
    cadence: "per month, billed yearly",
    summary: "For anyone whose recordings are part of the job.",
    featured: true,
    features: [
      "Everything in Free, without the length limit",
      "4K and HEVC export, up to 120 fps",
      "Automatic zooms from clicks and typing",
      "Every frame preset, including the social sizes",
      "Per-slice overrides and keyframed zooms",
    ],
  },
  {
    name: "Team",
    price: "£6",
    cadence: "per seat, per month",
    summary: "Shared presets, one invoice, five seats or more.",
    features: [
      "Everything in Pro",
      "Shared backgrounds and export presets",
      "Centralised billing and seat management",
      "Priority support",
    ],
  },
];

/** Rows are `[feature, free, pro, team]`; `true` renders as a tick. */
export const COMPARISON: [string, boolean | string, boolean | string, boolean | string][] = [
  ["Screen, window and region capture", true, true, true],
  ["Webcam and both audio sources", true, true, true],
  ["Recording length", "10 min", "Unlimited", "Unlimited"],
  ["Maximum export", "1080p60", "4K120", "4K120"],
  ["Codecs", "H.264", "H.264 · HEVC", "H.264 · HEVC"],
  ["Automatic zooms", false, true, true],
  ["Keyframed zooms and per-slice overrides", false, true, true],
  ["Frame and social presets", "16:9 only", true, true],
  ["Shared presets across a team", false, false, true],
  ["Priority support", false, false, true],
];

export const FAQ: { question: string; answer: string }[] = [
  {
    question: "When can I actually buy this?",
    answer:
      "Not yet. Prequel is in development and nothing is for sale, which is why every button on this page joins the waitlist instead. The plans are here so it is clear what will be free when it does ship.",
  },
  {
    question: "Is the free plan watermarked?",
    answer:
      "No. Free exports carry nothing that Pro exports do not — the limits are on length and output format, not on the file being usable.",
  },
  {
    question: "What do I need to run it?",
    answer:
      "An Apple Silicon Mac on macOS 14 or later, and the Screen Recording permission. Capture is built on ScreenCaptureKit, so there is no Intel build and no Windows build planned.",
  },
  {
    question: "Does anything leave my machine?",
    answer:
      "Recording, editing and export all happen locally. There is no upload step and no cloud rendering — the export is your Mac's own media engine writing an MP4 to disk.",
  },
];
