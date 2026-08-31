"use client";

import { useEffect, useRef } from "react";

/**
 * The webcam picture in the layouts demo: a short clip, looping, muted.
 *
 * A client component for one reason, and it is the same reason the two
 * `prefers-reduced-motion` blocks in `globals.css` exist. Everything else in
 * this section is CSS and can be stopped by a media query; a video cannot —
 * `autoplay` is an attribute, not a declaration, and the server has no way to
 * know the preference at render time.
 *
 * `muted` is required rather than merely polite: without it every browser
 * refuses the autoplay outright and the picture sits on its first frame. The
 * file carries no audio track either, so there is nothing to unmute.
 */
export function CameraFootage() {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    const apply = () => {
      const el = video.current;
      if (!el) return;
      // Paused rather than unmounted, so the frame it stopped on stays in the
      // box. An empty camera would read as a broken layout rather than as
      // a still one.
      if (reduce.matches) el.pause();
      // `play()` rejects when the tab is hidden or the user has not interacted
      // yet, and an unhandled rejection here would surface as a console error
      // on a page that is behaving correctly.
      else void el.play().catch(() => {});
    };

    apply();
    reduce.addEventListener("change", apply);
    return () => reduce.removeEventListener("change", apply);
  }, []);

  return (
    <video
      ref={video}
      src="/camera-preview.mp4"
      // `autoPlay` as well as the effect above: the effect runs after
      // hydration, and without the attribute the picture holds its first frame
      // until this route's JavaScript has arrived.
      autoPlay
      loop
      muted
      playsInline
      // The clip is a wide studio shot with the subject right of centre, so a
      // square crop taken from the middle lands on a microphone. 59% is where
      // the face ends up centred once `cover` has thrown away the 44% of the
      // width a square box cannot show; in the 16:9 layouts nothing is
      // cropped and the figure has no effect.
      className="absolute inset-0 size-full object-cover object-[59%_50%]"
    />
  );
}
