import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "../hooks/useAuth";
import { Toggle } from "./controls/inputs";
import { BugIcon, CheckIcon, CloseIcon } from "./icons";

/**
 * The most a report may be, matching `main/feedback.ts` and the Worker.
 *
 * Enforced in the box as well as on the wire so the counter can appear before
 * anybody hits it — a refusal that arrives after Send, on text that has already
 * been written, is the one moment a bug report turns into a second bug.
 */
const MAX = 4_000;

/** When the counter appears. Silent until the limit is near enough to matter. */
const COUNT_FROM = MAX - 400;

/**
 * Where a bug report is written.
 *
 * Deliberately one box and one button. Every field this could have asked for —
 * what you were doing, which recording, what you expected — is a field somebody
 * reads on their way to deciding not to bother, and none of it is worth as much
 * as the sentence they would have typed. The build and the account are attached
 * in main, so the two facts that actually get asked for in the reply are already
 * there.
 *
 * **Signed in only, and pressing Send while signed out is not a refusal.** The
 * browser opens and the report goes the moment the token lands — the same
 * arrangement `ExportDialog` makes for sharing, and for the same reason: a
 * button that quietly does nothing until you have been somewhere else and come
 * back reads as a button that failed.
 */
export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const [text, setText] = useState("");
  /**
   * On by default, and said out loud rather than attached quietly.
   *
   * The log is what turns "the export failed" into something fixable, so a
   * report without one usually costs a round trip to ask for it. But it is also
   * the one thing here nobody typed on purpose — so the switch is on screen,
   * labelled with what it sends, and off is one press away.
   */
  const [withLog, setWithLog] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  /**
   * A press that arrived before there was an account to attribute it to.
   *
   * Held rather than forgotten, so the sign-in finishing is what sends the
   * report. Without it somebody signs in, comes back and finds their words
   * sitting in the box beside a button they have already pressed.
   */
  const [pending, setPending] = useState(false);

  const send = useCallback(async () => {
    setSending(true);
    setError(null);

    const result = await window.prequel.feedback.send(text, withLog);

    setSending(false);
    if (result.ok) setSent(true);
    else setError(result.message);
  }, [text, withLog]);

  // The other half of `pending`. Guarded on `sending` so a token arriving while
  // a report is already going cannot send it twice.
  useEffect(() => {
    if (!pending || auth.status !== "signed-in") return;
    setPending(false);
    if (!sending) void send();
  }, [pending, auth.status, sending, send]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Focused on open, because the dialog exists to be typed into and a cursor
  // somebody has to place first is a click nobody should have to make.
  useEffect(() => {
    box.current?.focus();
  }, []);

  const signedOut = auth.status !== "signed-in";
  const empty = text.trim().length === 0;
  const tooLong = text.length > MAX;

  const press = () => {
    if (empty || tooLong || sending) return;

    if (signedOut) {
      // The browser opens and the effect above finishes the job — one press,
      // not two. `waiting` lands here as well: pressing again while a handshake
      // is open starts a fresh one, which is what `AccountMenu` does too.
      setPending(true);
      void window.prequel.auth.signIn();
      return;
    }

    void send();
  };

  return (
    // `no-drag` throughout: this floats over the title bar's drag region, and
    // without it every press inside the header would move the window.
    <div
      className="no-drag absolute inset-0 z-50 grid place-items-center bg-black/50 p-6"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Report a bug"
        className="relative flex w-[400px] flex-col overflow-hidden rounded-2xl border border-editor-line bg-editor-panel shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
      >
        {/* In the corner rather than under the Send button. A full-width
            Cancel at the bottom of a dialog whose one job is to be typed into
            gives the way out the same weight as the way through, and it was
            the last thing the eye reached on its way down to the button that
            matters. Escape still does the same thing. */}
        <button
          type="button"
          aria-label="Close"
          title="Close"
          className="absolute top-3 right-3 z-10 grid size-7 place-items-center rounded-full text-editor-muted transition-colors hover:bg-white/10 hover:text-editor-fg [&_svg]:size-3.5"
          onClick={onClose}
        >
          <CloseIcon />
        </button>

        <div className="flex flex-col px-5 pt-5 pb-4">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-xl border border-white/8 bg-white/8 text-white [&_svg]:size-4">
              {sent ? <CheckIcon /> : <BugIcon />}
            </span>
            <h2 className="text-[0.9375rem] font-medium tracking-tight text-editor-fg">
              {sent ? "Thank you" : "Found a bug?"}
            </h2>
          </div>

          {sent ? (
            <p className="mt-4 text-[0.8125rem] leading-relaxed text-editor-muted">
              This went straight to the team, with your version, your email
              {withLog ? " and the end of your log" : ""}. We read every one.
            </p>
          ) : (
            <>
              <p className="mt-3 text-[0.8125rem] leading-relaxed text-editor-muted">
                Tell us what happened. What you were doing and what the app did instead is plenty —
                your version and your email come along on their own.
              </p>

              <textarea
                ref={box}
                value={text}
                maxLength={MAX}
                disabled={sending}
                spellCheck
                placeholder="The cut landed in the wrong place…"
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  // Command-Return sends, Return makes a paragraph. The other
                  // way round loses a report to a stray newline, and this box
                  // is the one place in the app where that cannot be undone.
                  if (event.key === "Enter" && event.metaKey) {
                    event.preventDefault();
                    press();
                  }
                }}
                className="mt-4 h-28 w-full resize-none rounded-lg border border-editor-line bg-black/20 px-3 py-2.5 text-[0.8125rem] leading-relaxed text-editor-fg outline-none placeholder:text-editor-muted/60 focus:border-white/25 disabled:opacity-50"
              />

              {text.length > COUNT_FROM && (
                <p className="mt-1.5 text-right text-[11px] text-editor-muted">
                  {MAX - text.length} left
                </p>
              )}

              {/* The label is what it sends, not what it is called. "Attach
                  diagnostics" would be the same switch with the answer to
                  "what is in it?" left off. */}
              <label className="mt-4 flex items-start gap-3">
                <Toggle value={withLog} onChange={setWithLog} />
                <span className="text-[0.8125rem] leading-snug text-editor-muted">
                  Send the last of my log
                  <span className="mt-0.5 block text-[11px] text-editor-muted/70">
                    What the app did, with your folder names taken out. No video and no audio.
                  </span>
                </span>
              </label>
            </>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-editor-line px-4 py-4">
          {sent ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-white/10 py-2.5 text-center text-[12px] font-medium text-editor-fg hover:bg-white/15"
            >
              Done
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={empty || sending}
                onClick={press}
                // White, with the editor's own near-black on it — the same
                // primary the welcome window and the update window use. The
                // sunrise gradient belongs to the two buttons that ask for
                // money; nothing is being sold here.
                className="rounded-lg bg-white py-2.5 text-center text-[12px] font-medium text-editor-bg hover:bg-white/90 disabled:pointer-events-none disabled:opacity-40"
              >
                {sending ? "Sending…" : signedOut ? "Sign in and send" : "Send"}
              </button>

              {/* Says where the button goes before it goes there, like the
                  upgrade dialog: a native app that throws a browser at you
                  without warning reads as having lost the thread. */}
              {signedOut && (
                <p className="text-center text-[11px] text-editor-muted">
                  Opens your browser to sign in, then sends this
                </p>
              )}
            </>
          )}

          {error !== null && (
            // The text stays in the box behind this. A failure here is usually
            // the network, and losing what somebody wrote because of one is how
            // a bug report becomes the last one they send.
            <p className="text-center text-[11px] text-dock-record">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
