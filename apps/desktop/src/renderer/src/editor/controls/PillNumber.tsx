import { useState } from "react";

/**
 * A number typed into one of the pills that float over the composition.
 *
 * Shared by the frame bar and the picture bar rather than written once in each:
 * the behaviour that matters is the held draft, and a second copy of it is a
 * field that clamps halfway through a number somebody is still typing.
 *
 * Not `controls/inputs.tsx`, which is the inspector's — those fields carry a
 * label above them and a track beside them, and they are a page of controls
 * rather than a line of them.
 */
export function PillNumber({
  label,
  value,
  onChange,
  normalise,
  width = "w-16",
}: {
  /** The accessible name. There is no visible one — the bar says what the row is. */
  label: string;
  value: number;
  onChange: (value: number) => void;
  /**
   * What a typed number becomes before it is written.
   *
   * The frame's sizes must be even, a box's must be at least a pixel, and
   * neither belongs in here — this field knows how to hold a draft and nothing
   * else about what the number means.
   */
  normalise?: (value: number) => number;
  width?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      aria-label={label}
      className={`${width} rounded-full bg-transparent px-2 py-1 text-center tabular-nums outline-none hover:bg-white/5 focus:bg-white/10`}
      value={draft ?? String(Math.round(value))}
      // Held as text while being typed: committing on every keystroke would
      // clamp "10" to the minimum before "1080" could be finished.
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        // `|| value` rather than a parse check: a blank field and a word both
        // come out falsy, and the useful answer to either is the number that
        // was already there.
        if (draft !== null) {
          const next = Number(draft) || value;
          onChange(normalise ? normalise(next) : next);
        }
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") setDraft(null);
      }}
    />
  );
}
