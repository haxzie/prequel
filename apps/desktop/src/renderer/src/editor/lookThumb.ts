import type { CameraGrade } from "../../../shared/camera-looks";
import { LOOK_REFERENCE } from "./lookReference";
import { GRADE_GLSL } from "./webgl";

/**
 * The little graded pictures down the side of the Effects list.
 *
 * Drawn through the *same* GLSL the compositor grades the camera with — see
 * `GRADE_GLSL`, which exists so there is one copy of it. A swatch built out of
 * CSS filters would have been a tenth of this file and would have been a
 * picture of a look that is not the look: `saturate()` has no idea what skin
 * is, and the vibrance that spares a face is most of what separates these six.
 * A reader choosing from a list of them has no way to tell a lying swatch from
 * an honest one, which is exactly why it has to be honest.
 *
 * One WebGL context for the whole list, held at module scope. Seven canvases
 * would be seven contexts, and a browser gives out somewhere around sixteen
 * before it starts dropping the oldest — the preview's own among them.
 */

/**
 * How big the offscreen is drawn, before it is scaled into each row.
 *
 * Portrait, matching the reference and matching what a camera bubble actually
 * holds: a face, upright. Three by four rather than the nine by sixteen a phone
 * would give, because the swatch sits in a row of text and a tall one would set
 * the height of the whole list.
 */
const WIDTH = 96;
const HEIGHT = 128;

const VERTEX = `#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  v_uv = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec4 u_gradeA;
uniform vec4 u_gradeB;
uniform vec4 u_gradeC;
in vec2 v_uv;
out vec4 fragColor;

${GRADE_GLSL}

void main() {
  vec3 rgb = texture(u_image, v_uv).rgb;
  // The same switch the compositor reads, so an ungraded swatch is the
  // reference picture exactly rather than the picture put through a grade of
  // all zeroes — which is very nearly but not quite the same thing.
  if (u_gradeC.z > 0.0) rgb = graded(rgb, u_gradeA, u_gradeB, u_gradeC);
  fragColor = vec4(rgb, 1.0);
}`;

interface Rig {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  vao: WebGLVertexArrayObject | null;
  gradeA: WebGLUniformLocation | null;
  gradeB: WebGLUniformLocation | null;
  gradeC: WebGLUniformLocation | null;
}

let rig: Rig | null = null;
let failed = false;

/**
 * The reference the looks are shown on, decoded once.
 *
 * A photograph rather than something drawn, because every look in the
 * catalogue is tuned for skin and a swatch without a face in it would be
 * answering a different question. See `lookReference`, which says why it is
 * inlined.
 *
 * Held as a promise at module scope: six rows all ask for it at once the first
 * time the list opens, and a promise is what makes that one decode instead of
 * six.
 */
let picture: Promise<HTMLImageElement> | null = null;

function reference(): Promise<HTMLImageElement> {
  picture ??= new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("the look reference would not decode"));
    image.src = LOOK_REFERENCE;
  });
  return picture;
}

/** Builds the context and uploads the reference, once. Null once it has failed. */
async function build(): Promise<Rig | null> {
  if (rig) return rig;
  if (failed) return null;

  let image: HTMLImageElement;
  try {
    image = await reference();
  } catch (cause) {
    console.error("[editor] the look swatches have no reference picture:", cause);
    failed = true;
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false });
  if (!gl) {
    failed = true;
    return null;
  }

  const compile = (kind: number, source: string) => {
    const shader = gl.createShader(kind);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      // Logged rather than thrown, like the compositor's: a swatch that will
      // not compile costs the swatches, and the list still works without them.
      console.error("[editor] the look swatch shader failed:", gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  };

  const vertex = compile(gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
  const program = vertex && fragment ? gl.createProgram() : null;
  if (!vertex || !fragment || !program) {
    failed = true;
    return null;
  }

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("[editor] the look swatch shader failed to link:", gl.getProgramInfoLog(program));
    failed = true;
    return null;
  }

  gl.useProgram(program);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  // Flipped on the way in. A decoded image runs top-down and a texture's v
  // runs bottom-up, and the quad here maps v straight from the corner id — so
  // without this the reference is uploaded on its head, which is exactly how it
  // first drew. The compositor needs no such flag because its geometry already
  // accounts for the difference.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.uniform1i(gl.getUniformLocation(program, "u_image"), 0);

  rig = {
    gl,
    canvas,
    // Required in WebGL2 even with no attributes: the corner comes from
    // gl_VertexID, but a draw with no array bound is an error.
    vao: gl.createVertexArray(),
    gradeA: gl.getUniformLocation(program, "u_gradeA"),
    gradeB: gl.getUniformLocation(program, "u_gradeB"),
    gradeC: gl.getUniformLocation(program, "u_gradeC"),
  };
  return rig;
}

/**
 * Paints one swatch: the reference picture, through `grade`.
 *
 * Into a plain 2-D canvas the row owns, rather than giving each row a context
 * of its own. `drawImage` off a WebGL canvas is a copy the compositor does for
 * free, and it leaves the row an ordinary element that scales and rounds with
 * CSS like anything else.
 *
 * Does nothing it cannot do. No context, no shader, no picture — the list
 * draws its names and the swatch column is simply empty.
 *
 * Asynchronous only because the reference has to decode, which happens once for
 * the life of the window. Every call after that resolves on the microtask
 * queue, so a row re-painting is still within the frame.
 */
export async function paintLookThumb(
  target: HTMLCanvasElement,
  grade: CameraGrade | null,
): Promise<void> {
  const built = await build();
  if (!built) return;

  const { gl } = built;
  gl.bindVertexArray(built.vao);
  gl.viewport(0, 0, WIDTH, HEIGHT);
  gl.uniform4f(
    built.gradeA,
    grade?.temperature ?? 0,
    grade?.tint ?? 0,
    grade?.contrast ?? 0,
    grade?.saturation ?? 0,
  );
  gl.uniform4f(
    built.gradeB,
    grade?.vibrance ?? 0,
    grade?.lift ?? 0,
    grade?.shadowHue ?? 0,
    grade?.shadowAmount ?? 0,
  );
  gl.uniform4f(
    built.gradeC,
    grade?.highlightHue ?? 0,
    grade?.highlightAmount ?? 0,
    grade ? 1 : 0,
    0,
  );
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null);

  const ctx = target.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(built.canvas, 0, 0, target.width, target.height);
}
