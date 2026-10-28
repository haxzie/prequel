"use client";

import { useRef, useState } from "react";

/** A pair of marks the keyboard can wrap the selection in. */
interface Mark {
  /** The letter pressed with ⌘ or Ctrl. */
  key: string;
  before: string;
  after: string;
}

const MARKS: Mark[] = [
  { key: "B", before: "**", after: "**" },
  { key: "I", before: "_", after: "_" },
];

/**
 * Where a comment is typed.
 *
 * A plain field. The body is markdown and is rendered as markdown once posted —
 * `**bold**`, `_italic_`, `~~struck~~`, backticks and fenced blocks all work —
 * but nothing about that is drawn around the box. A toolbar and a syntax crib
 * over a comment field on a page somebody opened to watch a two-minute
 * recording is chrome asking to be read before anything has been typed; the
 * people who use the syntax already know it, and everybody else types a
 * sentence and presses the button.
 *
 * ⌘B and ⌘I still wrap the selection. They cost nothing on screen, which is the
 * whole argument against the buttons that used to be here.
 */
export function Composer({
  busy,
  placeholder = "Leave a comment…",
  onSubmit,
}: {
  busy: boolean;
  placeholder?: string;
  /** Rejects by throwing; the panel above shows the error. */
  onSubmit: (body: string) => Promise<void>;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");

  /**
   * Wraps the selection, or opens an empty pair where the caret is.
   *
   * `setRangeText` rather than rebuilding the value by hand: it keeps the
   * field's own undo stack, so ⌘Z after ⌘B undoes the asterisks instead of the
   * whole comment.
   */
  const wrap = ({ before, after }: Mark) => {
    const element = field.current;
    if (!element) return;

    const { selectionStart: start, selectionEnd: end } = element;
    element.focus();
    element.setRangeText(`${before}${element.value.slice(start, end)}${after}`, start, end, "end");

    // Nothing selected means the caret goes between the marks, where the next
    // keystroke is meant to land.
    if (start === end) {
      const caret = start + before.length;
      element.setSelectionRange(caret, caret);
    }

    setValue(element.value);
  };

  const submit = async () => {
    const body = value.trim();
    if (!body || busy) return;

    await onSubmit(body);
    // Only on success: a throw leaves the words in the box, which is the one
    // thing a failed comment box must do.
    setValue("");
  };

  return (
    <div className="rounded-xl border border-line bg-bg focus-within:border-muted/40">
      <textarea
        ref={field}
        value={value}
        rows={2}
        placeholder={placeholder}
        aria-label="Comment"
        className="block max-h-48 min-h-16 w-full resize-y bg-transparent px-3 py-2.5 text-sm leading-relaxed text-fg placeholder:text-muted/70 focus:outline-none"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (!(event.metaKey || event.ctrlKey)) return;

          // ⌘↵ posts, which is what every comment box this sits next to does.
          // Return alone is a new line: a comment here is a paragraph more
          // often than it is a chat message.
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
            return;
          }

          const mark = MARKS.find((candidate) => candidate.key === event.key.toUpperCase());
          if (mark) {
            event.preventDefault();
            wrap(mark);
          }
        }}
      />

      <div className="flex justify-end px-3 pb-2.5">
        <button
          type="button"
          disabled={busy || value.trim() === ""}
          className="h-8 rounded-full bg-fg px-4 text-xs font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => void submit()}
        >
          {busy ? "Posting…" : "Comment"}
        </button>
      </div>
    </div>
  );
}
