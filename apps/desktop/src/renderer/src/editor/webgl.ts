/**
 * The preview's compositor, in WebGL.
 *
 * A deliberate mirror of `crates/prequel-render/src/shaders.metal`: the same
 * uniforms, the same modes, the same superellipse distance function, one quad
 * per primitive. Written that way so the two agree by construction rather than
 * by inspection — the plan already guarantees they draw the same *geometry*,
 * and this is what makes them draw the same *pixels*.
 *
 * It replaces a Canvas 2D compositor that could not express what the exporter
 * could. Two things it could not do:
 *
 * - A perspective transform. `setTransform` takes six numbers; parallel lines
 *   stay parallel by definition, and a tilt needs a homography.
 * - A blur that varies across the frame. `filter: blur()` is uniform per draw.
 *
 * Both are natural here, which is the point of the change. The immediate gain
 * is smaller and worth stating: the 2D compositor blurred shadows with a real
 * Gaussian while the exporter softens a distance field, so the preview and the
 * export have never quite agreed about shadows. Now they do.
 */
import {
  cursorAt,
  rectAt,
  type Paint,
  type PlanItem,
  type Rect,
  type RectKey,
  type RenderPlan,
  type Shape,
} from "../../../shared/layout";

/** Images the plan names by path — backgrounds, and the pointer. */
export type Images = Map<string, CanvasImageSource>;

/** The live video elements a plan draws from. */
export interface Sources {
  screen: HTMLVideoElement | null;
  camera: HTMLVideoElement | null;
}

export interface Backing {
  width: number;
  height: number;
}

const MODE_FILL = 0;
const MODE_GRADIENT = 1;
const MODE_IMAGE = 2;
const MODE_SHADOW = 3;
const MODE_STROKE = 4;

const VERTEX = `#version 300 es
precision highp float;

uniform vec4 u_rect;
uniform vec2 u_frame;
// Twelve numbers as four (x, y, w) corners, or w = 0 for "not tilted".
uniform vec3 u_quad[4];

out vec2 v_local;
out vec2 v_uv;
out vec2 v_screen;

void main() {
  // Four corners from the vertex id, no buffer: the rectangle is a uniform.
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));

  vec3 placed = u_quad[gl_VertexID];
  // The tilted corner if there is one, otherwise the plain rectangle.
  vec2 pixel = placed.z > 0.0 ? placed.xy : u_rect.xy + corner * u_rect.zw;
  float w = placed.z > 0.0 ? placed.z : 1.0;

  // Pixels to clip space, with y flipped: clip space is bottom-up and every
  // rectangle in the plan is top-down.
  vec2 clip = (pixel / u_frame) * 2.0 - 1.0;

  // Scaled by w, with w in the fourth component: the hardware divides by it
  // per fragment, which is what makes the texture and the shape follow the
  // perspective instead of being smeared across two flat triangles.
  gl_Position = vec4(clip.x * w, -clip.y * w, 0.0, w);
  v_local = corner * u_rect.zw;
  v_uv = corner;
  // Where this corner is in the output frame, so the fragment can measure its
  // distance from what is in focus.
  v_screen = pixel;
}`;

