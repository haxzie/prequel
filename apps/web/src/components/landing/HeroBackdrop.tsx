/**
 * The hero's background before — and without — the shader.
 *
 * `ShaderStack` needs about 700 kB of engine and a GPU device before it can
 * paint a frame, and on a browser with no WebGPU it never paints one at all.
 * Something has to hold the hero in both cases, and the site's own `Wash` is the
 * wrong shape for it: three blurred circles pulled off the top edge, so the
 * colour is a band under the nav and the rest of the hero is flat. Fading from
 * that into a full-height field with pools down both sides is a visible change
 * of design, not a change of texture.
 *
 * So this is drawn to match, layer for layer, in the order the shader composites
 * them — flutes over vignette over colour. CSS background layers paint
 * first-listed on top, so the list below reads outermost-first, the same way the
 * shader tree does.
 *
 * The colours are not invented. They were sampled off the shader's own canvas on
 * a 9 × 5 grid, composited against the page background at the same 0.75 the
 * canvas is shown at, and the pools below sit where the sampled maxima sat: the
 * crimson low and left, the violet low and right, the sun's orange as a hint
 * behind the mark. What cannot be matched is that the real field drifts, so this
 * is one plausible frame of it rather than any particular one.
 *
 * Opaque, deliberately. It covers `Wash` completely inside its own box, and the
 * rule in `globals.css` that hides `Wash` on hero pages is what stops the two
 * fighting through the mask at the bottom, where this one fades out and the
 * other has not quite finished.
 */
export function HeroBackdrop() {
  return (
    <div
      aria-hidden
      data-hero-backdrop
      // The same box and the same mask as `ShaderStack`, because the shader
      // cross-fades in over the top of this and any difference in either shows
      // up as the layer sliding or resizing as it arrives.
      className="pointer-events-none absolute inset-x-0 -top-20 -bottom-24 -z-10 overflow-hidden"
      style={{
        maskImage: "linear-gradient(to bottom, black 45%, transparent)",
        WebkitMaskImage: "linear-gradient(to bottom, black 45%, transparent)",
        backgroundColor: "var(--bg)",
        backgroundImage: [
          // The flutes. `FlutedGlass` at `frequency: 16` puts about 95px between
          // ribs on a desktop viewport, and each rib reads as a dark trough with
          // a highlight up one edge — the light bending through the thick part
          // of the glass. Two stops per period is enough at this contrast; the
          // shader's actual refraction is not reproducible in a gradient and at
          // these opacities nobody is comparing.
          "linear-gradient(90deg, rgb(255 255 255 / 0.035) 0%, rgb(255 255 255 / 0) 14%, rgb(0 0 0 / 0.16) 52%, rgb(255 255 255 / 0) 88%, rgb(255 255 255 / 0.035) 100%)",
          // The vignette, doing the same structural job it does in the shader:
          // the field runs the full width of the viewport, well past the
          // content's measure, and this is what stops it ending against the
          // window edge.
          "radial-gradient(115% 95% at 50% 42%, rgb(11 13 17 / 0) 34%, rgb(11 13 17 / 0.72) 78%, var(--bg) 100%)",
          // The mesh, as three pools. Low and to the sides, which is where the
          // sampled maxima were and is also the only arrangement that leaves the
          // headline sitting over the darkest part of the frame.
          "radial-gradient(58% 62% at 79% 86%, #5f0a86 0%, rgb(95 10 134 / 0) 72%)",
          "radial-gradient(52% 68% at 17% 58%, #5b0a3c 0%, rgb(91 10 60 / 0) 74%)",
          "radial-gradient(46% 48% at 47% 96%, #6b0357 0%, rgb(107 3 87 / 0) 76%)",
          // The sun, behind the mark. The faintest layer here by some way: it is
          // the one hue the mesh only reaches at the very top of its ramp, so it
          // shows up in the real thing as a warm cast rather than as a pool.
          "radial-gradient(38% 30% at 50% 10%, rgb(225 75 21 / 0.16) 0%, rgb(225 75 21 / 0) 72%)",
        ].join(", "),
        // Only the flutes tile. Everything after them is a single pass over the
        // whole box, and leaving them all at `auto` would tile the pools too.
        backgroundSize: "95px 100%, auto, auto, auto, auto, auto",
        backgroundRepeat: "repeat-x, no-repeat, no-repeat, no-repeat, no-repeat, no-repeat",
      }}
    />
  );
}
