/**
 * The captions, in the looks the app ships, over a recording.
 *
 * The third demo, and the only one whose subject is text rather than geometry.
 * The two above it argue about where a picture sits. This one argues that the
 * words under it are a thing you own: they arrive with the recording, they take
 * whichever look you pick, and the transcript is editable prose rather than a
 * layer burned into the frame you would have to re-record to fix.
 *
 * Five beats. Four are looks, and what moves within each is what actually moves
 * in the app:
 *
 * - `Blur in` leads, because it is the one that is genuinely word by word. Each
 *   word is drawn out of focus on the moment it is said and settles, so the
 *   line fills up as the sentence is spoken.
 * - `Subtitle` and `Band` show the whole cue at once, so the line simply
 *   arrives. Animating them a word at a time would be inventing behaviour.
 * - `Highlight` shows the whole cue too, and lights the word being spoken as
 *   the voice reaches it. The travelling colour is the animation.
 *
 * That split is the honest version of "word by word". Two of these looks do it
 * and two do not, and a picture that animated all four the same way would be
 * promising something three of them do not do.
 *
 * The fifth beat is the one worth the animation. The inspector slides in, a
 * sentence in the transcript is selected, and pressing delete takes that
 * stretch of footage out of the video. No still can show that: a picture of a
 * text field and a picture of a shortened timeline are two pictures of two
 * unrelated things. Watching the words leave the frame as the sentence leaves
 * the panel is the whole argument, and it takes five seconds.
 *
 * Entirely CSS, for the reason the two demos above are. Two periods, nested:
 * 25s for which beat is on screen, and 5s (one beat) for the words inside it.
 * The words can carry a per-element delay because their own period is the beat,
 * so each one enters and leaves inside one and the stagger cannot run past the
 * end of the loop. That is the whole reason the word animations are 5s and not
 * 25s.
 */
import { CameraFootage } from "@/components/landing/CameraFootage";
import {
  BandGlyph,
  BlurGlyph,
  CaptionsGlyph,
  HighlightGlyph,
  PencilGlyph,
} from "@/components/landing/glyphs";
import { DemoTimeline } from "@/components/landing/DemoTimeline";
import { SubtitlesWord, TextWord } from "@/components/landing/marks";
import { CAPTIONS_SCREEN, CAPTIONS_STAGE } from "@/components/landing/stage";
import { Container, SectionHeading } from "@/components/Section";
import { ASSETS } from "@/lib/assets";

/**
 * The sentence, as the two halves the animation treats differently.
 *
 * `kept` survives. `cut` is what the last beat takes out, so it lives in its
 * own group that can close up and take its space with it.
 *
 * One definition and six readers: five caption lines and the transcript draw
 * the same sentence, and six copies of it would be six sentences the moment any
 * one was edited.
 */
const LINE = {
  kept: ["This", "is", "the", "checkout"],
  cut: ["we", "shipped", "last", "week"],
};

/** Seconds a beat is on screen, and five of them. The track agrees with it. */
const BEAT = 6;

/**
 * How far apart the words are, in seconds.
 *
 * Eight words at this spacing spend almost the whole beat arriving, and the
 * finished line is up for well under a second before the beat changes.
 *
 * That ratio is the point rather than the number. At a third of this the line
 * completed within half a second of the beat starting and stood there for the
 * rest of it, so what anyone glancing at the frame actually saw was a finished
 * sentence. A look that shows a word on the moment it is spoken reads as one
 * only while there are still words to come.
 */
const WORD_STEP = 0.62;

/**
 * The five beats, and the look each one draws the line in.
 *
 * The editing beat reuses the plainest look rather than inventing a sixth. What
 * it is showing is the panel and the cut, and a look nobody has seen in the
 * four beats before it would be a second new thing competing for the attention.
 */
const BEATS = [
  { id: "blur", name: "Blur in", look: "blur", Glyph: BlurGlyph },
  { id: "subtitle", name: "Subtitle", look: "subtitle", Glyph: CaptionsGlyph },
  { id: "highlight", name: "Highlight", look: "highlight", Glyph: HighlightGlyph },
  { id: "band", name: "Band", look: "band", Glyph: BandGlyph },
  { id: "edit", name: "Edit", look: "subtitle", Glyph: PencilGlyph },
] as const;

type Look = (typeof BEATS)[number]["look"];

