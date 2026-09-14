"use client";

import { useEffect, useRef } from "react";

import { formatTime, type Chapter } from "./time";

/**
 * The table of contents, beside the player.
 *
 * The bar shows *that* the recording has parts; this says what they are, all
 * at once, which is what somebody sent a twenty-minute link is looking for
 * before they press play. The one playing is marked and kept in view, so the
 * list reads as a position as well as a menu.
 */
export function ChapterList({
  chapters,
  duration,
  active,
  onSelect,
  className = "",
}: {
  chapters: readonly Chapter[];
  /** In seconds, for the timecode's shape and the last chapter's length. */
  duration: number;
  /** The chapter playing, or -1. */
  active: number;
  onSelect: (index: number) => void;
  className?: string;
}) {
  const list = useRef<HTMLOListElement>(null);

  // Kept in view as playback moves through it. `nearest` rather than
  // `center` so a list that fits is never scrolled at all, and the page does
  // not jump because a chapter changed off screen.
  useEffect(() => {
    if (active < 0) return;
    const item = list.current?.children[active];
    if (item instanceof HTMLElement) item.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <nav aria-label="Chapters" className={`min-w-0 ${className}`}>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
        Chapters
        <span className="ml-1.5 font-normal normal-case tracking-normal text-muted/70">
          {chapters.length}
        </span>
      </h2>
      <ol ref={list} className="flex flex-col gap-0.5">
        {chapters.map((chapter, index) => {
          const current = index === active;
          return (
            <li key={chapter.at}>
              <button
                type="button"
                aria-current={current ? "true" : undefined}
                className={`flex w-full items-baseline gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  current ? "bg-surface text-fg" : "text-muted hover:bg-surface/70 hover:text-fg"
                }`}
                onClick={() => onSelect(index)}
              >
                <span
                  className={`w-11 flex-none font-mono text-xs tabular-nums ${
                    current ? "text-accent" : "text-muted/70"
                  }`}
                >
                  {formatTime(chapter.at, duration)}
                </span>
                <span className="min-w-0 flex-1 leading-snug">{chapter.title}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
