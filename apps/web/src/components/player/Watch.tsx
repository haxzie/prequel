"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";

import { ChapterList } from "./ChapterList";
import { Player, type PlayerHandle } from "./Player";
import type { Chapter } from "./time";

/** A chapter as the API sends it: milliseconds, the row's unit. */
export interface ApiChapter {
  at: number;
  title: string;
}

/**
 * A recording, its chapters, and whatever the page puts under it.
 *
 * The one client component the two watch pages render, because the player
 * and the list share state — which chapter is playing, and where a click on
 * the list sends the video — and the page itself is a server component that
 * cannot hold either. `children` is the page's own block under the picture:
 * the title on the share page, the link and the facts in the dashboard.
 *
 * With chapters, the list sits beside the video on a wide screen and under
 * the children on a narrow one. Without, the page is exactly what it was
 * before there were chapters: the video, then the children.
 */
export function Watch({
  src,
  poster,
  title,
  durationMs,
  width,
  height,
  contentType,
  chapters: raw,
  captions,
  /** Beside the video where there is room, or always under it. */
  panel = "side",
  children,
}: {
  src: string;
  poster: string | null;
  title: string;
  durationMs: number;
  /** The file's frame, or zero for a row that never recorded it. */
  width: number;
  height: number;
  contentType: string;
  chapters: readonly ApiChapter[];
  /** The subtitle track, when the recording was transcribed. */
  captions: { src: string; language: string } | null;
  panel?: "side" | "below";
  children?: ReactNode;
}) {
  const player = useRef<PlayerHandle>(null);
  const [active, setActive] = useState(-1);
  /**
   * The frame as the file reports it, for a row that never recorded one.
   *
   * `width` and `height` default to zero on the row, and a recording shared
   * before they were sent would otherwise sit in a 16:9 box for good — a
   * portrait one letterboxed between two black bands. The row's figures win
   * when they exist, because they are known before a byte has loaded.
   */
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  const frame =
    width > 0 && height > 0 ? { width, height } : (measured ?? { width: 16, height: 9 });

  const chapters = useMemo<Chapter[]>(
    () => raw.map((chapter) => ({ at: chapter.at / 1000, title: chapter.title })),
    [raw],
  );

  // As wide as the page allows, and no taller than most of the viewport —
  // enforced as a *width*, worked back from the file's own proportions, so the
  // box shrinks to fit rather than letterboxing the picture inside a wider one.
  // A tall recording therefore sits centred in a narrow box, not in a black
  // band the width of the page. The title under it is held to the same width,
  // so the two stay aligned when the cap is what decides.
  const ratio = frame.width / frame.height;
  const column = (
    <div
      className="mx-auto w-full min-w-0"
      style={{ maxWidth: `calc(75dvh * ${ratio.toFixed(4)})` }}
    >
      <div className="overflow-hidden rounded-2xl border border-line bg-black">
        {contentType === "image/gif" ? (
          // A GIF is not a video and a `<video>` pointed at one shows nothing at
          // all — no error, just a black rectangle with controls.
          <img src={src} alt={title} className="block w-full" />
        ) : (
          <Player
            ref={player}
            src={src}
            poster={poster}
            title={title}
            durationMs={durationMs}
            width={frame.width}
            height={frame.height}
            chapters={chapters}
            captions={captions}
            onChapter={setActive}
            onFrame={(w, h) => setMeasured({ width: w, height: h })}
          />
        )}
      </div>
      {children}
    </div>
  );

  if (chapters.length === 0 || contentType === "image/gif") return column;

  const list = (
    <ChapterList
      chapters={chapters}
      duration={durationMs / 1000}
      active={active}
      onSelect={(index) => player.current?.seek(chapters[index]!.at)}
    />
  );

  if (panel === "below") {
    return (
      <>
        {column}
        <div className="mt-8 border-t border-line pt-6">{list}</div>
      </>
    );
  }

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-x-8">
      {column}
      {/* Beside the picture and everything under it, and pinned as the page
          scrolls, so a long recording's contents stay where the eye left
          them. `top-20` clears the site bar. */}
      <div className="mt-8 border-t border-line pt-6 lg:mt-0 lg:border-t-0 lg:pt-0">
        <div className="lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto">
          {list}
        </div>
      </div>
    </div>
  );
}
