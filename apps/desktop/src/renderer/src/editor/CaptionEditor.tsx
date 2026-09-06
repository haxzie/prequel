/**
 * The transcript as a run of text that can be typed into.
 *
 * One editable block rather than a field per word, because correcting a
 * transcript is reading it: the eye runs along the sentence and stops at the
 * word that is wrong. A field per word would put a box around every one and
 * make adding a missed word impossible.
 *
 * The text and the timeline are the same thing seen twice. Selecting words
 * lights the footage they were spoken over, and deleting the selection cuts
 * that footage out — which is what deleting a sentence from a recording
 * means. Retyping over a selection is the other thing, a correction, and does
 * not cut anything.
 *
 * The words are drawn imperatively. React re-rendering the children of a
 * contenteditable moves the caret to wherever the new nodes happen to leave
 * it, so the spans are rebuilt by hand whenever the words change and the caret
 * is put back where it was by counting characters.
 */
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent } from "react";

import { isFiller } from "../../../shared/captions";
import type { MediaTime } from "../../../shared/manifest";
import type { TranscriptWord } from "../../../shared/transcript";
import { cn } from "../lib/cn";

/** What the editor needs from the words, and everything it can do to them. */
export interface CaptionEditing {
  /** The words the edit still plays, in time order. */
  words: readonly TranscriptWord[];
  /** Whether the text differs from the generated transcript, so Reset has something to do. */
  edited: boolean;
  /** The whole text as it now reads. */
  onEdit: (text: string) => void;
  /** Typing has paused or begun, so what follows is a new step to undo. */
  onBeginEdit: () => void;
  /** Back to the generated transcript. */
  onReset: () => void;
  onUndo: () => void;
  /** The footage the selected words were spoken over, or null for none. */
  onSelect: (range: { start: MediaTime; end: MediaTime } | null) => void;
  /** Cut that footage out. */
  onCut: (range: { start: MediaTime; end: MediaTime }) => void;
  /** Move the playhead to where a word was said. */
  onSeek: (source: MediaTime) => void;
  /** Where the playhead is in source time, read per frame. */
  sourceAt: (now?: number) => MediaTime | null;
}

/**
 * How long typing has to pause before what comes next is its own undo step.
 *
 * Long enough that finishing a word is one step, short enough that coming
 * back to fix something else is another.
 */
const PAUSE_MS = 1000;

/**
 * Where the caret is, counted in characters that are not spaces.
 *
 * Not a plain offset: the words are rebuilt with exactly one space between
 * them, and the text as typed may have two, or one at the end. Counting only
 * what survives the rebuild puts the caret back beside the same letter.
 */
interface Caret {
  letters: number;
  /** Whether it sat just after a space, so it goes after the space again. */
  afterSpace: boolean;
}

