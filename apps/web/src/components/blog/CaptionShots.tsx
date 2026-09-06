/**
 * The captions panel, the transcript editor and the timeline band, redrawn.
 *
 * Figures for the subtitles post. They are drawn rather than screenshotted for
 * the reason the landing demos are drawn: a PNG of the editor is stale the
 * first time a label moves, and nobody notices until a reader points at a
 * control that is not there any more. These are built from the same labels,
 * order and default values the panel actually ships, so a rename shows up as a
 * diff in this file rather than as a wrong picture on a page.
 *
 * Redrawn, and not imported. `apps/web` shares no code with `apps/desktop`.
 * The rule is in the repo's `AGENTS.md`, and giving the editor's own
 * components a marketing consumer would be a second reason for them to change.
 * What is copied here is what a reader sees: the words on the controls and the
 * values they sit at when a recording is opened.
 *
 * Every figure is a picture. `role="img"` with a label, and the parts inside
 * hidden. Read one node at a time a slider track is noise, and the sentence
 * on the wrapper is the whole of what is worth reaching.
 */
import type { ReactNode } from "react";

/** The six looks the picker offers, in the order it lists them. */
const LOOKS = [
  { id: "subtitle", label: "Subtitle", plate: true },
  { id: "highlight", label: "Highlight", plate: true, lit: true },
  { id: "pop", label: "Pop", caps: true, heavy: true, lit: true },
  { id: "outline", label: "Outline", heavy: true, outline: true },
  { id: "band", label: "Band", band: true },
  { id: "blur", label: "Blur in", blurred: true },
];

/** The accent a lit word takes, which is the app's own default. */
const SPOKEN = "#ffd60a";

/**
 * The captions section of the inspector, as it opens.
 *
 * Values are the defaults a new recording carries: captions on, the Highlight
 * look, size 0.8×, bottom, 8% from the edge, one line. Showing anything else
 * would be showing a panel somebody had already been fiddling with.
 */
export function CaptionsPanelShot() {
  return (
    <Figure label="The captions section of Prequel's inspector: an Edit captions button, a Show captions toggle, a grid of six looks with Highlight selected, and sliders for size, position, distance from the edge and the number of lines.">
      <div className="w-full max-w-[22rem] rounded-xl border border-line bg-bg p-4">
        <header className="mb-3 flex items-center">
          <h4 className="flex-1 text-[11px] font-semibold tracking-wide text-fg uppercase">
            Captions
          </h4>
          <span className="text-[11px] text-muted">Reset</span>
        </header>

        <button
          type="button"
          disabled
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-elevated px-2 py-1.5 text-[11px] text-fg"
        >
          <PencilMark />
          Edit captions
        </button>

        <Row label="Show captions">
          <span className="flex h-4 w-7 items-center rounded-full bg-positive px-0.5">
            <span className="ml-auto size-3 rounded-full bg-white" />
          </span>
        </Row>

        <Stack label="Style">
          <div className="grid grid-cols-3 gap-1">
            {LOOKS.map((look) => (
              <div key={look.id} className="flex flex-col gap-1 text-center">
                <span
                  className={`grid aspect-video place-items-center overflow-hidden rounded-[5px] bg-fg/30 ${
                    // The app rings the chosen look in its own near-white
                    // accent, not in a colour. Every look is white text on a
                    // dark treatment, and a coloured ring would read as one of
                    // them being a different kind of thing.
                    look.id === "highlight" ? "bg-fg/40 ring-2 ring-fg/80 ring-inset" : ""
                  }`}
                >
                  <LookSample look={look} />
                </span>
                <span
                  className={`text-[10px] ${look.id === "highlight" ? "text-fg" : "text-muted"}`}
                >
                  {look.label}
                </span>
              </div>
            ))}
          </div>
        </Stack>

        <Stack label="Size" value="0.8×">
          <Slider at={0.2} />
        </Stack>

        <Stack label="Position">
          <div className="flex gap-px overflow-hidden rounded-lg bg-elevated p-0.5 text-[11px]">
            {["Top", "Middle", "Bottom"].map((place) => (
              <span
                key={place}
                className={`flex-1 rounded-md py-1 text-center ${
                  place === "Bottom" ? "bg-fg/15 text-fg" : "text-muted"
                }`}
              >
                {place}
              </span>
            ))}
          </div>
        </Stack>

        <Stack label="Distance from edge" value="8%">
          <Slider at={0.32} />
        </Stack>

        <Stack label="Lines" value="1 line">
          <Slider at={0} />
        </Stack>

        <Stack label="Spoken word">
          <span className="flex items-center gap-2 text-[11px] text-muted">
            <span
              className="size-4 rounded-md border border-line"
              style={{ backgroundColor: SPOKEN }}
            />
            {SPOKEN.toUpperCase()}
          </span>
        </Stack>
      </div>
    </Figure>
  );
}

/**
 * The transcript, with a sentence selected.
 *
 * The moment before the delete, which is the one worth a picture: the words are
 * text in a box, and the sentence highlighted here is about to leave both the
 * paragraph and the video.
 */
