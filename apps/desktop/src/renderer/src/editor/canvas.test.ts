/**
 * That the expensive half of a frame is actually reused.
 *
 * The preview repaints the whole frame, but only the video changes between
 * frames — the background gradient and the blurred shadow behind the screen are
 * identical every time, and both are far more expensive than the two
 * `drawImage` calls that are not. Rebuilding them sixty times a second is what
 * made a preview with a camera as well as a screen crawl.
 *
 * The cache only helps if its signature is stable across frames, and the plan
 * is rebuilt from scratch every frame — so this checks the thing that would
 * silently undo the whole optimisation.
 */
import { describe, expect, it } from "vitest";

import { buildRenderPlan } from "../../../shared/layout";
import { DEFAULT_SETTINGS, type SliceSettings } from "../../../shared/project";

const FRAME = { width: 1920, height: 1080 };
const SCREEN = { width: 2560, height: 1440 };
const CAMERA = { width: 1280, height: 720 };

function settings(overrides: Partial<SliceSettings["background"]> = {}): SliceSettings {
  const base = structuredClone(DEFAULT_SETTINGS);
  return { ...base, background: { ...base.background, ...overrides } };
}

/**
 * The half of a plan the compositor caches: everything before the first video
 * frame. Mirrors the split in `PreviewCompositor.draw`.
 */
function staticHalf(plan: ReturnType<typeof buildRenderPlan>) {
  const split = plan.items.findIndex((item) => item.kind === "image");
  return JSON.stringify(split === -1 ? plan.items : plan.items.slice(0, split));
}

describe("the cached layer", () => {
  it("is identical between two frames of the same edit", () => {
    // The plan is rebuilt every frame from new objects, so the signature has to
    // compare by value. If this ever differs, the layer is rebuilt every frame
    // and the cache costs more than it saves.
    const first = buildRenderPlan(FRAME, { screen: SCREEN, camera: CAMERA }, settings());
    const second = buildRenderPlan(FRAME, { screen: SCREEN, camera: CAMERA }, settings());

    expect(staticHalf(first)).toBe(staticHalf(second));
  });

  it("holds the background and the shadow, and nothing that moves", () => {
    const plan = buildRenderPlan(FRAME, { screen: SCREEN, camera: CAMERA }, settings());
    const cached = JSON.parse(staticHalf(plan)) as { kind: string }[];

    // The two expensive ones: a full-frame gradient and a blur.
    expect(cached.map((item) => item.kind)).toEqual(["fill", "shadow"]);
    // And nothing that depends on a video frame.
    expect(cached.some((item) => item.kind === "image")).toBe(false);
  });

  it("changes when the background does", () => {
    const before = buildRenderPlan(FRAME, { screen: SCREEN, camera: CAMERA }, settings());
    const after = buildRenderPlan(
      FRAME,
      { screen: SCREEN, camera: CAMERA },
      settings({ background: { kind: "solid", color: "#ff0000" } }),
    );

    expect(staticHalf(before)).not.toBe(staticHalf(after));
  });

  it("changes when the padding moves the shadow", () => {
    const before = buildRenderPlan(FRAME, { screen: SCREEN, camera: CAMERA }, settings());
    const after = buildRenderPlan(
      FRAME,
      { screen: SCREEN, camera: CAMERA },
      settings({ padding: 0.2 }),
    );

    expect(staticHalf(before)).not.toBe(staticHalf(after));
  });

  it("does not change when only the camera is toggled", () => {
    // The camera is drawn after the split, so switching it cannot invalidate
    // the background — that would rebuild a blur for nothing.
    const base = structuredClone(DEFAULT_SETTINGS);
    const withCamera = buildRenderPlan(FRAME, { screen: SCREEN, camera: CAMERA }, base);
    const without = buildRenderPlan(
      FRAME,
      { screen: SCREEN, camera: CAMERA },
      {
        ...base,
        layout: { ...base.layout, cameraVisible: false },
      },
    );

    expect(staticHalf(withCamera)).toBe(staticHalf(without));
  });
});