export function CaptionEditor({
  words,
  onEdit,
  onBeginEdit,
  onUndo,
  onSelect,
  onCut,
  onSeek,
  sourceAt,
}: CaptionEditing) {
  const root = useRef<HTMLDivElement>(null);
  /** Where to put the caret after the next rebuild, or null to leave it be. */
  const caret = useRef<Caret | null>(null);
  const pause = useRef<number | null>(null);
  /** The word range last reported, so the timeline is only told about a change. */
  const reported = useRef<[number, number] | null>(null);

  // Read through a ref so the document-level listeners bind once.
  const latest = useRef({ words, onSelect, onCut, onEdit });
  latest.current = { words, onSelect, onCut, onEdit };

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;

    element.replaceChildren(
      ...words.flatMap((word, index) => {
        const span = document.createElement("span");
        span.dataset.index = String(index);
        span.textContent = word.text;
        // Dimmed rather than hidden: the sound was made, and a person reading
        // the transcript should see why "um" is in the text and not on screen.
        if (isFiller(word.text)) span.className = "text-editor-muted";
        return index === 0 ? [span] : [document.createTextNode(" "), span];
      }),
    );

    if (caret.current !== null) {
      placeCaret(element, caret.current);
      caret.current = null;
    }
  }, [words]);

  /**
   * The footage under the selection, reported as it changes.
   *
   * On the document rather than the element, because `selectionchange` only
   * fires there. Anything that is not a stretch of words inside the editor —
   * a caret, a click on the timeline — reads as no selection, which is what
   * clears the band.
   */
  useEffect(() => {
    const onChange = () => {
      const element = root.current;
      const range = selectedWords(element);
      const previous = reported.current;

      if (range === null) {
        if (previous === null) return;
        reported.current = null;
        latest.current.onSelect(null);
        return;
      }
      if (previous && previous[0] === range[0] && previous[1] === range[1]) return;

      reported.current = range;
      const { words: current } = latest.current;
      latest.current.onSelect({ start: current[range[0]]!.at, end: current[range[1]]!.end });
    };

    document.addEventListener("selectionchange", onChange);
    return () => {
      document.removeEventListener("selectionchange", onChange);
      // Going away — back, close, another tab — takes the band with it.
      if (reported.current !== null) latest.current.onSelect(null);
      if (pause.current !== null) window.clearTimeout(pause.current);
    };
  }, []);

  /**
   * The word under the playhead, lit as playback goes past it.
   *
   * A DOM write from its own frame loop rather than state: the position
   * changes every frame, and React would re-render the panel for each one.
   * Only the attribute that changed is touched, so a frame where the playhead
   * is still inside the same word costs a lookup and nothing else.
   */
  useEffect(() => {
    let frame = 0;
    let lit: HTMLElement | null = null;

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const element = root.current;
      if (!element) return;

      const at = sourceAt(now);
      const index = at === null ? -1 : wordUnder(latest.current.words, at);
      const next =
        index === -1
          ? null
          : (element.querySelector<HTMLElement>(`[data-index="${index}"]`) ?? null);
      if (next === lit) return;

      lit?.removeAttribute("data-live");
      next?.setAttribute("data-live", "");
      lit = next;
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [sourceAt]);

  const onInput = () => {
    const element = root.current;
    if (!element) return;

    caret.current = caretIn(element);
    onEdit(element.textContent ?? "");

    if (pause.current !== null) window.clearTimeout(pause.current);
    pause.current = window.setTimeout(() => {
      pause.current = null;
      onBeginEdit();
    }, PAUSE_MS);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The window's shortcuts ignore anything editable, so undo has to be
    // caught here or ⌘Z inside the text does the browser's own undo — over a
    // DOM that is rebuilt from the words after every change, which corrupts it.
    if ((event.metaKey || event.ctrlKey) && event.code === "KeyZ") {
      event.preventDefault();
      if (!event.shiftKey) onUndo();
      return;
    }

    switch (event.key) {
      // One block of text. A line break would become a `<div>` the rebuild
      // cannot represent, and a cue's line breaks are decided by the style.
      case "Enter":
        event.preventDefault();
        return;

      case "Escape":
        event.currentTarget.blur();
        return;

      case "Backspace":
      case "Delete": {
        // A stretch of words is footage; the caret is a letter. Deleting the
        // one cuts the recording, deleting the other edits a word.
        const range = selectedWords(event.currentTarget);
        if (range === null) return;
        event.preventDefault();

        const { words: current } = latest.current;
        const selection = document.getSelection();
        if (selection && selection.rangeCount > 0) {
          const before = selection.getRangeAt(0).cloneRange();
          before.collapse(true);
          caret.current = caretAt(event.currentTarget, before);
        }
        onCut({ start: current[range[0]]!.at, end: current[range[1]]!.end });
        return;
      }
    }
  };

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    // A click that places the caret also puts the playhead on the word, so
    // "what did I actually say here" is one click rather than a hunt along
    // the timeline. A drag is a selection, and is left alone.
    const selection = document.getSelection();
    if (!selection || !selection.isCollapsed) return;

    const span = (event.target as HTMLElement).closest<HTMLElement>("[data-index]");
    if (!span) return;
    const word = latest.current.words[Number(span.dataset.index)];
    if (word) onSeek(word.at);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={root}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        role="textbox"
        aria-multiline
        aria-label="Caption text"
        data-placeholder="Nothing was said."
        className={cn(
          // `select-text` because the window switches selection off at the
          // body — this is the one place in the editor that text is text.
          "flex-1 cursor-text px-4 py-3 text-[13px] leading-6 whitespace-pre-wrap outline-none select-text",
          "empty:before:text-editor-muted empty:before:content-[attr(data-placeholder)]",
          "[&_[data-live]]:text-indicator",
        )}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onClick={onClick}
        onFocus={onBeginEdit}
        onBlur={() => {
          if (reported.current === null) return;
          reported.current = null;
          onSelect(null);
        }}
        onPaste={(event) => {
          // Plain text only. Pasted markup would put elements in the block
          // that the rebuild does not know about, and the browser's own paste
          // brings styles with it.
          event.preventDefault();
          document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
        }}
      />
    </div>
  );
}

/**
 * The first and last word the selection covers, or null when it covers none.
 *
 * Null too for a caret, and for a selection anywhere but inside the editor.
 * A boundary that lands in the space between two words snaps inwards, so
 * dragging from the end of one word to the start of the next selects
 * nothing rather than the space.
 */
