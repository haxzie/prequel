/**
 * The transcript as a run of text that can be typed into.
 *
 * One editable block rather than a field per word, because correcting a
 * transcript is reading it: the eye runs along the sentence and stops at the
 * word that is wrong. A field per word would put a box around every one and
 * make adding a missed word impossible.
 *
 * The words are broken into blocks where the speaking stopped, each headed by
 * the time it starts, so a moment can be found by eye rather than by reading
 * from the top. The blocks are the recording's shape, not the caption style's —
 * see `groupWords`.
 *
 * The text and the timeline are the same thing seen twice. Selecting words
 * lights the footage they were spoken over, and cutting the selection takes
 * that footage out — which is what deleting a sentence from a recording means.
 * The words stay on screen, struck through, and the selection can be put back.
 * Retyping over a selection is the other thing, a correction, and does not cut
 * anything.
 *
 * The words are drawn imperatively. React re-rendering the children of a
 * contenteditable moves the caret to wherever the new nodes happen to leave
 * it, so the spans are rebuilt by hand whenever the words change and the caret
 * is put back where it was by counting characters.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import { isFiller } from "../../../shared/captions";
import type { MediaTime } from "../../../shared/manifest";
import { cn } from "../lib/cn";
import { formatElapsed } from "../lib/format";
import { groupWords, type EditorWord } from "./captionText";

/** A stretch of footage the words point at, and what may be done to it. */
export interface CaptionSelection {
  start: MediaTime;
  end: MediaTime;
  /** Whether any of it still plays, so there is something to cut. */
  live: boolean;
  /** Whether any of it was cut out, so there is something to put back. */
  cut: boolean;
}

