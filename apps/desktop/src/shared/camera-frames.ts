/**
 * The catalogue of frames the camera can be dressed in.
 *
 * A frame is a picture with a hole in it — a polaroid's paper, a window's
 * chrome, a stamp's perforated edge, a television's cabinet — hung round the
 * bubble so the camera shows through the hole. The artwork ships with the app
 * and is copied onto the library shelf the first time an editor opens, so both
 * rasterisers reach it the way they already reach a wallpaper: a path in the
 * plan. See `shared/library.ts`.
 *
 * Deliberately free of any DOM, Node or React import: the editor builds its
 * picker from this, `layout.ts` resolves a plan from it, main seeds the shelf
 * from it, and all three have to work in a test with none of them.
 *
 * ## The art is the geometry
 *
 * Nothing here describes how a frame looks — that is in the PNG. What is here
 * is the one thing a picture cannot say for itself: **where its hole is**,
 * measured off the artwork and written down as fractions of it. `layout.ts`
 * works backwards from that to place the plate, so the camera stays exactly
 * where and the size it was and the paper is hung round it.
 *
 * The numbers come from `scripts/make-frames.mjs`, which makes the art and
 * prints them. They are not guesses to be nudged: re-run it and paste what it
 * says, or the hole drifts off the picture.
 *
 * Three of the four are photographs of objects, cut out of their source art.
 * The window is *drawn*, by `scripts/window-frame.mjs` — it is flat fills, a
 * hairline and three discs, and a photograph of those can only be a softer
 * version of them. See that file.
 *
 * Because the hole is part of the art, picking a frame takes the camera's
 * corner radius over for as long as it is on — a polaroid with a circular
 * window is not a polaroid, and the paper would crop one anyway. The stored
 * `cameraCornerRadius` is left untouched underneath, so taking the frame off
 * puts back exactly the roundness that was dialled in before.
 *
 * ## Why the plan carries the id and not the plate
 *
 * The id is what a project stores and what the plan names, as a click mark's
 * is: a frame this build does not ship draws no plate, which is the right
 * answer for a project written by a newer one. The rasterisers never see the
 * id — `layout.ts` resolves it to a path and a rectangle, so neither side has
 * a table of frames to drift out of step with the other's.
 */

/** Every frame, by the name that travels in `project.json`. */
export type CameraFrameId = "none" | "polaroid" | "window" | "stamp" | "crt" | "macintosh";

export interface CameraFrameSpec {
  label: string;
  /**
   * A sentence for the picker's tooltip. Plain and short, like the rest of the
   * editor's copy — what it looks like, not what it is doing.
   */
  hint: string;
  /** The artwork, by the bare name it has in `resources/frames` and on the shelf. */
  file: string;
  /**
   * Where the hole is in that artwork, as fractions of it.
   *
   * Measured from the alpha channel rather than written by hand — see the note
   * above. Every frame here is deeper along one edge than the other three,
   * which is most of what makes each one recognisable at thumbnail size: the
   * polaroid's writing strip, the window's title bar, the television's deck.
   */
  aperture: { x: number; y: number; width: number; height: number };
  /**
   * What the hole is shaped like — its width over its height.
   *
   * Written onto `cameraWidth` when the frame is picked, exactly as a shape's
   * own proportions are: a frame opens drawn at the proportions it was made
   * at rather than stretched into whatever the last shape left behind.
   *
   * It is not read after that, and nothing has to put it back: a framed camera
   * resizes proportionally whichever handle is pulled — see the aspect lock in
   * `Preview.tsx` — so the hole keeps the shape the art was cut at for as long
   * as the frame is on.
   */
  aspect: number;
  /**
   * A rounded rectangle standing in for the plate's outline, as a fraction of
   * the plate's shorter edge, and the superellipse exponent of its corners.
   *
   * Read by the shadow and by nothing else. The real silhouette is the art's
   * alpha — scallops, knobs and all — and a shadow that chased every scallop
   * would be work the export pays for and nobody can see through a blur. It is
   * near enough that the shadow lands under the object rather than beside it,
   * which is all a shadow has to do.
   */
  plate: { radius: number; exponent: number };
}

/**
 * The frames, by id. `none` is not in here: it is the absence of a frame
 * rather than one of them, and giving it a row would mean every reader had to
 * know which row means "do not draw".
 */
export const CAMERA_FRAMES: Record<Exclude<CameraFrameId, "none">, CameraFrameSpec> = {
  polaroid: {
    label: "Polaroid",
    hint: "Instant-film paper, with the wide strip along the bottom.",
    file: "polaroid.png",
    aperture: { x: 0.0685, y: 0.0722, width: 0.8605, height: 0.7122 },
    aspect: 1.0967,
    plate: { radius: 0.02, exponent: 2 },
  },
  window: {
    label: "Window",
    hint: "A Mac window, with its title bar and three lights.",
    file: "window.png",
    aperture: { x: 0.0238, y: 0.0892, width: 0.9524, height: 0.8854 },
    aspect: 1.1511,
    // Exactly what `window-frame.mjs` draws rather than an approximation of
    // it: this is the one frame whose silhouette is arithmetic on this side of
    // the repo too, so the shadow can trace the corner instead of guessing at
    // it. A 10pt corner on a 942-tall plate, and macOS's squircle.
    plate: { radius: 0.0318, exponent: 4 },
  },
  stamp: {
    label: "Stamp",
    hint: "Perforated paper with a printed keyline.",
    file: "stamp.png",
    aperture: { x: 0.0844, y: 0.0988, width: 0.8311, height: 0.8081 },
    aspect: 1.0389,
    plate: { radius: 0.015, exponent: 2 },
  },
  crt: {
    label: "Television",
    hint: "A valve set's cabinet, with its grille and knobs.",
    file: "crt.png",
    aperture: { x: 0.0978, y: 0.0972, width: 0.7978, height: 0.6519 },
    aspect: 1.3223,
    plate: { radius: 0.07, exponent: 2 },
  },
  macintosh: {
    label: "Macintosh",
    hint: "A Macintosh SE, badge, drive slots and all.",
    file: "macintosh.png",
    aperture: { x: 0.1453, y: 0.1511, width: 0.7053, height: 0.3922 },
    aspect: 1.4306,
    plate: { radius: 0.04, exponent: 2 },
  },
};

/** Every frame's id, in the order the picker offers them. */
export const CAMERA_FRAME_IDS = Object.keys(CAMERA_FRAMES) as Exclude<CameraFrameId, "none">[];

/**
 * Every frame's artwork, by file name.
 *
 * One list rather than three: main seeds the shelf from it, the editor
 * preloads from it, and a frame added to the table above is in both without
 * anybody remembering to add it.
 */
export const CAMERA_FRAME_FILES = CAMERA_FRAME_IDS.map((id) => CAMERA_FRAMES[id].file);

/**
 * The frame an id names, or null for none of them.
 *
 * Null for `none` and null for a name this build has never heard of, which are
 * the same answer on purpose: a project written by a newer build names a frame
 * that is not here, and drawing no plate beats refusing to open it.
 */
export function cameraFrame(id: string): CameraFrameSpec | null {
  if (!Object.hasOwn(CAMERA_FRAMES, id)) return null;
  return CAMERA_FRAMES[id as Exclude<CameraFrameId, "none">];
}
