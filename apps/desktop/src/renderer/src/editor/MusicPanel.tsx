/**
 * The panel a selected bed on the music row takes the inspector over with.
 *
 * One tab, because there is one question — which song, and how loud it comes
 * up and goes away. A rail of two glyphs over four controls would be filing
 * for its own sake.
 *
 * In a file of its own for the reason `TextPanels.tsx` is: `Inspector.tsx` is
 * already the longest file in the editor, and nothing here reads the clip
 * machinery — a bed has no overrides, no defaults and no apply-to-all.
 *
 * The same panel whichever way the bed arrived. A track from the library and a
 * file somebody dragged off their disk are the same thing once they are in the
 * recording — a name, a length and a level — so there is one set of controls
 * and one list to change the file from. That is what makes the dropdown at the
 * top worth having rather than two panels with a different first row.
 */
import type { MusicListing } from "../../../shared/contract";
import {
  MAX_MUSIC_FADE,
  MAX_MUSIC_VOLUME,
  type MusicFile,
  type MusicSlice,
} from "../../../shared/music";
import { Section } from "./controls/Field";
import { Dropdown, percent, PlaySampleButton, Slider, ToggleField } from "./controls/inputs";
import {
  FadeInIcon,
  FadeOutIcon,
  ImportAudioIcon,
  MusicIcon,
  RepeatIcon,
  SpeakerIcon,
  SpinnerIcon,
} from "./icons";
import type { Music } from "./useMusic";

/** Everything about a bed but its identity, its span and its file. */
export type MusicPatch = Partial<Omit<MusicSlice, "id" | "at" | "length" | "file" | "offset">>;

/**
 * What the music panel needs from outside the reducer.
 *
 * Bundled for the reason `presets` and `captions` are: the library arrives
 * over IPC and both callbacks reach the recording's directory — one to download
 * a track into it, one to copy a file in — and threading four props for one
 * panel would put that knowledge in `InspectorProps`.
 */
export interface MusicState {
  /** The hosted library, grouped the way the picker shows it. */
  library: Music;
  /** The track being fetched, if any, so its row can say so. */
  pending: string | null;
  /** Points this bed at a library track, fetching it into the recording first. */
  onPick: (track: MusicListing) => void;
  /**
   * Points it at a file the recording already holds.
   *
   * Its own callback rather than `onPick` with a made-up listing: a file that
   * is here has no catalogue entry to be described by — an imported one never
   * had one — and inventing the fields to fit would be a shape nothing else
   * reads.
   */
  onChoose: (file: MusicFile) => void;
  /** Opens the file picker and points this bed at what comes back. */
  onImport: () => void;
  /**
   * Plays a track so it can be heard without choosing it, or stops with null.
   *
   * A file rather than a listing: the row knows its own name and nothing else,
   * and whether the bytes are in the recording yet is the caller's problem —
   * it is the one that can fetch them.
   */
  onPreview: (file: string | null) => void;
  /** The file being auditioned, if any, so its row can offer to stop it. */
  playing: string | null;
}

