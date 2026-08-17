import type { Metadata } from "next";

import { ButtonLink } from "@/components/Button";
import { Container, SectionHeading } from "@/components/Section";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "About",
  description:
    "Why Prequel is a native Rust capture core under an Electron shell, and the principles the app is built on.",
};

const PRINCIPLES = [
  {
    title: "Native where it counts",
    body: "Capture, encode and export are Rust against ScreenCaptureKit, AVFoundation, VideoToolbox and Metal. The shell is Electron because a shell is not the hard part.",
  },
  {
    title: "Nothing is decided too early",
    body: "The layout is an editing decision, not a recording one. Anything the app can leave open until you have seen the take, it leaves open.",
  },
  {
    title: "One implementation, not two",
    body: "Where the same answer is needed in two places — a position, an audio gain — it is computed once and sent to both. Two implementations is how a preview and an export come to disagree.",
  },
  {
    title: "Local by default",
    body: "Recording, editing and export happen on your machine. There is no upload, no queue and no cloud render.",
  },
];

export default function About() {
  return (
    <>
      <section className="pt-20 pb-8">
        <Container>
          <SectionHeading
            eyebrow="About"
            title="Built because the recording was never the hard part"
            lede="Getting the pixels is straightforward. Getting a video somebody wants to watch, out of a take you made once and cannot make again, is the work."
            align="centre"
          />
        </Container>
      </section>

      <section className="pb-4">
        <Container>
          <div className="mx-auto max-w-2xl">
            <div className="space-y-5 text-[1.0625rem] leading-relaxed text-muted">
              <p>
                A raw screen recording is flat. It sits at one distance from the viewer for its
                whole length, the thing that matters is too small to read, and the pointer wanders
                about while nothing happens.
              </p>
              <p>
                Everyone knows what fixes it. Push in on the work. Cut the dead air. Frame the
                camera somewhere sensible and put the whole thing on a background. And almost nobody
                does it, because that is an afternoon in a video editor for a five minute clip — so
                the flat version gets sent instead.
              </p>
              <p>
                Prequel makes that pass for you. It watches where you click and type while it
                records, and opens an editor with the zooms already placed, the camera already
                framed and a background already on. Nothing is baked in: what you change is only
                what you disagree with.
              </p>
              <p>
                Then it exports properly — hardware H.264 or HEVC at up to 4K, composited in Metal,
                at a constant frame rate. A video that looks produced is worth nothing if the file
                is soft.
              </p>
            </div>

            <h2 className="mt-14 text-2xl font-medium tracking-tight text-fg">
              Why not just use Electron for all of it
            </h2>
            <div className="mt-5 space-y-5 text-[1.0625rem] leading-relaxed text-muted">
              <p>
                We tried. <code className="font-mono text-sm text-lilac">desktopCapturer</code> and{" "}
                <code className="font-mono text-sm text-lilac">MediaRecorder</code> cannot reach the
                quality bar: software VP8 and VP9 encoding, dropped frames above 1080p60, no way to
                exclude a window from its own capture, and system-audio loopback that broke on macOS
                15 and stayed broken.
              </p>
              <p>
                So capture, encode and export are Rust against the platform frameworks, and
                everything crossing into JavaScript is plain data. No Objective-C object and no{" "}
                <code className="font-mono text-sm text-lilac">CMSampleBuffer</code> ever reaches
                the Node side — it sees descriptions of things and commands to act on them.
              </p>
              <p>
                The result is a recorder that holds 1080p60 without dropping frames, an export that
                runs on the media engine rather than the CPU, and a preview that agrees with the
                file because both draw the same plan.
              </p>
            </div>
          </div>
        </Container>
      </section>

      <section className="py-20">
        <Container>
          <div className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2">
            {PRINCIPLES.map((principle) => (
              <div key={principle.title} className="bg-bg p-7">
                <h3 className="text-[0.9375rem] font-medium text-fg">{principle.title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-muted">{principle.body}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="pb-8">
        <Container>
          <div className="squircle lit rounded-3xl border border-line bg-surface px-6 py-14 text-center sm:px-16">
            <h2 className="text-2xl font-medium tracking-tight text-fg">Say something</h2>
            <p className="mx-auto mt-3 max-w-md text-pretty text-muted">
              Feature requests, bug reports and disagreements about codecs all go to the same
              address.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="inline-flex h-11 items-center rounded-full bg-white px-6 text-sm font-medium text-bg transition-colors hover:bg-white/90"
              >
                {CONTACT_EMAIL}
              </a>
              <ButtonLink href="/#waitlist" variant="secondary">
                Join the waitlist
              </ButtonLink>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
