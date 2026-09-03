/**
 * The zoom pass, running, in place of a screenshot of it.
 *
 * A still picture of a directed recording cannot show the one thing the
 * product does — the push in, the hold, the pull back out — so this is the
 * timeline playing: four zoom slices in sequence, a playhead crossing them, and
 * the picture above doing what the slice under the playhead says.
 *
 * Entirely CSS. There is no state, no `use client` and no renderer: the whole
 * cycle is sixteen keyframe animations sharing one 16s period, declared beside
 * the site's other animations in `globals.css`. That is not thrift for its own
 * sake — the hero already ships 700 kB of shader on this route, and a second
 * animated block driven from JavaScript would compete with it for the same main
 * thread while the page is still settling.
 *
 * The zoom targets in `demo-screen` and `demo-cursor` are percentages of this
 * picture, and they were measured off the laid-out mock rather than guessed —
 * which is what the `data-demo-*` attributes below are for. Move a panel or
 * resize a frame and they have to be measured again, or the pass zooms into
 * whatever is now at the old coordinates:
 *
 *   const box = document.querySelector(".animate-demo-screen").getBoundingClientRect()
 *   const r = document.querySelector("[data-demo-toolbar]").getBoundingClientRect()
 *   [((r.left + r.width / 2 - box.left) / box.width) * 100,
 *    ((r.top + r.height / 2 - box.top) / box.height) * 100]
 *
 * The picture is inset inside the frame that crops it, so a target near an edge
 * then has to be pulled back towards the middle — the note on `demo-screen` has
 * the limit and the arithmetic.
 *
 * The four things it does are the four a person actually does in a design tool
 * in the first minute: type the address, draw a frame, select one, pick a tool.
 * The app itself is drawn generically — panels, a canvas, a floating toolbar —
 * rather than reproducing anyone's mark or wordmark.
 */
import { CameraFootage } from "@/components/landing/CameraFootage";
import { DemoTimeline } from "@/components/landing/DemoTimeline";
import { ZOOM_STAGE } from "@/components/landing/stage";
import { Container, SectionHeading } from "@/components/Section";

/**
 * The four slices, in the order they play.
 *
 * `zoom` is the real figure from the matching keyframe in `demo-screen` rather
 * than a label chosen to look tidy. Four slices reading 2.5x is what a mock-up
 * does; a timeline whose numbers do not match its own picture is the sort of
 * detail that tells a visitor the whole thing is a drawing.
 *
 * The first is the biggest by some way because an address bar sits a few per
 * cent from the top of the window: the nearer a target is to an edge, the
 * tighter the zoom has to be before the frame can hold it without the crop
 * sliding off the picture. See the note on `demo-screen`.
 */
const SLICES = [
  { zoom: "3.6×", did: "Typed the address" },
  { zoom: "2.3×", did: "Drew a frame" },
  { zoom: "2.6×", did: "Selected a frame" },
  { zoom: "3.2×", did: "Picked a tool" },
];

/**
 * The address being typed.
 *
 * The length is in three places that have to agree — this string, the `steps(9)`
 * in `demo-type`, and the `-9ch` in `demo-caret-step` — because a step count
 * cannot be read from a custom property. Change it and change all three, or the
 * caret stops landing on the last letter.
 */
const ADDRESS = "figma.com";

/** The layer tree in the left panel. */
const LAYERS = [
  { name: "Home", kind: "frame", depth: 0 },
  { name: "Nav", kind: "group", depth: 1 },
  { name: "Hero", kind: "group", depth: 1 },
  { name: "Heading", kind: "text", depth: 2 },
  { name: "Pricing", kind: "frame", depth: 0 },
  { name: "Plan card", kind: "group", depth: 1 },
];

/** The floating toolbar. The one the pointer picks is the frame tool. */
const TOOLS = ["move", "frame", "shape", "pen", "text", "comment"] as const;

