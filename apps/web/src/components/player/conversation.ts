"use client";

/**
 * The share page's side of `/p/:slug/conversation`.
 *
 * One hook holding one object, because the two halves of the answer are drawn
 * in two places that must agree: the panel lists the comments, the scrub bar
 * draws the reactions, and both are written by the same press. Splitting them
 * into two states is how a reaction comes to sit on the bar and not in the
 * count beside it.
 *
 * Fetched from the browser rather than rendered on the server. The page's first
 * job is the video, and a stranger's session has to be asked for over the
 * network — putting that in front of the first frame buys a comment list
 * nobody has scrolled to yet.
 */
import { useCallback, useEffect, useState } from "react";

import { api, ApiError } from "@/lib/api";

export interface Author {
  name: string;
  /** For the marble. A hash the API makes — never an address. */
  seed: string;
  image: string | null;
}

export interface Comment {
  id: string;
  /** Null for one that was taken back. The row keeps its place; see the API. */
  body: string | null;
  createdAt: string;
  author: Author | null;
  mine: boolean;
}

export interface Reaction {
  id: string;
  emoji: string;
  /** Milliseconds into the recording. */
  atMs: number;
  by: string;
  mine: boolean;
}

export interface Conversation {
  /** The emoji the API will accept, in the order to draw them. */
  palette: string[];
  comments: Comment[];
  reactions: Reaction[];
}

export interface ConversationState {
  data: Conversation | null;
  /** The first load only. A post does not blank the panel. */
  loading: boolean;
  error: string | null;
  comment(body: string): Promise<void>;
  removeComment(id: string): Promise<void>;
  react(emoji: string, atMs: number): Promise<void>;
  unreact(id: string): Promise<void>;
}

/**
 * Everything said about one recording.
 *
 * Writes go to the API and the answer is merged into what is held here — no
 * refetch after a post. Partly for the round-trip, mostly because a refetch
 * would reorder a list somebody is reading and move the comment they just
 * wrote out from under their eye.
 */
export function useConversation(slug: string | null): ConversationState {
  const [data, setData] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Null on every surface that shows the player without a conversation under
    // it — the dashboard, the free tools. The hook is still called, because a
    // hook called in one branch and not the other is not a hook.
    if (!slug) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    api<Conversation>(`/p/${slug}/conversation`)
      .then((answer) => {
        if (!cancelled) setData(answer);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(message(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const comment = useCallback(
    async (body: string) => {
      const created = await api<Comment>(`/p/${slug}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });

      setData((current) =>
        current ? { ...current, comments: [...current.comments, created] } : current,
      );
    },
    [slug],
  );

  const removeComment = useCallback(
    async (id: string) => {
      await api(`/p/${slug}/comments/${id}`, { method: "DELETE" });

      // Emptied in place rather than dropped, which is what the API did to the
      // row — the gap is the point. See `videoComment.deletedAt`.
      setData((current) =>
        current
          ? {
              ...current,
              comments: current.comments.map((row) =>
                row.id === id ? { ...row, body: null, author: null, mine: false } : row,
              ),
            }
          : current,
      );
    },
    [slug],
  );

  const react = useCallback(
    async (emoji: string, atMs: number) => {
      const created = await api<Reaction>(`/p/${slug}/reactions`, {
        method: "POST",
        body: JSON.stringify({ emoji, atMs: Math.round(atMs) }),
      });

      // Kept in timeline order, because the bar draws them in the order it is
      // handed them and a mark appearing out of order is a mark that overlaps
      // the wrong neighbour.
      setData((current) =>
        current
          ? {
              ...current,
              reactions: [...current.reactions, created].sort((a, b) => a.atMs - b.atMs),
            }
          : current,
      );
    },
    [slug],
  );

  const unreact = useCallback(
    async (id: string) => {
      await api(`/p/${slug}/reactions/${id}`, { method: "DELETE" });
      setData((current) =>
        current
          ? { ...current, reactions: current.reactions.filter((row) => row.id !== id) }
          : current,
      );
    },
    [slug],
  );

  return { data, loading, error, comment, removeComment, react, unreact };
}

/** Whether a failed write was simply "you are not signed in". */
export function needsSignIn(cause: unknown): boolean {
  return cause instanceof ApiError && cause.status === 401;
}

export function message(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : "Something went wrong.";
}
