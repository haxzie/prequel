/**
 * The drop-ups are native menus, and what is worth pinning about them is the
 * contract the panel relies on: a pick comes back through the promise, a
 * dismissal comes back as `null`, and the menu is placed so it stands *above*
 * the panel rather than on it.
 *
 * Placement is the one with history. A menu popped with no positioning item
 * is put wherever fits on the screen, which at the bottom of a display means
 * on top of the pill that opened it — Electron only keeps a popup on the
 * screen, not clear of its own window. Positioning the *last* item is what
 * makes the menu grow upward from the point, and that is asserted here because
 * dropping the option would still open a menu, just in the wrong place.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MenuItemConstructorOptions } from "electron";

import type { DockMenu } from "../../shared/contract.js";

interface Popup {
  x?: number;
  y?: number;
  positioningItem?: number;
  callback?: () => void;
}

/** Every popup asked for, with its options, so a test can close it. */
const popups: { template: MenuItemConstructorOptions[]; options: Popup }[] = [];
const closed: number[] = [];

vi.mock("electron", () => ({
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => ({
      items: template,
      popup(options: Popup) {
        popups.push({ template, options });
      },
      closePopup() {
        closed.push(popups.length);
      },
    }),
  },
}));

const { DockMenuPopup, dockMenuTemplate } = await import("./dock-menu.js");

const WINDOW = { isDestroyed: () => false } as never;

const CAMERAS: DockMenu = {
  kind: "camera",
  anchor: { x: 120, y: 40 },
  devices: [
    { deviceId: "a", label: "MacBook Pro Camera" },
    { deviceId: "b", label: "iPhone Camera" },
  ],
  selectedId: "b",
};

/** Clicks the item at `index` in the last popup and then closes the menu —
    the order Electron delivers them in, and deliberately so. */
function pickItem(index: number) {
  const popup = popups.at(-1)!;
  popup.template[index]!.click?.(undefined as never, undefined, undefined as never);
  popup.options.callback?.();
}

beforeEach(() => {
  popups.length = 0;
  closed.length = 0;
});

describe("the teleprompter menu", () => {
  const PROMPTER: DockMenu = {
    kind: "teleprompter",
    anchor: { x: 0, y: 0 },
    mode: "voice",
    size: "medium",
    displays: ["Built-in Retina Display"],
    display: null,
  };

  it("offers the script first, then the mode and size with the current ones ticked", () => {
    const template = dockMenuTemplate(PROMPTER, () => undefined);

    expect(template.map((item) => item.label ?? item.type)).toEqual([
      "Edit Script…",
      "separator",
      "Follow My Voice",
      "Auto-scroll",
      "Manual",
      "separator",
      "Small Text",
      "Medium Text",
      "Large Text",
    ]);
    expect(template.filter((item) => item.checked).map((item) => item.label)).toEqual([
      "Follow My Voice",
      "Medium Text",
    ]);
  });

  it("offers the displays only when there is more than one to choose from", () => {
    const one = dockMenuTemplate(PROMPTER, () => undefined);
    expect(one.some((item) => item.label?.startsWith("On "))).toBe(false);

    const two = dockMenuTemplate(
      {
        ...PROMPTER,
        displays: ["Built-in Retina Display", "Studio Display"],
        display: "Studio Display",
      },
      () => undefined,
    );
    expect(two.slice(-3).map((item) => [item.label, item.checked])).toEqual([
      ["Follow the Camera", false],
      ["On Built-in Retina Display", false],
      ["On Studio Display", true],
    ]);
  });

  it("resolves with the mode or size that was picked", async () => {
    const menus = new DockMenuPopup();
    const picked = menus.open(PROMPTER, WINDOW);

    pickItem(3);

    await expect(picked).resolves.toEqual({ kind: "teleprompterMode", mode: "timed" });
  });
});

describe("a device menu", () => {
  it("lists every device, then Off, with the chosen one ticked", () => {
    const template = dockMenuTemplate(CAMERAS, () => undefined);

    expect(template.map((item) => item.label ?? item.type)).toEqual([
      "MacBook Pro Camera",
      "iPhone Camera",
      "separator",
      "Off",
    ]);
    expect(template.map((item) => item.checked ?? false)).toEqual([false, true, false, false]);
  });

  it("ticks Off when the device is switched off", () => {
    const template = dockMenuTemplate({ ...CAMERAS, selectedId: null }, () => undefined);

    expect(template.at(-1)).toMatchObject({ label: "Off", checked: true });
  });

  it("resolves with the device that was picked", async () => {
    const menus = new DockMenuPopup();
    const picked = menus.open(CAMERAS, WINDOW);

    pickItem(0);

    await expect(picked).resolves.toEqual({
      kind: "camera",
      device: { deviceId: "a", label: "MacBook Pro Camera" },
    });
  });

  it("resolves with no device when Off is picked", async () => {
    const menus = new DockMenuPopup();
    const picked = menus.open(CAMERAS, WINDOW);

    pickItem(3);

    await expect(picked).resolves.toEqual({ kind: "camera", device: null });
  });
});

