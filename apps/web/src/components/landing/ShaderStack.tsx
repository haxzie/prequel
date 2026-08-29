"use client";

import { useEffect, useState } from "react";
import { CRTScreen, FlutedGlass, MeshGradient, Shader } from "shaders/react";

/**
 * The hero's background: a WebGPU shader stack, over the three blurred circles
 * `Wash` draws in CSS.
 *
 * Loaded only through `ShaderWash`, which is the lazy boundary — see the note
 * there. Nothing else may import this module directly, or the engine joins the
 * shared client chunk and every page on the site downloads it.
 *
 * Three layers, outermost first — the same order the shaders.com editor lists
 * them in, since both filters declare `requiresChild` and so wrap what they
 * transform:
 *
 *   FlutedGlass  ribbed glass over the whole thing, refracting the light below
 *   CRTScreen    scanlines, a little chromatic fringing and the corner vignette
 *   MeshGradient the light itself — the icon's sunrise, scattered and drifting
 *
 * The palette is the icon's, which is the palette `Wash` mixes: the sun's
 * orange and crimson, the clip's violet, the page background at the dark end.
 * Swapping one background for the other changes the texture, not the colour.
 *
 * `HeroBackdrop` sits underneath and is never switched off. This canvas cannot
 * paint anything on a browser without WebGPU — the library reports that through
 * `onUnavailable` and writes nothing to the console — so the static layer is
 * both what fills the second before the first frame and what the hero falls back
 * to for good. It is drawn from this stack's own sampled output, which is what
 * makes the cross-fade read as the background sharpening rather than as a
 * different background arriving.
 */
export default function ShaderStack() {
  // Off until the renderer says it has a frame. Compiling the stack takes a
  // moment, and fading in from the CSS wash below hides the swap; appearing at
  // full opacity mid-scroll reads as a second background loading late.
  const [state, setState] = useState<"pending" | "ready" | "unavailable">("pending");

  // The site already stops the CSS wash outright under `prefers-reduced-motion`
  // rather than slowing it down — see the rule on `[data-wash]`. Same answer
  // here, except a shader has nowhere to put `animation: none`: every layer's
  // motion is a `speed` uniform, so the query has to be read in JS and fed back
  // in as a prop.
  const still = useReducedMotion();

  if (state === "unavailable") return null;

  return (
    <div
      aria-hidden
      // `absolute`, and the hero section is `relative` so these offsets resolve
      // against it: up past the nav to the top of the document, and a little
      // below the fold so the mask has somewhere to finish.
      //
      // `-z-10` matches `Wash`. A negative-z child paints after its stacking
      // context's background and before its content, and `relative` alone
      // creates no stacking context, so this lands in the body's — behind the
      // headline, above the page background, exactly where the CSS wash sits.
      className="pointer-events-none absolute inset-x-0 -top-20 -bottom-24 -z-10 overflow-hidden transition-opacity duration-1000"
      style={{
        opacity: state === "ready" ? 0.75 : 0,
        // Masked as well as clipped, for the reason `Wash` is: a background that
        // ends on a straight horizontal line reads as a seam across the page
        // rather than as light falling off.
        maskImage: "linear-gradient(to bottom, black 45%, transparent)",
        WebkitMaskImage: "linear-gradient(to bottom, black 45%, transparent)",
      }}
    >
      <Shader
        className="size-full"
        onReady={() => setState("ready")}
        onUnavailable={() => setState("unavailable")}
      >
        <FlutedGlass
          shape="bars"
          angle={0}
          // More flutes than the default 10, and softer edges between them. The
          // ribbing is meant to be felt as vertical structure behind the
          // headline rather than counted, and at the default each rib is wide
          // enough across a desktop viewport to visibly bend the backdrop under
          // a single word.
          frequency={16}
          softness={0.9}
          refraction={0.7}
          aberration={0.1}
          lightAngle={30}
          highlight={0.22}
          highlightSoftness={0.55}
          highlightColor="#eeacff"
          // A drift, not a slide. The pattern crossing the frame at any speed
          // you can follow turns the background into something to watch.
          speed={still ? 0 : 0.02}
        >
          <CRTScreen
            // The maximum, which is the *least* pixelation the shader offers.
            // Anything lower quantises the gradient into visible blocks behind
            // 16px body copy.
            pixelSize={128}
            colorShift={0.5}
            // A tenth of the default. Scanlines at full strength are a costume;
            // at this level they are the grain that stops a flat gradient
            // reading as a JPEG artefact.
            scanlineIntensity={0.12}
            scanlineFrequency={420}
            brightness={1}
            contrast={1.05}
            // The corner darkening is doing structural work, not period
            // flavour: the field runs the full width of the viewport, well past
            // the content's measure, and the vignette is what stops it ending
            // against the window edge. The mask above finishes the same job at
            // the bottom.
            vignetteIntensity={0.9}
            vignetteRadius={0.72}
          >
            <MeshGradient
              // The icon's sunrise, weighted dark: the first two stops hold the
              // bottom fifth of the ramp at the page background, and the four
              // above them climb crimson → violet → orange. The weighting is
              // what makes it read as light pooling in a dark room rather than
              // as a coloured panel behind the text.
              stops={[
                { color: "#0b0d11", position: 0 },
                { color: "#1b0820", position: 0.22 },
                { color: "#8e1450", position: 0.46 },
                { color: "#a410c9", position: 0.66 },
                { color: "#e14b15", position: 0.85 },
                { color: "#ffb066", position: 1 },
              ]}
              colorSpace="oklab"
              count={6}
              smoothness={3.4}
              // Near zero, where the library defaults to 0.35. `variation` is
              // what lets some cell boundaries stay crisp, and a crisp boundary
              // in a field this large is a hard vertical edge running the whole
              // height of the hero — it reads as a panel with a seam rather
              // than as light.
              variation={0.12}
              swirl={0.22}
              drift={0.45}
              wrapping={0}
              // Above the library's default of 1, which is the one number here
              // that is deliberately not restrained: the colour is the only
              // thing in this stack that moves enough to notice, and at the
              // fraction of a unit a background would normally get it reads as
              // a still image on any visit shorter than a minute.
              //
              // The flute pattern above stays near zero regardless. Two layers
              // travelling at once is what turns a background into something to
              // watch rather than something to read over.
              speed={still ? 0 : 1.6}
              seed={11}
            />
          </CRTScreen>
        </FlutedGlass>
      </Shader>
    </div>
  );
}

/**
 * `prefers-reduced-motion`, as a boolean that follows the setting.
 *
 * Subscribed rather than read once. Somebody who turns the setting on while the
 * page is open has just told the browser they want the movement to stop, and a
 * value sampled at mount would keep the gradient running until they navigated.
 *
 * The first answer is "moving", corrected on the effect that runs at mount.
 * Nothing has been painted by then — the stack is still compiling — so the
 * correction is never visible as a change of speed.
 */
function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);

    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
