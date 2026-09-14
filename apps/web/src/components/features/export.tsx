import { Group, Segmented } from "@/components/editor-controls";
import { Bubble, Frame, Screen, Slab } from "@/components/features/frame";
import { CAPTIONS_SCREEN, LAYOUT_SCREEN } from "@/components/landing/stage";

/**
 * The pictures on the Export cards.
 */

/**
 * The export dialog's three choices, and the line that sums them up.
 *
 * The rows are `ExportDialog.tsx`'s: the format, the quality, the rate, with
 * the size and rate printed beside the button the way the dialog prints them.
 * No labels over the rows — three labelled fields are taller than the frame,
 * and "MP4 · HEVC · GIF" says what it is without one.
 */
export function ExportDialog() {
  return (
    <Frame stage="sequoia">
      <Slab className="inset-x-4 top-5 -bottom-6 lg:inset-x-16">
        <Group>
          <div className="flex gap-3">
            <div className="flex-[3]">
              <Segmented options={["MP4", "HEVC", "GIF"]} at={0} />
            </div>
            <div className="flex-[2]">
              <Segmented options={["60 fps", "30 fps"]} at={0} />
            </div>
          </div>
          <Segmented options={["Full", "1080p", "720p", "480p"]} at={1} />
          <div className="flex items-center justify-end gap-3">
            <span className="font-mono text-[11px] whitespace-nowrap text-editor-muted">
              1920 × 1080 · 60 fps · H.264
            </span>
            <span className="grid h-7 place-items-center rounded-md bg-selected px-3 text-[11px] font-medium text-white">
              Export
            </span>
          </div>
        </Group>
      </Slab>
    </Frame>
  );
}

/**
 * One composition in four frames.
 *
 * The same recording and the same bubble in each, sized as a fraction of the
 * frame's shorter edge, which is why the padding round the screen and the
 * bubble in its corner are the same in all four. The frames are drawn at one
 * height so the widths say the shape.
 */
export function AnyFrame() {
  const frames = [
    { name: "16:9", aspect: "16 / 9" },
    { name: "4:5", aspect: "4 / 5" },
    { name: "1:1", aspect: "1 / 1" },
    { name: "9:16", aspect: "9 / 16" },
  ];

  return (
    <Frame stage="facet">
      <div className="absolute inset-x-4 top-4 bottom-0 flex items-start justify-center gap-3 lg:gap-5">
        {frames.map((frame) => (
          <span key={frame.name} className="flex h-full flex-col items-center gap-1.5">
            <span
              className="relative h-[6.25rem] overflow-hidden rounded-md bg-black/25 ring-1 ring-white/60 backdrop-blur-sm"
              style={{ aspectRatio: frame.aspect }}
            >
              <Screen className="inset-[8%] rounded-[3px]" style={{ boxShadow: "none" }} />
              <Bubble className="right-[10%] bottom-[10%] aspect-square w-[24%]" edge="border" />
            </span>
            <span className="font-mono text-[10px] text-white/85">{frame.name}</span>
          </span>
        ))}
      </div>
    </Frame>
  );
}

/**
 * An export part way through.
 *
 * A progress bar and the two chips that say where the work is being done.
 * VideoToolbox and Metal are named because they are the fact the card makes,
 * and a bar on its own would be any app's.
 */
export function HardwareExport() {
  return (
    <Frame stage="peony">
      <Screen className="-right-8 -bottom-10 top-7 left-6 blur-[1.5px]" src={CAPTIONS_SCREEN} />
      <Slab className="inset-x-6 top-1/2 -translate-y-1/2">
        <div className="flex flex-col gap-2.5 px-4 py-3.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-editor-fg">Exporting</span>
            <span className="font-mono text-editor-muted tabular-nums">64%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-[64%] rounded-full bg-selected" />
          </div>
          <div className="flex gap-1.5">
            {["VideoToolbox", "Metal", "No upload"].map((chip) => (
              <span
                key={chip}
                className="rounded-full bg-white/8 px-2 py-0.5 font-mono text-[10px] text-editor-muted"
              >
                {chip}
              </span>
            ))}
          </div>
        </div>
      </Slab>
    </Frame>
  );
}

/**
 * The preview and the file, side by side and the same.
 *
 * Two identical compositions with an equals sign between them, which is the
 * claim in its plainest shape. Both are drawn from one set of insets, so the
 * picture cannot show a difference the code does not have.
 */
export function PreviewEqualsExport() {
  const panes = ["Preview", "Export"];

  return (
    <Frame stage="sequoia">
      <div className="absolute inset-0 flex items-center justify-center gap-3 px-4">
        {panes.map((pane, i) => (
          <span key={pane} className="contents">
            {i === 1 ? <span className="text-2xl font-light text-white/90">=</span> : null}
            <span className="flex flex-col items-center gap-1.5">
              <span
                className="relative aspect-video w-32 overflow-hidden rounded-md bg-cover bg-center ring-1 ring-white/50 lg:w-36"
                style={{ backgroundImage: `url(${LAYOUT_SCREEN})` }}
              >
                <span className="absolute inset-0 bg-black/10" />
                <Bubble className="right-[6%] bottom-[8%] aspect-square w-[22%]" edge="border" />
              </span>
              <span className="font-mono text-[10px] text-white/85">{pane}</span>
            </span>
          </span>
        ))}
      </div>
    </Frame>
  );
}