describe("the permissions menu", () => {
  it("offers each missing permission with what it costs underneath", () => {
    const template = dockMenuTemplate(
      { kind: "permissions", anchor: { x: 0, y: 0 }, missing: ["camera"] },
      () => undefined,
    );

    expect(template).toHaveLength(1);
    expect(template[0]).toMatchObject({
      label: "Allow Camera…",
      sublabel: expect.stringContaining("camera") as string,
    });
  });

  it("offers a restart only when a missing permission needs one", () => {
    // Camera and microphone come back from a prompt and take effect at once;
    // a Restart item beside them would be an instruction with no reason.
    const prompted = dockMenuTemplate(
      { kind: "permissions", anchor: { x: 0, y: 0 }, missing: ["camera", "microphone"] },
      () => undefined,
    );
    expect(prompted.some((item) => item.label === "Restart Prequel")).toBe(false);

    const fixedAtLaunch = dockMenuTemplate(
      { kind: "permissions", anchor: { x: 0, y: 0 }, missing: ["accessibility"] },
      () => undefined,
    );
    expect(fixedAtLaunch.at(-1)).toMatchObject({ label: "Restart Prequel" });
  });

  it("resolves with the permission that was asked for", async () => {
    const menus = new DockMenuPopup();
    const picked = menus.open(
      { kind: "permissions", anchor: { x: 0, y: 0 }, missing: ["screen", "accessibility"] },
      WINDOW,
    );

    pickItem(1);

    await expect(picked).resolves.toEqual({ kind: "permission", id: "accessibility" });
  });
});

describe("any menu", () => {
  it("resolves with nothing when it is dismissed", async () => {
    const menus = new DockMenuPopup();
    const picked = menus.open(CAMERAS, WINDOW);

    popups.at(-1)!.options.callback?.();

    await expect(picked).resolves.toBeNull();
    expect(menus.openKind).toBeNull();
  });

  it("reports which kind is open for as long as it is", () => {
    const menus = new DockMenuPopup();
    void menus.open(CAMERAS, WINDOW);

    expect(menus.openKind).toBe("camera");

    popups.at(-1)!.options.callback?.();

    expect(menus.openKind).toBeNull();
  });

  it("is popped from its last item, above the control", () => {
    const menus = new DockMenuPopup();
    void menus.open(CAMERAS, WINDOW);

    const { options, template } = popups.at(-1)!;
    // The last item, so the menu grows upward from the point — see the file
    // comment. The first would put the menu's top there and the rest of it
    // over the panel.
    expect(options.positioningItem).toBe(template.length - 1);
    expect(options.x).toBe(120);
    // Above the control's top edge, not on it.
    expect(options.y).toBeLessThan(40);
  });

  it("lifts a menu further when its last item is two lines tall", () => {
    // The Restart item carries a sublabel, and a menu lifted by a one-line
    // item's height would end on top of the panel by the other line's.
    const menus = new DockMenuPopup();
    void menus.open(CAMERAS, WINDOW);
    const plain = popups.at(-1)!.options.y!;

    void menus.open(
      { kind: "permissions", anchor: CAMERAS.anchor, missing: ["accessibility"] },
      WINDOW,
    );
    const twoLine = popups.at(-1)!.options.y!;

    expect(twoLine).toBeLessThan(plain);
  });

  it("closes what is open before opening another, resolving the first with nothing", async () => {
    const menus = new DockMenuPopup();
    const first = menus.open(CAMERAS, WINDOW);

    void menus.open({ ...CAMERAS, kind: "microphone" }, WINDOW);
    // What AppKit does once `closePopup` lands.
    popups[0]!.options.callback?.();

    expect(closed).toHaveLength(1);
    await expect(first).resolves.toBeNull();
    // The second menu's state is not undone by the first one's close.
    expect(menus.openKind).toBe("microphone");
  });
});
