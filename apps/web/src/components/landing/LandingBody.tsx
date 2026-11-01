import type { ReactNode } from "react";

import { ButtonLink } from "@/components/Button";
import { Faq } from "@/components/Faq";
import { BuiltForMac } from "@/components/landing/BuiltForMac";
import { CaptionsDemo } from "@/components/landing/CaptionsDemo";
import { LayoutDemo } from "@/components/landing/LayoutDemo";
import { TeleprompterDemo } from "@/components/landing/TeleprompterDemo";
import { ZoomDemo } from "@/components/landing/ZoomDemo";
import { CaptureStep, PlayerStep, TimelineStep } from "@/components/landing/step-visuals";
import { Container, SectionHeading } from "@/components/Section";
import { DownloadCta } from "@/components/DownloadButton";
import { DesignIt } from "@/components/landing/DesignIt";
import { Playables } from "@/components/landing/Playables";
import type { FaqEntry } from "@/lib/faq";
import { TRIAL_DAYS } from "@/lib/pricing";

/**
 * The whole product in three steps, in the order they happen.
 *
 * The title is the step and the body is what it actually involves, which is the
 * only thing that makes a step worth reading: "Record your screen and camera"
 * on its own is a sentence nobody needed, and the display-or-window-or-region
 * choice under it is the answer to the first question anybody has.
 *
 * Step two is passive on purpose. `COPY.md` says Prequel does the verb, and it
 * does in that step's body, but the whole of what the step itself promises is
 * that the reader is not the one doing it.
 */
const STEPS = [
  {
    title: "Record your screen and camera",
    body: "Pick a display, a window or an area you drag out, with your camera, microphone and system audio each on their own track.",
    visual: <CaptureStep />,
  },
  {
    title: "Zooms and layout are applied automatically",
    body: "Prequel reads where you clicked and typed, then places the zooms, frames your camera and sets a background behind it.",
    visual: <TimelineStep />,
  },
  {
    title: "Edit, export and share",
    body: "Move a zoom, trim a clip or fix a caption, then export one MP4 at up to 4K or send a link that plays anywhere.",
    visual: <PlayerStep />,
  },
];

/**
 * Everything below the hero, shared by `/` and every `/create/<slug>` page.
 *
 * `STEPS` stays with the loop that reads it rather than moving to `lib/`: it
 * holds JSX, and a constant used in one place is just indirection.
 */
