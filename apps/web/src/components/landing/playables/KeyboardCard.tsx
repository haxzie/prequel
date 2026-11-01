"use client";

import { KEYBOARDS } from "@/lib/playables";

import { MacKeyboard } from "./MacKeyboard";
import { PlayCard, Stage } from "./PlayCard";
import { PlayGlyph } from "./PlayGlyph";
import { useSound } from "./sound";

/**
 * The five keyboards, each one playable.
 *
 * The sound is the app's, rendered by `prequel-keysound` — see the note in
 * `lib/playables.ts`. Four seconds of a real phrase rather than a single
 * keypress: half of what tells a Thock from a Clicky is the rhythm of a run of
 * keys, and one press has no rhythm.
 *
 * The keys light while a clip plays, in the order the phrase types them — see
 * `MacKeyboard`. They are not synchronised to the audio and are not meant to
 * read as synchronised: the run is at roughly a typist's cadence, which says
 * "this is typing" and leaves the sound to say which keyboard it is. Pinning
 * each key to its own press would mean shipping the cue list beside the audio
 * to no end, since nobody is reading the letters.
 */
export function KeyboardCard() {
  const { playing, play } = useSound();

  return (
    <PlayCard
      title="Keyboards"
      body="Add the sound of the keys you are pressing, chosen from five. Recorded silently and mixed at export, so the room you are in stays out of it."
    >
      {/* No desk, and `bg-bg` rather than the lid every other card uses: the
          board has no frame of its own, so what is behind it has to be the
          ground rather than a panel — a lit surface under an edgeless board is
          a tray it is sitting in.

          `overflow-hidden` because the board is wider than the card on
          purpose. */}
      <Stage className="grid items-end justify-items-center overflow-hidden bg-bg px-0 py-6">
        <MacKeyboard playing={Boolean(playing)} />
      </Stage>

      <ul className="flex flex-col gap-1 p-4">
        {KEYBOARDS.map((keyboard) => (
          <li key={keyboard.id}>
            <button
              type="button"
              onClick={() => play(keyboard.id, `/sounds/keys-${keyboard.id}.m4a`)}
              aria-label={`${playing === keyboard.id ? "Stop" : "Play"} ${keyboard.label}`}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                playing === keyboard.id ? "bg-accent/12" : "hover:bg-elevated"
              }`}
            >
              <PlayGlyph playing={playing === keyboard.id} />
              <span className="text-sm font-medium text-fg">{keyboard.label}</span>
              <span className="ml-auto text-xs text-muted">{keyboard.note}</span>
            </button>
          </li>
        ))}
      </ul>
    </PlayCard>
  );
}
