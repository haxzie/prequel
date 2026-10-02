/**
 * The looks a camera can wear, and the grade each one resolves to.
 *
 * A catalogue of *numbers*, not of shader code — which is the whole point, and
 * the one thing this does differently from `filters.ts`. A filter is an arm of a
 * switch in two shaders that have to be kept in step by hand, so adding one is
 * two pieces of GLSL and MSL and a test that compares them. A look here is a row
 * in this file: `buildRenderPlan` resolves it to eight numbers, the plan carries
 * them, and both rasterisers run the same grading function over whatever they
 * are handed. The preview and the export cannot come to disagree about what
 * "Warm" means, because neither of them knows.
 *
 * It is also why these are not `.cube` files. A real lookup table would mean an
 * asset per look, a parser, a 3-D texture in two graphics APIs and a fourth
 * texture slot in a shader whose uniform block is already hand-aligned. The
 * grade below reaches most of what a table would for a face in a bubble, and
 * when a table is genuinely wanted it drops into the same place: the plan gains
 * a path beside the numbers and `graded` samples it instead.
 *
 * Every look is built for **skin first**. A camera in a recording is a person,
 * usually lit by whatever was in the room, and the failures are always the same
 * two: a face going orange under a warm bulb, or going grey and flat under a
 * window. So the levers here are the ones that fix those — white balance, a
 * gentle contrast, and a saturation that spares skin — rather than the ones
 * that make a landscape look cinematic.
 */

/**
 * What a look does to the picture, once resolved.
 *
 * Deliberately small, and every field is signed and centred on zero so that
 * "none" is all zeroes and a strength of 0 is the identity. That is what lets
 * the plan leave the whole thing out when there is no look, and what makes
 * fading one in a matter of scaling the row rather than interpolating towards a
 * neutral that would have to be written down somewhere.
 */
export interface CameraGrade {
  /** Warmer above zero, cooler below. The first thing a face needs. */
  temperature: number;
  /** Magenta above zero, green below. The second thing a face needs. */
  tint: number;
  /** An S-curve about mid grey. Positive is more contrast. */
  contrast: number;
  /** Flat saturation, which moves skin as much as anything else. */
  saturation: number;
  /**
   * Saturation that spares what is already saturated, and skin most of all.
   *
   * The useful one. Flat saturation on a face drives it orange long before the
   * room has any colour in it; this weights by how grey a pixel already is, and
   * then weights *again* by how far its hue is from skin — so a dull background
   * comes up and the person does not.
   */
  vibrance: number;
  /**
   * Raises the blacks without touching the whites, 0 to 1 of the way to mid.
   *
   * The film-print look, and the one thing that most reliably takes the "webcam"
   * out of a webcam: a sensor in a dim room clips its shadows to nothing, and
   * lifting them puts the room back.
   */
  lift: number;
  /** Colour pushed into the shadows, as a hue angle in turns and an amount. */
  shadowHue: number;
  shadowAmount: number;
  /** And into the highlights. Opposing the two is what reads as film. */
  highlightHue: number;
  highlightAmount: number;
}

/** No look at all: every lever at rest. */
export const NO_GRADE: CameraGrade = {
  temperature: 0,
  tint: 0,
  contrast: 0,
  saturation: 0,
  vibrance: 0,
  lift: 0,
  shadowHue: 0,
  shadowAmount: 0,
  highlightHue: 0,
  highlightAmount: 0,
};

export interface CameraLook {
  id: string;
  label: string;
  /** One line, shown under the name in the picker. */
  note: string;
  grade: CameraGrade;
}

/**
 * The catalogue, in the order the picker shows it.
 *
 * Short on purpose. A dozen looks is a gallery to browse; six is a decision to
 * make, and every one of these answers a room somebody has actually recorded
 * in. `none` leads because it is the honest default — a camera that was already
 * well lit does not want any of this.
 */
