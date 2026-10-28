"use client";

import { useState } from "react";

import { formatTime } from "./time";

/**
 * The row of emoji under the recording.
 *
 * A press is "this, here": the emoji is stored against the playhead at the
 * moment of the press and appears over the scrub bar at that point for
 * everybody who opens the link afterwards. So the row says where it will land —
 * without that it reads as a like button, and a like on a two-minute recording
 * is worth a great deal less than a 🙌 at 1:12.
 */
export function Reactions({
  palette,
  signedIn,
  at,
  onReact,
  onNeedsSignIn,
}: {
  palette: readonly string[];
  signedIn: boolean;
  /** Where the playhead is, in seconds, read at the moment of the press. */
  at: () => number;
  onReact: (emoji: string, atMs: number) => Promise<void>;
  onNeedsSignIn: () => void;
}) {
  /** The last emoji pressed, to flash the timecode it landed on. */
  const [landed, setLanded] = useState<{ emoji: string; seconds: number } | null>(null);
  const [busy, setBusy] = useState(false);

  if (palette.length === 0) return null;

  const press = async (emoji: string) => {
    if (!signedIn) return onNeedsSignIn();
    if (busy) return;

    const seconds = at();
    setBusy(true);

    try {
      await onReact(emoji, seconds * 1000);
      setLanded({ emoji, seconds });
    } catch {
      // The panel beside this one reports what went wrong; a failed press here
      // simply leaves no mark, which is what the viewer sees anyway.
    } finally {
      setBusy(false);
    }
  };

  return (
    // Left under the title on a phone, where the row is below it rather than
    // beside it; right-aligned beside it on anything wider.
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <div className="flex items-center gap-1 rounded-full border border-line bg-surface/60 px-1.5 py-1">
        {palette.map((emoji) => (
          <button
            key={emoji}
            type="button"
            title={signedIn ? `React with ${emoji}` : "Sign in to react"}
            aria-label={signedIn ? `React with ${emoji}` : "Sign in to react"}
            className="grid size-8 place-items-center rounded-full text-lg leading-none transition-transform hover:scale-110 hover:bg-elevated active:scale-95"
            onClick={() => void press(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>

      {/* Only after a press, and it stays: it is a receipt, not a notification,
          and something that vanishes on a timer takes the one explanation of
          what the row just did with it. */}
      <p className="h-4 text-xs text-muted">
        {landed
          ? `${landed.emoji} at ${formatTime(landed.seconds)}`
          : signedIn
            ? "Reacts at the current moment"
            : ""}
      </p>
    </div>
  );
}
