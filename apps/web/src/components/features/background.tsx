import { Group, PanelHeader, Segmented, Slider } from "@/components/editor-controls";
import { Bubble, Chip, Frame, Screen, Slab } from "@/components/features/frame";
import {
  BackdropIcon,
  CornerRadiusIcon,
  PaddingIcon,
  ShadowIcon,
  SizeIcon,
} from "@/components/landing/editor-icons";
import { CAPTIONS_STAGE, LAYOUT_STAGE, ZOOM_STAGE } from "@/components/landing/stage";
import { Logo } from "@/components/Logo";

/**
 * The pictures on the Background and frame cards.
 */

/**
 * Where a background can come from, as the swatch row the panel shows.
 *
 * Five swatches: the desktop picture, two from the hosted catalogue, a
 * gradient and a solid. The wallpapers are the site's three, which are three
 * of the catalogue's, so the swatches are pictures of real choices and the
 * picked one is the ground this card stands on.
 */
export function BackgroundSources() {
  const swatches = [
    { name: "Desktop", style: { backgroundImage: `url(${ZOOM_STAGE})` } },
    { name: "Catalogue", style: { backgroundImage: `url(${LAYOUT_STAGE})` } },
    { name: "Catalogue", style: { backgroundImage: `url(${CAPTIONS_STAGE})` } },
    { name: "Gradient", style: { background: "linear-gradient(135deg, #c000f0, #4e84f9)" } },
    { name: "Solid", style: { background: "#3a2d5e" } },
  ];

  return (
    <Frame stage="peony">
      <Slab className="inset-x-4 top-5 -bottom-6" inner="flex flex-col gap-3 px-4 pt-3">
        <div className="w-56">
          <Segmented options={["Image", "Gradient", "Solid"]} at={0} />
        </div>
        <div className="flex gap-2">
          {swatches.map((swatch, i) => (
            <span key={`${swatch.name}-${i}`} className="flex flex-col items-center gap-1.5">
              <span
                className={`block h-12 w-16 rounded-md bg-cover bg-center sm:w-20 ${
                  i === 2
                    ? "ring-2 ring-selected ring-offset-2 ring-offset-editor-bg"
                    : "ring-1 ring-white/10"
                }`}
                style={swatch.style}
              />
              <span className="text-[10px] text-editor-muted">{swatch.name}</span>
            </span>
          ))}
        </div>
      </Slab>
    </Frame>
  );
}

/**
 * The frame controls, and the frame they are shaping.
 *
 * A tall card: the composition above and the panel below it, so the padding
 * the slider reads is the padding the picture shows. The card's own wallpaper
 * is the composition's background — the recording is set in from the frame's
 * edge by the panel's padding, and the bubble sits in its corner — rather than
 * a second wallpaper drawn on the first, which read as a picture of a picture.
 * The panel's rows and order are the app's; the values are a fixture, since
 * there is no clip to read them off.
 */
export function FrameControls() {
  return (
    <Frame stage="sequoia" fill>
      <Screen className="inset-x-7 top-5 h-[7.5rem]" />
      <Bubble className="top-[6.75rem] right-10 size-11" />
      <Slab className="inset-x-4 top-[11.5rem] -bottom-4">
        <PanelHeader icon={<BackdropIcon />} title="Frame" />
        <Group>
          <Slider icon={<PaddingIcon />} label="Padding" read="9%" value={0.45} />
          <Slider icon={<CornerRadiusIcon />} label="Corner radius" read="18%" value={0.18} />
          <Slider icon={<SizeIcon />} label="Border" read="0.6%" value={0.3} />
          <Slider icon={<ShadowIcon />} label="Shadow" read="45%" value={0.45} />
        </Group>
      </Slab>
    </Frame>
  );
}

/**
 * The wallpaper softened behind a sharp recording.
 *
 * A second copy of the ground, blurred and scaled past the edges so the blur
 * has nothing transparent to pull in from outside the box. The recording sits
 * over it untouched, which is the whole of what the slider does.
 */
export function BlurBehind() {
  return (
    <Frame stage="facet">
      <div
        className="absolute -inset-4 scale-110 bg-cover bg-center blur-lg"
        style={{ backgroundImage: `url(${LAYOUT_STAGE})` }}
      />
      <Screen className="-right-6 -bottom-8 top-7 left-6" />
      <Chip className="top-3 left-4">Blur 60%</Chip>
    </Frame>
  );
}

/**
 * A logo in the frame's corner, over the recording.
 *
 * The site's own mark, because it is the one logo to hand that is really an
 * SVG, and drawn short of full opacity so it reads as a watermark rather than
 * as a sticker.
 */
export function Watermark() {
  return (
    <Frame stage="peony">
      <Screen className="-right-8 -bottom-8 top-6 left-6">
        <span className="absolute right-14 bottom-12 flex items-center gap-1.5 opacity-80">
          <Logo size={22} radius={0.28} />
          <span className="text-[13px] font-medium tracking-tight text-white drop-shadow">
            Prequel
          </span>
        </span>
      </Screen>
      <Chip className="top-3 right-4">Opacity 80%</Chip>
    </Frame>
  );
}