export function CaptionsDemo() {
  return (
    <section className="py-24">
      <Container>
        {/* Heading left, picture right: the arrangement the zoom demo has and
            the layouts demo mirrors. Three sections in a row all leading with
            the picture would read as a gallery rather than as an argument made
            three times. */}
        <div
          data-captions-demo
          className="grid items-center gap-12 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:gap-16"
        >
          <div>
            <SectionHeading
              eyebrow="Subtitles"
              title={
                <>
                  <SubtitlesWord>Subtitles</SubtitlesWord> you can edit like{" "}
                  <TextWord>text</TextWord>
                </>
              }
              lede="Every word is transcribed on your Mac while you record. Pick a look, from a plain plate to each word coming into focus as it is said, then open the transcript and type. Delete a sentence there and it leaves the video with it."
              cta="Record now"
            />
          </div>

          {/*
            `role="img"` with a label and everything inside hidden, as the two
            demos above do. Read out one node at a time this is the same
            sentence five times over, which is noise. The sentence here is the
            whole of what is worth reaching.
          */}
          <div>
            <div
              role="img"
              aria-label="One line of subtitles over a screen recording, shown in four looks in turn: a look that brings each word into focus on the moment it is said, a plain subtitle plate, a plate that lights each word as it is spoken, and a band across the full width of the frame. Then the caption editor slides in, a sentence is selected in the transcript and deleted, and those words leave the video with it."
            >
              {/* The stage: the wallpaper the composition stands on and the
                  frame that crops it. `@container` so everything inside can be
                  sized in `cqw` and stay proportional at every width. In the app
                  a caption is a fraction of the frame's shorter edge, and
                  written in pixels here it would be a different size at every
                  breakpoint. */}
              <div className="grain @container relative aspect-[16/9] overflow-hidden rounded-lg">
                <div
                  className="absolute inset-0 bg-cover bg-center"
                  style={{ backgroundImage: `url(${CAPTIONS_STAGE})` }}
                />

                <ScreenBox />
                <CameraBubble />

                {/* All five beats mounted, one visible at a time. One keyframe
                    and a delay per beat rather than five keyframes: each is on
                    screen for its own fifth of the period and hidden for the
                    rest, which is the same animation shifted five times. */}
                {BEATS.map((beat, index) => (
                  <div
                    key={beat.id}
                    data-captions-beat={index}
                    className="animate-captions-look absolute inset-x-0 bottom-[9%] flex justify-center opacity-0"
                    style={{ animationDelay: `${index * BEAT}s` }}
                  >
                    <CaptionLine look={beat.look} words={beat.look === "blur"} />
                  </div>
                ))}

                <Inspector />
              </div>
            </div>

            <CaptionsTrack />
          </div>
        </div>
      </Container>
    </section>
  );
}

/**
 * The five beats on the shared track.
 *
 * The same component the two demos above put under their pictures, and the same
 * job: the slice lit is the thing the picture is showing.
 */
function CaptionsTrack() {
  return (
    <DemoTimeline
      step={BEAT}
      sliceClass="animate-captions-slice"
      playheadClass="animate-captions-playhead"
      slices={BEATS.map(({ id, name, Glyph }) => ({
        key: id,
        label: name,
        content: (
          <>
            <Glyph />
            {/* Hidden below `sm`, as the layouts demo hides its names: five
                slices across a phone leave room for the glyph or for two
                truncated characters, and the glyph says more. */}
            <span className="hidden truncate text-[0.6875rem] sm:inline sm:text-xs">{name}</span>
          </>
        ),
      }))}
    />
  );
}

/**
 * One look, drawn the way the app draws it.
 *
 * The plate colour, the band's full width, the lit word's accent and the light
 * weight the blurring look is set in are the app's own values rather than
 * numbers picked to look right here. A picture claiming these are the settings
 * has to show the settings.
 *
 * `words` asks for the word by word arrival, which only the blurring look does.
 */
function CaptionLine({ look, words }: { look: Look; words: boolean }) {
  const plate = look === "subtitle" || look === "highlight";

  return (
    <p
      className={[
        "flex items-baseline gap-[0.9cqw] text-[3.2cqw] leading-none tracking-tight text-white",
        // The band runs the width of the frame; a pill only fits its own line.
        look === "band"
          ? "w-full justify-center bg-[rgb(8_10_14/0.55)] px-[1.6cqw] py-[1.1cqw] font-medium"
          : "max-w-[86%] rounded-[1cqw] px-[1.6cqw] py-[0.9cqw]",
        plate ? "bg-[rgb(8_10_14/0.55)] font-medium" : "",
        // Light, and a hair open, which is how the app sets the blurring look.
        look === "blur" ? "font-light tracking-normal" : "",
      ].join(" ")}
    >
      {LINE.kept.map((word, index) => (
        <Word key={word} look={look} index={index} words={words}>
          {word}
        </Word>
      ))}

      {/* The words the editing beat takes out, in their own box so the line can
          close over them. A group whose `max-width` collapses takes its space
          with it, where fading four separate words would leave the sentence
          full of holes. */}
      <span className="animate-captions-cut flex items-baseline gap-[0.9cqw] overflow-hidden whitespace-nowrap">
        {LINE.cut.map((word, index) => (
          <Word key={word} look={look} index={LINE.kept.length + index} words={words}>
            {word}
          </Word>
        ))}
      </span>
    </p>
  );
}

/** One word, staggered into the beat it belongs to. */
function Word({
  look,
  index,
  words,
  children,
}: {
  look: Look;
  index: number;
  words: boolean;
  children: string;
}) {
  const animated = words || look === "highlight";

  return (
    <span
      className={[
        "inline-block",
        // Only the blurring look arrives a word at a time; the others show the
        // whole cue and would be inventing behaviour if they staggered.
        words ? "animate-captions-reveal opacity-0" : "",
        // Only the lit look moves a colour along the line.
        look === "highlight" ? "animate-captions-lit" : "",
      ].join(" ")}
      style={animated ? { animationDelay: `${index * WORD_STEP}s` } : undefined}
    >
      {children}
    </span>
  );
}

