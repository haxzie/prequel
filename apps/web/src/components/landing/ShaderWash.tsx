"use client";

import dynamic from "next/dynamic";

/**
 * The hero's shader background, behind a lazy boundary.
 *
 * The engine and its shader graph weigh about 700 kB gzipped — by a wide margin
 * the largest thing on the site, and more than the rest of the landing page's
 * JavaScript put together. The boundary is what keeps that off the seventeen
 * pages that do not render a hero; without it the engine joins the shared client
 * chunk and `/pricing`, `/blog` and every article download a renderer they never
 * mount. Confirm with `grep -rl <chunk> .next/server/app` after a build: the hit
 * list should be `/` and the `create/` pages, and nothing else.
 *
 * It does not defer the download on the pages that *do* render it. Turbopack
 * folds the dynamic import back into those routes' client chunk, so it ships as
 * an `async` script in their HTML — off the parser's critical path, but fetched
 * on first load rather than after hydration. What is genuinely deferred is the
 * WebGPU device and the shader compile, which wait for mount. `ShaderStack`
 * fades itself in once the renderer has a frame, and the CSS `Wash` underneath
 * carries the hero until it does.
 *
 * `ssr: false` because there is nothing to render on the server. The component
 * is a canvas and a GPU device; the markup it would emit is an empty element,
 * and asking for it only gives the client something to reconcile against.
 */
export const ShaderWash = dynamic(() => import("./ShaderStack"), { ssr: false });