/** What the editor needs from the words, and everything it can do to them. */
export interface CaptionEditing {
  /** The words the clip plays and the cut ones among them, in time order. */
  words: readonly EditorWord[];
  /** Whether the text differs from the generated transcript, so Reset has something to do. */
  edited: boolean;
  /** The footage the selected words point at, or null for none. */
  selection: CaptionSelection | null;
  /** The whole text as it now reads. */
  onEdit: (text: string) => void;
  /** Typing has paused or begun, so what follows is a new step to undo. */
  onBeginEdit: () => void;
  /** Back to the generated transcript. */
  onReset: () => void;
  onUndo: () => void;
  /** The words selected have changed. */
  onSelect: (selection: CaptionSelection | null) => void;
  /** Cut that footage out. */
  onCut: (range: { start: MediaTime; end: MediaTime }) => void;
  /** Put cut footage back. */
  onRestore: (range: { start: MediaTime; end: MediaTime }) => void;
  /** Move the playhead to where a word was said. */
  onSeek: (source: MediaTime) => void;
  /** Where a word sits in the edit, or null when its footage was cut. */
  projectAt: (source: MediaTime) => MediaTime | null;
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
 * what survives the rebuild puts the caret back beside the same letter. Cut
 * words are not counted at all — they are not text the caret moves through.
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
  projectAt,
  sourceAt,
}: CaptionEditing) {
  const root = useRef<HTMLDivElement>(null);
  /**
   * Bumped to draw the words again when the block has been typed into in a way
   * the words cannot hold — see `dirty`.
   */
  const [sweep, setSweep] = useState(0);
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
      ...groupWords(words).map((group) => {
        const block = document.createElement("div");
        block.dataset.group = "";
        // The time is drawn by a `::before` off this attribute rather than by
        // a node of its own: a node would have to be left out of the text read
        // back and out of the caret's arithmetic, and a non-editable one is
        // eaten whole by a Backspace beside it — which would lose the heading
        // with nothing changed for the rebuild to put it back.
        //
        // Taken from the first word of the block still in the edit, which is
        // not always its first word: a block that opens with a cut sentence
        // has no time of its own until the words that survived it. One that is
        // cut from end to end has no time at all and goes unheaded.
        const at = words
          .slice(group.from, group.to)
          .reduce<MediaTime | null>((found, word) => found ?? projectAt(word.at), null);
        if (at !== null) block.dataset.time = formatElapsed(at / 1_000_000);

        block.append(
          ...words.slice(group.from, group.to).flatMap((word, offset) => {
            const span = document.createElement("span");
            span.dataset.index = String(group.from + offset);
            span.textContent = word.text;
            if (word.cut) {
              // Struck through rather than gone. Editable like the rest of the
              // text on purpose, even though nothing typed into it is kept:
              // `contentEditable="false"` makes a word an atom the browser
              // selects whole, so a drag that *starts* on a cut word selects
              // that word and nothing else — and starting there is how
              // somebody picks a cut sentence to put back. `sweep` is what
              // takes any typing in one back out.
              span.dataset.cut = "";
            } else if (isFiller(word.text)) {
              // Dimmed rather than hidden: the sound was made, and a person
              // reading the transcript should see why "um" is in the text and
              // not on screen.
              span.className = "text-editor-muted";
            }
            return offset === 0 ? [span] : [document.createTextNode(" "), span];
          }),
        );
        return block;
      }),
    );

    if (caret.current !== null) {
      placeCaret(element, caret.current);
      caret.current = null;
    }
    // `sweep` is in here to be bumped, not to be read: it is how an edit the
    // words did not record asks for the block to be laid out again.
  }, [words, projectAt, sweep]);

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
      latest.current.onSelect(spanOf(latest.current.words, range));
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
    onEdit(liveText(element));
    // A keystroke that landed somewhere the words cannot record it. Nothing
    // has changed for the rebuild to follow, so it is asked for by hand — and
    // the letters go back to what was said.
    if (dirty(element, words)) setSweep((count) => count + 1);

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
      // One block of text per group, and the groups are the recording's.
      // A line break would become a `<div>` the rebuild cannot represent, and
      // a cue's line breaks are decided by the style.
      case "Enter":
        event.preventDefault();
        return;

      case "Escape":
        event.currentTarget.blur();
        return;

      case "Backspace":
      case "Delete": {
        // A stretch of words is footage; the caret is a letter. Cutting the
        // one takes the recording out, deleting the other edits a word.
        const range = selectedWords(event.currentTarget);
        if (range === null) return;
        event.preventDefault();

        const span = spanOf(latest.current.words, range);
        // Nothing left to cut: the selection is words that were cut already.
        // Prevented rather than passed on, because the browser would delete
        // the letters of them and the words would not change to say so.
        if (!span.live) return;

        const selection = document.getSelection();
        if (selection && selection.rangeCount > 0) {
          const before = selection.getRangeAt(0).cloneRange();
          before.collapse(true);
          caret.current = caretAt(event.currentTarget, before);
        }
        onCut({ start: span.start, end: span.end });
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
          // The time over each block, drawn from the attribute rather than
          // from a node of its own — see the rebuild.
          "[&_[data-time]]:before:mb-0.5 [&_[data-time]]:before:block",
          "[&_[data-time]]:before:text-[10px] [&_[data-time]]:before:leading-none",
          "[&_[data-time]]:before:text-editor-muted [&_[data-time]]:before:tabular-nums",
          "[&_[data-time]]:before:content-[attr(data-time)]",
          "[&_[data-group]+[data-group]]:mt-3",
          // Cut, and said anyway. Muted as well as struck: the line alone
          // reads as emphasis at this size.
          "[&_[data-cut]]:text-editor-muted [&_[data-cut]]:line-through",
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

/** The footage a range of words points at, and what may be done to it. */
function spanOf(words: readonly EditorWord[], [first, last]: [number, number]): CaptionSelection {
  const covered = words.slice(first, last + 1);

  return {
    start: words[first]!.at,
    end: words[last]!.end,
    live: covered.some((word) => !word.cut),
    cut: covered.some((word) => word.cut),
  };
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
 * Inside a word's span it is that word. In the space between two, in a block's
 * own box, or on the editor itself as a select-all leaves it, it is the nearest
 * word on the side the selection continues towards — found by document
 * position rather than by walking siblings, because the next word may be the
 * first of the next block rather than a sibling of this one.
 */
function wordBeside(
  element: HTMLElement,
  node: Node,
  offset: number,
  side: "after" | "before",
): number | null {
  const spans = [...element.querySelectorAll<HTMLElement>("[data-index]")];
  const span = (node instanceof HTMLElement ? node : node.parentElement)?.closest<HTMLElement>(
    "[data-index]",
  );
  if (span && element.contains(span)) {
    const index = Number(span.dataset.index);
    // The far edge of a word's own text is not in the word: a selection that
    // ends at offset 0 of the next word has not taken any of it.
    const text = node.textContent?.length ?? 0;
    if (side === "before" && offset === 0) return index > 0 ? index - 1 : null;
    if (side === "after" && node.nodeType === Node.TEXT_NODE && offset === text) {
      return index + 1 < spans.length ? index + 1 : null;
    }
    return index;
  }

  const at = document.createRange();
  at.setStart(node, offset);
  at.collapse(true);

  if (side === "after") {
    const found = spans.find((candidate) => at.comparePoint(candidate, 0) >= 0);
    return found ? Number(found.dataset.index) : null;
  }
  const found = spans.findLast(
    (candidate) => at.comparePoint(candidate, candidate.childNodes.length) <= 0,
  );
  return found ? Number(found.dataset.index) : null;
}

/**
 * Whether the block holds letters the words cannot hold.
 *
 * A cut word is text like any other to the browser, so it can be typed into or
 * backspaced away — and because nothing in it is read back, the words would
 * not change and nothing would put it back. Counting the spans catches the
 * second case: a word deleted whole takes its span with it.
 */
function dirty(element: HTMLElement, words: readonly EditorWord[]): boolean {
  const spans = element.querySelectorAll<HTMLElement>("[data-index]");
  if (spans.length !== words.length) return true;

  return [...spans].some((span) => {
    const word = words[Number(span.dataset.index)];
    return word?.cut === true && span.textContent !== word.text;
  });
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
  const text = liveText(element, at);

  return {
    letters: text.replace(/\s/g, "").length,
    afterSpace: /\s$/.test(text),
  };
}

/**
 * The text nodes the words are typed into — the cut ones left out.
 *
 * `FILTER_REJECT` on a text node is `FILTER_SKIP`: it has no children to
 * prune, so the two are the same here and the cut word's letters simply never
 * arrive.
 */
function liveNodes(element: HTMLElement): TreeWalker {
  return document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest("[data-cut]")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
}

/**
 * The words as one run of text, as the editor now reads them.
 *
 * `textContent` would do it if the editor held nothing but the words it plays.
 * It holds the cut ones too, and those are not text any more — reading them
 * back would time the cut footage into the edit as a correction. Each block
 * boundary contributes a space, because the break between two blocks is a word
 * boundary that no text node holds.
 *
 * With `upTo`, only the text before that point — which is how the caret is
 * counted, against exactly the letters the rebuild will lay back out.
 */
function liveText(element: HTMLElement, upTo?: Range): string {
  const walker = liveNodes(element);
  let out = "";
  let block: Element | null = null;
  let started = false;

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const group = node.parentElement?.closest("[data-group]") ?? null;
    if (started && group !== block) out += " ";
    started = true;
    block = group;

    if (upTo) {
      if (node === upTo.startContainer) return out + node.data.slice(0, upTo.startOffset);
      if (upTo.comparePoint(node, 0) === 1) return out;
    }
    out += node.data;
  }

  return out;
}

/**
 * Puts the caret back beside the letter it was at, in the rebuilt words.
 *
 * Walks the text nodes counting letters, so it lands inside the right span
 * rather than between two of them — a caret between spans types into the
 * space, and the next rebuild moves it again.
 */
function placeCaret(element: HTMLElement, caret: Caret) {
  const walker = liveNodes(element);
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
      // Past the space too, when the caret had gone past one before. A block
      // boundary has no space to step over — the caret is already at the start
      // of the next word, which is where it was.
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
function wordUnder(words: readonly EditorWord[], at: MediaTime): number {
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
