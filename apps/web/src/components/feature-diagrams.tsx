import {
  CLIP_H,
  Clip,
  ClipLabel,
  ColorField,
  EditorSurface,
  Field,
  Filmstrip,
  Group,
  Panel,
  PanelHeader,
  Playhead,
  Rail,
  Ruler,
  Segmented,
  Slider,
  Strip,
  ToggleField,
  TRACK_GAP,
  Wave,
  ZoomBar,
} from "@/components/editor-controls";
import {
  AudioIcon,
  BackdropIcon,
  BlurIcon,
  CameraIcon,
  CaptionsIcon,
  CornerRadiusIcon,
  CursorIcon,
  LayoutIcon,
  OpacityIcon,
  PaddingIcon,
  PerspectiveIcon,
  PresetsIcon,
  ScreenIcon,
  ShadowIcon,
  SizeIcon,
  SmoothingIcon,
  SpeakerIcon,
  WatermarkIcon,
  ZoomIcon,
} from "@/components/landing/editor-icons";
import { CameraFootage } from "@/components/landing/CameraFootage";
import { CAMERA_STILL, LAYOUT_SCREEN, LAYOUT_STAGE } from "@/components/landing/stage";
import { ASSETS } from "@/lib/assets";

/**
 * The four diagrams on `/features`, one under each section heading.
 *
 * They are the editor, not pictures of it: every surface and control comes from
 * `editor-controls.tsx`, which carries the app's own class strings. A visitor
 * who downloads Prequel after reading this page opens the thing these show.
 *
 * Dark, on a page that is always paper. The public site has no dark mode at all
 * — `globals.css` scopes `[data-theme="dark"]` to the signed-in app and the auth
 * pages, and says why — so these are not a theme responding to a preference.
 * They are the product, which is dark, shown on the site, which is not.
 * `EditorSurface` turns on `editor-theme`, the same palette the landing page's
 * `AppPreview` runs on, so the two agree by construction rather than by somebody
 * remembering to check.
 *
 * Static, deliberately. The three animated demos on the home page exist to show
 * a motion a still cannot: a push in, a re-frame, a word landing. Nothing here
 * is about motion, and four loops running forever beside a dense list of
 * controls is movement in the reader's peripheral vision while they are trying
 * to read. That is also why none of them needs `motion-reduce`.
 *
 * Every one is `aria-hidden`: each says again, in shapes, what the heading above
 * and the cards below say in words, so read out they are noise.
 */

/** The band a diagram sits in, and the ground it sits on. */
function Board({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div aria-hidden className="mt-12">
      <EditorSurface className={`p-4 sm:p-6 ${className}`}>{children}</EditorSurface>
    </div>
  );
}