export const CAMERA_LOOKS: readonly CameraLook[] = [
  {
    id: "none",
    label: "None",
    note: "The camera as it was recorded",
    grade: NO_GRADE,
  },
  {
    id: "natural",
    label: "Natural",
    note: "Evens out the room without changing the colour",
    grade: {
      ...NO_GRADE,
      // Almost nothing, and that is the look. A touch of contrast to undo the
      // flat profile most webcams record in, and vibrance rather than
      // saturation so the gain lands on the room and not on the face.
      contrast: 0.14,
      vibrance: 0.18,
      lift: 0.03,
    },
  },
  {
    id: "warm",
    label: "Warm",
    note: "For a cold room or a window behind you",
    grade: {
      ...NO_GRADE,
      // A window is daylight at around 6500K against skin that wants nearer
      // 5000, which is why a face by a window reads grey. This walks it back.
      temperature: 0.3,
      tint: 0.06,
      contrast: 0.12,
      vibrance: 0.2,
      lift: 0.04,
      highlightHue: 0.09,
      highlightAmount: 0.1,
    },
  },
  {
    id: "cool",
    label: "Cool",
    note: "For a warm bulb overhead",
    grade: {
      ...NO_GRADE,
      // The opposite failure, and the more common one: a tungsten or warm LED
      // bulb pushes a face orange, and no amount of saturation fixes a white
      // balance.
      temperature: -0.26,
      tint: 0.04,
      contrast: 0.12,
      vibrance: 0.16,
      lift: 0.03,
      shadowHue: 0.58,
      shadowAmount: 0.08,
    },
  },
  {
    id: "film",
    label: "Film",
    note: "Lifted blacks, teal shadows, warm highlights",
    grade: {
      ...NO_GRADE,
      temperature: 0.1,
      contrast: 0.2,
      saturation: -0.08,
      vibrance: 0.22,
      // The print look. The lift is what does most of the work; the split
      // toning is what stops the lift reading as a washed-out picture.
      lift: 0.1,
      shadowHue: 0.53,
      shadowAmount: 0.16,
      highlightHue: 0.08,
      highlightAmount: 0.14,
    },
  },
  {
    id: "clean",
    label: "Clean",
    note: "Crisp and neutral, for a bright room",
    grade: {
      ...NO_GRADE,
      // No colour cast at all, which is the point — some rooms are already
      // right and only want the contrast a webcam's flat profile throws away.
      contrast: 0.26,
      vibrance: 0.1,
      saturation: 0.04,
    },
  },
  {
    id: "soft",
    label: "Soft",
    note: "Gentle and low contrast, for harsh light",
    grade: {
      ...NO_GRADE,
      // A ring light or a hard overhead blows the highlights on a face and
      // leaves the shadows black. Pulling the contrast down and lifting is the
      // only honest answer short of relighting the room.
      temperature: 0.12,
      contrast: -0.12,
      vibrance: 0.14,
      lift: 0.12,
      highlightHue: 0.1,
      highlightAmount: 0.08,
    },
  },
];

/** A look by id, or the first — which is `none`, so an unknown id wears nothing. */
export function cameraLook(id: string): CameraLook {
  return CAMERA_LOOKS.find((look) => look.id === id) ?? CAMERA_LOOKS[0]!;
}

/**
 * The grade a look and a strength resolve to, or null where there is nothing
 * to do.
 *
 * Null rather than a row of zeroes, so the plan carries no grade at all for the
 * overwhelmingly common case and both rasterisers skip the work by looking at
 * one field. Scaling every lever by the strength is exactly a fade towards the
 * untouched picture, because the levers are all signed and centred on zero.
 */
export function resolveGrade(id: string, strength: number): CameraGrade | null {
  const amount = Math.max(0, Math.min(1, strength));
  const look = cameraLook(id);
  if (look.id === "none" || amount <= 0) return null;

  const scaled = (value: number) => value * amount;
  return {
    temperature: scaled(look.grade.temperature),
    tint: scaled(look.grade.tint),
    contrast: scaled(look.grade.contrast),
    saturation: scaled(look.grade.saturation),
    vibrance: scaled(look.grade.vibrance),
    lift: scaled(look.grade.lift),
    // The hues are *directions*, not amounts, so they are held and only the
    // amounts fade. Scaling a hue would walk the shadows round the colour
    // wheel as the slider moved, which is not what anybody means by "less".
    shadowHue: look.grade.shadowHue,
    shadowAmount: scaled(look.grade.shadowAmount),
    highlightHue: look.grade.highlightHue,
    highlightAmount: scaled(look.grade.highlightAmount),
  };
}
