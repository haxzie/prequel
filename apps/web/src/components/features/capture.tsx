import { EyeOff, Pause } from "lucide-react";

import {
  CLIP_H,
  Clip,
  ClipLabel,
  Segmented,
  Strip,
  TRACK_GAP,
  Wave,
} from "@/components/editor-controls";
import { Bubble, Chip, Frame, Key, Screen, Slab } from "@/components/features/frame";
import { Lane, SYSTEM, VOICE } from "@/components/features/tracks";
import { AudioIcon, CameraIcon, SpeakerIcon } from "@/components/landing/editor-icons";
import { CAPTIONS_SCREEN, LAYOUT_SCREEN } from "@/components/landing/stage";

/**
 * The pictures on the Capture cards: what the dock records, and how.
 */

/**
 * A region dragged out on a screen, with the source picker over it.
 *
 * The marquee is the one the picker draws: a dashed edge, a grip at each
 * corner and the size printed at the top left, so the drag has something to
 * read while it is happening. The picker sits on the region choice, because
 * the marquee is what that choice looks like and the other two are the whole
 * screen or a window's own edge, neither of which needs drawing.
 */
export function SourcePicker() {
  return (
    <Frame stage="sequoia">
      <Screen className="-top-6 -right-8 -bottom-8 left-8 lg:left-24" />
      <div className="absolute top-[34%] right-[22%] bottom-[8%] left-[38%] rounded-sm border-2 border-dashed border-white shadow-[0_0_0_9999px_rgb(0_0_0_/_0.35)]">
        {["-top-1 -left-1", "-top-1 -right-1", "-bottom-1 -left-1", "-bottom-1 -right-1"].map(
          (corner) => (
            <span key={corner} className={`absolute size-2 rounded-[2px] bg-white ${corner}`} />
          ),
        )}
        <Chip className="-top-3 left-2">1280 × 720</Chip>
      </div>
      <Slab className="top-4 left-4 w-52" inner="p-1">
        <Segmented options={["Display", "Window", "Region"]} at={2} />
      </Slab>
    </Frame>
  );
}

/**
 * The camera, standing half off the screen it was recorded beside.
 *
 * Overlapping the recording's corner rather than sitting inside it, which is
 * the card's claim in one shape: a bubble burned into the picture could not
 * cross its edge.
 */
export function CameraTrack() {
  return (
    <Frame stage="facet">
      <Screen className="-top-10 -right-14 bottom-8 left-10" />
      <Bubble className="bottom-5 left-4 size-[4.5rem]" />
      <Chip className="right-4 bottom-5">
        <CameraIcon />
        Its own track
      </Chip>
    </Frame>
  );
}

/**
 * The two audio lanes, each with its own wave.
 *
 * Unequal on purpose: the system lane starts late and stops early, which is a
 * notification and a clip playing under the voice, and is why it has a gain of
 * its own. Two lanes the same length would draw a mixed track with a
 * decorative split.
 */
export function AudioTracks() {
  return (
    <Frame stage="peony">
      <Slab className="inset-x-4 top-6 -bottom-6">
        <Strip>
          <div className="pt-4">
            <Lane label="Microphone">
              <div className="relative flex" style={{ height: CLIP_H }}>
                <Clip width={1}>
                  <Wave peaks={VOICE} />
                  <ClipLabel icons={<AudioIcon />} read="0:29" />
                </Clip>
              </div>
            </Lane>
            <div style={{ height: TRACK_GAP }} />
            <Lane label="System">
              <div className="relative" style={{ height: CLIP_H }}>
                <div className="absolute inset-y-0 flex" style={{ left: "22%", width: "54%" }}>
                  <Clip width={1}>
                    <Wave peaks={SYSTEM} />
                    <ClipLabel icons={<SpeakerIcon />} read="0:16" />
                  </Clip>
                </div>
              </div>
            </Lane>
          </div>
        </Strip>
      </Slab>
    </Frame>
  );
}

/**
 * The countdown, the shortcut that started it, and the pause it can take.
 *
 * `Shift+Cmd+R` is the app's default chord, from `RecordingPreferences`; the
 * card says it can be rebound, so the one shown has to be the one that ships.
 */
export function Countdown() {
  return (
    <Frame stage="sequoia">
      <Screen className="-top-8 -right-12 -bottom-10 left-6 blur-[1.5px]" src={CAPTIONS_SCREEN} />
      <div className="absolute inset-0 grid place-items-center">
        <span className="grid size-[4.5rem] place-items-center rounded-full border-[3px] border-white bg-black/40 text-3xl font-medium text-white tabular-nums backdrop-blur-sm">
          3
        </span>
      </div>
      <div className="absolute bottom-4 left-4 flex gap-1">
        <Key>⇧</Key>
        <Key>⌘</Key>
        <Key>R</Key>
      </div>
      <Chip className="right-4 bottom-4">
        <Pause />
        Paused 0:42
      </Chip>
    </Frame>
  );
}

/**
 * A loupe on the recording, at three times.
 *
 * The magnified disc is the same capture at 300%, still sharp, which is what a
 * native-resolution take has to spare. The reading beside it is a 14-inch
 * MacBook Pro's own panel, so the figure is one a reader can check against
 * the lid in front of them.
 */
export function NativeResolution() {
  return (
    <Frame stage="facet">
      <Screen className="-right-8 -bottom-8 top-6 left-6" />
      <Chip className="top-9 left-9">3024 × 1964</Chip>
      <div
        className="absolute top-8 right-8 size-[5.5rem] rounded-full bg-no-repeat shadow-[0_10px_24px_-8px_rgb(0_0_0_/_0.7)] ring-2 ring-white"
        style={{
          backgroundImage: `url(${LAYOUT_SCREEN})`,
          backgroundSize: "300%",
          backgroundPosition: "46% 42%",
        }}
      />
      <Chip className="right-8 bottom-4">300%</Chip>
    </Frame>
  );
}

/**
 * The dock, drawn where it would be and marked as not in the take.
 *
 * Dashed and dimmed, the way a picker draws a window that is filtered out of
 * a capture. It is the app's own pill in outline — a record button, a divider
 * and a row of controls — rather than a generic toolbar, because the claim is
 * about this window in particular.
 */
export function OwnWindowsExcluded() {
  return (
    <Frame stage="peony">
      <Screen className="-right-10 -bottom-10 top-5 left-5" />
      <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-[10px] border border-dashed border-white/80 bg-black/40 px-2.5 py-2 opacity-90 backdrop-blur-sm">
        <span className="size-4 rounded-full bg-[#ff453a] ring-2 ring-white/40" />
        <span className="h-4 w-px bg-white/25" />
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-4 rounded bg-white/30" />
        ))}
      </div>
      <Chip className="top-9 right-8">
        <EyeOff />
        Not in the recording
      </Chip>
    </Frame>
  );
}
