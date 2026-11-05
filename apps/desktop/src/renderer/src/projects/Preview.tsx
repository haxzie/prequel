import { useEffect, useRef, useState } from "react";

import type { ProjectComposition } from "../../../shared/contract";
import { WebGlCompositor } from "../editor/webgl";
import { openScene, type Scene } from "./composed";
import { PauseIcon, PlayIcon } from "../editor/icons";
import { cn } from "../lib/cn";

/**
 * The recording, playing, composed the way its edit is.
 *
 * The same picture the tile draws and the same `buildRenderPlan` behind it —
 * see `composed.ts` — with the videos running instead of parked on one frame.
 * What it is *not* is the export: no zoom moments, no captions, no text and no
 * pointer, for the reason the tile leaves them out. Each needs a track, a
 * bitmap or a font that opening a library pane does not load, and none of them
 * is what somebody checking which recording this is came to see. The
 * composition — background, frame, camera, look — is.
 *
 * It loops the clip the tile pictures rather than playing the whole take. A
 * recording that has been cut has footage the video no longer contains, and a
 * preview that ran on into it would be showing the one thing the edit says to
 * leave out. `ProjectComposition.screen.until` is where that clip ends.
 */
export function Preview({
  spec,
  poster,
}: {
  spec: ProjectComposition | null;
  poster: string | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [playing, setPlaying] = useState(false);
  /** Open while the videos are being fetched, so the poster can hold the space. */
  const [opening, setOpening] = useState(false);

  // Opened on demand rather than with the pane. A composition is two video
  // decodes, and pointing at a recording to read its size should not cost them
  // — the poster is already on disk and is the same picture.
  useEffect(() => {
    if (!spec || !playing) return;

    let live = true;
    setOpening(true);
    void openScene(spec).then((opened) => {
      setOpening(false);
      // Let go straight away where the pane moved on while this was decoding;
      // the effect's cleanup has already run and will never see it.
      if (!live) {
        opened?.release();
        return;
      }
      if (!opened) {
        setPlaying(false);
        return;
      }
      setScene(opened);
    });

    return () => {
      live = false;
      setScene((current) => {
        current?.release();
        return null;
      });
    };
  }, [spec, playing]);

  // The loop. Its own animation frame rather than React, for the reason the
  // editor's preview has one: a video's contents change without anything
  // telling React they have.
  useEffect(() => {
    const element = canvas.current;
    if (!scene || !element || !spec) return;

    const compositor = new WebGlCompositor();
    const { screen, camera, matte } = scene.media;
    const from = spec.screen?.at ?? 0;
    // A clip shorter than this is one the loop would spend restarting. Half a
    // second is the shortest span worth calling a preview.
    const until = Math.max(spec.screen?.until ?? 0, from + 0.5);

    const start = (video: HTMLVideoElement | null, at: number) => {
      if (!video) return;
      video.currentTime = at;
      video.muted = true;
      void video.play().catch(() => {
        // A decode that will not start leaves the frame it was seeked to on
        // screen, which is the poster by another route.
      });
    };

    start(screen, from);
    start(camera, spec.camera?.at ?? 0);
    start(matte, spec.camera?.at ?? 0);

    let frame = 0;
    const draw = () => {
      frame = window.requestAnimationFrame(draw);

      // Back to the top of the clip. Driven off the screen track because that
      // is the clock the span was measured on; the camera follows it rather
      // than looping on its own, or the two would drift apart a loop at a time.
      if (screen && screen.currentTime >= until) {
        start(screen, from);
        start(camera, spec.camera?.at ?? 0);
        start(matte, spec.camera?.at ?? 0);
      }

      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.round(element.clientWidth * ratio);
      const height = Math.round(element.clientHeight * ratio);
      if (width <= 0 || height <= 0) return;
      if (element.width !== width || element.height !== height) {
        element.width = width;
        element.height = height;
      }

      compositor.draw(element, scene.plan, scene.sources, scene.images, { width, height });
    };

    draw();
    return () => {
      window.cancelAnimationFrame(frame);
      screen?.pause();
      camera?.pause();
      matte?.pause();
      compositor.dispose();
    };
  }, [scene, spec]);

  // A recording changed under the pane. Whatever was playing was of the last
  // one, and a picture of the wrong recording is worse than no picture.
  useEffect(() => setPlaying(false), [spec]);

  const shape = spec ? aspect(spec) : 16 / 9;
  /**
   * A screenshot has nothing to play, and the poster *is* its composition —
   * the same plan through the same compositor, already on disk. So there is no
   * control: a play button over one frame is a button that can only disappoint.
   */
  const playable = spec !== null && !spec.stillScreen;

  return (
    <div
      className="relative w-full overflow-hidden rounded-xl border border-white/8 bg-black/40"
      style={{ aspectRatio: shape }}
    >
      {/* Under the canvas and always there: it is the same frame, already on
          disk, and it is what holds the box while the videos decode. */}
      {poster && (
        <img
          src={poster}
          alt=""
          className="absolute inset-0 size-full object-contain"
          draggable={false}
        />
      )}

      <canvas
        ref={canvas}
        className={cn(
          "absolute inset-0 size-full",
          // Hidden rather than unmounted while it has nothing on it: the loop
          // measures the element to size its backing store, and an element that
          // is not laid out measures zero.
          scene ? "opacity-100" : "opacity-0",
        )}
      />

      {/* One control. The preview is a loop of one clip, so there is nothing to
          seek through and nothing to seek with — this says whether it is
          moving, which is the only question it can answer. */}
      {playable && (
        <button
          type="button"
          aria-label={playing ? "Pause the preview" : "Play the preview"}
          className={cn(
            "absolute inset-0 grid place-items-center text-white transition-opacity",
            "[&_svg]:size-5",
            playing ? "opacity-0 hover:opacity-100" : "opacity-100",
          )}
          onClick={() => setPlaying((on) => !on)}
        >
          <span
            className={cn(
              "grid size-11 place-items-center rounded-full bg-black/55 backdrop-blur-sm",
              "transition-transform hover:scale-105",
              opening && "animate-pulse",
            )}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * The shape the preview is drawn at.
 *
 * The project's frame, not the source's: a recording reframed to 9:16 is a
 * vertical video, and a box the shape of the capture would letterbox it inside
 * a box of the wrong shape. An automatic frame carries no size — it means "the
 * size of the screen track" — and there is nothing decoded here to measure, so
 * that falls back to the ordinary landscape shape until the scene opens and the
 * plan is drawn into whatever box this gave it.
 */
function aspect(spec: ProjectComposition): number {
  if (spec.frame.auto || spec.frame.width <= 0 || spec.frame.height <= 0) return 16 / 9;
  return spec.frame.width / spec.frame.height;
}