export function LandingBody({ faq }: { faq: FaqEntry[] }) {
  return (
    <>
      {/* Before the demos rather than after them. Each demo below is a close
          look at something one of these steps named, and a visitor who has not
          been told there are only three steps reads the demos as unrelated
          features rather than as the same three made concrete. It is also the
          shortest thing on the page, so it costs a skimmer nothing. */}
      <section className="pt-16 pb-8">
        <Container>
          <SectionHeading
            eyebrow="How it works"
            title="Three steps to a finished video"
            align="centre"
            cta="Download for Mac"
          />
          {/* An `ol`, because these are a sequence and not a set: read out in a
              different order they stop being true.

              Gapped cards rather than the hairline grid the feature cards use.
              That grid exists to make a set read as one object, and it is right
              where the cells are text; here each cell opens on a picture, and
              three pictures meeting at a hairline read as one wide image cut
              into thirds. */}
          <ol className="mx-auto mt-10 grid max-w-5xl gap-5 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li
                key={step.title}
                className="flex flex-col overflow-hidden rounded-2xl border border-line bg-bg"
              >
                {step.visual}
                <div className="flex flex-col gap-2.5 p-6">
                  <span className="font-mono text-xs tracking-wider text-muted" aria-hidden>
                    {index + 1}
                  </span>
                  <span className="text-[0.9375rem] font-medium text-fg">{step.title}</span>
                  <span className="text-sm leading-relaxed text-muted">{step.body}</span>
                </div>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* The first place on the page where the product is shown doing something
          rather than described. It replaced a composed screenshot of the editor:
          the still could show the zoom slices sitting on a timeline but not the
          push in, which is the part worth seeing. */}
      <ZoomDemo />

      {/* Directly under it, because the two make one argument between them: the
          zoom demo shows the camera moving *within* the picture, and this one
          shows the picture itself being re-arranged. Split apart by a section of
          prose they read as two unrelated animations. */}
      <LayoutDemo />

      {/* And a third, on the words rather than the picture. It comes after the
          two above rather than before them because it is the only one that
          needs them to have landed first: a visitor who has not yet accepted
          that the frame is composed after the fact has no reason to care that
          the sentence under it is editable. */}
      <CaptionsDemo />

      {/* A fourth, and the one that stands apart from the argument the three
          above build together. Those are all about what happens to a take
          after it is recorded — the frame it is composed into, the words
          pulled out of it. This one is about the moment of recording itself,
          which is why it comes last rather than between any of them: dropped
          in the middle it would read as a change of subject, where at the end
          it reads as one more thing Prequel does while the camera is
          rolling. */}
      <TeleprompterDemo />

      {/* The foot of the page, in the dark.
          
          The run above is the argument — what Prequel does to a recording, one
          demo at a time — and everything from here down is what you are left
          deciding: whether the details are right, what it exports, and the
          questions before you download it. The page turning over is what says
          that, and it turns over on `BuiltForMac` because that section is
          about the hardware — silicon on paper is a diagram, and the same
          chip on a deep field is the thing itself.
          
          `data-theme="dark"` and not a set of `dark:` variants. The attribute
          redefines the thirteen tokens for its whole subtree — see the note on
          it in `globals.css` — so every `bg-surface`, `border-line` and
          `text-muted` in here resolves to its dark value with no call site
          edited. The cards inside were already built on the tokens; what is
          below is the handful of places that were not.
          
          `-mb-32 pb-32` is the footer's own `mt-32` absorbed. Without it the
          dark ends, 128px of paper follows, and then the footer — which reads
          as a dark slab dropped on the page rather than as the page itself
          turning over. The footer stays light because it is in the marketing
          layout and every other page on the site has one. */}
      <div data-theme="dark" className="-mb-32 bg-bg pb-32">
        {/* First in the dark, and the reason the dark starts here: the one
            section about the machine rather than the take. It follows the four
            demos because they have just shown four things happening to a
            recording, and "all of that runs on the Mac's own hardware" is the
            sentence those four earn. */}
        <BuiltForMac />

        {/* Where the editor's six feature cells used to be. See `Playables`
            for what replaced them and why. */}
        <Playables />

        {/* And the other half of the editor: that none of it is baked, and
            the thing you are moving has handles on it. It follows the two
            cards because they are the small decisions and this is the shape
            of the whole thing. */}
        <DesignIt />

        <CallToAction />
        <Faq heading="Zooms, exports and the rest" entries={faq} />
      </div>
    </>
  );
}

function CallToAction(): ReactNode {
  return (
    <section className="pb-8">
      <Container>
        <div className="squircle lit relative overflow-hidden rounded-3xl border border-line bg-surface px-6 py-16 text-center sm:px-16">
          <h2 className="text-3xl font-medium tracking-tight text-balance text-fg sm:text-4xl">
            Record demos worth sharing
          </h2>
          <p className="mx-auto mt-4 max-w-md text-pretty text-muted">
            Free for {TRIAL_DAYS} days. No watermark on anything you export.
          </p>
          <DownloadCta className="mt-8" />
          <p className="mt-8 text-xs text-muted">
            Curious about the internals?{" "}
            <ButtonLink
              href="/blog"
              variant="ghost"
              size="sm"
              className="px-1 underline-offset-4 hover:underline"
            >
              Read the blog
            </ButtonLink>
          </p>
        </div>
      </Container>
    </section>
  );
}
