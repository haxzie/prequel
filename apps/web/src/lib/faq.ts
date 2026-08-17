/**
 * The landing page FAQ.
 *
 * One list, rendered twice: as visible copy and as `FAQPage` structured data.
 * Keeping both off the same array is the point — an answer that differs between
 * the markup and the JSON-LD is the kind of mismatch search engines penalise,
 * and it happens the first time someone edits one and not the other.
 *
 * Weighted towards zooms because that is the part people search for and the
 * part that is hardest to picture without having used it.
 *
 * Named `PRODUCT_FAQ` rather than `FAQ` to keep it distinct from the pricing
 * page's own list in `lib/pricing.ts`.
 */
export type FaqEntry = { question: string; answer: string };

export const PRODUCT_FAQ: FaqEntry[] = [
  {
    question: "What is Prequel?",
    answer:
      "Prequel is a screen recorder for macOS that hands back a finished video rather than raw footage. It records your screen, your webcam, your microphone and system audio, then opens an editor on the take with the zooms already placed, the camera framed and a background applied. Export is one MP4 at up to 4K, rendered on your Mac's own media engine.",
  },
  {
    question: "How do the automatic zooms work?",
    answer:
      "Prequel records where you click and type while it captures. When the editor opens on the take, those moments have already been clustered into zooms — pushed in on what you were doing, and pulled back out when you moved on. There is nothing to set up before you record.",
  },
  {
    question: "Can I change or delete the automatic zooms?",
    answer:
      "Yes. Every generated zoom is an ordinary slice on the timeline, identical to one you add yourself. Move it, retime it, point it somewhere else or delete it. Nothing about the automatic pass is baked in.",
  },
  {
    question: "Can I zoom in on something other than the cursor?",
    answer:
      "Yes. A zoom can target the cursor, a fixed region you draw, or whatever you are typing into. Region zooms hold still, which is what you want for a form or a diff. Cursor zooms follow the pointer around the screen.",
  },
  {
    question: "Does zooming in make the recording blurry?",
    answer:
      "It depends on how much headroom the recording has. Capture runs at your display's native resolution, so a Retina Mac recording a 3024 by 1898 screen and exporting at 1080p has roughly three times the pixels it needs — a 2x zoom still lands on real detail. Push past the source resolution and it softens, the same as any crop.",
  },
  {
    question: "Can I control how fast a zoom moves?",
    answer:
      "Level, speed, tilt and yaw are all set per zoom, and blur falls away progressively from the focus, so a push reads as depth rather than a jump cut. Slow and shallow for a walkthrough, faster and tighter for a highlight.",
  },
  {
    question: "Do I need to set anything up before I record?",
    answer:
      "No. Pick a screen, a window or a dragged region and start. The zooms, the camera framing, the background and the cuts are all decided afterwards, on a take you can already see.",
  },
  {
    question: "Can I move the webcam after recording?",
    answer:
      "Yes. The webcam is never burned into the screen recording, so its shape — circle, squircle, rounded or wide — along with its size, its corner and whether it is mirrored are all still yours once the take is finished.",
  },
  {
    question: "What can Prequel export?",
    answer:
      "One MP4, in H.264 or HEVC, at up to 4K and up to 120 frames per second, at a constant frame rate. Frame presets cover 16:9, 4K, vertical 9:16, square, 4:5 and the usual social sizes.",
  },
  {
    question: "Can I make a vertical version of a landscape recording?",
    answer:
      "Yes, and the look survives the switch. Framing is stored in proportions rather than pixels, so moving a take from 16:9 to 9:16 keeps the camera and the padding where you put them instead of sliding them off the frame.",
  },
  {
    question: "Are the microphone and system audio recorded separately?",
    answer:
      "Yes, as separate tracks with separate gains. A notification landing at full volume over your voice is a slider afterwards rather than a reason to record the whole thing again.",
  },
  {
    question: "What do I need to run Prequel?",
    answer:
      "An Apple Silicon Mac on macOS 14 or later, and the Screen Recording permission. Zooms driven by typing also want Accessibility; without it that one input is simply absent rather than broken.",
  },
  {
    question: "Does my recording leave my machine?",
    answer:
      "No. Recording, editing and export all happen locally, on your Mac's own media engine. There is no upload step and no cloud render.",
  },
];
