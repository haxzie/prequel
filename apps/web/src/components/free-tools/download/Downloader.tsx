"use client";

/**
 * The X video tool: paste a link, pick a size, get the file.
 *
 * The download happens in this tab, against `video.twimg.com`, and that is the
 * whole architecture. Our Worker is asked for the post's metadata — a few
 * hundred bytes of JSON naming the files X is already serving — and the browser
 * then fetches the chosen file from X directly, which it is allowed to do
 * because `video.twimg.com` answers `access-control-allow-origin: *`.
 *
 * Routing the video through the Worker instead would be one line shorter and
 * wrong twice: it would put somebody else's video on our egress, which is the
 * case Cloudflare's terms single out, and it would make every download twice as
 * slow for no gain a visitor can see.
 *
 * The cost of doing it this way is that the bytes are assembled in memory before
 * they are saved, because a cross-origin URL cannot be handed to `<a download>` —
 * the attribute is ignored and the browser plays the video instead of saving it.
 * Hence `MAX_BYTES` and the fallback below it.
 */

import { Download, Film, Link2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/Button";
import { api, ApiError } from "@/lib/api";
import { formatSize } from "@/lib/free-tools/recording";

import { DownloadDialog } from "../DownloadDialog";

/**
 * The largest file to assemble in the tab.
 *
 * A download has to be buffered to be saved (see the note above), so this is a
 * ceiling on the tab's memory rather than on anything X enforces. Premium
 * accounts can post hours of video, and a 3GB blob does not fail gracefully —
 * it takes the tab with it. Past this the file is opened instead, with the one
 * instruction that does work on a video playing in a browser.
 */
const MAX_BYTES = 600_000_000;

type Variant = {
  url: string;
  label: string;
  width: number;
  height: number;
  bitrate: number;
};

type Media = {
  kind: "video" | "gif";
  durationMs: number;
  poster: string;
  variants: Variant[];
};

type Post = {
  id: string;
  author: { name: string; handle: string };
  text: string;
  media: Media[];
};

type Stage = "empty" | "finding" | "found" | "saving" | "failed";

export function Downloader(): ReactNode {
  const [link, setLink] = useState("");
  const [stage, setStage] = useState<Stage>("empty");
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState("");
  /** Bytes fetched and total, for the bar. Total is zero until X reports one. */
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [pitching, setPitching] = useState(false);

  /**
   * Abandons an in-flight download when another is started or the component
   * goes away. Without it, picking 720p after starting 1080p leaves the first
   * fetch running and racing the second to call `setProgress`.
   */
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  const find = useCallback(async () => {
    const pasted = link.trim();
    if (!pasted) return;

    setStage("finding");
    setError("");
    setPost(null);

    try {
      const found = await api<Post>(`/v1/x-video?url=${encodeURIComponent(pasted)}`);
      setPost(found);
      setStage("found");
    } catch (cause) {
      // The Worker's messages are written for this panel, so they are shown as
      // they arrive rather than replaced with a generic line here.
      setError(cause instanceof ApiError ? cause.message : "Something went wrong.");
      setStage("failed");
    }
  }, [link]);

  const save = useCallback(
    async (variant: Variant, media: Media) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      setStage("saving");
      setError("");
      setProgress({ done: 0, total: 0 });

      try {
        const response = await fetch(variant.url, {
          signal: controller.signal,
          // `video.twimg.com` is hotlink-protected on the `Referer` header and
          // nothing else: no header at all is 200, a `Referer` of x.com is 200,
          // a `Referer` of our origin is 403. A browser sends one by default, so
          // without this every download fails — and only from the page, which
          // is why it survives any amount of checking with curl.
          referrerPolicy: "no-referrer",
        });
        if (!response.ok || !response.body) throw new Error(`X answered ${response.status}`);

        const total = Number(response.headers.get("content-length") ?? 0);

        if (total > MAX_BYTES) {
          // Opened rather than saved. The file is far too big to hold in a tab,
          // and a video playing in a browser is one right-click from being on
          // the disk — which is a worse experience and a working one.
          window.open(variant.url, "_blank", "noopener,noreferrer");
          setError(
            `That video is ${formatSize(total)}, which is too large to save through this page. It has opened in a new tab — right-click it and choose Save Video As.`,
          );
          setStage("failed");
          return;
        }

        const reader = response.body.getReader();
        // `BlobPart[]` rather than `Uint8Array[]`: a `Uint8Array` may be backed
        // by a `SharedArrayBuffer`, which `Blob` does not accept, so the array's
        // own type is the one place to say these are blob parts and nothing else.
        const chunks: BlobPart[] = [];
        let done = 0;

        for (;;) {
          const read = await reader.read();
          if (read.done) break;
          chunks.push(read.value as BlobPart);
          done += read.value.byteLength;
          setProgress({ done, total });
        }

        const url = URL.createObjectURL(new Blob(chunks, { type: "video/mp4" }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = fileNameFor(post, variant, media);
        anchor.click();
        // The object URL is the only thing holding the bytes once the click has
        // been handled, so it goes immediately. Revoking it in the same tick the
        // click happens is safe: the browser has already taken the reference.
        URL.revokeObjectURL(url);

        setStage("found");
        setPitching(true);
      } catch (cause) {
        if (controller.signal.aborted) return;
        console.error("x-video: download failed", cause);
        setError("The download stopped before it finished. Try again, or pick a smaller size.");
        setStage("failed");
      }
    },
    [post],
  );

  const media = post?.media[0];
  const ratio = progress.total > 0 ? progress.done / progress.total : 0;
  const busy = stage === "finding" || stage === "saving";

  /**
   * The dark panel is the result, so it does not exist until there is one.
   * Rendered empty it was a large box of nothing above the fold, which read as
   * the tool having failed to load rather than as waiting for a link.
   */
  const showResult = Boolean(post && media);

  return (
    <>
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3">
        {/* A form, so Enter submits the way it does in every other search box
            without a key handler of our own. */}
        <form
          className="relative w-full"
          onSubmit={(event) => {
            event.preventDefault();
            void find();
          }}
        >
          <Link2
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted"
          />
          <input
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="Paste a link to a post on X or Twitter"
            spellCheck={false}
            autoComplete="off"
            aria-label="Link to a post on X or Twitter"
            className="h-14 w-full rounded-full border border-line bg-surface pr-32 pl-12 text-base text-fg placeholder:text-muted/70 focus:border-accent focus:outline-none"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!link.trim() || busy}
            className="absolute top-2 right-2 h-10 px-5"
          >
            {stage === "finding" ? "Looking…" : "Find video"}
          </Button>
        </form>

        {/* One place for anything the tool has to say, so a message cannot
            appear below the fold while the thing it is about is above it. */}
        {error ? (
          <p className="text-center text-sm leading-relaxed text-pretty text-negative" role="alert">
            {error}
          </p>
        ) : (
          <p className="text-center text-sm text-muted">
            Your browser downloads the video straight from X. Nothing passes through us.
          </p>
        )}
      </div>

      {showResult && post && media ? (
        <div className="editor-theme squircle dot-grid mt-8 flex flex-col items-center gap-4 rounded-3xl bg-editor-bg px-6 py-10 text-center ring-1 ring-black/20">
          {media.poster ? (
            // Not `next/image`: the host is X's and the URL is only known at run
            // time, so there is nothing for the optimiser to pre-size.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={media.poster} alt="" className="max-h-56 rounded-xl ring-1 ring-white/10" />
          ) : (
            <div className="flex size-14 items-center justify-center rounded-2xl bg-white/5 text-editor-muted ring-1 ring-white/10">
              <Film className="size-7" />
            </div>
          )}

          <div className="flex flex-col gap-1">
            <p className="max-w-full truncate text-lg font-medium text-editor-fg">
              {post.author.name || post.author.handle}
            </p>
            <p className="font-mono text-xs text-editor-muted">
              @{post.author.handle}
              {media.durationMs > 0 ? ` · ${formatDuration(media.durationMs)}` : ""}
            </p>
          </div>

          {stage === "saving" ? (
            <div className="flex w-full max-w-xs flex-col gap-2">
              <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-white transition-[width] duration-150"
                  style={{ width: `${Math.round(ratio * 100)}%` }}
                />
              </div>
              <p className="font-mono text-[11px] text-editor-muted">
                {progress.total > 0
                  ? `${formatSize(progress.done)} of ${formatSize(progress.total)}`
                  : formatSize(progress.done)}
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {media.variants.map((variant) => (
                <button
                  key={variant.url}
                  type="button"
                  onClick={() => void save(variant, media)}
                  className="flex h-[30px] items-center gap-2 rounded-full bg-white px-3.5 text-[13px] font-medium text-black transition-colors hover:bg-white/90"
                >
                  <Download className="size-4" />
                  {variant.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <DownloadDialog open={pitching} onClose={() => setPitching(false)} />
    </>
  );
}

/**
 * What the saved file is called.
 *
 * The handle and the id, because a downloads folder with four files called
 * `video.mp4` is the usual result of these pages and the id is the one thing
 * that takes somebody back to the post.
 */
function fileNameFor(post: Post | null, variant: Variant, media: Media): string {
  const handle = post?.author.handle || "x";
  const id = post?.id ?? "";
  const quality = media.kind === "gif" ? "gif" : variant.label;
  return `x-${handle}-${id}-${quality}.mp4`;
}

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