/** The mono label down the left of a timeline row, at the app's field size. */
function Lane({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 truncate text-[11px] text-editor-muted sm:w-24">{label}</span>
      <div className="relative min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * Peaks for the two audio lanes, as `waveform.ts` would hand them over: one
 * 0–1 amplitude per 50ms bucket, normalised so the loudest reaches the top.
 *
 * Written out rather than generated. A random figure per bucket would differ
 * between the server's render and the client's and hydration would report it,
 * and speech does not look random anyway — these run in phrases with breaths
 * between them, which is what a voice track actually draws.
 */
const VOICE = [
  0.08, 0.31, 0.62, 0.78, 0.55, 0.71, 0.44, 0.18, 0.06, 0.04, 0.12, 0.48, 0.83, 0.66, 0.9, 0.72,
  0.41, 0.15, 0.05, 0.09, 0.35, 0.68, 0.52, 0.79, 0.61, 0.33, 0.11, 0.04, 0.07, 0.28, 0.57, 0.74,
  0.95, 0.63, 0.38, 0.16, 0.06, 0.05, 0.22, 0.51, 0.7, 0.58, 0.42, 0.19, 0.08, 0.04, 0.14, 0.46,
  0.76, 0.88, 0.6, 0.36, 0.13, 0.05, 0.1, 0.4, 0.65, 0.5, 0.27, 0.09,
];

/**
 * The system track: quieter, and in bursts rather than in phrases.
 *
 * A notification and a video playing under the voice, which is what this track
 * usually carries and why it has a gain of its own.
 */
const SYSTEM = [
  0.05, 0.04, 0.06, 0.42, 0.68, 0.51, 0.22, 0.07, 0.05, 0.04, 0.04, 0.05, 0.31, 0.55, 0.47, 0.39,
  0.44, 0.36, 0.29, 0.41, 0.5, 0.38, 0.25, 0.12, 0.06, 0.04, 0.05, 0.18, 0.46, 0.61, 0.4, 0.2,
];

/**
 * Four tracks, kept apart.
 *
 * The lanes are deliberately unequal: the camera starts late and the system
 * audio stops early, which is the thing the section is claiming. Four bars of
 * identical length would draw a mixed-down video with the lanes as decoration.
 *
 * In the app all four are **one** row, because they were recorded together and a
 * clip carries its filmstrip and its wave at once. Pulling them apart is the one
 * liberty this diagram takes, and it is the section's whole point. Everything
 * else is the strip: the ruler above, `TRACK_GAP` between rows, clips at
 * `CLIP_H` with the label along the top and the wave standing on the floor.
 *
 * The pictures are the site's own capture and camera, the ones the home page's
 * demos run on. A drawn filmstrip is a diagram; a real one says this is footage.
 */
export function CaptureDiagram() {
  return (
    <Board>
      <Strip>
        <Ruler seconds={30} />

        <Lane label="Screen">
          <div className="relative flex" style={{ height: CLIP_H }}>
            <Clip width={1}>
              <Filmstrip src={LAYOUT_SCREEN} />
              <ClipLabel icons={<ScreenIcon />} read="0:30" />
            </Clip>
          </div>
        </Lane>

        <div style={{ height: TRACK_GAP }} />

        <Lane label="Camera">
          {/* Late by 8%: the camera opens a few hundred milliseconds after the
              screen, which `session.json` records as an offset and the files
              themselves do not carry. */}
          <div className="relative" style={{ height: CLIP_H }}>
            <div className="absolute inset-y-0 flex" style={{ left: "8%", right: 0 }}>
              <Clip width={1}>
                {/* Cells rather than the clip playing. A camera lane is 38px
                    tall and a few hundred wide, and a 16:9 talking head under
                    `object-cover` in a box that shape is a horizontal band of
                    cheek. The app draws every track as filmstrip cells, and a
                    cell is portrait — which is the shape a face fits. */}
                <Filmstrip src={CAMERA_STILL} cells={22} />
                <ClipLabel icons={<CameraIcon />} read="0:27" />
              </Clip>
            </div>
          </div>
        </Lane>

        <div style={{ height: TRACK_GAP }} />

        <Lane label="Microphone">
          <div className="relative" style={{ height: CLIP_H }}>
            <div className="absolute inset-y-0 flex" style={{ left: "4%", right: 0 }}>
              <Clip width={1}>
                <Wave peaks={VOICE} />
                <ClipLabel icons={<AudioIcon />} read="0:29" />
              </Clip>
            </div>
          </div>
        </Lane>

        <div style={{ height: TRACK_GAP }} />

        <Lane label="System audio">
          <div className="relative" style={{ height: CLIP_H }}>
            <div className="absolute inset-y-0 flex" style={{ left: "22%", width: "54%" }}>
              <Clip width={1}>
                <Wave peaks={SYSTEM} />
                <ClipLabel icons={<SpeakerIcon />} read="0:16" />
              </Clip>
            </div>
          </div>
        </Lane>
      </Strip>
    </Board>
  );
}

/**
 * Clicks and typing, becoming zoom slices.
 *
 * The marks and the bars come off one array, so a bar cannot drift out of
 * alignment with the cluster it is supposed to have come from — which is the
 * whole claim of the section and the one thing a reader would notice.
 *
 * Both rows are the app's: the clip row above, the zoom row below at the same
 * height, `TRACK_GAP` between them. A zoom row half the size reads as less
 * important than the thing it is changing, which is backwards.
 */
export function ZoomPassDiagram() {
  const shots = [
    { marks: [0.05, 0.08, 0.12], from: 0.02, to: 0.16 },
    { marks: [0.27, 0.3], from: 0.25, to: 0.35 },
    { marks: [0.48, 0.51, 0.54, 0.57], from: 0.46, to: 0.61 },
    { marks: [0.75, 0.8], from: 0.73, to: 0.87 },
  ];

  return (
    <Board>
      <Strip>
        <Ruler seconds={30} />

        <Lane label="You did">
          <div className="relative flex" style={{ height: CLIP_H }}>
            <Clip width={1}>
              <Filmstrip src={LAYOUT_SCREEN} />
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
              {/* Where the pointer went down, and where a burst of typing
                  landed. `--slice-ring` is the clip's own light, so these read
                  as marks on the recording rather than as a fifth colour.
                  Placed on the clip's middle band: the label owns the top and
                  the wave the bottom three fifths. */}
              {shots.flatMap((shot) =>
                shot.marks.map((at) => (
                  <span
                    key={at}
                    aria-hidden
                    className="absolute top-[38%] size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slice-ring"
                    style={{ left: `${at * 100}%` }}
                  />
                )),
              )}
            </Clip>
          </div>
        </Lane>

        <div style={{ height: TRACK_GAP }} />

        <Lane label="Prequel made">
          <div className="relative" style={{ height: CLIP_H }}>
            {shots.map((shot, i) => (
              <ZoomBar
                key={shot.from}
                left={shot.from}
                width={shot.to - shot.from}
                // One of them held, because a row where nothing is selected
                // never shows the ring or the grips, and those are half of what
                // a zoom bar looks like.
                selected={i === 2}
              />
            ))}
            <Playhead at={0.52} read="0:15" />
          </div>
        </Lane>
      </Strip>
    </Board>
  );
}

/**
 * The editor: the composition, the dock, and the panel showing.
 *
 * The Background panel, because it is the one whose controls are all four kinds
 * at once — a segmented row, sliders, a colour and a switch — so the diagram
 * shows the whole vocabulary rather than a column of one control repeated. The
 * rows and their order are `Inspector.tsx`'s; the values are a fixture, since
 * this has no clip to read them off.
 */
export function EditorDiagram() {
  const rail = [
    { id: "presets", Icon: PresetsIcon },
    { id: "layout", Icon: LayoutIcon },
    { id: "background", Icon: BackdropIcon },
    { id: "camera", Icon: CameraIcon },
    { id: "audio", Icon: AudioIcon },
    { id: "cursor", Icon: CursorIcon },
    { id: "captions", Icon: CaptionsIcon },
    { id: "watermark", Icon: WatermarkIcon },
  ];

  return (
    <Board className="!p-0">
      <div className="flex min-h-0">
        {/* The board the composition sits on: the app's dot grid over the
            scrim, which is what is behind the picture in the editor. */}
        <div className="dot-grid hidden min-w-0 flex-1 place-items-center bg-editor-scrim p-5 sm:grid">
          {/* One of the wallpapers the app's own picker ships, not a gradient
              invented for the site — the same argument `stage.ts` makes for the
              three demos on the home page. `facet.jpg` because the other two are
              already carrying a demo each, and a fourth appearance of `sequoia`
              would read as the one background this app has.

              No width cap. It ran at `max-w-sm` inside a column most of twice
              that, which left the board four fifths empty dot grid and made the
              composition — the thing every control in the panel beside it is
              editing — the smallest element in the section. The board's own
              padding is what still reads as ground around it. */}
          <div
            className="grain relative aspect-video w-full overflow-hidden rounded-lg bg-cover bg-center"
            style={{ backgroundImage: `url(${LAYOUT_STAGE})` }}
          >
            {/* The recording, padded inside the background. Padding, radius and
                shadow are three of the four the Background panel beside it sets,
                so the picture and the controls are saying the same thing.

                A real capture rather than a window drawn in CSS. A drawn window
                is a diagram: it says "a screen recording would go here" where a
                capture says this is what the tool does to your work. Not
                `next/image` — it is a decorative fill on a box whose size the
                layout decides, and the fixed intrinsic size an `Image` wants is
                the one thing that is not known here. */}
            <div
              className="absolute inset-[7%] overflow-hidden rounded-[4px] bg-cover bg-top shadow-[0_8px_24px_-6px_rgb(0_0_0_/_0.6)] ring-1 ring-black/20"
              style={{ backgroundImage: `url(${LAYOUT_SCREEN})` }}
            />
            {/* The camera, in the corner it defaults to, and playing. A still
                face reads as a photograph pasted on the frame; the whole claim
                of the section is that this is a second track being laid over the
                first, which only a moving one makes. */}
            <span className="squircle absolute right-[8%] bottom-[8%] aspect-square w-[17%] overflow-hidden rounded-full shadow-[0_4px_12px_-2px_rgb(0_0_0_/_0.5)] ring-1 ring-white/25">
              <CameraFootage src={`${ASSETS}/camera-closeup.mp4`} position="50% 50%" />
            </span>
          </div>
        </div>

        <Rail items={rail} at={2} />

        <Panel>
          <PanelHeader icon={<BackdropIcon />} title="Background" />
          <Group>
            <Segmented options={["Image", "Gradient", "Solid"]} at={2} />
            <ColorField icon={<OpacityIcon />} hex="#3A2D5E" />
          </Group>
          <Group>
            <Slider icon={<PaddingIcon />} label="Padding" read="6%" value={0.3} />
            <Slider icon={<CornerRadiusIcon />} label="Corner radius" read="18%" value={0.18} />
            <Slider icon={<ShadowIcon />} label="Shadow" read="45%" value={0.45} />
            <Slider icon={<SizeIcon />} label="Border" read="0.7%" value={0.07} />
          </Group>
          <Group>
            <Field label="Perspective" icon={<PerspectiveIcon />}>
              <Segmented options={["Flat", "Tilt", "Yaw"]} at={1} />
            </Field>
            <ToggleField icon={<BlurIcon />} label="Blur behind" on />
          </Group>
        </Panel>
      </div>
    </Board>
  );
}

/**
 * The zoom panel, and the push it is describing.
 *
 * Sits under the editor section's second grid: the first diagram shows where the
 * controls are, this shows what one of them actually does. Level, speed, tilt,
 * yaw and the focus falloff are the rows the cards beside it name.
 *
 * The composition is the same take as the editor diagram, pushed in to the level
 * the panel reads — 180%, so the picture is at 180% and the two are saying one
 * thing rather than two. The panel stood alone here for a while, hugged to its
 * own 320px: no dock, since the zoom panel is what the inspector shows while a
 * zoom is held rather than one of the rail's categories. But a 320px card
 * centred in a 1152px measure is a column of white either side of it, and the
 * fix for a small object in a wide space is to give it the thing it acts on, not
 * to shrink the frame around it.
 */
export function ZoomPanelDiagram() {
  return (
    <Board className="!p-0">
      <div className="flex min-h-0">
        {/* The board, as the editor diagram draws it. No rail: this panel
            appears because a zoom is selected on the timeline, and the rail is
            not what put it there. */}
        <div className="dot-grid hidden min-w-0 flex-1 place-items-center bg-editor-scrim p-5 sm:grid">
          <div
            className="grain relative aspect-video w-full overflow-hidden rounded-lg bg-cover bg-center"
            style={{ backgroundImage: `url(${LAYOUT_STAGE})` }}
          >
            {/* The recording, pushed in. `background-size: 180%` is the Level
                slider's own reading, and the position is where the pointer was
                — which is what a cursor zoom targets.

                Focus falls away from that point rather than from the middle of
                the frame: a radial mask holds a sharp disc over the subject and
                lets the blurred copy underneath through everywhere else. Two
                layers rather than a filter on one, because `blur()` on an
                element blurs its edges into the background as well, and the
                recording has to keep a hard edge against the wallpaper. */}
            <div className="absolute inset-[7%] overflow-hidden rounded-[4px] shadow-[0_8px_24px_-6px_rgb(0_0_0_/_0.6)] ring-1 ring-black/20">
              <div
                className="absolute inset-0 scale-110 bg-no-repeat blur-[3px]"
                style={{
                  backgroundImage: `url(${LAYOUT_SCREEN})`,
                  backgroundSize: "180%",
                  backgroundPosition: "62% 38%",
                }}
              />
              <div
                className="absolute inset-0 bg-no-repeat"
                style={{
                  backgroundImage: `url(${LAYOUT_SCREEN})`,
                  backgroundSize: "180%",
                  backgroundPosition: "62% 38%",
                  maskImage:
                    "radial-gradient(circle at 62% 38%, #000 22%, rgb(0 0 0 / 0.35) 45%, transparent 62%)",
                }}
              />
            </div>
            <span className="squircle absolute right-[8%] bottom-[8%] aspect-square w-[17%] overflow-hidden rounded-full shadow-[0_4px_12px_-2px_rgb(0_0_0_/_0.5)] ring-1 ring-white/25">
              <CameraFootage src={`${ASSETS}/camera-closeup.mp4`} position="50% 50%" />
            </span>
          </div>
        </div>

        <Panel>
          <PanelHeader icon={<ZoomIcon />} title="Zoom" />
          <Group>
            <Segmented options={["Cursor", "Region", "Typing"]} at={0} />
            <Slider icon={<ZoomIcon />} label="Level" read="180%" value={0.55} />
            <Slider icon={<SmoothingIcon />} label="Speed" read="70%" value={0.7} />
          </Group>
          <Group>
            <Slider icon={<PerspectiveIcon />} label="Tilt" read="12°" value={0.34} />
            <Slider icon={<PerspectiveIcon />} label="Yaw" read="-6°" value={0.42} />
          </Group>
          <Group>
            <Slider icon={<BlurIcon />} label="Focus falloff" read="60%" value={0.6} />
            <Slider icon={<SizeIcon />} label="Sharp area" read="35%" value={0.35} levels={4} />
            <ToggleField icon={<CursorIcon />} label="Hide idle cursor" on />
          </Group>
        </Panel>
      </div>
    </Board>
  );
}

/**
 * What a share link is: a page, with the video on it and an address to send.
 *
 * A browser window rather than a link glyph, because the claim in this section
 * is that the other side needs no account and no app, and an ordinary address
 * bar is that claim in one shape. The window is drawn on the editor's own
 * surfaces so it belongs to the set, even though the page it stands for is the
 * site's and not the app's.
 */
export function ShareDiagram() {
  return (
    <Board>
      <div className="mx-auto max-w-lg overflow-hidden rounded-lg border border-editor-line bg-editor-panel">
        <div className="flex items-center gap-2 border-b border-editor-line px-3 py-2.5">
          <span className="flex gap-1" aria-hidden>
            {["#f0d06f", "#c0a8ff", "#30a46c"].map((c) => (
              <span key={c} className="size-2 rounded-full" style={{ backgroundColor: c }} />
            ))}
          </span>
          {/* The address, drawn rather than typed. Real text here would be a URL
              somebody could try, and it does not resolve. */}
          <span className="flex h-5 min-w-0 flex-1 items-center rounded-full bg-white/5 px-2.5">
            <span className="h-1.5 w-24 rounded-full bg-white/15 sm:w-36" />
          </span>
        </div>
        <div className="relative grid aspect-[16/7] place-items-center bg-gradient-to-br from-[#2b2247] to-[#16171a]">
          <span className="grid size-10 place-items-center rounded-full bg-white/10 ring-1 ring-white/20">
            <span className="ml-0.5 size-0 border-y-[6px] border-l-[10px] border-y-transparent border-l-white" />
          </span>
          <span className="absolute right-2.5 bottom-2.5 rounded bg-black/50 px-1.5 py-0.5 font-mono text-[10px] text-white/80">
            0:42
          </span>
        </div>
      </div>
    </Board>
  );
}