export function ZoomDemo() {
  return (
    <section className="py-24">
      <Container>
        {/* Two columns, and the wider one is the picture. The heading is three
            lines of type that read fine at 400px; the demo is a window with
            panels down both sides, and below about 560px its own labels stop
            being legible before the zoom has done anything.

            It is also why the picture is no longer full width. A CSS transform
            scales the rasterised layer rather than re-rendering it, and the
            browser picks one raster scale for the whole animation with a cap on
            the texture it will allocate — so the bigger the box, the lower the
            scale it settles for and the softer a 3.6x push looks. Halving the
            width buys back most of that on its own; the supersample below buys
            the rest. */}
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:gap-16">
          {/*
            Deliberately not the hero's "pushed in on the work", and
            deliberately not "Prequel watches ... while it records", which is
            the sentence the next section down opens with. This is the first
            thing under the hero and it sits directly above the section that
            explains the pass, so both of those phrases were being said twice
            within a screen of each other.

            Nor "Zooms that follow the work", which is a feature card a screen
            further down. The cursor is what this one is about — it is what the
            picture below actually shows, and naming it is the difference
            between a claim and a description of what is on screen.
          */}
          <SectionHeading
            eyebrow="The zoom pass"
            title="The zoom follows your cursor"
            lede="Prequel reads the pointer as it records and frames each thing you did, holding the rest of the window soft behind it. This is that pass, playing — not a picture of it."
          />

          {/*
            `role="img"` with a label, and everything inside it hidden. The
            parts are a few hundred boxes standing in for an application window;
            read out one at a time they are noise, and none of the text in them
            is worth reaching. One sentence describing what the picture shows is
            the whole of what a screen reader needs here.
          */}
          <div
            data-zoom-demo
            role="img"
            aria-label="A screen recording of a design tool, playing. The picture pushes in on an address being typed, on a new frame being drawn on the canvas, on a frame being selected, and on a tool being picked from the toolbar — each time with the rest of the window falling out of focus behind it — while the camera bubble holds its corner and a playhead crosses the four zoom slices on the timeline below."
          >
            {/* Nothing but a wrapper. The picture and its timeline used to sit
                in a panel with a border and an inset; the stage already paints
                the composited background edge to edge, so the panel only ever
                showed in that inset and read as a tray the demo was standing
                on. Grouping them is the timeline's own margin, not a box drawn
                around both. */}
            <div>
              {/*
                The stage: the wallpaper a recording sits on, and the frame that
                crops it.

                `perspective` lives here rather than on the picture itself. It
                has to be on an ancestor for the tilts in `demo-screen` to
                converge — set on the transformed element it applies to that
                element's own children instead, and the rotations come out as a
                flat skew. The distance is short enough that a few degrees read
                as depth; at the 1400px this started on, an 8° turn was
                indistinguishable from none.

                `overflow-hidden` is what makes the zoom a zoom: at 3.6x most of
                the picture is outside this box, and without the crop it would
                paint over the timeline underneath.

                The picture fills this box at rest rather than sitting inset in
                it. The inset it used to have cost margin at both ends — it made
                the crop harder to keep covered *and* pushed every target nearer
                a picture edge, so each one needed a tighter push before it could
                be centred.
              */}
              <div
                className="relative aspect-[16/10] overflow-hidden rounded-lg bg-[#0b0d11]"
                style={{ perspective: "800px" }}
              >
                {/* The box everything is measured against: the zoom targets in
                    `demo-screen` and the pointer's path in `demo-cursor` are
                    both percentages of this element. */}
                {/*
                  Three nested boxes, and the nesting is what keeps the picture
                  sharp under a 3.6x push.

                  A CSS transform does not re-render its subtree. The browser
                  rasterises the animated layer once, at a raster scale it picks
                  for the whole animation, and stretches that texture — so
                  everything here is about making it pick a high scale, and
                  about handing it more pixels than it needs if it does not.

                  1. The tilt. `rotateX`/`rotateY` live out here on their own and
                     the push lives below, because a transform animation that
                     contains a 3D rotation has no computable maximum scale: the
                     browser gives up, rasterises at 1x and magnifies, which is
                     exactly the pixellation this is fixing. Split apart, the
                     inner animation is plain scale and translate and its
                     maximum — 3.6 — can be read straight off the keyframes.

                     Rotating out here also rotates about the frame's own centre
                     rather than about a point the push has already thrown a long
                     way off it, which is what stops a few degrees of tilt
                     dragging the picture's edge into shot.

                  2. The supersample. This box is laid out at twice the size it
                     is shown at and scaled back by half — *above* the animated
                     element, not inside it. Inside, the browser folds the halving
                     into the same raster and the extra detail is thrown away
                     before anything uses it, which is how the first attempt at
                     this changed nothing at all. Out here the halving happens
                     after rasterisation, so whatever scale the browser picks, the
                     texture holds twice the detail the screen asks of it.

                  3. The push. Scale and translate only.
                */}
                <div className="animate-demo-tilt absolute inset-0">
                  <div
                    className="origin-top-left"
                    style={{ width: "200%", height: "200%", transform: "scale(0.5)" }}
                  >
                    <div
                      className="grain animate-demo-screen size-full overflow-hidden bg-cover bg-center"
                      style={{ backgroundImage: `url(${ZOOM_STAGE})` }}
                    >
                      {/* `@container` here, so `cqw` resolves against the doubled
                          box: every length inside doubles in layout pixels and
                          halves again under the scale above, which is what makes
                          the supersample invisible to the layout and to the
                          targets measured off it. */}
                      <div className="@container size-full">
                        {/*
                          The window floats on the background rather than
                          filling the frame, and the margin is doing real work.

                          A push can only centre a target that is at least
                          `0.5 / (0.9 * scale)` from the picture's own edge —
                          nearer than that and the crop would slide off the
                          picture, so it gets clamped and the subject ends up
                          pinned to the side of the frame instead of in the
                          middle of it. An address bar four per cent from the top
                          of a full-bleed window can never be centred at any zoom
                          worth using. Floating the window inwards moves the two
                          edge targets — the address bar and the toolbar — far
                          enough in that both can sit centre frame.

                          It is also, exactly, what the product does to a
                          recording: padding, radius and a shadow over a
                          background. So the background is painted here, inside
                          the thing that zooms, rather than on the crop outside
                          it — a wallpaper that held still while the window
                          scaled would give away that the two are not one frame,
                          and the margin around the window would read as a black
                          border rather than as the composited edge it is.
                        */}
                        <div className="absolute inset-x-[8%] inset-y-[14%] overflow-hidden rounded-[0.9cqw] bg-[#1e1e1e] shadow-[0_3cqw_6cqw_-2cqw_rgb(0_0_0_/_0.8)] ring-1 ring-white/8">
                          <BrowserChrome />
                          <DesignTool />
                        </div>
                      </div>

                      {/* Inside the push and outside the content, so its
                          percentages are the same numbers as the zoom targets.
                          `demo-click` counter-scales it against both the push
                          and the halving above — see the note there. */}
                      <Pointer />
                    </div>
                  </div>
                </div>

                <CameraBubble />
              </div>

              <ZoomTrack />
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

/**
 * The webcam, in the corner of the composition.
 *
 * On the crop rather than inside the push, which is the one thing about it that
 * has to be right: the camera is a second picture composited into the frame,
 * not part of the recording, so a zoom pushes into the screen and leaves it
 * where it is. Magnified along with the window it would read as a sticker on
 * the recording — and at 3.6x most of it would be outside the frame.
 *
 * `squircle` — `corner-shape` — over a 50% radius, the same pairing `LayoutDemo`
 * uses: a square box at 50% is a circle, and the app's default camera shape is
 * the macOS superellipse. Safari and Firefox have no `corner-shape` yet and
 * fall back to the circle, which is a shape the app offers too.
 *
 * 21% of the width is `cameraHeight`'s default 0.35 of the frame's shorter edge
 * — the height, on a 16:10 stage — carried across to a square box.
 */
function CameraBubble() {
  return (
    <div className="squircle absolute right-[3.4%] bottom-[6%] aspect-square w-[21%] overflow-hidden rounded-full bg-[#2a1a2e] shadow-[0_1.5cqw_3cqw_-1cqw_rgb(0_0_0_/_0.65)] ring-1 ring-white/15">
      {/* Already cut square, so the middle is what it wants — the default
          position is measured against the wide clip the layouts demo plays. */}
      <CameraFootage src="/camera-closeup.mp4" position="50% 50%" />
    </div>
  );
}

/**
 * The tab strip and address bar — slice one's subject, and its own focus layer.
 *
 * Fixed at 7% of the picture's height, which is the figure the window below
 * subtracts to fill the rest.
 */
function BrowserChrome() {
  return (
    <div className="flex h-[7%] items-center gap-[1.2%] border-b border-black/40 bg-[#2b2b2b] px-[1.4%]">
      <div className="flex gap-[0.45%]">
        <span className="size-[0.5cqw] rounded-full bg-white/20" />
        <span className="size-[0.5cqw] rounded-full bg-white/20" />
        <span className="size-[0.5cqw] rounded-full bg-white/20" />
      </div>
      <div className="ml-[0.6%] flex h-[64%] w-[18%] items-center gap-[4%] rounded-t-md bg-white/10 px-[4%]">
        <span className="aspect-square h-[44%] shrink-0 rounded-[2px] bg-white/50" />
        <span className="truncate text-[0.62cqw] text-white/55">New tab</span>
      </div>

      {/* The address bar. The typed text and the placeholder it replaces are
          siblings that swap over on the same clock, so the field is never both
          empty and captioned. */}
      <div
        data-demo-address
        className="animate-demo-address-ring ml-[1%] flex h-[58%] flex-1 items-center gap-[1%] rounded-full bg-[#1e1e1e] px-[1.2%]"
      >
        <LockIcon />
        {/* `font-mono` so the caret can step in `ch`, which is only a character
            width in a fixed-pitch face. */}
        <span className="relative flex flex-1 items-center font-mono">
          {/* `whitespace-pre` so the clip lands on letter boundaries rather than
              on a box the browser has already collapsed. */}
          <span
            data-demo-url
            className="animate-demo-type text-[0.66cqw] whitespace-pre text-white/85"
          >
            {ADDRESS}
          </span>
          {/* Three animations over two elements. The wrapper carries two of
              them — when the caret exists, and where along the word it is — as
              one token, since they write different properties and compose. The
              blink has to be on the bar inside: it writes `opacity` like the
              first of those, and on one element the later declaration would
              simply win. */}
          <span className="animate-demo-caret">
            <span className="animate-demo-blink block h-[0.95cqw] w-[0.1cqw] bg-white" />
          </span>
          {/* The caption the field carries before anything is typed. Absolute
              so it occupies no width — in flow it would shove the typed text
              along as it faded, and the caret is positioned off that text. */}
          <span className="animate-demo-placeholder absolute left-0 text-[0.66cqw] whitespace-nowrap text-white/25">
            Search or enter address
          </span>
        </span>
      </div>
    </div>
  );
}

/**
 * The application window.
 *
 * This used to be split into four subtrees so each could be blurred separately
 * — a rack focus, one per slice. It is gone: a `filter: blur()` over a picture
 * that is also being scaled reads as a dropped frame rather than as depth, and
 * at these sizes it cost more than it bought. The push is the emphasis now, and
 * it is enough on its own.
 */
function DesignTool() {
  return (
    <div className="flex h-[93%] flex-col bg-[#1e1e1e]">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <div className="w-[17%] shrink-0 border-r border-black/50 bg-[#2c2c2c]">
          <LeftPanel />
        </div>
        <Canvas />
        <div className="w-[19%] shrink-0 border-l border-black/50 bg-[#2c2c2c]">
          <RightPanel />
        </div>
      </div>
    </div>
  );
}

/** File name, zoom, collaborators, Share. The tools are not here — they are in
 *  the floating bar over the canvas, which is where slice four goes. */
function TopBar() {
  return (
    <div className="flex h-[3cqw] items-center gap-[1.4%] border-b border-black/50 bg-[#2c2c2c] px-[1.4%]">
      <span className="aspect-square h-[1.4cqw] rounded-[3px] bg-gradient-to-br from-[#e14b15] to-[#c000f0]" />
      <span className="text-[0.72cqw] text-white/45">
        Product tour <span className="text-white/25">/</span>{" "}
        <span className="text-white/85">Marketing site</span>
      </span>
      <span className="rounded bg-white/8 px-[0.9%] py-[0.2%] text-[0.6cqw] text-white/45">
        Draft
      </span>
      <span className="ml-auto flex items-center gap-[1.4%]">
        <span className="text-[0.66cqw] text-white/45">62%</span>
        <span className="flex -space-x-[0.4cqw]">
          <span className="aspect-square h-[1.3cqw] rounded-full bg-[#4e84f9] ring-1 ring-[#2c2c2c]" />
          <span className="aspect-square h-[1.3cqw] rounded-full bg-[#e14b15] ring-1 ring-[#2c2c2c]" />
        </span>
        <span className="rounded-md bg-accent px-[1.4%] py-[0.35%] text-[0.66cqw] font-medium text-white">
          Share
        </span>
      </span>
    </div>
  );
}

function LeftPanel() {
  return (
    <div className="px-[8%] py-[6%]">
      <div className="pb-[4%] text-[0.62cqw] tracking-wide text-white/35 uppercase">Pages</div>
      <div className="flex flex-col gap-[1%]">
        <div className="rounded bg-white/10 px-[5%] py-[2.5%] text-[0.66cqw] text-white/85">
          Desktop
        </div>
        <div className="px-[5%] py-[2.5%] text-[0.66cqw] text-white/45">Mobile</div>
      </div>

      <div className="mt-[8%] border-t border-white/8 pt-[6%] text-[0.62cqw] tracking-wide text-white/35 uppercase">
        Layers
      </div>
      <div className="mt-[3%] flex flex-col gap-[0.5%]">
        {LAYERS.map((layer) => (
          <div
            key={layer.name}
            data-demo-layer={layer.name}
            className={`flex items-center gap-[4%] rounded py-[2%] text-[0.64cqw] ${
              layer.name === "Pricing"
                ? "animate-demo-selected-row px-[5%]"
                : "px-[5%] text-white/50"
            }`}
            style={{ paddingLeft: `${5 + layer.depth * 9}%` }}
          >
            <LayerIcon kind={layer.kind} />
            <span className="truncate">{layer.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RightPanel() {
  return (
    <div className="px-[8%] py-[6%]">
      <div className="flex items-center justify-between pb-[5%]">
        <span className="text-[0.62cqw] tracking-wide text-white/35 uppercase">Design</span>
        <span className="flex gap-[6%]">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="h-[0.9cqw] w-[0.22cqw] rounded-[1px] bg-white/25" />
          ))}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-[5%]">
        {[
          ["X", "240"],
          ["Y", "160"],
          ["W", "480"],
          ["H", "320"],
        ].map(([label, value]) => (
          <div
            key={label}
            className="flex items-center gap-[6%] rounded bg-[#1e1e1e] px-[8%] py-[5%]"
          >
            <span className="text-[0.6cqw] text-white/30">{label}</span>
            <span className="font-mono text-[0.62cqw] text-white/75">{value}</span>
          </div>
        ))}
      </div>

      <div className="mt-[8%] border-t border-white/8 pt-[6%]">
        <div className="pb-[4%] text-[0.62cqw] tracking-wide text-white/35 uppercase">Fill</div>
        <div className="flex items-center gap-[6%] rounded bg-[#1e1e1e] px-[8%] py-[5%]">
          <span className="aspect-square h-[0.9cqw] rounded-[2px] bg-[#4e84f9]" />
          <span className="font-mono text-[0.62cqw] text-white/75">4E84F9</span>
          <span className="ml-auto font-mono text-[0.6cqw] text-white/30">100%</span>
        </div>
      </div>

      <div className="mt-[6%] border-t border-white/8 pt-[6%]">
        <div className="pb-[4%] text-[0.62cqw] tracking-wide text-white/35 uppercase">Effects</div>
        <div className="flex items-center gap-[6%] rounded bg-[#1e1e1e] px-[8%] py-[5%]">
          <span className="text-[0.62cqw] text-white/60">Drop shadow</span>
        </div>
      </div>
    </div>
  );
}

/**
 * The canvas, the artboards on it, and the toolbar floating over it.
 *
 * The dotted ground is a `radial-gradient` tiled by `background-size` rather
 * than an image: at the sizes this is drawn it is a handful of bytes and it
 * stays crisp through a 2.9x push, which a bitmap at this scale would not.
 */
function Canvas() {
  return (
    <div className="relative min-w-0 flex-1 bg-[#1a1a1a]">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(rgb(255 255 255 / 0.09) 1px, transparent 1px)",
          backgroundSize: "1.4cqw 1.4cqw",
        }}
      >
        {/* The two frames that are already there. `Pricing` is the one slice
            three selects. */}
        <Artboard label="Home" className="top-[30%] left-[8%] h-[32%] w-[38%]" />
        <Artboard
          label="Pricing"
          selected
          className="top-[30%] left-[54%] h-[27%] w-[36%]"
          hook="pricing"
        />

        {/* The frame slice two draws. Absent at rest, drawn during that slice,
            and cleared again inside slice one where the canvas is off frame —
            see the note on `demo-draw`.

            Boxed in on two sides. It sits left of centre and low, because the
            drag finishes at its bottom-right corner: any further right and that
            corner lands behind the floating toolbar, so the pointer would
            appear to finish the drag on top of a control it never touched — and
            any higher and the frame runs under the Home artboard, which puts its
            label on top of somebody else's content. */}
        <div
          data-demo-newframe
          className="animate-demo-draw absolute top-[68%] left-[6%] h-[19%] w-[38%] origin-top-left rounded-[2px] border border-dashed border-accent bg-accent/10"
        >
          <span className="absolute -top-[1.4cqw] left-0 text-[0.62cqw] text-accent">Frame 3</span>
        </div>
      </div>

      {/* The floating toolbar — slice four's subject, and its own focus layer.
          Here rather than in the top bar because a target a few per cent from
          the top of the window forces a much tighter zoom than one sitting in
          the middle of the bottom edge. */}
      <div
        data-demo-toolbar
        className="absolute bottom-[4%] left-1/2 flex -translate-x-1/2 items-center gap-[0.3cqw] rounded-[0.6cqw] border border-white/10 bg-[#2c2c2c] px-[0.5cqw] py-[0.35cqw] shadow-[0_8px_24px_-6px_rgb(0_0_0_/_0.7)]"
      >
        {TOOLS.map((tool) => (
          <span
            key={tool}
            data-demo-tool={tool}
            className={`flex aspect-square h-[1.6cqw] items-center justify-center rounded-[0.3cqw] ${
              tool === "frame" ? "animate-demo-tool-picked" : "text-white/45"
            }`}
          >
            <ToolIcon tool={tool} />
          </span>
        ))}
      </div>
    </div>
  );
}

/** One artboard on the canvas, with its name above it the way a design tool
 *  labels them. */
function Artboard({
  label,
  className,
  selected = false,
  hook,
}: {
  label: string;
  className: string;
  selected?: boolean;
  hook?: string;
}) {
  return (
    <div className={`absolute ${className}`} data-demo-frame={hook}>
      <span className="absolute -top-[1.4cqw] left-0 text-[0.62cqw] text-white/40">{label}</span>
      <div className="h-full w-full rounded-[2px] bg-[#f4f4f5] p-[4%]">
        {/* A page drawn inside the artboard, so a 2.9x push lands on something
            rather than on a white rectangle. */}
        <div className="h-[14%] w-full rounded-[1px] bg-[#d4d4d8]" />
        <div className="mt-[4%] h-[34%] w-full rounded-[1px] bg-[#e4e4e7]" />
        <div className="mt-[4%] flex gap-[4%]">
          <div className="h-[1cqw] flex-1 rounded-[1px] bg-[#e4e4e7]" />
          <div className="h-[1cqw] flex-1 rounded-[1px] bg-[#e4e4e7]" />
          <div className="h-[1cqw] flex-1 rounded-[1px] bg-[#e4e4e7]" />
        </div>
        <div className="mt-[4%] h-[0.7cqw] w-[60%] rounded-[1px] bg-[#d4d4d8]" />
      </div>

      {/* The selection: a ring and eight handles, held at zero opacity until
          slice three rather than mounted then. */}
      {selected ? (
        <div className="animate-demo-select pointer-events-none absolute -inset-px rounded-[2px] ring-1 ring-accent">
          {[
            "-top-[0.25cqw] -left-[0.25cqw]",
            "-top-[0.25cqw] left-1/2 -translate-x-1/2",
            "-top-[0.25cqw] -right-[0.25cqw]",
            "top-1/2 -left-[0.25cqw] -translate-y-1/2",
            "top-1/2 -right-[0.25cqw] -translate-y-1/2",
            "-bottom-[0.25cqw] -left-[0.25cqw]",
            "-bottom-[0.25cqw] left-1/2 -translate-x-1/2",
            "-bottom-[0.25cqw] -right-[0.25cqw]",
          ].map((pos) => (
            <span
              key={pos}
              className={`absolute size-[0.5cqw] rounded-[1px] border border-accent bg-white ${pos}`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The pointer, and the ring the press leaves behind.
 *
 * The arrow is the app's own black pointer — the `black` style in
 * `apps/desktop/scripts/make-cursor.mjs`, whose outline is what keeps a black
 * arrow visible on anything black. The polygon is transcribed rather than
 * imported: `apps/web` shares no code with `apps/desktop`, and the generator
 * emits PNGs for two rasterisers that neither of them is a browser. Seven points
 * copied once beats a build-time dependency between the site and the product.
 *
 * `paint-order: stroke` puts the white outline under the fill so it reads as an
 * edge around the arrow rather than as a line drawn through it, and the
 * `viewBox` is padded by half the stroke so that edge is not clipped.
 */
function Pointer() {
  return (
    // The layer, not the arrow, is what moves — see the note on `demo-cursor`.
    <div className="animate-demo-cursor pointer-events-none absolute inset-0">
      <div className="absolute top-0 left-0">
        <span className="animate-demo-ripple absolute -top-[9px] -left-[9px] block size-[18px] rounded-full border border-white/70" />
        {/* Sized in `px` and not `cqw`: this one thing is deliberately not part
            of the picture's scale. `demo-click` counter-scales it against the
            zoom so it stays the same size on screen however far in the push
            goes, which is what the app does when it composites a pointer into a
            recording. */}
        <svg
          viewBox="-4 -4 64 94"
          className="animate-demo-click block h-[19px] w-[13px] origin-top-left overflow-visible"
        >
          <path
            d="M0 0 0 75 19 58 30 86 43 81 32 53 56 53Z"
            fill="#000"
            stroke="#fff"
            strokeWidth="7"
            strokeLinejoin="round"
            paintOrder="stroke"
          />
        </svg>
      </div>
    </div>
  );
}

/** The four zoom slices on the shared track. */
function ZoomTrack() {
  return (
    <DemoTimeline
      step={4}
      sliceClass="animate-demo-slice"
      playheadClass="animate-demo-playhead"
      slices={SLICES.map((slice) => ({
        key: slice.did,
        content: (
          <>
            <MagnifierIcon />
            <MouseIcon />
            <span className="font-mono text-[0.6875rem] sm:text-xs">{slice.zoom}</span>
          </>
        ),
      }))}
    />
  );
}

function LayerIcon({ kind }: { kind: string }) {
  const common = "size-[0.7cqw] shrink-0";
  if (kind === "text") return <span className={`${common} text-center text-[0.6cqw]`}>T</span>;
  if (kind === "frame")
    return (
      <svg
        viewBox="0 0 16 16"
        className={common}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path d="M2 5h12M2 11h12M5 2v12M11 2v12" />
      </svg>
    );
  return (
    <svg viewBox="0 0 16 16" className={common} fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="3" width="10" height="10" rx="1.5" strokeDasharray="2.5 2" />
    </svg>
  );
}

function ToolIcon({ tool }: { tool: (typeof TOOLS)[number] }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.6 } as const;
  const cls = "size-[0.95cqw]";
  if (tool === "move")
    return (
      <svg viewBox="0 0 16 16" className={cls} {...p}>
        <path d="M3 2l9 5.5-4 1-1.6 4z" strokeLinejoin="round" />
      </svg>
    );
  if (tool === "frame")
    return (
      <svg viewBox="0 0 16 16" className={cls} {...p}>
        <path d="M2 5h12M2 11h12M5 2v12M11 2v12" />
      </svg>
    );
  if (tool === "shape")
    return (
      <svg viewBox="0 0 16 16" className={cls} {...p}>
        <rect x="3" y="3" width="10" height="10" rx="1" />
      </svg>
    );
  if (tool === "pen")
    return (
      <svg viewBox="0 0 16 16" className={cls} {...p}>
        <path d="M3 13l1-3.5L11 2.5 13.5 5 6.5 12z" strokeLinejoin="round" />
      </svg>
    );
  if (tool === "text")
    return (
      <svg viewBox="0 0 16 16" className={cls} {...p}>
        <path d="M3 3.5h10M8 3.5v9" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg viewBox="0 0 16 16" className={cls} {...p}>
      <path d="M13.5 8.5a5 5 0 0 1-5 5H3l1.6-2.4A5 5 0 1 1 13.5 8.5z" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-[0.7cqw] shrink-0 text-white/35"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.75 7V5.25a2.25 2.25 0 0 1 4.5 0V7" />
    </svg>
  );
}

function MagnifierIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.2 10.2 14 14" strokeLinecap="round" />
    </svg>
  );
}

function MouseIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <rect x="4.5" y="1.75" width="7" height="12.5" rx="3" />
      <path d="M8 4.6v2.2" strokeLinecap="round" />
    </svg>
  );
}