export function MusicPanel({
  bed,
  files,
  music,
  onChange,
  onBeginEdit,
}: {
  bed: MusicSlice;
  /** Every file this recording holds, which is the Imported half of the list. */
  files: readonly MusicFile[];
  music: MusicState;
  onChange: (patch: MusicPatch) => void;
  /** A new drag is starting, so it is its own undo step. */
  onBeginEdit: () => void;
}) {
  // The library's tracks, flattened in catalogue order with their group kept
  // as the heading each row sits under. One list rather than one dropdown per
  // category: choosing a song is one choice, and the headings are what say
  // where each came from.
  const hosted = music.library.groups.flatMap((group) =>
    group.items.map((track) => ({
      value: track.file,
      label: track.label,
      group: group.label,
    })),
  );

  /**
   * The files somebody brought in themselves, above the library.
   *
   * Grouped by where a song *came from* rather than by whether it is in the
   * recording yet. A library track that has been used is in `musicFiles` too,
   * and listing it as Imported would say it came off this Mac — so the two
   * halves are split by `libraryId` and the hosted row below is the one that
   * shows it.
   *
   * Theirs first. The library is the same for everybody and the files here are
   * this video's, so a list that opened on a catalogue would bury the two
   * songs somebody had already gone and found.
   */
  const imported = files
    .filter((file) => file.libraryId === undefined)
    .map((file) => ({ value: file.file, label: file.label, group: "Imported" }));

  /**
   * Library tracks in the recording that the catalogue does not list.
   *
   * Offline, or a track withdrawn since it was chosen. They have to be in the
   * list or the bed's own song would be missing from the picker showing it —
   * which reads as the song having been lost.
   */
  const stray = files
    .filter(
      (file) => file.libraryId !== undefined && !hosted.some((track) => track.value === file.file),
    )
    .map((file) => ({ value: file.file, label: file.label, group: "Built in" }));

  const options = [...imported, ...hosted, ...stray];

  /** The credit the licence asks for, where the chosen track carries one. */
  const attribution = music.library.groups
    .flatMap((group) => group.items)
    .find((track) => track.file === bed.file)?.attribution;

  return (
    <>
      <Section>
        {/* First, and on its own. Every control under it is about a song that
            has already been chosen, and the one thing somebody opens this
            panel to do is change which one. */}
        <Dropdown
          label="Music"
          value={bed.file}
          options={options}
          icon={() => <MusicIcon />}
          // A spinner on the row being fetched, the way a background swatch
          // carries one: the file is a couple of megabytes and nothing else on
          // screen would say the press had been registered. Every other row
          // offers to play itself — a song is the one thing in this editor
          // nobody can judge from its name.
          action={(option) =>
            option.value === music.pending ? (
              <span className="mr-1 grid size-6 flex-none place-items-center text-editor-muted [&_svg]:size-3.5">
                <SpinnerIcon />
              </span>
            ) : (
              <PlaySampleButton
                label={option.label}
                playing={option.value === music.playing}
                onClick={() =>
                  music.onPreview(option.value === music.playing ? null : option.value)
                }
              />
            )
          }
          header={
            <button
              type="button"
              className={
                "flex w-full items-center gap-2 rounded-full px-2.5 py-1.5 text-left text-[13px] " +
                "text-editor-muted hover:bg-white/6 hover:text-editor-fg [&_svg]:size-3.5"
              }
              onClick={music.onImport}
            >
              <span className="flex-none opacity-70" aria-hidden>
                <ImportAudioIcon />
              </span>
              <span className="truncate">Import Audio…</span>
            </button>
          }
          onChange={(file) => {
            // Already here: nothing to fetch, so the reducer is told straight
            // away. The list carries every file in the recording, and most
            // presses on it are a return to one of those.
            const known = files.find((entry) => entry.file === file);
            if (known) {
              music.onChoose(known);
              return;
            }

            const track = music.library.groups
              .flatMap((group) => group.items)
              .find((entry) => entry.file === file);
            if (track) music.onPick(track);
          }}
        />

        {attribution !== undefined && attribution !== "" && (
          // Shown rather than tucked away in a licence file: it is a condition
          // of using the track, and the person putting it in a video is the one
          // who has to carry the credit.
          <p className="px-2.5 text-[11px] leading-snug text-editor-muted">{attribution}</p>
        )}
      </Section>

      <Section title="Level">
        {/* "Include", the same word and the same shape the microphone and the
            system audio use: there are now three things that can be left out
            of the mix, and three different ways of saying so would read as
            three different controls. */}
        <ToggleField
          icon={<MusicIcon />}
          label="Include"
          value={!bed.muted}
          onChange={(value) => onChange({ muted: !value })}
        />
        <Slider
          icon={<SpeakerIcon />}
          label="Volume"
          value={bed.volume}
          min={0}
          max={MAX_MUSIC_VOLUME}
          format={percent}
          disabled={bed.muted}
          onChange={(volume) => onChange({ volume })}
        />
      </Section>

      <Section title="Shape">
        {/* In seconds rather than as a fraction of the bed. A fade is heard as
            a length of time — "give me two seconds" — and a fraction would
            change the sound of it every time the bar was trimmed. */}
        <Slider
          icon={<FadeInIcon />}
          label="Fade in"
          value={bed.fadeIn}
          min={0}
          max={MAX_MUSIC_FADE}
          step={100_000_000}
          format={seconds}
          disabled={bed.muted}
          onChange={(fadeIn) => {
            onBeginEdit();
            onChange({ fadeIn });
          }}
        />
        <Slider
          icon={<FadeOutIcon />}
          label="Fade out"
          value={bed.fadeOut}
          min={0}
          max={MAX_MUSIC_FADE}
          step={100_000_000}
          format={seconds}
          disabled={bed.muted}
          onChange={(fadeOut) => {
            onBeginEdit();
            onChange({ fadeOut });
          }}
        />
        {/* Last, because it is the one control here that changes what is heard
            rather than how loudly: a bed longer than its song is silence at
            the end without it. */}
        <ToggleField
          icon={<RepeatIcon />}
          label="Repeat"
          value={bed.repeat}
          disabled={bed.muted}
          onChange={(repeat) => onChange({ repeat })}
        />
      </Section>
    </>
  );
}

/** Nanoseconds as a reading somebody can use. */
function seconds(value: number): string {
  return `${(value / 1_000_000_000).toFixed(1)}s`;
}
