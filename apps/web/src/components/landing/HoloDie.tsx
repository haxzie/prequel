"use client";

import { useEffect, useRef } from "react";

/**
 * The die's surface: holographic foil, lit and slowly turning.
 *
 * A fragment shader on a WebGL canvas, drawn behind the mark. The look is the
 * sticker on a laptop lid — a thin film that shifts through the spectrum as
 * the angle changes, with one hard highlight sliding across it. Three terms
 * make it: a curved fake normal so the square reads as a slightly domed
 * surface rather than a flat print, a band of noise that breaks the spectrum
 * into the uneven stripes real foil has, and a specular streak that sweeps
 * diagonally on its own slower clock. The spectrum itself is a cosine palette,
 * which is the cheapest thing that gives rainbow without a texture.
 *
 * Raw WebGL and not a library. The whole thing is one quad and one fragment
 * program, about three kilobytes of source; the WebGPU stack the hero once
 * carried was 700 kB to say less. WebGL 1 rather than 2, because nothing here
 * needs 2 and 1 runs on every Mac that reaches the page.
 *
 * It stops when it cannot be seen. `IntersectionObserver` pauses the loop
 * once the die scrolls off, and `prefers-reduced-motion` draws one frame and
 * leaves it: the foil still reads as foil when still, it just does not turn.
 * If WebGL is refused — a GPU blocklist, a privacy setting — the canvas stays
 * transparent and the gradient the die already paints underneath is what
 * shows, so the section never shows a hole.
 */

const VERTEX = `
attribute vec2 p;
varying vec2 v;
void main() { v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }
`;

const FRAGMENT = `
precision mediump float;
varying vec2 v;
uniform float t;

// Inigo Quilez's cosine palette: a spectrum from one line, no texture.
vec3 spectrum(float x) {
  return 0.5 + 0.5 * cos(6.28318 * (x + vec3(0.00, 0.33, 0.67)));
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

void main() {
  vec2 uv = v;
  vec2 c = uv - 0.5;

  // A domed normal: the square bulges towards the viewer at its centre, so
  // the viewing angle — and with it the colour — changes across the face.
  vec3 n = normalize(vec3(c * 0.8, 1.0));
  vec3 eye = vec3(0.0, 0.0, 1.0);
  // The light moves on a slow circle, which is what turns the foil.
  vec3 light = normalize(vec3(cos(t * 0.35) * 1.2, sin(t * 0.27) * 1.2, 0.6));
  float lit = max(dot(n, light), 0.0);
  float facing = dot(n, normalize(light + eye));

  // Foil's colour runs in bands across a direction, the way a diffraction
  // grating is laid down: a linear ramp bent a little by the viewing angle
  // and a fine stripe of noise. Blobs of noise read as oil, not foil.
  float ramp = (uv.x * 1.3 - uv.y * 0.8) * 0.9;
  float stripe = noise(vec2(uv.x * 14.0 - uv.y * 9.0 + t * 0.06, uv.y * 3.0)) * 0.3
               + noise(uv * 40.0 + t * 0.03) * 0.06;
  float phase = ramp + facing * 1.4 + stripe + t * 0.04;
  vec3 foil = spectrum(phase);
  // Pulled towards grey, so the rainbow sits with the navy around it instead
  // of shouting over it.
  float lum = dot(foil, vec3(0.299, 0.587, 0.114));
  foil = mix(vec3(lum), foil, 0.5);

  // Dark until it catches the light. The sheen is a narrow window around the
  // half-vector, so most of the face is near-black with the spectrum riding
  // faintly on it, and the spectrum opens up only where the light lands.
  float sheen = smoothstep(0.78, 1.0, facing);
  vec3 base = vec3(0.035, 0.05, 0.09);
  vec3 col = base + foil * (0.14 + 0.6 * sheen) + lit * 0.06;

  // One hard highlight sweeping on a diagonal, on its own clock, with a long
  // quiet gap between passes so it reads as a catch of light and not a loop.
  float sweep = fract(t * 0.11);
  float d = (uv.x + uv.y) * 0.5 - (sweep * 1.8 - 0.4);
  float glint = exp(-d * d * 220.0) * 0.7 + exp(-d * d * 1600.0) * 0.6;
  col += glint * (0.7 + 0.3 * foil);

  // The dome's edges fall away from the light: a soft vignette that keeps
  // the mark in the centre as the brightest thing.
  col *= 1.0 - smoothstep(0.35, 0.75, length(c)) * 0.45;

  // A faint grain, so the dark field does not band on a wide display.
  col += (hash(uv * 900.0 + t) - 0.5) * 0.012;

  gl_FragColor = vec4(col, 1.0);
}
`;

export function HoloDie({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      powerPreference: "low-power",
    });
    if (!gl) return;

    const program = gl.createProgram();
    if (!program) return;
    for (const [kind, source] of [
      [gl.VERTEX_SHADER, VERTEX],
      [gl.FRAGMENT_SHADER, FRAGMENT],
    ] as const) {
      const shader = gl.createShader(kind);
      if (!shader) return;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        // Named in the console rather than thrown: a shader that fails to
        // compile on one GPU should leave the gradient underneath, not take
        // the page down.
        console.warn("[holo] shader failed:", gl.getShaderInfoLog(shader));
        return;
      }
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const time = gl.getUniformLocation(program, "t");

    // Sized to what is on screen times the pixel ratio, capped at 2: the die
    // is a couple of hundred pixels across, and a 3x canvas spends fill rate
    // on detail the grain hides anyway.
    const size = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.round(canvas.clientWidth * scale);
      const height = Math.round(canvas.clientHeight * scale);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
    };

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let visible = true;
    const started = performance.now();

    const draw = (now: number) => {
      size();
      gl.uniform1f(time, (now - started) / 1000);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (!still && visible) frame = requestAnimationFrame(draw);
    };

    const watcher = new IntersectionObserver(([entry]) => {
      const was = visible;
      visible = entry?.isIntersecting ?? true;
      if (visible && !was && !still) frame = requestAnimationFrame(draw);
      if (!visible) cancelAnimationFrame(frame);
    });
    watcher.observe(canvas);
    frame = requestAnimationFrame(draw);

    // The context is left alone on the way out. This used to call
    // `WEBGL_lose_context.loseContext()` to hand the GPU back early, and in
    // development React runs every effect twice: the cleanup killed the
    // context and the second run got the same dead one back from
    // `getContext`, so the shader "failed to compile" with an empty log on
    // every dev build and only there. The browser reclaims the context with
    // the canvas, which is soon enough.
    return () => {
      cancelAnimationFrame(frame);
      watcher.disconnect();
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className={className} />;
}
