/**
 * The little markdown a comment is allowed to be.
 *
 * Hand-written, and deliberately: a comment is typed by a stranger and drawn on
 * a page other strangers open, so the one property that matters is that nothing
 * in it can become markup. Every parser in reach emits an HTML string, which
 * then needs `dangerouslySetInnerHTML` and a sanitiser beside it — two
 * dependencies and a standing bet that the sanitiser's idea of safe and the
 * parser's idea of valid never drift apart.
 *
 * This emits React elements instead. Text is text because React escapes it on
 * the way into the DOM, so there is no sanitiser to keep in step and no
 * configuration that can be got wrong. A `<script>` somebody types is a
 * `<script>` somebody reads.
 *
 * What is supported is what the composer's buttons write and nothing else:
 * bold, italic, strikethrough, inline code, fenced code, bullet lists, links
 * and emoji. No images, no tables, no raw HTML, no headings — a comment under a
 * recording is a paragraph, and the rest is surface nobody asked for.
 */
import { Fragment, type ReactNode } from "react";

import { EMOJI } from "./emoji";

/** Renders a comment body. */
export function Markdown({ source, className = "" }: { source: string; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 text-sm leading-relaxed break-words ${className}`}>
      {blocks(source)}
    </div>
  );
}

/**
 * Paragraphs, lists and fenced code, in the order they were typed.
 *
 * Fences are found first and by line, not by regex over the whole body: a
 * backtick inside a code block must not be able to close something it is
 * nowhere near, and an unclosed fence has to run to the end of the comment
 * rather than swallow the rest of the panel's markup.
 */
function blocks(source: string): ReactNode[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const out: ReactNode[] = [];

  let paragraph: string[] = [];
  let bullets: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(<p key={`p${out.length}`}>{inline(paragraph.join("\n"))}</p>);
    paragraph = [];
  };

  const flushBullets = () => {
    if (bullets.length === 0) return;
    out.push(
      <ul key={`u${out.length}`} className="ml-4 list-disc marker:text-muted/60">
        {bullets.map((item, index) => (
          <li key={index}>{inline(item)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const fence = /^\s*```(\w+)?\s*$/.exec(line);

    if (fence) {
      flushParagraph();
      flushBullets();

      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index]!)) {
        body.push(lines[index]!);
        index += 1;
      }
      out.push(<Code key={`c${out.length}`} source={body.join("\n")} />);
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      bullets.push(bullet[1]!);
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      flushBullets();
      continue;
    }

    flushBullets();
    paragraph.push(line);
  }

  flushParagraph();
  flushBullets();

  return out;
}

/**
 * The spans inside a line.
 *
 * One alternation rather than a pass per mark, so the *first* thing that
 * matches wins and the order in the pattern is the precedence. Code comes
 * first and for a reason: `**bold**` inside backticks is two asterisks and a
 * word, and any order that lets emphasis run first would eat it.
 */
const INLINE =
  /(`[^`\n]+`)|(\*\*[\s\S]+?\*\*)|(~~[\s\S]+?~~)|(\*[^*\n]+\*|\b_[^_\n]+_\b)|(https?:\/\/[^\s<>()[\]]+)|(:[a-z0-9_+-]+:)/gi;

function inline(source: string, depth = 0): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;

  // Bounded, because bold renders its contents through here again. Six is
  // past anything a person types and stops a pathological body from being a
  // way to spend the renderer's stack.
  if (depth > 6) return source;

  for (const match of source.matchAll(INLINE)) {
    const [whole, code, bold, strike, italic, link, shortcode] = match;
    const at = match.index;

    if (at > last) out.push(text(source.slice(last, at), out.length));
    last = at + whole.length;

    if (code) {
      out.push(
        <code
          key={out.length}
          className="rounded bg-surface px-1 py-0.5 font-mono text-[0.85em] text-fg"
        >
          {code.slice(1, -1)}
        </code>,
      );
    } else if (bold) {
      out.push(
        <strong key={out.length} className="font-semibold text-fg">
          {inline(bold.slice(2, -2), depth + 1)}
        </strong>,
      );
    } else if (strike) {
      out.push(
        <s key={out.length} className="text-muted">
          {inline(strike.slice(2, -2), depth + 1)}
        </s>,
      );
    } else if (italic) {
      out.push(<em key={out.length}>{inline(italic.slice(1, -1), depth + 1)}</em>);
    } else if (link) {
      // `noopener` because a tab opened from here can otherwise steer this one
      // through `window.opener`, and `nofollow` because a comment box on a
      // public page is a link farm the moment it is worth one.
      out.push(
        <a
          key={out.length}
          href={link}
          target="_blank"
          rel="nofollow noopener noreferrer"
          className="text-accent underline underline-offset-2 hover:no-underline"
        >
          {link.replace(/^https?:\/\//, "")}
        </a>,
      );
    } else if (shortcode) {
      const emoji = EMOJI[shortcode.slice(1, -1).toLowerCase()];
      out.push(emoji ? <Fragment key={out.length}>{emoji}</Fragment> : shortcode);
    }
  }

  if (last < source.length) out.push(text(source.slice(last), out.length));

  return out;
}

/**
 * Plain text, with single newlines kept.
 *
 * A comment is typed in a textarea where return means a new line, not the start
 * of a paragraph — markdown's own rule, that a lone newline is whitespace,
 * surprises everybody who has ever used a chat window.
 */
function text(value: string, key: number): ReactNode {
  const parts = value.split("\n");
  if (parts.length === 1) return <Fragment key={key}>{value}</Fragment>;

  return (
    <Fragment key={key}>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && <br />}
          {part}
        </Fragment>
      ))}
    </Fragment>
  );
}

function Code({ source }: { source: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-line bg-surface p-3 font-mono text-xs leading-relaxed">
      <code>{highlight(source)}</code>
    </pre>
  );
}

/**
 * Colour for a code block, without knowing the language.
 *
 * A comment under a recording carries a line of config or a stack trace, not a
 * file, and nothing in the body says what language it is — so this colours what
 * every language agrees on: comments, strings, numbers, and the keywords the
 * C-descended languages share. A real highlighter is a megabyte of grammars for
 * a panel this size.
 *
 * Strings and comments are matched in the same pass as the rest for the reason
 * `INLINE` above is one alternation: a `//` inside a string is not a comment,
 * and only one pass over the text can know that.
 */
const TOKENS =
  /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|('[^'\n]*'|"[^"\n]*"|`[^`]*`)|(\b\d[\d_.]*\b)|(\b(?:const|let|var|function|return|if|else|for|while|import|from|export|class|new|await|async|try|catch|throw|type|interface|def|fn|pub|struct|impl|match|null|undefined|true|false)\b)/g;

function highlight(source: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;

  for (const match of source.matchAll(TOKENS)) {
    const [whole, comment, string, number, keyword] = match;
    const at = match.index;

    if (at > last) out.push(source.slice(last, at));
    last = at + whole.length;

    const className = comment
      ? "text-muted/70 italic"
      : string
        ? "text-positive"
        : number
          ? "text-brand-from"
          : "text-accent";

    out.push(
      <span key={out.length} className={className}>
        {comment ?? string ?? number ?? keyword}
      </span>,
    );
  }

  if (last < source.length) out.push(source.slice(last));

  return out;
}
