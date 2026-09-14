/**
 * The dock's drop-ups, as native menus.
 *
 * They were a second `BrowserWindow` before this. It had to be one — a vibrant
 * window gets exactly one `NSVisualEffectView` filling exactly its own
 * rectangle, so a frosted menu over a frosted pill was two windows or it was
 * not frosted — and everything wrong with the drop-ups followed from that: a
 * webContents that had not finished loading when it was shown, so the menu
 * opened empty; a size reported by a `ResizeObserver` over IPC and applied a
 * frame later, so it opened the wrong shape; a window that had to be moved by
 * hand whenever the panel was dragged.
 *
 * An `NSMenu` has none of those. There is nothing to load, AppKit sizes it
 * before it is on screen, and it owns the mouse until it closes, so the panel
 * cannot be dragged out from under it. It is also how every other menu in
 * macOS works, which is what the frosted window was imitating.
 */
import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from "electron";

import type { DockMenu, DockMenuPick } from "../../shared/contract.js";
import {
  NEEDS_RESTART,
  PERMISSION_CONSEQUENCE,
  PERMISSION_LABEL,
} from "../../shared/permissions.js";

/** The gap between the top of the control and the bottom of the menu. */
const GAP = 10;

/**
 * How far the top of a menu's last item sits above the menu's bottom edge:
 * one item, plus the padding AppKit draws under it. An item with a sublabel
 * is a second line taller, so it has a number of its own.
 *
 * `Menu.popup` places the *top-left* of `positioningItem` at the point it is
 * given, and Electron only ever adjusts that point to keep the menu on the
 * screen — not to keep it clear of the window it was popped from. A menu
 * placed with no positioning item lands on top of the panel. Positioning the
 * last item lets the menu grow upward from the point instead, which is the
 * drop-up; this is what turns "where the menu ends" into "where its last item
 * starts", which is the number AppKit wants.
 *
 * Both measured on macOS 26 by reading the menu window's bounds while one was
 * open. Off by a few points on another release, the menu sits a few points
 * closer to the panel, which is all the failure amounts to.
 */
const LAST_ITEM_ABOVE_BOTTOM = { plain: 29, sublabel: 55 };

/** The template for a drop-up. Pure, so it can be checked without a window. */
export function dockMenuTemplate(
  menu: DockMenu,
  pick: (pick: DockMenuPick) => void,
): MenuItemConstructorOptions[] {
  if (menu.kind === "permissions") {
    const items: MenuItemConstructorOptions[] = menu.missing.map((id) => ({
      label: `Allow ${PERMISSION_LABEL[id]}…`,
      // The consequence under the label rather than in a tooltip, where nobody
      // waits for it: the whole point of the line is that it is read before
      // the click, and a menu item is the one control in the panel with room
      // for a second line.
      sublabel: PERMISSION_CONSEQUENCE[id],
      click: () => pick({ kind: "permission", id }),
    }));

    // Offered whenever any missing permission is one macOS decides at launch.
    // Pressing Allow on those ends in System Settings, and the grant given
    // there does not reach this copy of Prequel — so without a way back the
    // user does the right thing, returns, and finds the warning still here.
    if (menu.missing.some((id) => NEEDS_RESTART[id])) {
      items.push(
        { type: "separator" },
        {
          label: "Restart Prequel",
          sublabel: "Already allowed it in System Settings? macOS only tells Prequel at launch.",
          click: () => pick({ kind: "relaunch" }),
        },
      );
    }
    return items;
  }

  const { kind, selectedId } = menu;
  return [
    ...menu.devices.map((device): MenuItemConstructorOptions => ({
      label: device.label,
      // A checkbox rather than a radio: a radio group ticks whichever item was
      // clicked before `click` runs, and Off below is part of the same choice
      // without being part of the group. The tick is the preference's,
      // re-drawn from it each time the menu is built.
      type: "checkbox",
      checked: device.deviceId === selectedId,
      click: () => pick({ kind, device }),
    })),
    { type: "separator" },
    {
      label: "Off",
      type: "checkbox",
      checked: selectedId === null,
      click: () => pick({ kind, device: null }),
    },
  ];
}

/**
 * One popup at a time, above the panel.
 *
 * `open` resolves when the menu closes, with the pick if there was one: a
 * click on an item arrives before the close callback — Electron posts the
 * close asynchronously for exactly that reason — so the pick is in hand by
 * the time the promise settles.
 */
export class DockMenuPopup {
  private current: { kind: DockMenu["kind"]; menu: Menu; window: BrowserWindow } | null = null;

  /** Which menu is open, for `DockState`. */
  get openKind(): DockMenu["kind"] | null {
    return this.current?.kind ?? null;
  }

  open(spec: DockMenu, window: BrowserWindow): Promise<DockMenuPick | null> {
    // A menu that is up owns the mouse, so a second request cannot come from a
    // click. It can come from anywhere else, and two popups over one panel
    // would leave the first one's promise unsettled.
    this.close();

    let picked: DockMenuPick | null = null;
    const menu = Menu.buildFromTemplate(
      dockMenuTemplate(spec, (pick) => {
        picked = pick;
      }),
    );
    // The last item is what is positioned. Every template has at least one —
    // Off, or a permission — so the index is never -1.
    const last = menu.items.length - 1;
    const lift = menu.items[last]?.sublabel
      ? LAST_ITEM_ABOVE_BOTTOM.sublabel
      : LAST_ITEM_ABOVE_BOTTOM.plain;
    const opened = { kind: spec.kind, menu, window };
    this.current = opened;

    return new Promise((resolve) => {
      menu.popup({
        window,
        // Left-aligned with the control, as a pull-down's menu is. Electron
        // flips it to the left of the point if it would run off the screen.
        x: Math.round(spec.anchor.x),
        y: Math.round(spec.anchor.y - GAP - lift),
        positioningItem: last,
        callback: () => {
          // Only if it is still ours: `close` may have replaced it, and the
          // replacement's state is not this menu's to clear.
          if (this.current === opened) this.current = null;
          resolve(picked);
        },
      });
    });
  }

  /** Closes whatever is open. Its promise resolves with no pick. */
  close(): void {
    const current = this.current;
    if (!current) return;
    this.current = null;
    if (!current.window.isDestroyed()) current.menu.closePopup(current.window);
  }
}
