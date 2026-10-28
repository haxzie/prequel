"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";

import { useSession } from "@/lib/auth-client";

import { ChapterList } from "./ChapterList";
import { useConversation } from "./conversation";
import { Player, type PlayerHandle } from "./Player";
import { Reactions } from "./Reactions";
import { SidePanel } from "./SidePanel";
import { SignInDialog } from "./SignInDialog";
import type { Chapter } from "./time";

/** A chapter as the API sends it: milliseconds, the row's unit. */
export interface ApiChapter {
  at: number;
  title: string;
}

/**
 * A recording, its chapters, and whatever the page puts under it.
 *
 * The one client component the two watch pages render, because the player and
 * everything beside it share state — which chapter is playing, where a click in
 * the panel sends the video, and where the playhead is when somebody presses an
 * emoji — and the page itself is a server component that cannot hold any of it.
 * `children` is the page's own block under the picture: the title on the share
 * page, the link and the facts in the dashboard.
 *
 * With `slug`, the column beside the video is the comments and the chapters as
 * tabs, and the row of emoji sits under the picture. Without it — the dashboard
 * — the page is what it was: the video, the children, and a chapter list where
 * there are chapters.
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
  /**
   * The share link's slug, which is what the conversation hangs off.
   *
   * Absent means no panel and no reactions. The endpoints are public reads
   * keyed by slug — see `apps/api/src/routes/conversation.ts` — so this is the
   * only thing the page needs to hand over to have one.
   */
  slug,
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
  slug?: string;
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

  // An image is not a recording: no player, no playhead, and nothing for a
  // reaction to be pinned to. The conversation is asked for anyway, because a
  // screenshot shares through the same route and is as worth commenting on as
  // anything else — it is only the emoji row that has no meaning here.
  const isImage = contentType.startsWith("image/");

  const talk = useConversation(slug ?? null);
  const { data: session } = useSession();
  const signedIn = Boolean(session?.user);
  /** What the sign-in dialog says somebody was trying to do, or null when it is shut. */
  const [signIn, setSignIn] = useState<string | null>(null);

  const duration = durationMs / 1000;

  const column = (
    // As wide as the page allows, and no taller than most of the viewport —
    // enforced as a *width*, worked back from the file's own proportions, so the
    // box shrinks to fit rather than letterboxing the picture inside a wider one.
    // A tall recording therefore sits centred in a narrow box, not in a black
    // band the width of the page. The title under it is held to the same width,
    // so the two stay aligned when the cap is what decides.
    <div
      className="mx-auto w-full min-w-0"
      style={{ maxWidth: `calc(75dvh * ${(frame.width / frame.height).toFixed(4)})` }}
    >
      <div className="overflow-hidden rounded-2xl border border-line bg-black">
        {isImage ? (
          // A picture is not a video, and a `<video>` pointed at one shows
          // nothing at all — no error, just a black rectangle with controls.
          // Any image, not the GIF alone: a screenshot shares as a PNG through
          // the same route, and the player has nothing to offer either of them.
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
            reactions={talk.data?.reactions}
            captions={captions}
            onChapter={setActive}
            onFrame={(w, h) => setMeasured({ width: w, height: h })}
          />
        )}
      </div>

      {/* The page's own block and the emoji row, on one line where there is
          room for both. The row is on the right because it is a control and
          the block on the left is a caption: a palette directly under the
          title reads as part of it. */}
      <div className="flex flex-col gap-y-2 sm:flex-row sm:items-start sm:justify-between sm:gap-x-6">
        <div className="min-w-0 sm:flex-1">{children}</div>
        {talk.data && !isImage && (
          <div className="shrink-0 sm:mt-6">
            <Reactions
              palette={talk.data.palette}
              signedIn={signedIn}
              at={() => player.current?.time() ?? 0}
              onReact={talk.react}
              onNeedsSignIn={() => setSignIn("react")}
            />
          </div>
        )}
      </div>
    </div>
  );

  const dialog = (
    <SignInDialog
      open={signIn !== null}
      reason={signIn ?? "comment"}
      onClose={() => setSignIn(null)}
    />
  );

  // The panel, which is the conversation where there is one and the chapters
  // where there is not. Built here rather than in two branches below so the
  // narrow and wide layouts cannot drift apart.
  const aside = slug ? (
    <SidePanel
      comments={talk.data?.comments ?? []}
      loading={talk.loading}
      signedIn={signedIn}
      chapters={chapters}
      duration={duration}
      activeChapter={active}
      onSelectChapter={(index) => player.current?.seek(chapters[index]!.at)}
      onComment={talk.comment}
      onDeleteComment={talk.removeComment}
      onNeedsSignIn={() => setSignIn("comment")}
    />
  ) : chapters.length > 0 && !isImage ? (
    <ChapterList
      chapters={chapters}
      duration={duration}
      active={active}
      onSelect={(index) => player.current?.seek(chapters[index]!.at)}
    />
  ) : null;

  if (!aside) return column;

  if (panel === "below") {
    return (
      <>
        {column}
        <div className="mt-8 border-t border-line pt-6">{aside}</div>
        {dialog}
      </>
    );
  }

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-x-8">
      {column}
      {/* Beside the picture and everything under it, and pinned as the page
          scrolls, so a long recording's contents stay where the eye left
          them. `top-20` clears the site bar.

          The column is the height of the viewport rather than of its contents,
          which is what puts the comment box on the floor of the panel and keeps
          it there however few comments there are. The list scrolls inside the
          space above it. */}
      <div className="mt-8 border-t border-line pt-6 lg:mt-0 lg:border-t-0 lg:pt-0">
        <div className="lg:sticky lg:top-20 lg:flex lg:h-[calc(100dvh-6rem)] lg:flex-col">
          {aside}
        </div>
      </div>
      {dialog}
    </div>
  );
}