const FRAGMENT = `#version 300 es
precision highp float;

uniform vec4 u_rect;
uniform vec4 u_src;
uniform vec2 u_shape;
uniform vec4 u_colorA;
uniform vec4 u_colorB;
uniform vec2 u_gradient;
uniform int u_mode;
uniform float u_weight;
uniform int u_mirror;
// Depth of field: xy is what stays sharp in output pixels, z how far around it
// stays sharp, w the widest blur beyond. w of 0 means nothing is softened.
uniform vec4 u_focus;
uniform vec2 u_texel;
uniform sampler2D u_image;

in vec2 v_local;
in vec2 v_uv;
in vec2 v_screen;
out vec4 fragColor;

/**
 * The picture, softened by how far this pixel is from what is in focus.
 *
 * One pass with a per-pixel radius rather than the usual two with a fixed one:
 * a separable blur has a single kernel for the whole frame, and progressive
 * means the kernel changes everywhere. Sixteen taps on a spiral — enough that
 * the falloff reads as defocus rather than as rings, and cheap enough to do at
 * export resolution.
 */
vec4 sampleFocused(vec2 uv) {
  float away = max(distance(v_screen, u_focus.xy) - u_focus.z, 0.0);
  // Squared, so the sharp area has a soft border instead of an edge where the
  // blur switches on.
  float radius = u_focus.w * min(away / max(u_focus.z, 1.0), 1.0);
  radius *= radius / max(u_focus.w, 0.0001);

  if (u_focus.w <= 0.0 || radius <= 0.5) return texture(u_image, uv);

  vec4 total = vec4(0.0);
  for (int tap = 0; tap < 16; tap++) {
    float turn = float(tap) * 2.399963;
    float reach = sqrt(float(tap) + 0.5) / 4.0;
    vec2 offset = vec2(cos(turn), sin(turn)) * reach * radius * u_texel;
    total += texture(u_image, uv + offset);
  }
  return total / 16.0;
}

// Signed distance to a superellipse-cornered rectangle. Negative inside,
// positive outside, in pixels. Verbatim from the Metal shader.
float shapeDistance(vec2 p, vec2 halfSize, float radius, float n) {
  radius = min(radius, min(halfSize.x, halfSize.y));
  if (radius <= 0.0) {
    vec2 d = abs(p) - halfSize;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }

  vec2 corner = abs(p) - (halfSize - radius);
  if (corner.x <= 0.0 || corner.y <= 0.0) {
    vec2 d = abs(p) - halfSize;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }

  vec2 q = corner / radius;
  float value = pow(q.x, n) + pow(q.y, n);
  return (pow(value, 1.0 / n) - 1.0) * radius;
}

// The canvas compositor expects premultiplied colour; the exporter blends
// straight alpha. Folding it in here rather than there keeps one blend mode on
// each side and the same result from both.
vec4 premultiplied(vec3 rgb, float alpha) {
  return vec4(rgb * alpha, alpha);
}

void main() {
  vec2 halfSize = u_rect.zw * 0.5;
  vec2 p = v_local - halfSize;
  float d = shapeDistance(p, halfSize, u_shape.x, u_shape.y);

  // Shadows are the same shape, softened — so the blur follows the silhouette
  // rather than the bounding box.
  if (u_mode == 3) {
    float softness = max(u_weight, 0.0001);
    fragColor = premultiplied(u_colorA.rgb, u_colorA.a * (1.0 - smoothstep(-softness, softness, d)));
    return;
  }

  if (u_mode == 4) {
    // A stroke is the band either side of the edge.
    float halfWidth = max(u_weight, 0.5) * 0.5;
    float band = 1.0 - smoothstep(halfWidth - 0.5, halfWidth + 0.5, abs(d));
    fragColor = premultiplied(u_colorA.rgb, u_colorA.a * band);
    return;
  }

  // One pixel of feathering at the edge, or a circle has visibly stepped edges.
  float coverage = 1.0 - smoothstep(-0.5, 0.5, d);
  if (coverage <= 0.0) discard;

  if (u_mode == 2) {
    vec2 uv = v_uv;
    if (u_mirror != 0) uv.x = 1.0 - uv.x;
    // Mirroring first, so it flips the crop rather than moving it.
    uv = u_src.xy + uv * u_src.zw;
    vec4 sampled = sampleFocused(uv);
    fragColor = premultiplied(sampled.rgb, sampled.a * coverage);
    return;
  }

  if (u_mode == 1) {
    // Projected onto the gradient's axis, so the stops are measured the way
    // CSS measures them.
    float t = clamp(dot(v_uv - 0.5, u_gradient) + 0.5, 0.0, 1.0);
    vec4 color = mix(u_colorA, u_colorB, t);
    fragColor = premultiplied(color.rgb, color.a * coverage);
    return;
  }

  fragColor = premultiplied(u_colorA.rgb, u_colorA.a * coverage);
}`;

