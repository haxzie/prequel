import { Copy, EyeOff, Link2 } from "lucide-react";

import { Frame, Slab } from "@/components/features/frame";
import { CAMERA_STILL, CAPTIONS_SCREEN, LAYOUT_SCREEN } from "@/components/landing/stage";

/**
 * The pictures on the Sharing cards.
 *
 * These stand for pages on the site rather than surfaces in the app, and are
 * still drawn on the editor's slabs so the set reads as one. None of them
 * prints a whole address: real text in an address bar is a URL somebody could
 * try, and it does not resolve. The chat message shows the path's prefix and
 * an ellipsis, which is enough to say where a link goes.
 */

/** The three lights and the bar, at the top of a drawn browser. */
function AddressBar() {
  return (
    <div className="flex items-center gap-2 border-b border-editor-line px-3 py-2">
      <span className="flex gap-1">
        {["#f0d06f", "#c0a8ff", "#30a46c"].map((c) => (
          <span key={c} className="size-2 rounded-full" style={{ backgroundColor: c }} />
        ))}
      </span>
      <span className="flex h-5 min-w-0 flex-1 items-center rounded-full bg-white/5 px-2.5">
        <span className="h-1.5 w-24 rounded-full bg-white/15 lg:w-36" />
      </span>
    </div>
  );
}

/**
 * A frame of the video with a play button on it: the poster.
 *
 * Positioned by the caller, so the class list here carries no `relative` for
 * a caller's `absolute` to fight with. The badge inside is absolute either way.
 */
function Poster({ src, read, className = "" }: { src: string; read: string; className?: string }) {
  return (
    <div
      className={`grid place-items-center overflow-hidden bg-cover bg-top ${className}`}
      style={{ backgroundImage: `url(${src})` }}
    >
      <span className="absolute inset-0 bg-black/25" />
      <span className="relative grid size-8 place-items-center rounded-full bg-white/90">
        <svg viewBox="0 0 24 24" className="size-3 translate-x-px fill-black">
          <path d="M7 4.5v15l13-7.5z" />
        </svg>
      </span>
      <span className="absolute right-2 bottom-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white/90">
        {read}
      </span>
    </div>
  );
}

/**
 * The watch page: a browser window with the video in it and nothing else.
 *
 * An ordinary address bar is the card's claim in one shape. Whoever is on the
 * other end opens a page, and a page needs no account and no app.
 */
export function WatchPage() {
  return (
    <Frame stage="peony">
      <Slab className="inset-x-8 top-6 -bottom-8 lg:inset-x-24">
        <AddressBar />
        <Poster src={CAPTIONS_SCREEN} read="0:42" className="absolute inset-x-0 top-9 bottom-0" />
      </Slab>
    </Frame>
  );
}

/**
 * The link, and the one thing that is true of every link.
 *
 * A pill with the link in it and a copy button beside, which is the share
 * dialog. The chip under it says the page is kept out of search, because the
 * pill on its own says only that there is a link.
 */
export function NeverIndexed() {
  return (
    <Frame stage="sequoia">
      <Slab className="inset-x-4 top-1/2 -translate-y-1/2">
        <div className="flex flex-col gap-2.5 px-3 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md bg-white/5 px-2.5 text-editor-muted [&_svg]:size-3.5">
              <Link2 />
              <span className="h-1.5 w-28 rounded-full bg-white/15" />
            </span>
            <span className="grid h-7 place-items-center gap-1 rounded-md bg-selected px-2.5 text-[11px] font-medium text-white [&_svg]:size-3.5">
              <span className="flex items-center gap-1.5">
                <Copy />
                Copy
              </span>
            </span>
          </div>
          <span className="flex items-center gap-1.5 text-[11px] text-editor-muted [&_svg]:size-3.5">
            <EyeOff />
            Anyone with the link. Nothing indexed.
          </span>
        </div>
      </Slab>
    </Frame>
  );
}

/**
 * The library: three rows and the storage meter under them.
 *
 * Each row is a poster, a name, a length and a view count, which are the
 * columns the library shows. The meter is the row the pricing page is about,
 * and it is drawn part full so it reads as a meter and not a rule.
 */
export function Library() {
  const rows = [
    { name: "Onboarding walkthrough", src: CAPTIONS_SCREEN, read: "0:42 · 12 MB · 38 views" },
    { name: "Stream setup", src: LAYOUT_SCREEN, read: "1:10 · 21 MB · 7 views" },
    { name: "Checkout fix", src: CAPTIONS_SCREEN, read: "0:18 · 5 MB · 3 views" },
  ];

  return (
    <Frame stage="facet">
      <Slab className="inset-x-4 top-5 -bottom-6">
        <div className="flex flex-col gap-px px-3 pt-3">
          {rows.map((row) => (
            <span key={row.name} className="flex items-center gap-2.5 py-1">
              <span
                className="h-6 w-10 shrink-0 rounded-[3px] bg-cover bg-top ring-1 ring-white/10"
                style={{ backgroundImage: `url(${row.src})` }}
              />
              <span className="min-w-0 flex-1 truncate text-[11px] text-editor-fg">{row.name}</span>
              <span className="hidden font-mono text-[10px] whitespace-nowrap text-editor-muted lg:inline">
                {row.read}
              </span>
            </span>
          ))}
          <div className="mt-2 flex items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <span className="block h-full w-[24%] rounded-full bg-selected" />
            </span>
            <span className="font-mono text-[10px] text-editor-muted">1.2 GB of 5 GB</span>
          </div>
        </div>
      </Slab>
    </Frame>
  );
}

/**
 * The link, pasted into a chat, with the poster unfurled under it.
 *
 * A generic message rather than any one app's: an avatar, a name, a line of
 * text and a card with the video's poster still and its length. It is what
 * every chat client makes of a page with the right tags on it, and the still
 * is the reason it looks like a video and not a link.
 */
export function Unfurl() {
  return (
    <Frame stage="sequoia">
      <Slab className="inset-x-6 top-5 -bottom-8 lg:inset-x-20">
        <div className="flex gap-2.5 px-4 pt-3">
          <span
            className="size-7 shrink-0 rounded-md bg-cover bg-center"
            style={{ backgroundImage: `url(${CAMERA_STILL})` }}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="flex items-baseline gap-2 text-[11px]">
              <span className="font-medium text-editor-fg">Alex</span>
              <span className="text-editor-muted">10:42</span>
            </span>
            <span className="text-[11px] text-editor-fg">
              Here is the walkthrough{" "}
              <span className="text-selected underline">prequel.sh/v/…</span>
            </span>
            <div className="flex max-w-xs overflow-hidden rounded-md border-l-2 border-editor-line bg-white/5">
              <Poster
                src={CAPTIONS_SCREEN}
                read="0:42"
                className="relative h-14 w-24 shrink-0 rounded-sm"
              />
              <span className="flex min-w-0 flex-col justify-center gap-1 px-2.5">
                <span className="truncate text-[11px] font-medium text-editor-fg">
                  Onboarding walkthrough
                </span>
                <span className="text-[10px] text-editor-muted">Shared with Prequel</span>
              </span>
            </div>
          </div>
        </div>
      </Slab>
    </Frame>
  );
}
