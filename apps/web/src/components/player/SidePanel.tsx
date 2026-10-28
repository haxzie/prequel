"use client";

import { useState } from "react";

import { ChapterList } from "./ChapterList";
import { Comments } from "./Comments";
import type { Comment } from "./conversation";
import type { Chapter } from "./time";

type Tab = "comments" | "chapters";

/**
 * What sits beside the video.
 *
 * Two things want the same column — what the recording is made of, and what
 * people said about it — and neither is worth a scroll past the other. Tabs
 * rather than two stacked panels for that reason: on a wide screen this column
 * is as tall as the picture, and anything below the fold here is below the fold
 * for good.
 *
 * Comments is the default even when there are chapters. The chapters are also
 * on the scrub bar, where they are read while watching; the comments are only
 * here.
 */
export function SidePanel({
  comments,
  loading,
  signedIn,
  chapters,
  duration,
  activeChapter,
  onSelectChapter,
  onComment,
  onDeleteComment,
  onNeedsSignIn,
}: {
  comments: Comment[];
  loading: boolean;
  signedIn: boolean;
  chapters: readonly Chapter[];
  /** Seconds, for the chapter timecodes. */
  duration: number;
  activeChapter: number;
  onSelectChapter: (index: number) => void;
  onComment: (body: string) => Promise<void>;
  onDeleteComment: (id: string) => Promise<void>;
  onNeedsSignIn: () => void;
}) {
  const [tab, setTab] = useState<Tab>("comments");

  // A recording with no chapters has no tab for them — an empty tab is a
  // promise of something that is not coming. With only one tab the strip is
  // still drawn, so the panel does not change shape between recordings.
  const hasChapters = chapters.length > 0;
  const showing: Tab = tab === "chapters" && !hasChapters ? "comments" : tab;

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="About this recording">
      <div role="tablist" className="flex shrink-0 items-center gap-1 border-b border-line pb-2">
        <TabButton
          id="comments"
          label="Comments"
          count={comments.length}
          active={showing === "comments"}
          onSelect={setTab}
        />
        {hasChapters && (
          <TabButton
            id="chapters"
            label="Chapters"
            count={chapters.length}
            active={showing === "chapters"}
            onSelect={setTab}
          />
        )}
      </div>

      <div
        role="tabpanel"
        id={`panel-${showing}`}
        aria-labelledby={`tab-${showing}`}
        className="flex min-h-0 flex-1 flex-col pt-4"
      >
        {showing === "comments" ? (
          <Comments
            comments={comments}
            loading={loading}
            signedIn={signedIn}
            onComment={onComment}
            onDelete={onDeleteComment}
            onNeedsSignIn={onNeedsSignIn}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ChapterList
              chapters={chapters}
              duration={duration}
              active={activeChapter}
              onSelect={onSelectChapter}
              // The heading is the tab now; a second "Chapters" above the list
              // is the same word twice in two centimetres.
              className="[&>h2]:sr-only"
            />
          </div>
        )}
      </div>
    </section>
  );
}

function TabButton({
  id,
  label,
  count,
  active,
  onSelect,
}: {
  id: Tab;
  label: string;
  count: number;
  active: boolean;
  onSelect: (tab: Tab) => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`tab-${id}`}
      aria-selected={active}
      aria-controls={`panel-${id}`}
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
        active ? "bg-surface font-medium text-fg" : "text-muted hover:bg-surface/60 hover:text-fg"
      }`}
      onClick={() => onSelect(id)}
    >
      {label}
      {count > 0 && (
        <span className="rounded-full bg-elevated px-1.5 py-px font-mono text-[10px] tabular-nums text-muted">
          {count}
        </span>
      )}
    </button>
  );
}
