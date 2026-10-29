"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";

import { Avatar } from "@/components/dashboard/Avatar";

import { Composer } from "./Composer";
import { message, needsSignIn, type Comment } from "./conversation";
import { Markdown } from "./markdown";

/**
 * The thread under a recording.
 *
 * Oldest first, the way a conversation is read, with the box under it — so the
 * newest comment and the place to answer it are next to each other and neither
 * moves when one is added.
 */
export function Comments({
  comments,
  loading,
  signedIn,
  onComment,
  onDelete,
  onNeedsSignIn,
}: {
  comments: Comment[];
  loading: boolean;
  signedIn: boolean;
  onComment: (body: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** A write came back 401, or somebody pressed the box while signed out. */
  onNeedsSignIn: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (body: string) => {
    setBusy(true);
    setError(null);

    try {
      await onComment(body);
    } catch (cause) {
      // A session can expire between the page loading and the comment being
      // written, so the 401 is handled where it happens rather than only at
      // the button — otherwise a comment typed by somebody signed out this
      // morning fails with a message about nothing.
      if (needsSignIn(cause)) onNeedsSignIn();
      else setError(message(cause));

      // Rethrown so the composer keeps what was typed.
      throw cause;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="py-6 text-center text-sm text-muted">Loading comments…</p>
        ) : comments.length === 0 ? (
          <p className="py-6 text-center text-sm leading-relaxed text-muted">
            No comments yet.
            <br />
            Say what you think of it.
          </p>
        ) : (
          <ol className="flex flex-col gap-4">
            {comments.map((comment) => (
              <li key={comment.id} className="flex gap-2.5">
                {comment.author ? (
                  <Avatar
                    seed={comment.author.seed}
                    image={comment.author.image}
                    size={28}
                    className="mt-0.5"
                  />
                ) : (
                  <span className="mt-0.5 size-7 shrink-0 rounded-full bg-surface" />
                )}

                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-fg">
                      {comment.author?.name ?? "Someone"}
                    </span>
                    <time
                      dateTime={comment.createdAt}
                      className="shrink-0 text-xs text-muted"
                      title={new Date(comment.createdAt).toLocaleString()}
                    >
                      {ago(comment.createdAt)}
                    </time>
                    {comment.mine && (
                      <button
                        type="button"
                        aria-label="Delete comment"
                        title="Delete comment"
                        className="ml-auto shrink-0 text-muted transition-colors hover:text-negative"
                        onClick={() => void onDelete(comment.id).catch(() => undefined)}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </p>

                  {comment.body === null ? (
                    <p className="mt-0.5 text-sm italic text-muted">This comment was deleted.</p>
                  ) : (
                    <Markdown source={comment.body} className="mt-0.5 text-fg/90" />
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Where the box goes, which is not the same answer on both layouts.
          Last in the source, because that is the order a screen reader and the
          keyboard should take: read the thread, then answer it.

          In the side panel it is pinned to the foot of the column the list
          scrolls inside. A comment box that scrolls away is one nobody finds
          at the end of a long thread, which is exactly where somebody has just
          finished reading.

          Under the video it comes first instead. The whole page scrolls there,
          so a box at the end of the thread is below however many comments
          there are — several screens down on a recording people have talked
          about — and a reader arriving at the video has to scroll past all of
          it to find the one thing they came to do. */}
      <div className="order-first shrink-0 bg-bg pb-3 lg:order-none lg:sticky lg:bottom-0 lg:z-10 lg:pt-2 lg:pb-0">
        {signedIn ? (
          <Composer busy={busy} onSubmit={submit} />
        ) : (
          // A line of text with a button on the end of it, in the box the
          // composer will be. Nothing to type into until somebody is signed
          // in — they cannot be told afterwards that what they wrote is being
          // thrown away — and the whole row used to *be* the button, which
          // read as a text field somebody had disabled.
          //
          // The same pill the composer's own Send wears, in the same corner,
          // so the thing that replaces this is already drawn here.
          <div className="flex items-center gap-3 rounded-xl border border-line bg-bg px-3 py-2.5">
            <p className="text-sm text-muted">Sign in to leave a comment</p>
            <button
              type="button"
              className="ml-auto h-8 shrink-0 rounded-full bg-fg px-4 text-xs font-medium text-bg transition-opacity hover:opacity-90"
              onClick={onNeedsSignIn}
            >
              Sign in
            </button>
          </div>
        )}

        {error && (
          <p className="mt-2 text-xs text-negative" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * "4m", "2h", "3d" — and the date once it is older than a week.
 *
 * Rendered in the browser only; this component mounts there. A relative time
 * computed on the server and hydrated on the client is a mismatch React reports
 * as an error whenever the two straddle a minute boundary, which is most of
 * them.
 */
function ago(iso: string): string {
  const seconds = Math.max((Date.now() - new Date(iso).getTime()) / 1000, 0);

  if (seconds < 60) return "just now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d`;

  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