/**
 * The recording under the captions: a real capture, not a drawing.
 *
 * A checkout somebody is walking through, which is the kind of take these
 * captions come from. It replaced a generic window drawn in CSS: that read as a
 * diagram of a screen recording where this reads as one.
 *
 * `object-cover`, which is what the app does to a screen track. The picture is
 * cropped into whatever box the arrangement gives it rather than squashed to
 * fit, so a narrower frame shows less of the capture rather than a distorted
 * copy of all of it.
 *
 * Laid out beside the camera rather than filling the frame, which is one of the
 * app's own arrangements: the screen takes the left, the camera stands in a
 * portrait card on the right, and both are held clear of the bottom so the
 * captions have somewhere to sit. On a window that reached the frame's edge, a
 * dark plate on a dark window would be a look nobody could see.
 */
function ScreenBox() {
  return (
    <div className="absolute top-[11%] bottom-[26%] left-[4%] w-[64%] overflow-hidden rounded-[0.8cqw] bg-[#111318] shadow-[0_2cqw_5cqw_-2cqw_rgb(0_0_0_/_0.75)] ring-1 ring-white/10">
      <img
        src={CAPTIONS_SCREEN}
        alt=""
        loading="lazy"
        decoding="async"
        className="size-full object-cover object-left-top"
      />
    </div>
  );
}

/**
 * The camera, as the app composites it: a second picture in the frame.
 *
 * A portrait card standing beside the screen rather than a bubble over it,
 * which is one of the arrangements the app offers and the one that suits a
 * close-up. The camera is a separate track, so its shape is a decision made
 * after the recording rather than something baked into it.
 *
 * The same footage treatment the layouts demo gives its camera, and the same
 * reason for it. A recording with a face in it is what these captions are
 * transcribed from, and a frame with no speaker in it is a strange thing to be
 * making subtitles for.
 */
function CameraBubble() {
  return (
    <div className="absolute top-[11%] right-[4%] bottom-[26%] w-[24%] overflow-hidden rounded-[0.8cqw] bg-[#2a1a2e] shadow-[0_2cqw_5cqw_-2cqw_rgb(0_0_0_/_0.75)] ring-1 ring-white/15">
      {/* Centred rather than the wide studio shot's 59%: this clip is a
          close-up with the subject in the middle, and a portrait box crops the
          width alone, so the middle is what it should keep. */}
      <CameraFootage src={`${ASSETS}/camera-talking-head.mp4`} position="50% 50%" />
    </div>
  );
}

/**
 * The caption editor, as the inspector holds it.
 *
 * Inside the frame and down its right-hand side, which is where the app puts
 * it. It was a bar under the picture first, and that read as the sentence being
 * printed twice rather than as a panel over the video it belongs to.
 *
 * Sized in `cqw` like everything else in the frame, so the panel keeps its
 * proportions against the picture at every width.
 */
function Inspector() {
  return (
    // No `translate-x` utility here, and that is load-bearing: Tailwind v4
    // writes those to the `translate` property, which composes with the
    // `transform` the keyframe animates rather than being replaced by it. The
    // panel would sit a full width off the frame for the whole loop, correctly
    // animating a transform nobody could see. The keyframe owns the movement,
    // and `opacity-0` is what keeps it hidden before the animation applies.
    <div className="animate-captions-panel absolute inset-y-[6%] right-[3%] w-[34%] rounded-[0.8cqw] border border-white/10 bg-[#0e1015]/95 opacity-0 shadow-[0_1.5cqw_4cqw_-1cqw_rgb(0_0_0_/_0.7)] backdrop-blur-sm">
      <div className="flex items-center gap-[0.6cqw] border-b border-white/10 px-[1.1cqw] py-[0.9cqw]">
        <span className="text-[1.3cqw] leading-none text-white/45">‹</span>
        <span className="text-[1.3cqw] leading-none font-medium text-white/90">Edit captions</span>
        <span className="ml-auto text-[1.1cqw] leading-none text-white/45">Reset</span>
      </div>

      <p className="flex flex-wrap items-baseline gap-x-[0.45cqw] gap-y-[0.3cqw] px-[1.1cqw] py-[1cqw] text-[1.35cqw] leading-[1.6] text-white/85">
        {LINE.kept.map((word) => (
          <span key={word}>{word}</span>
        ))}

        {/* The sentence that goes. The selection sweeps across it first, which
            is the half second that says a person did this rather than the app.
            Blue because that is what selected text looks like. The red band the
            app draws is on the timeline, and the timeline is not in this
            picture. */}
        <span className="animate-captions-cut relative overflow-hidden whitespace-nowrap">
          <span className="animate-captions-select absolute inset-y-0 left-0 w-0 rounded-[0.15cqw] bg-accent/40" />
          <span className="relative inline-flex items-baseline gap-x-[0.45cqw]">
            {LINE.cut.map((word) => (
              <span key={word}>{word}</span>
            ))}
          </span>
        </span>
      </p>
    </div>
  );
}