export function CaptionEditorShot() {
  return (
    <Figure label="Prequel's caption editor: a back arrow, the title Edit captions, a Reset button, and the transcript below it as one paragraph. The sentence 'we shipped last week' is selected.">
      <div className="w-full max-w-[22rem] rounded-xl border border-line bg-bg">
        <header className="flex items-center gap-2.5 border-b border-line px-3 py-2.5 text-[13px]">
          <span className="text-muted">‹</span>
          <span className="grid size-6 place-items-center rounded-md border border-line bg-elevated">
            <CaptionsMark />
          </span>
          <span className="flex-1 font-medium text-fg">Edit captions</span>
          <span className="text-[11px] text-muted">Reset</span>
        </header>

        <p className="px-4 py-3 text-[13px] leading-6 text-fg">
          This is the dashboard{" "}
          <span className="rounded-[0.15em] bg-accent/35">we shipped last week</span>
        </p>
      </div>
    </Figure>
  );
}

/**
 * The timeline while that sentence is selected.
 *
 * The band is the full height of the strip, which is the whole point of the
 * figure: the selection in the paragraph is a stretch of footage, and pressing
 * delete removes it. Red because the app draws it in the colour it draws a cut
 * in. The site has no token for that exact red, so this is the nearest one it
 * does have rather than a second definition of the app's.
 */
export function CaptionCutShot() {
  return (
    <Figure label="Prequel's timeline with a red band across it. The band covers the stretch of footage the selected sentence was spoken over, from about one second to about two and a half seconds.">
      <div className="w-full max-w-[26rem] rounded-xl border border-line bg-bg p-3">
        <div className="relative">
          {/* The ruler, then the clip, then the band over both, which is the order the
              strip draws them in. */}
          <div
            className="h-2.5"
            style={{
              backgroundImage:
                "repeating-linear-gradient(to right, color-mix(in oklab, var(--muted) 45%, transparent) 0 1px, transparent 1px 12.5%)",
            }}
          />

          <div className="mt-1.5 h-11 overflow-hidden rounded-lg border border-iris/70 bg-iris/25">
            <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="h-full w-full">
              <path
                d="M0 12 L6 9 L12 13 L18 7 L24 11 L30 8 L36 12 L42 6 L48 10 L54 13 L60 8 L66 11 L72 9 L78 12 L84 7 L90 11 L96 9 L100 12 L100 20 L0 20 Z"
                fill="currentColor"
                className="text-lilac/40"
              />
            </svg>
          </div>

          {/* The band. Square, an edge down each side and none across: the two
              sides are the moments the cut lands on. */}
          <span
            className="pointer-events-none absolute inset-y-0 border-x border-brand-from/60 bg-brand-from/20"
            style={{ left: "18%", width: "26%" }}
          />
        </div>
      </div>
    </Figure>
  );
}

/** One of the six looks, drawn the way the picker draws its swatch. */
function LookSample({ look }: { look: (typeof LOOKS)[number] }) {
  return (
    <span
      className={[
        "text-[11px] leading-none whitespace-nowrap text-white",
        look.heavy ? "font-extrabold" : "font-medium",
        look.caps ? "uppercase" : "",
        look.plate ? "rounded-[0.34em] bg-[rgb(8_10_14/0.55)] px-[0.5em] py-[0.3em]" : "",
        look.band ? "w-full bg-[rgb(8_10_14/0.55)] px-[0.6em] py-[0.42em] text-center" : "",
        look.blurred ? "font-light blur-[1.5px]" : "",
      ].join(" ")}
      style={
        look.outline ? { WebkitTextStroke: "1.2px #000", paintOrder: "stroke fill" } : undefined
      }
    >
      Just <span style={look.lit ? { color: SPOKEN } : undefined}>so</span>
    </span>
  );
}

/** A control with its label above it, and its value on the right. */
function Stack({ label, value, children }: { label: string; value?: string; children: ReactNode }) {
  return (
    <div className="mt-3.5">
      <div className="mb-1.5 flex items-baseline">
        <span className="flex-1 text-[11px] text-muted">{label}</span>
        {value ? <span className="text-[11px] text-muted">{value}</span> : null}
      </div>
      {children}
    </div>
  );
}

/** A control that sits beside its label rather than under it. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-3.5 flex items-center">
      <span className="flex-1 text-[11px] text-muted">{label}</span>
      {children}
    </div>
  );
}

/** A slider track with its knob at a fraction of the way along. */
function Slider({ at }: { at: number }) {
  return (
    <span className="block h-5 rounded-lg bg-elevated p-0.5">
      <span className="relative block h-full rounded-md">
        <span
          className="absolute inset-y-0 left-0 rounded-md bg-fg/90"
          style={{ width: `${Math.max(at * 100, 6)}%` }}
        />
      </span>
    </span>
  );
}

function PencilMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <path
        d="M21.2 6.8a1.7 1.7 0 0 0-4-4L4 16v4h4z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CaptionsMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <rect width="18" height="14" x="3" y="5" rx="2" />
      <path d="M7 15h4M15 15h2M7 11h2M13 11h4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The frame every figure sits in.
 *
 * Centred on the page and captioned by its own label rather than by prose
 * under it: the sentence is what a screen reader is given, and repeating it
 * visually would be the same words twice for everyone else.
 */
function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="my-7 flex justify-center rounded-xl border border-line bg-surface/60 px-4 py-6">
      <div role="img" aria-label={label}>
        {children}
      </div>
    </div>
  );
}
