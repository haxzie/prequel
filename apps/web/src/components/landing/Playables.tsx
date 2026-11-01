import { Container, SectionHeading } from "@/components/Section";

import { KeyboardCard } from "./playables/KeyboardCard";
import { PointerCard } from "./playables/PointerCard";

/**
 * Two things to press, near the foot of the page.
 *
 * It replaced a six-cell grid of the editor's features, each cell a still
 * picture and a sentence. Both of these are a choice somebody makes in the app
 * — which pointer, which keyboard — and a picture of a choice is the one thing
 * that cannot show what choosing does. The sounds in particular had no
 * business being a screenshot.
 *
 * There were four. A card of click sounds and a card of caption looks have
 * gone: the clicks were a row of eleven pills under an empty stage, and the
 * captions were the third thing on this page to show a line of text appearing
 * over a video — the demo three screens up already does it with the editor
 * around it.
 *
 * A pair, in a grid rather than the masonry the four needed. Two cards of
 * different heights side by side is a ragged edge where four was a pattern, so
 * these are stretched to match: `items-stretch` is the default, and `PlayCard`
 * is built to fill whatever height it is given.
 */
export function Playables() {
  return (
    <section className="py-24">
      <Container>
        <SectionHeading
          eyebrow="The details"
          title="Control down to the pointer"
          lede="A hand on a stick instead of your Mac's arrow, and the sound of the keys you actually pressed. Press anything here."
          cta="Download for Mac"
          align="centre"
        />
        <div className="mt-14 grid gap-5 md:grid-cols-2">
          <PointerCard />
          <KeyboardCard />
        </div>
      </Container>
    </section>
  );
}
