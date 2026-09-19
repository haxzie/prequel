/**
 * The teleprompter, hung from the notch, following a take that wanders.
 *
 * The fourth demo, and the only one whose subject is a recording with no
 * screen in it. The three above re-frame or caption a capture that has
 * something else on it; the teleprompter's whole argument is eye contact with
 * the lens, so the honest picture for it is a camera filling the frame with
 * nothing behind it to look at instead — which is also why this is the one
 * demo with no wallpaper of its own in `stage.ts`. There is nothing here for
 * a background to sit behind.
 *
 * One take, four words told twice over: the reading line lights "I want to
 * show" in turn, holds on "show" while the footer note pulses, then jumps
 * past "you something" to "cool" and holds there until the loop restarts.
 * That is the feature end to end — follows your voice, waits while you are
 * off it, catches up within a couple of words — read straight off the docs
 * rather than invented for the demo.
 *
 * Entirely CSS, for the reason the three demos above are: no state, no
 * `use client` beyond the camera loop itself, one 18s period shared by every
 * word, the footer note and the track.
 */
import { CameraFootage } from "@/components/landing/CameraFootage";
import { CatchUpGlyph, VoiceGlyph, WaitGlyph } from "@/components/landing/glyphs";
import { DemoTimeline } from "@/components/landing/DemoTimeline";
import { ScriptWord } from "@/components/landing/marks";
import { Container, SectionHeading } from "@/components/Section";

/**
 * The reading line, as the four shapes its words are lit in.
 *
 * Every word rests dim — the colour of one not yet reached — until its own
 * `delay` elapses and its `anim` takes over, so the only thing that differs
 * between the seven is which keyframe it hands off to and when. See the note
 * on `--animate-teleprompter-early` in `globals.css` for why three of them
 * share one shape and the rest do not.
 */
const READING_LINE = [
  { word: "I", anim: "animate-teleprompter-early", delay: "0s" },
  { word: "want", anim: "animate-teleprompter-early", delay: "1.5s" },
  { word: "to", anim: "animate-teleprompter-early", delay: "3s" },
  { word: "show", anim: "animate-teleprompter-hold", delay: "4.5s" },
  { word: "you", anim: "animate-teleprompter-skipped", delay: "12s" },
  { word: "something", anim: "animate-teleprompter-skipped", delay: "12s" },
  { word: "cool", anim: "animate-teleprompter-caught-up", delay: "12s" },
] as const;

/** The three beats on the shared track, in the words the docs use for them. */
const BEATS = [
  { id: "voice", name: "Reads with you", Glyph: VoiceGlyph },
  { id: "waits", name: "Waits off-script", Glyph: WaitGlyph },
  { id: "catches-up", name: "Catches up", Glyph: CatchUpGlyph },
] as const;

/** Seconds a beat holds the track, and the demo's own period. */
const BEAT = 6;

export function TeleprompterDemo() {
  return (
    <section className="py-24">
      <Container>
        {/* Picture left, heading right — the layouts demo's arrangement
            rather than the zoom and captions demos' either side of it. The
            run alternates: heading-left, picture-left, heading-left, and now
            picture-left again. Four in a row on the same side would read as
            one long column of type with decoration beside it; alternating
            them is what makes each one announce itself as a new thing to
            look at rather than the last one continuing. */}
        <div
          data-teleprompter-demo
          className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.18fr)_minmax(0,0.82fr)] lg:gap-16"
        >
          {/* `role="img"` with everything inside hidden, as the three demos
              above do: read one node at a time this is a sentence, a pause
              and a jump forward, which is noise next to the one sentence
              describing all three. */}
          <div>
            <div
              role="img"
              aria-label="A camera recording, framed close on the speaker. A script hangs from the notch above them, four lines deep with the line being read second from the top. The words 'I', 'want' and 'to' light in turn as they are said, then 'show' lights and holds while a footer note pulses to say it is still listening, then the highlight jumps past two unsaid words and lands on 'cool', where it holds until the line begins again."
            >
              <div className="grain relative aspect-[16/10] overflow-hidden rounded-lg bg-[#0b0d11]">
                <CameraFootage />

                <Island />
              </div>
            </div>

            <TeleprompterTrack />
          </div>

          <div>
            <SectionHeading
              eyebrow="Teleprompter"
              title={
                <>
                  A <ScriptWord>teleprompter</ScriptWord> that follows your voice
                </>
              }
              lede="Prequel hangs your script from the notch, just under the camera, and follows your voice — the word you're saying lights up as you say it. Wander off script and it waits for you; skip ahead or fall behind and it catches up within a couple of words."
              cta="Download for Mac"
            />
          </div>
        </div>
      </Container>
    </section>
  );
}

/**
 * The script, hanging from the top edge of the frame the way it hangs from a
 * MacBook's notch: flush with the top, rounded only at the bottom.
 *
 * Four lines, with the second — the one carrying `READING_LINE` — set apart
 * on its own tinted bar, because that is the one line of the four actually
 * moving. `[pause here]` is drawn dim and in italics exactly as the app draws
 * a bracketed note: never read aloud, never waited for.
 */
function Island() {
  return (
    <div className="@container absolute inset-x-0 top-0 flex justify-center">
      <div className="relative w-[52%] rounded-b-[1cqw] border border-t-0 border-white/10 bg-[#0b0c10]/95 px-[1.4cqw] pt-[1.1cqw] pb-[0.9cqw] shadow-[0_1.2cqw_3cqw_-1cqw_rgb(0_0_0_/_0.75)] backdrop-blur-sm">
        {/* The camera's own lens, so the panel reads as the notch rather
            than as a caption plate that happens to sit at the top. */}
        <span className="absolute top-[0.6cqw] right-[0.8cqw] size-[0.6cqw] rounded-full bg-white/15" />

        <p className="text-[1.15cqw] leading-[1.55] text-white/35">
          Thanks so much for jumping on this call
        </p>

        <p className="mt-[0.3cqw] rounded-[0.4cqw] bg-white/5 px-[0.5cqw] py-[0.15cqw] text-[1.15cqw] leading-[1.55] text-white/92">
          {READING_LINE.map(({ word, anim, delay }, index) => (
            <span
              key={word}
              data-teleprompter-word={index}
              className={`${anim} mr-[0.35em] text-white/35 last:mr-0`}
              style={{ animationDelay: delay }}
            >
              {word}
            </span>
          ))}
        </p>

        <p className="mt-[0.3cqw] text-[1.15cqw] leading-[1.55] text-white/25 italic">
          [pause here]
        </p>
        <p className="text-[1.15cqw] leading-[1.55] text-white/35">
          we&rsquo;ve been building for the past few months
        </p>

        {/* "Still listening…", pulsing only while the reading line is held
            on "show". Reserved space rather than pushed in when it appears —
            an absolute footer, so the four lines above it never reflow. */}
        <p className="animate-teleprompter-footer absolute inset-x-0 bottom-[-1.6cqw] text-center text-[0.85cqw] text-white/50 italic opacity-0">
          Still listening&hellip;
        </p>
      </div>
    </div>
  );
}

/** The three beats on the shared track. */
function TeleprompterTrack() {
  return (
    <DemoTimeline
      step={BEAT}
      sliceClass="animate-teleprompter-slice"
      playheadClass="animate-teleprompter-playhead"
      slices={BEATS.map(({ id, name, Glyph }) => ({
        key: id,
        label: name,
        content: (
          <>
            <Glyph />
            <span className="hidden truncate text-[0.6875rem] sm:inline sm:text-xs">{name}</span>
          </>
        ),
      }))}
    />
  );
}
