/**
 * A label that has turned into a field, for the two places a recording is
 * named: its card in the library and the editor's title bar.
 *
 * Shared for the two traps below rather than for the markup, which is a styled
 * input and nothing else.
 */
import { useEffect, useRef, useState } from "react";

export function RenameField({
  name,
  className,
  onDone,
  onCancel,
}: {
  name: string;
  /** The caller's, because a card and a title bar are not the same shape. */
  className: string;
  onDone: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(name);
  const field = useRef<HTMLInputElement>(null);
  /**
   * Whether this edit has already ended, however it ended.
   *
   * Escape moves focus, which fires `blur` straight after — without this the
   * abandoned edit is committed by the very keypress that abandoned it. The
   * press outside below has the same shape from the other side: it commits,
   * and the blur it causes would commit again.
   */
  const settled = useRef(false);

  const finish = (commit: boolean) => {
    if (settled.current) return;
    settled.current = true;
    if (commit) onDone(field.current?.value ?? value);
    else onCancel();
  };

  /**
   * A press anywhere else is "done", not only one that moves focus here.
   *
   * Blur alone is not enough: the editor's title bar is a drag region and the
   * preview captures the pointer, so a press on either never takes focus off
   * this field — and the field sat open after a click that plainly meant to
   * finish. On the capture phase, so it lands before whatever was clicked
   * handles the press.
   */
  useEffect(() => {
    const away = (event: PointerEvent) => {
      if (!field.current?.contains(event.target as Node)) finish(true);
    };

    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  });

  return (
    <input
      ref={field}
      autoFocus
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.target.select()}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        // Stopped here as well as handled, for both callers: Escape is what
        // drops the library's selection, and in the editor every bare letter
        // is a shortcut — S splits the clip under the playhead.
        event.stopPropagation();
        if (event.key === "Enter") finish(true);
        if (event.key === "Escape") finish(false);
      }}
      className={className}
    />
  );
}