/** Uniform locations, looked up once — `getUniformLocation` is not free. */
interface Program {
  program: WebGLProgram;
  rect: WebGLUniformLocation | null;
  src: WebGLUniformLocation | null;
  shape: WebGLUniformLocation | null;
  frame: WebGLUniformLocation | null;
  colorA: WebGLUniformLocation | null;
  colorB: WebGLUniformLocation | null;
  gradient: WebGLUniformLocation | null;
  mode: WebGLUniformLocation | null;
  weight: WebGLUniformLocation | null;
  mirror: WebGLUniformLocation | null;
  quad: WebGLUniformLocation | null;
  focus: WebGLUniformLocation | null;
  texel: WebGLUniformLocation | null;
}

export class WebGlCompositor {
  private gl: WebGL2RenderingContext | null = null;
  private program: Program | null = null;
  private vao: WebGLVertexArrayObject | null = null;

  /** One texture per source, reused: a new one per frame would thrash. */
  private readonly textures = new Map<string, WebGLTexture>();
  /** Which images have been uploaded, so a still one is not re-sent. */
  private readonly uploaded = new WeakSet<CanvasImageSource>();
  /** Sources that would not upload, so the log says so once rather than at
      sixty times a second. */
  private readonly refused = new Set<string>();

  /**
   * Draws a plan.
   *
   * `at` is source time, for the items that move. The canvas is sized by the
   * caller; everything here works in output pixels and is scaled by the
   * viewport, exactly as the exporter's own frame does.
   */
  draw(
    canvas: HTMLCanvasElement,
    plan: RenderPlan,
    sources: Sources,
    images: Images,
    backing: Backing,
    at = 0,
  ): void {
    if (backing.width <= 0 || backing.height <= 0 || plan.frame.width <= 0) return;

    const gl = this.context(canvas);
    if (!gl || !this.program) return;

    gl.viewport(0, 0, backing.width, backing.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(this.program.frame, plan.frame.width, plan.frame.height);

    for (const item of plan.items) this.drawItem(gl, item, sources, images, at);

    gl.bindVertexArray(null);
  }

  /** Releases everything the GPU is holding. */
  dispose(): void {
    const gl = this.gl;
    if (!gl) return;

    for (const texture of this.textures.values()) gl.deleteTexture(texture);
    this.textures.clear();
    if (this.program) gl.deleteProgram(this.program.program);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.program = null;
    this.vao = null;
  }

  private context(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
    // A context that has been disposed keeps its `gl` — `getContext` hands back
    // the same object for the life of the canvas — but loses its program.
    // Rebuilding here rather than only on first call is what stops a stray
    // `dispose()` leaving this permanently unable to draw.
    if (this.gl) {
      this.program ??= compile(this.gl);
      this.vao ??= this.gl.createVertexArray();
      return this.gl;
    }

    // Deliberately plain. `desynchronized` puts the canvas on its own
    // low-latency surface, which is finicky about being composited inside a
    // transformed container, and `premultipliedAlpha: false` is a rarely
    // travelled path in Chromium's compositor. Neither is worth a preview that
    // might not appear; the shader premultiplies instead, which is the ordinary
    // way to do this and blends identically.
    const gl = canvas.getContext("webgl2", { alpha: true, antialias: false });
    if (!gl) {
      console.error("[editor] no WebGL2 context; the preview cannot draw");
      return null;
    }

    gl.enable(gl.BLEND);
    // Standard source-over on straight alpha, matching the exporter's pipeline
    // state exactly.
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this.program = compile(gl);
    // Said once, at the level the log actually keeps, so "is the preview even
    // drawing" is answerable from a packaged build.
    console.warn(`[editor] WebGL2 ready (${gl.getParameter(gl.VERSION) as string})`);
    // A vertex array is required in WebGL2 even with no attributes: the corner
    // comes from `gl_VertexID`, but a draw with no VAO bound is an error.
    this.vao = gl.createVertexArray();
    this.gl = gl;
    return gl;
  }

  private drawItem(
    gl: WebGL2RenderingContext,
    item: PlanItem,
    sources: Sources,
    images: Images,
    at: number,
  ): void {
    const p = this.program;
    if (!p) return;

    switch (item.kind) {
      case "fill": {
        this.paint(gl, item.paint, item.rect, images);
        break;
      }

      case "shadow": {
        const { rect, shape, quad } = moving(item, at);
        // Dropped by its own `dy`, so the shadow falls rather than sitting
        // exactly behind what casts it. Applied to the corners when the
        // picture is tilted, or the shadow would stay flat under a leaning
        // frame and give the whole thing away.
        set(gl, p, {
          rect: { ...rect, y: rect.y + item.dy },
          shape,
          quad: quad?.map((value, index) => (index % 3 === 1 ? value + item.dy : value)),
          mode: MODE_SHADOW,
          colorA: item.color,
          weight: item.blur / 2,
        });
        drawQuad(gl);
        break;
      }

      case "image": {
        const source = sources[item.source];
        // Nothing to draw is a normal state: the camera has no frame before it
        // opened, and holding its first one would misrepresent the take.
        if (!source) break;

        const texture = this.upload(gl, item.source, source, true);
        if (!texture) break;

        const { rect, shape, quad, focus } = moving(item, at);
        const src = normalised(item.srcRect, source.videoWidth, source.videoHeight);

        set(gl, p, {
          rect,
          shape,
          quad,
          focus,
          // In the source's own texels, so a blur of a given strength looks the
          // same whatever resolution the recording happens to be.
          texel: [1 / Math.max(source.videoWidth, 1), 1 / Math.max(source.videoHeight, 1)],
          mode: MODE_IMAGE,
          src,
          mirror: item.mirror,
        });
        drawQuad(gl);
        break;
      }

      case "stroke": {
        const { rect, shape, quad } = moving(item, at);
        set(gl, p, {
          rect,
          shape,
          quad,
          mode: MODE_STROKE,
          colorA: item.color,
          weight: item.width,
        });
        drawQuad(gl);
        break;
      }

      case "cursor": {
        const image = images.get(item.path);
        const point = image ? cursorAt(item.points, at) : null;
        // No image, or the pointer had left the recorded area. Both draw
        // nothing rather than something wrong.
        if (!image || !point) break;

        const texture = this.upload(gl, item.path, image, false);
        if (!texture) break;

        // Sized by where it sits on the picture, so a tilted frame's pointer
        // grows towards the near edge with everything else on it.
        const size = item.size * point.scale;

        set(gl, p, {
          rect: {
            x: point.x - item.hotspot.x * size,
            y: point.y - item.hotspot.y * size,
            width: size,
            height: size,
          },
          shape: { radius: 0, exponent: 2 },
          mode: MODE_IMAGE,
        });
        drawQuad(gl);
        break;
      }
    }
  }

  /** A background fill: flat, a gradient, or an image scaled to cover. */
  private paint(gl: WebGL2RenderingContext, paint: Paint, rect: Rect, images: Images): void {
    const p = this.program;
    if (!p) return;

    const square: Shape = { radius: 0, exponent: 2 };

    switch (paint.kind) {
      case "solid":
        set(gl, p, { rect, shape: square, mode: MODE_FILL, colorA: paint.color });
        drawQuad(gl);
        return;

      case "gradient": {
        // Measured clockwise from straight up, matching CSS.
        const radians = ((paint.angle - 90) * Math.PI) / 180;
        set(gl, p, {
          rect,
          shape: square,
          mode: MODE_GRADIENT,
          colorA: paint.from,
          colorB: paint.to,
          gradient: [Math.cos(radians), Math.sin(radians)],
        });
        drawQuad(gl);
        return;
      }

      case "image": {
        const image = images.get(paint.path);
        // Not loaded yet, or missing. A flat neutral rather than a transparent
        // hole that shows the editor's own chrome through the frame.
        if (!image) {
          set(gl, p, { rect, shape: square, mode: MODE_FILL, colorA: "#1c1e22" });
          drawQuad(gl);
          return;
        }

        const texture = this.upload(gl, paint.path, image, false);
        if (!texture) return;

        set(gl, p, { rect, shape: square, mode: MODE_IMAGE, src: cover(rect, sizeOf(image)) });
        drawQuad(gl);
        return;
      }
    }
  }

  /**
   * Uploads an image or a video frame, reusing its texture.
   *
   * `live` re-uploads every call, which is what a playing video needs; a still
   * image is sent once and then only referenced. Both clamp to the edge, or a
   * sample a hair outside the crop wraps to the far side and shows as a seam.
   */
  private upload(
    gl: WebGL2RenderingContext,
    key: string,
    image: CanvasImageSource,
    live: boolean,
  ): WebGLTexture | null {
    let texture = this.textures.get(key) ?? null;
    const fresh = texture === null;

    if (!texture) {
      texture = gl.createTexture();
      if (!texture) return null;
      this.textures.set(key, texture);
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    if (fresh) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    if (live || !this.uploaded.has(image)) {
      const size = sizeOf(image);
      if (size.width <= 0 || size.height <= 0) return null;

      try {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          image as TexImageSource,
        );
      } catch (cause) {
        // One unusable image must not take the frame with it. `texImage2D`
        // throws on cross-origin data rather than failing quietly, and this
        // runs inside the render loop — an uncaught throw here stops
        // everything else in the plan from being drawn, which reads as a
        // preview that does not work at all rather than a background that did
        // not load.
        if (!this.refused.has(key)) {
          this.refused.add(key);
          console.error(`[editor] could not upload ${key}:`, cause);
        }
        return null;
      }
      if (!live) this.uploaded.add(image);
    }

    return texture;
  }
}

/** The item's rectangle and shape at a moment, honouring a zoom's motion. */
function moving(
  item: Extract<PlanItem, { motion?: RectKey[] }>,
  at: number,
): { rect: Rect; shape: Shape; quad?: number[]; focus?: RectKey["focus"] } {
  const rect = "rect" in item ? item.rect : item.dstRect;
  if (!item.motion) return { rect, shape: item.shape };

  const key = rectAt(item.motion, at, rect, item.shape.radius);
  return {
    rect: { x: key.x, y: key.y, width: key.width, height: key.height },
    shape: { radius: key.radius, exponent: item.shape.exponent },
    ...(key.quad ? { quad: key.quad } : {}),
    ...(key.focus ? { focus: key.focus } : {}),
  };
}

/** Four zeroed corners: `w` of 0 means "no tilt", read by the vertex shader. */
const FLAT = new Float32Array(12);

interface Draw {
  rect: Rect;
  shape: Shape;
  mode: number;
  quad?: number[];
  src?: [number, number, number, number];
  colorA?: string;
  colorB?: string;
  gradient?: [number, number];
  weight?: number;
  mirror?: boolean;
  focus?: { x: number; y: number; safe: number; strength: number };
  /** One texel of the sampled image, so a blur is measured in its own pixels. */
  texel?: [number, number];
}

function set(gl: WebGL2RenderingContext, p: Program, draw: Draw): void {
  gl.uniform4f(p.rect, draw.rect.x, draw.rect.y, draw.rect.width, draw.rect.height);
  gl.uniform2f(p.shape, draw.shape.radius, draw.shape.exponent);
  gl.uniform1i(p.mode, draw.mode);
  gl.uniform1f(p.weight, draw.weight ?? 0);
  gl.uniform1i(p.mirror, draw.mirror ? 1 : 0);

  const src = draw.src ?? [0, 0, 1, 1];
  gl.uniform4f(p.src, src[0], src[1], src[2], src[3]);

  const a = rgba(draw.colorA ?? "#00000000");
  gl.uniform4f(p.colorA, a[0], a[1], a[2], a[3]);
  const b = rgba(draw.colorB ?? "#00000000");
  gl.uniform4f(p.colorB, b[0], b[1], b[2], b[3]);

  const gradient = draw.gradient ?? [0, 1];
  gl.uniform2f(p.gradient, gradient[0], gradient[1]);

  gl.uniform3fv(p.quad, draw.quad && draw.quad.length === 12 ? draw.quad : FLAT);

  const focus = draw.focus;
  gl.uniform4f(p.focus, focus?.x ?? 0, focus?.y ?? 0, focus?.safe ?? 1, focus?.strength ?? 0);
  gl.uniform2f(p.texel, draw.texel?.[0] ?? 0, draw.texel?.[1] ?? 0);
}

function drawQuad(gl: WebGL2RenderingContext): void {
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/** A source rectangle in pixels, as the 0-1 the shader samples with. */
function normalised(rect: Rect, width: number, height: number): [number, number, number, number] {
  if (width <= 0 || height <= 0) return [0, 0, 1, 1];
  return [rect.x / width, rect.y / height, rect.width / width, rect.height / height];
}

/**
 * The part of an image a `cover` fill shows.
 *
 * The largest centred region with the destination's shape. Mirrors `cover` in
 * the exporter's compositor: a background is the one thing on screen with no
 * edge of its own to give a difference away.
 */
function cover(
  rect: Rect,
  size: { width: number; height: number },
): [number, number, number, number] {
  if (size.width <= 0 || size.height <= 0 || rect.width <= 0 || rect.height <= 0) {
    return [0, 0, 1, 1];
  }

  const scale = Math.max(rect.width / size.width, rect.height / size.height);
  const visibleWidth = Math.min(rect.width / scale, size.width);
  const visibleHeight = Math.min(rect.height / scale, size.height);

  return [
    (size.width - visibleWidth) / 2 / size.width,
    (size.height - visibleHeight) / 2 / size.height,
    visibleWidth / size.width,
    visibleHeight / size.height,
  ];
}

function sizeOf(image: CanvasImageSource): { width: number; height: number } {
  if (image instanceof HTMLImageElement) {
    return { width: image.naturalWidth, height: image.naturalHeight };
  }
  if (image instanceof HTMLVideoElement) {
    return { width: image.videoWidth, height: image.videoHeight };
  }
  const sized = image as { width: number; height: number };
  return { width: sized.width, height: sized.height };
}

/**
 * A plan colour as four floats.
 *
 * Both forms the plan can carry, because it is written by a browser: `#rrggbb`
 * for anything the user picked, `rgba()` where an opacity was folded in.
 */
function rgba(color: string): [number, number, number, number] {
  const parsed = /rgba?\(([^)]+)\)/.exec(color);
  if (parsed) {
    const parts = parsed[1]!.split(",").map((part) => Number(part.trim()));
    return [(parts[0] ?? 0) / 255, (parts[1] ?? 0) / 255, (parts[2] ?? 0) / 255, parts[3] ?? 1];
  }

  const hex = color.replace("#", "");
  const value = parseInt(hex.slice(0, 6), 16);
  const alpha = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;

  return [
    ((value >> 16) & 0xff) / 255,
    ((value >> 8) & 0xff) / 255,
    (value & 0xff) / 255,
    Number.isNaN(alpha) ? 1 : alpha,
  ];
}

function compile(gl: WebGL2RenderingContext): Program | null {
  const build = (kind: number, source: string) => {
    const shader = gl.createShader(kind);
    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      // Logged rather than thrown: a preview that cannot compile its shader is
      // a broken editor, and the log is the only place that would say why.
      console.error("[editor] shader failed to compile:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const vertex = build(gl.VERTEX_SHADER, VERTEX);
  const fragment = build(gl.FRAGMENT_SHADER, FRAGMENT);
  if (!vertex || !fragment) return null;

  const program = gl.createProgram();
  if (!program) return null;

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("[editor] shader failed to link:", gl.getProgramInfoLog(program));
    return null;
  }

  const at = (name: string) => gl.getUniformLocation(program, name);
  return {
    program,
    rect: at("u_rect"),
    src: at("u_src"),
    shape: at("u_shape"),
    frame: at("u_frame"),
    colorA: at("u_colorA"),
    colorB: at("u_colorB"),
    gradient: at("u_gradient"),
    mode: at("u_mode"),
    weight: at("u_weight"),
    mirror: at("u_mirror"),
    quad: at("u_quad"),
    focus: at("u_focus"),
    texel: at("u_texel"),
  };
}

/** Whether a video element has a frame worth drawing. */
export function isReady(element: HTMLVideoElement | null): boolean {
  return element !== null && element.readyState >= 2 && element.videoWidth > 0;
}
