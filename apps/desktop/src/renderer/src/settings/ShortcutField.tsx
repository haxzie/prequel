import { useEffect, useRef, useState } from "react";

import { acceleratorFromEvent, isBindable } from "../../../shared/accelerator";
import { cn } from "../lib/cn";
import { Keycaps } from "./Keycaps";

/**
 * Records a chord and asks main to bind it.
 *
 * While recording it swallows every keydown, including the ones the browser
 * would otherwise act on — without `preventDefault` a rebind to `⌘W` closes the
 * window on the way past.
 *
 * Nothing is stored until macOS has accepted the binding. `setShortcut`
 * answers with a result rather than throwing, and on refusal the previous
 * chord is still registered and still shown, so the field never claims a
 * shortcut the user does not have.
 */
export function ShortcutField({
  accelerator,
  onChange,
}: {
  accelerator: string;
  onChange: (accelerator: string) => Promise<{ ok: boolean; message?: string }>;
}) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!recording) return;

    const onKeyDown = (event: KeyboardEvent) => {
      // Every key while recording, or the chord being typed leaks into the
      // window underneath.
      event.preventDefault();
      event.stopPropagation();

      if (event.code === "Escape") {
        setRecording(false);
        return;
      }

      const chord = acceleratorFromEvent(event);
      // Null while only modifiers are down — keep listening rather than
      // committing half a chord on the way to the real one.
      if (!chord) return;

      setRecording(false);

      if (!isBindable(chord)) {
        // Checked here as well as in main so the message is immediate, and so a
        // bare key never reaches a `globalShortcut.register` that would happily
        // take it away from every other app.
        setError("Use at least one of Command, Control or Option.");
        return;
      }

      void onChange(chord).then((result) => {
        setError(result.ok ? null : (result.message ?? "That shortcut is not available."));
      });
    };

    // Capture, so this runs before anything else in the window sees the key.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, onChange]);

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        ref={button}
        type="button"
        onClick={() => {
          setError(null);
          setRecording((on) => !on);
        }}
        onBlur={() => setRecording(false)}
        className={cn(
          "flex h-8 min-w-28 items-center justify-center gap-1 rounded-lg px-2.5",
          "border transition-colors",
          recording
            ? "border-editor-accent bg-white/5"
            : "border-editor-line bg-white/[0.03] hover:border-editor-muted",
        )}
      >
        {recording ? (
          <span className="text-[11px] text-editor-muted">Press keys…</span>
        ) : (
          <Keycaps accelerator={accelerator} />
        )}
      </button>

      {error ? (
        <p role="alert" className="max-w-56 text-right text-[11px] leading-snug text-editor-danger">
          {error} Still using <Keycaps accelerator={accelerator} muted />.
        </p>
      ) : null}
    </div>
  );
}
