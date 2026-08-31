/**
 * Keeping the caption bitmaps the playhead is near loaded, and no more.
 *
 * Deliberately not part of `useEditorImages`, which loads every path it is
 * given up front. That is right for backgrounds and pointer images — a handful
 * of small files that any frame might name — and wrong for captions: a
 * half-hour recording is hundreds of cue bitmaps at export resolution, and
 * decoding all of them to hold them in memory would cost more than the video.
 * The exporter keeps four at a time for exactly this reason.
 *
 * So this is a window around the playhead with an LRU behind it, which is the
 * same shape as `Compositor::load_captions` on the other side.
 */
import { useEffect, useRef } from "react";

import type { EditorSession } from "../../../shared/contract";
import type { RenderedCue } from "../../../shared/layout";
import { mediaUrl, recordingName } from "../../../shared/media-url";
import type { Images } from "./canvas";

/**
 * How far either side of the playhead a cue is loaded, in nanoseconds.
 *
 * Wide enough that scrubbing at a normal speed never outruns the decode, narrow
 * enough that it is a handful of bitmaps rather than a chapter of them.
 */
const REACH_NS = 3_000_000_000;

/** How many bitmaps to keep once they have fallen out of the window. */
const KEEP = 12;

export function useCaptionImages(
  session: EditorSession | null,
  cues: ReadonlyMap<string, readonly RenderedCue[]>,
  media: { sourceAt: (now: number) => number | null },
  setImages: (update: (images: Images) => Images) => void,
): void {
  const loaded = useRef(new Map<string, HTMLImageElement>());
  const pending = useRef(new Set<string>());
  const used = useRef(new Map<string, number>());
  const clock = useRef(0);

  // Read through a ref rather than depended on. `useEditorPlayback` returns a
  // fresh object every render and the cue list is replaced whenever anything is
  // redrawn, so either in the dependency array would tear this loop down and
  // rebuild it on almost every render — discarding whatever image was in flight
  // at the time, since the old run's cleanup marks itself cancelled.
  const latest = useRef({ cues, media });
  latest.current = { cues, media };

  useEffect(() => {
    if (!session) return;

    const name = recordingName(session.dir);
    let frame = 0;
    let cancelled = false;

    const tick = () => {
      frame = requestAnimationFrame(tick);

      // Null before the media is ready, and between slices at a cut. Nothing to
      // load rather than a window around zero, which would decode the first
      // cues of the recording every time the playhead crossed a gap.
      const at = latest.current.media.sourceAt(performance.now());
      if (at === null) return;
      clock.current += 1;

      // Across every look, not only the clip under the playhead: a cut into a
      // clip with a different style would otherwise have to decode its first
      // cue on the frame it appears, which is a visible blank.
      const wanted = new Set<string>();
      for (const set of latest.current.cues.values()) {
        for (const cue of set) {
          if (cue.end < at - REACH_NS || cue.at > at + REACH_NS) continue;
          wanted.add(cue.path);
          if (cue.litPath) wanted.add(cue.litPath);
        }
      }

      for (const path of wanted) used.current.set(path, clock.current);

      for (const path of wanted) {
        if (loaded.current.has(path) || pending.current.has(path)) continue;
        pending.current.add(path);

        const image = new Image();
        // Before `src`, or the request is already in flight without it.
        // `prequel-media:` is a different origin, and WebGL throws on a tainted
        // texture — which takes the whole frame down, not just the caption.
        image.crossOrigin = "anonymous";
        image.src = mediaUrl(name, path);

        image.onload = () => {
          pending.current.delete(path);
          if (cancelled) return;
          loaded.current.set(path, image);
          evict();
          publish();
        };
        image.onerror = () => {
          pending.current.delete(path);
          // A cue whose bitmap will not load is a plainer moment, not a broken
          // editor — the same posture the exporter takes.
          console.warn(`[captions] could not load ${path}`);
        };
      }
    };

    const evict = () => {
      while (loaded.current.size > KEEP) {
        let stalest: string | null = null;
        let seen = Infinity;
        for (const path of loaded.current.keys()) {
          const last = used.current.get(path) ?? 0;
          if (last < seen) {
            seen = last;
            stalest = path;
          }
        }
        // Everything left is in use this frame. More cues on screen at once
        // than the cache holds is not a reason to thrash.
        if (stalest === null || seen === clock.current) break;
        loaded.current.delete(stalest);
        used.current.delete(stalest);
      }
    };

    /**
     * Publishes a fresh map.
     *
     * Only on a load or an eviction, never per frame: the compositor reads this
     * map by identity, and a new one every frame would re-upload every texture
     * it holds.
     */
    const publish = () => {
      const mine = new Map(loaded.current);
      setImages((images) => {
        const next = new Map(images);
        // Only ever adds and replaces: the backgrounds and pointer images in
        // here belong to `useEditorImages`, and dropping them would blank the
        // composition to get a caption on screen.
        for (const [path, image] of mine) next.set(path, image);
        return next;
      });
    };

    frame = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
    // Only the recording. Everything that changes per frame is read off `latest`.
  }, [session, setImages]);
}
