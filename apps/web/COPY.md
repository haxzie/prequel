# Writing copy for the site

Every string a stranger reads: headlines, ledes, feature cards, FAQ answers,
button labels, the words under a button. Not code comments, which are governed
by the opposite rules in the root `AGENTS.md` and are long, discursive and full
of em dashes on purpose.

The two registers are not compatible and the comment voice is the one that
leaks. A visitor decides in about five seconds; a maintainer reads a comment
because they are already committed. Copy written in the comment voice reads as
someone explaining the product to themselves.

## The shape of a section

Every section on the landing page is the same three tiers, and nothing on the
page is a paragraph:

```
Eyebrow      One or two words, small caps. A category, not a claim.
Heading      One line. Two beats if it wants them, second beat shorter.
Lede         Two sentences. Three only if the third is short.
Cards        3 to 6. Bare noun-phrase title, then one or two sentences.
```

The rhythm is the voice, more than any individual sentence is. A section that
runs to four sentences of lede is not a longer section, it is a section written
in the wrong register.

## Rules

**No em dashes. Anywhere a visitor can read.** Use a comma, a colon, brackets,
or two sentences. En dashes in numeric ranges (`$18–$24`) are fine. This is the
rule most often broken by accident, because the surrounding code comments are
full of them and the hand carries over. `SectionHeading`'s `lede` is where it
usually lands.

**British spelling**, matching the rest of the tree: colour, normalised,
behaviour, centred.

**Prequel is the subject and the actor.** Name it, and let it do the verb.

> Prequel places the zooms, frames your camera and sets a background behind it.

Not "zooms are placed automatically", not "the app will help you add zooms". No
`we` anywhere in product copy; `we` belongs in blog posts and the about page,
where a person is genuinely speaking.

**The reader owns the artefacts.** Your take, your camera, your Mac, your
viewers, your work. Prequel owns the labour.

**Short sentences.** Under fifteen words is the norm. If a sentence needs a
subordinate clause hanging off a subordinate clause, it is two sentences.

**No hedging.** Not "helps you add zooms", not "designed to make editing
easier", not "can automatically". It either does it or it is not on the page.

**Never define the thing by what it is not.** No "not X, but Y", and none of
its cousins: "X rather than Y", "X instead of Y", "what opens is a finished
video, not raw footage". The shape reads as written rather than said, and the
page was full of it. Say what the thing does and stop. A factual contrast
inside a sentence is allowed where the contrast is the fact ("stored in
proportions, so nothing slides off the frame"); the rhetorical version is not.

**No superlatives, no buzzwords, and no claim with nothing in it.** "Exports
that hold up" says less than "It stays sharp at 4K". "Layouts to communicate
your big ideas" says less than "Layouts for the screen and the camera". If a
heading would survive being moved to a different product's page, it is not
about this one.

**No trade jargon.** "in post", "the pass", "assets". The reader records their
screen for work; they do not edit for a living.

**The automatic zooms are called zoom and pan.** Never "the zoom pass".

**Concrete nouns only.** Cursor, corner, padding, shadow, waveform, playhead,
timeline, wallpaper. Never workflow, experience, solution, engine, platform.
Whatever is on screen is what the sentence names.

**Value is measured in work not done.** Already placed, nothing to set up,
nothing to import, one click, opens by itself, no upload step. That is what the
product is; features are only evidence for it.

**Say the requirement out loud, quietly.** A big claim earns a small honest line
directly under it: `No credit card required` under the download button,
`on your Mac` inside the transcription sentence, Apple Silicon and macOS 14 in
the footer. It costs six words and buys more trust than a paragraph of
adjectives. It is also the only place self-criticism is allowed, and it is not
self-criticism: a reader who buys something that will not run leaves a refund
request and a one-star review.

**Card titles are outcomes, and the body is the mechanism.** Sentence case, no
full stop, no title case. `Guide attention automatically`,
`Keep the pointer out of the way`, `Export the frame you approved`. A title
that only names the control (`Backgrounds`, `Automatic zooms`, `Camera
framing`) leaves the reader to work out why they would ever touch it, and that
is the reader's job done badly rather than briefly.

The pairing is the point: the title says what they get, the body says how, and
the body stays exact. An outcome with nothing checkable under it is the other
failure, so the numbers under these titles are real ones, read off the app.

**Section headers are spoken English.** `Zooms, exports and the rest`, not
`Frequently asked questions`. `Everything you would have done by hand`, not
`Editor features`.

**Repetition across pages is fine.** The same card body appears on `/` and on
sixteen `/create/<slug>` pages because `LandingBody` is shared. Do not rewrite a
line to avoid saying it twice. Rewriting is how two pages end up making
different promises about the same feature.

## What never goes on the page

**Anything the first pass does not actually do.** Prequel places zooms, frames
the camera, applies a background, balances audio and cleans up the cursor.
It does **not** cut, trim, or remove silences. Cutting is a manual pass on the
timeline. Never write "dead air" and never imply pacing is automatic. This is
the one class of overclaim that turns into a refund.

**A Prequel shortcoming.** No "the catch", no conceding a feature to a rival, no
hedging about maturity. If something is genuinely weak, leave it out rather than
write it down. Compatibility facts are the exception, above.

**Numbers we cannot stand behind.** "Thousands of people" over a user count we
would have to keep true. The real specs (4K, 120 fps, H.264, HEVC) are exact
because they are checkable.

**Pain agitation.** Never open by telling the reader their recordings are bad.
Where a problem is named, it is mechanical and blameless: "a raw recording holds
one distance for the whole take", not "your demos are boring".

**Exclamation marks, emoji, and adjective stacking.** One adjective per noun at
most, and only where the picture beside it proves the adjective.

## Where the strings live

| Path | What it holds |
| --- | --- |
| `src/lib/site.ts` | Tagline, meta description, nav labels. Anything said twice. |
| `src/lib/faq.ts` | The landing FAQ. Rendered as copy and as `FAQPage` JSON-LD off one array. |
| `src/app/(marketing)/page.tsx` | The home hero title and lede. |
| `src/components/landing/LandingBody.tsx` | Everything under the hero, shared with `/create/<slug>`. |
| `src/components/landing/{Zoom,Layout,Captions}Demo.tsx` | Each demo's own heading, lede and `aria-label`. |
| `src/components/DownloadButton.tsx` | The line under the download button. |
| `src/content/use-cases.ts` | The sixteen `/create/<slug>` heroes and their own FAQs. |
| `src/content/competitors.ts` | Cited head-to-head facts. Has its own rules in the file. |
| `src/lib/pricing.ts` | Plan names, plan blurbs, the pricing FAQ. |

`aria-label` counts as copy. It is read aloud, so it obeys every rule here,
em dashes included.

## Before it ships

```bash
# No em dashes in anything user-facing. Comments are allowed them; strings are not.
grep -rn "—" apps/web/src --include="*.tsx" --include="*.ts" --include="*.mdx" \
  | grep -vE ":[0-9]+: *(\*|//|/\*)"

# American spellings that slip in from competitor copy.
grep -rniE "normaliz|customiz|color:|behavior|centered" apps/web/src/lib apps/web/src/content

# The claim we do not make.
grep -rni "dead air\|removes silence\|cuts silence" apps/web/src
```

Then read the section out loud. If you run out of breath inside one sentence,
it is two sentences.