function selectedWords(element: HTMLElement | null): [number, number] | null {
  const selection = document.getSelection();
  if (!element || !selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const range = selection.getRangeAt(0);
  if (!element.contains(range.commonAncestorContainer)) return null;

  const first = wordBeside(element, range.startContainer, range.startOffset, "after");
  const last = wordBeside(element, range.endContainer, range.endOffset, "before");
  if (first === null || last === null || first > last) return null;

  return [first, last];
}

/**
 * The index of the word a selection boundary belongs to.
 *
 * Inside a word's span it is that word. In the space between two, or on the
 * block itself as a select-all leaves it, it is the nearest word on the side
 * the selection continues towards.
 */
function wordBeside(
  element: HTMLElement,
  node: Node,
  offset: number,
  side: "after" | "before",
): number | null {
  const span = (node instanceof HTMLElement ? node : node.parentElement)?.closest<HTMLElement>(
    "[data-index]",
  );
  if (span && element.contains(span)) {
    // The far edge of a word's own text is not in the word: a selection that
    // ends at offset 0 of the next word has not taken any of it.
    const text = node.textContent?.length ?? 0;
    if (side === "before" && offset === 0) return previousWord(span);
    if (side === "after" && node.nodeType === Node.TEXT_NODE && offset === text) {
      return nextWord(span);
    }
    return Number(span.dataset.index);
  }

  // A text node between words, or the block itself.
  let from: Node | null =
    node === element ? (element.childNodes[side === "after" ? offset : offset - 1] ?? null) : node;
  if (from === null) return side === "after" ? null : lastWord(element);

  if (side === "after") {
    while (from && !(from instanceof HTMLElement && from.dataset.index)) from = from.nextSibling;
  } else {
    while (from && !(from instanceof HTMLElement && from.dataset.index)) {
      from = from.previousSibling;
    }
  }
  return from instanceof HTMLElement ? Number(from.dataset.index) : null;
}

function previousWord(span: HTMLElement): number | null {
  const index = Number(span.dataset.index);
  return index > 0 ? index - 1 : null;
}

function nextWord(span: HTMLElement): number | null {
  const next = span.nextElementSibling as HTMLElement | null;
  return next?.dataset.index !== undefined ? Number(next.dataset.index) : null;
}

function lastWord(element: HTMLElement): number | null {
  const spans = element.querySelectorAll<HTMLElement>("[data-index]");
  const last = spans[spans.length - 1];
  return last ? Number(last.dataset.index) : null;
}

/** Where the caret is now, or null when it is not in the block. */
function caretIn(element: HTMLElement): Caret | null {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0).cloneRange();
  if (!element.contains(range.startContainer)) return null;
  range.collapse(true);
  return caretAt(element, range);
}

function caretAt(element: HTMLElement, at: Range): Caret {
  const before = document.createRange();
  before.selectNodeContents(element);
  before.setEnd(at.startContainer, at.startOffset);
  const text = before.toString();

  return {
    letters: text.replace(/\s/g, "").length,
    afterSpace: /\s$/.test(text),
  };
}

/**
 * Puts the caret back beside the letter it was at, in the rebuilt words.
 *
 * Walks the text nodes counting letters, so it lands inside the right span
 * rather than between two of them — a caret between spans types into the
 * space, and the next rebuild moves it again.
 */
function placeCaret(element: HTMLElement, caret: Caret) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let remaining = caret.letters;
  let node: Text | null = null;
  let offset = 0;

  while (walker.nextNode()) {
    node = walker.currentNode as Text;
    const text = node.data;
    offset = 0;
    for (; offset < text.length; offset += 1) {
      if (remaining === 0) break;
      if (!/\s/.test(text[offset]!)) remaining -= 1;
    }
    if (remaining === 0) {
      // Past the space too, when the caret had gone past one before.
      if (caret.afterSpace && text[offset] === " ") offset += 1;
      else if (caret.afterSpace && offset === text.length) {
        const next = walker.nextNode() as Text | null;
        if (next && next.data.startsWith(" ")) {
          node = next;
          offset = 1;
        }
      }
      break;
    }
  }
  if (!node) return;

  const selection = document.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStart(node, Math.min(offset, node.data.length));
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** The index of the word being said at `at`, or -1 between words. */
function wordUnder(words: readonly TranscriptWord[], at: MediaTime): number {
  let low = 0;
  let high = words.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const word = words[middle]!;
    if (at < word.at) high = middle - 1;
    else if (at >= word.end) low = middle + 1;
    else return middle;
  }
  return -1;
}
