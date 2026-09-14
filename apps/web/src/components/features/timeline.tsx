import {
  CLIP_H,
  Clip,
  ClipLabel,
  Filmstrip,
  Group,
  Playhead,
  Ruler,
  Slider,
  Strip,
  Wave,
} from "@/components/editor-controls";
import { Bubble, Chip, Frame, Pointer, Screen, Slab } from "@/components/features/frame";
import { SYSTEM, VOICE } from "@/components/features/tracks";
import {
  AudioIcon,
  CameraIcon,
  PaddingIcon,
  ScissorsIcon,
  ScreenIcon,
  ShadowIcon,
  SpeakerIcon,
  TrashIcon,
} from "@/components/landing/editor-icons";
import {
  CAPTIONS_STAGE,
  LAYOUT_SCREEN,
  LAYOUT_STAGE,
  ZOOM_STAGE,
} from "@/components/landing/stage";

/**
 * The pictures on the Timeline, audio and presets cards.
 */

/**
 * The strip as it opens: a ruler, one clip with its filmstrip and its wave,
 * and the playhead part way along.
 *
 * Every part is `editor-controls.tsx`'s, and the wave stands on the frames
 * the way the app draws it: bottom three fifths, over the dimmed filmstrip,
 * with the label along the top.
 */
export function FilmstripAndWave() {
  return (
    <Frame stage="sequoia">
      <Slab className="inset-x-4 top-5 -bottom-6">
        <Strip>
          <Ruler seconds={30} />
          <div className="relative flex" style={{ height: CLIP_H }}>
            <Clip width={1}>
              <Filmstrip src={LAYOUT_SCREEN} cells={18} />
              <Wave peaks={VOICE} />
              <ClipLabel
                icons={
                  <>
                    <ScreenIcon />
                    <CameraIcon />
                  </>
                }
                read="0:30"
              />
            </Clip>
            <Playhead at={0.38} read="0:11" />
          </div>
        </Strip>
      </Slab>
    </Frame>
  );
}

/**
 * A clip cut in two at the playhead, with the blade over the cut.
 *
 * The right-hand piece is the selected one, so its grips show: split and trim
 * are the same picture, one cut and two ends to take hold of. The two buttons
 * in the corner are the transport's own cut and delete.
 */
export function SplitAndTrim() {
  return (
    <Frame stage="facet">
      <Slab className="inset-x-4 top-9 -bottom-6">
        <Strip>
          <div className="relative pt-4">
            <div className="flex gap-1.5" style={{ height: CLIP_H }}>
              <Clip width={0.44}>
                <Filmstrip src={LAYOUT_SCREEN} cells={6} />
                <Wave peaks={VOICE.slice(0, 26)} />
              </Clip>
              <Clip width={0.56} selected>
                <Filmstrip src={LAYOUT_SCREEN} cells={7} />
                <Wave peaks={VOICE.slice(26)} />
              </Clip>
            </div>
            <Playhead at={0.445} read="0:13" />
          </div>
        </Strip>
      </Slab>
      <div className="absolute top-3 right-4 flex gap-1">
        {[ScissorsIcon, TrashIcon].map((Icon, i) => (
          <span
            key={i}
            className="grid size-7 place-items-center rounded-md bg-black/60 text-white backdrop-blur-sm [&_svg]:size-3.5"
          >
            <Icon />
          </span>
        ))}
      </div>
      <Pointer className="top-[46%] left-[46%] w-7" />
    </Frame>
  );
}

/**
 * One control set for the clip, one still on the project's default.
 *
 * The dot beside the first slider is the app's override mark: a control that
 * has been changed with a clip selected carries it, and a control still on the
 * defaults does not. Two rows, one with and one without, is the card.
 */
export function PerClipOverride() {
  return (
    <Frame stage="peony">
      <Slab className="inset-x-4 top-8 -bottom-6">
        <Group>
          <div className="relative">
            <span className="absolute top-1/2 -left-2.5 size-1.5 -translate-y-1/2 rounded-full bg-selected" />
            <Slider icon={<PaddingIcon />} label="Padding" read="3%" value={0.15} />
          </div>
          <Slider icon={<ShadowIcon />} label="Shadow" read="45%" value={0.45} />
        </Group>
      </Slab>
      <Chip className="top-3 left-4">Set for this clip</Chip>
    </Frame>
  );
}

/**
 * Three saved looks, as the presets panel shows them.
 *
 * Each card is a composition in miniature on its own wallpaper, because a
 * preset carries the background along with the arrangement and the name
 * alone would not say which is which. The three grounds are the site's three.
 */
export function ScenePresets() {
  const presets = [
    { name: "Launch", stage: ZOOM_STAGE, bubble: "right-[8%] bottom-[10%]" },
    { name: "Tutorial", stage: LAYOUT_STAGE, bubble: "left-[8%] bottom-[10%]" },
    { name: "Talk", stage: CAPTIONS_STAGE, bubble: "right-[8%] top-[10%]" },
  ];

  return (
    <Frame stage="sequoia">
      <Slab className="inset-x-4 top-5 -bottom-6" inner="px-3 pt-3">
        <span className="text-[10px] text-editor-muted">Saved looks</span>
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          {presets.map((preset, i) => (
            <span
              key={preset.name}
              className={`flex flex-col gap-1 rounded-md p-1 ${
                i === 0 ? "bg-selected/25 ring-1 ring-selected" : "bg-white/5"
              }`}
            >
              <span
                className="relative aspect-video overflow-hidden rounded bg-cover bg-center"
                style={{ backgroundImage: `url(${preset.stage})` }}
              >
                <Screen
                  className="inset-[10%] rounded-[2px] ring-white/30"
                  style={{ boxShadow: "none" }}
                />
                <Bubble className={`aspect-square w-[22%] ${preset.bubble}`} edge="border" />
              </span>
              <span className="truncate text-center text-[10px] text-editor-fg">{preset.name}</span>
            </span>
          ))}
        </div>
      </Slab>
    </Frame>
  );
}

/**
 * The two gains, and the two waves under them.
 *
 * The audio panel's two rows over two lanes at the readings they show: the
 * microphone up, the system sound held back, which is the balance a take with
 * a video playing under it needs.
 */
export function AudioGains() {
  return (
    <Frame stage="facet">
      <Slab className="inset-x-4 top-5 -bottom-6">
        <Group>
          <Slider icon={<AudioIcon />} label="Microphone" read="80%" value={0.8} />
          <Slider icon={<SpeakerIcon />} label="System" read="45%" value={0.45} />
        </Group>
        <Strip>
          <div className="flex gap-1.5 pt-1" style={{ height: CLIP_H }}>
            <Clip width={0.6}>
              <Wave peaks={VOICE} />
            </Clip>
            <Clip width={0.4}>
              <Wave peaks={SYSTEM} />
            </Clip>
          </div>
        </Strip>
      </Slab>
    </Frame>
  );
}
