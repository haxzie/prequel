import type { Metadata } from "next";
import Link from "next/link";

import { ButtonLink } from "@/components/Button";
import { Container, SectionHeading } from "@/components/Section";
import { SUPPORT_EMAIL } from "@/lib/site";
import { TRIAL_DAYS } from "@/lib/pricing";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Support",
  description:
    "Get help with Prequel. Email support@prequel.sh, or fix the two things that go wrong most often: the Screen Recording permission and the restart it needs.",
  path: "/support",
});

/**
 * The four things people write in about, in the order they happen.
 *
 * Both permission answers say to quit and reopen, because that is the step
 * people skip: macOS hands a running app the old answer until it restarts, so
 * granting the permission and trying again looks like the grant did not work.
 * `Welcome.tsx` in the app makes the same point at the same moment.
 */
const ANSWERS = [
  {
    title: "Prequel cannot see your screen",
    body: "Open System Settings, then Privacy & Security, then Screen & System Audio Recording, and allow Prequel. Quit the app and open it again afterwards: macOS keeps handing a running app the old answer, so this looks broken until you restart it.",
  },
  {
    title: "The zooms did not follow my typing",
    body: "Typing zooms need Accessibility, in the same Privacy & Security pane, and the same quit and reopen. Without it your clicks still drive the zooms, so that one input is missing rather than the feature being broken.",
  },
  {
    title: "Something crashed, or an export failed",
    body: "Send us the log. Click the Prequel icon in the menu bar and choose Show Log in Finder, or open ~/Library/Logs/Prequel/main.log yourself. It carries the app's lifecycle, the export progress and any error behind it.",
  },
  {
    title: "Licences, billing and new Macs",
    body: `Same address. Moving a lifetime licence to a new Mac, a receipt you need for expenses, a subscription you want stopped, or a trial that ran out before you got to try the thing you downloaded it for. The trial is ${TRIAL_DAYS} days and nothing it exports is watermarked.`,
  },
];

export default function Support() {
  return (
    <>
      <section className="pt-20 pb-8">
        <Container>
          <SectionHeading
            eyebrow="Support"
            title="Something not working? Write to us."
            lede="One address, read by the people who build the app. Bug reports, feature requests and disagreements about codecs all go to the same place."
            align="centre"
          />
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="inline-flex h-11 items-center rounded-full bg-white px-6 text-sm font-medium text-bg transition-colors hover:bg-white/90"
            >
              {SUPPORT_EMAIL}
            </a>
            <ButtonLink href="/download" variant="secondary">
              Download for Mac
            </ButtonLink>
          </div>
        </Container>
      </section>

      <section className="py-12">
        <Container>
          <div className="mx-auto max-w-2xl">
            <h2 className="text-2xl font-medium tracking-tight text-fg">
              What to put in the email
            </h2>
            <p className="mt-4 text-[1.0625rem] leading-relaxed text-muted">
              Your macOS version and which Mac it is, the version of Prequel from the tray menu, and
              what you were recording when it went wrong. If the app misbehaved rather than simply
              refused, attach the log as well. That is usually the difference between one reply and
              four.
            </p>
          </div>
        </Container>
      </section>

      <section className="pb-12">
        <Container>
          <div className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2">
            {ANSWERS.map((answer) => (
              <div key={answer.title} className="bg-bg p-7">
                <h3 className="text-[0.9375rem] font-medium text-fg">{answer.title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-muted">{answer.body}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="pb-20">
        <Container>
          <div className="squircle lit rounded-3xl border border-line bg-surface px-6 py-14 text-center sm:px-16">
            <h2 className="text-2xl font-medium tracking-tight text-fg">Answered already?</h2>
            <p className="mx-auto mt-3 max-w-md text-pretty text-muted">
              The questions people ask before they buy are on the home page and the pricing page,
              with the answers written out rather than linked to a help centre.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link
                href="/#faq"
                className="inline-flex h-11 items-center rounded-full border border-line bg-elevated px-6 text-sm font-medium text-fg transition-colors hover:border-muted/40 hover:bg-surface"
              >
                Product FAQ
              </Link>
              <ButtonLink href="/pricing" variant="secondary">
                Pricing and licences
              </ButtonLink>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
