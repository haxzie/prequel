import { useCallback, useEffect, useRef, type ComponentType } from "react";

import type { MediaDevice } from "../../../shared/contract";
import { useTooltip } from "../components/Tooltip";
import { useAudioLevel } from "../hooks/useAudioLevel";
import { useDock } from "../hooks/useDock";
import { cn } from "../lib/cn";
import { ChevronIcon } from "./icons";

/** The dot's colour per state. One green for both: a device that is on is a
    device that is on, whichever it is, and the level filling the microphone's
    own glyph is what says whether it can hear you. */
const STATUS_COLOUR: Record<DeviceStatus, string> = {
  on: "bg-dot-on",
  off: "bg-dot-off",
  error: "bg-dock-record",
};

/**
 * What the status dot next to a device is saying.
 *
 * `error` is not decorative: a device can be listed and still be unusable —
 * unplugged between enumeration and use, or refusing to open — and without it
 * the panel would show a broken camera as merrily on right up until the
 * recording came back without it. It is also the one state the glyph cannot
 * carry on its own: a camera that will not open still draws as a camera.
 */
export type DeviceStatus = "on" | "off" | "error";

interface DeviceMenuProps {
  kind: "camera" | "microphone";
  devices: MediaDevice[];
  /** `null` means the device is switched off. */
  selectedId: string | null;
  /**
   * Label of the chosen device.
   *
   * The durable half of the pair: Chromium's ids are salted and do not survive
   * a restart, so without this the stored choice silently stops matching and
   * the device comes back as unavailable every launch.
   */
  selectedLabel: string | null;
  /** Set when the device is switched on but failed to open. */
  error?: string | null;
  /**
   * Fills the icon from the bottom with the device's live input level.
   *
   * Only meaningful for a microphone, and only worth the open stream there: it
   * is the one device whose "on" state tells you nothing about whether it is
   * actually hearing you.
   */
  meter?: boolean;
  open: boolean;
  /**
   * Opens the chooser, reporting the top-left of the control that did it in
   * window coordinates.
   *
   * The menu is native and main pops it from this window, so the frame this
   * renderer measures in is exactly the one `Menu.popup` takes.
   */
  onOpen: (anchor: { x: number; y: number }) => void;
  /**
   * Reports the whole device, not just its id: the label is what the native
   * recorder can resolve, since Chromium's ids are salted per origin.
   */
  onSelect: (device: MediaDevice | null) => void;
  OnIcon: ComponentType;
  OffIcon: ComponentType;
}

/**
 * One control: the device's icon, a status dot, and a chevron that opens the
 * list.
 *
 * The icon used to be a button of its own that toggled the device, with the
 * dot, the device's name and the chevron beside it opening the chooser. Two
 * controls for one question — "which camera, if any" — and the toggle was the
 * half that could not answer it: switching on picked whatever was last used,
 * which is a different choice from the one the menu offers. Off is an item in
 * the list, so the whole answer is in one place.
 *
 * The name went with the split. They are long — "MacBook Pro Microphone
 * (Built-in)" — and two of them side by side were most of the panel's width,
 * spent on something that changes about once; the tooltip carries it now.
 */
export function DeviceMenu({
  kind,
  devices,
  selectedId,
  selectedLabel,
  error,
  meter,
  open,
  onOpen,
  onSelect,
  OnIcon,
  OffIcon,
}: DeviceMenuProps) {
  // Read here rather than passed down: the meter is the only thing in this
  // component that opens a device, and threading a flag through every caller
  // for one `getUserMedia` is more plumbing than it is worth.
  const { devicesLive } = useDock();
  const enabled = selectedId !== null;
  // By id first — it is exact within a session — then by label, which is what
  // survives a restart.
  const selected =
    devices.find((device) => device.deviceId === selectedId) ??
    devices.find((device) => device.label === selectedLabel);
  const unavailable = devices.length === 0;

  // Heal the stored id back to this session's handle once the label has found
  // the device, so everything downstream keeps working with a live id.
  useEffect(() => {
    if (enabled && selected && selected.deviceId !== selectedId) onSelect(selected);
    // Keyed on the resolved device rather than the whole object identity, which
    // changes on every enumeration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, selected?.deviceId, selectedId]);

  // The chooser's anchor: this control's top-left, handed to main when it
  // opens. Nudging a menu back inside the screen edge used to happen here
  // against `window.innerWidth`; a native menu is kept on the screen by AppKit.
  const trigger = useRef<HTMLButtonElement>(null);
  const openMenu = () => {
    const box = trigger.current?.getBoundingClientRect();
    onOpen(box ? { x: box.left, y: box.top } : { x: 0, y: 0 });
  };

  const levelRef = useAudioLevel(
    meter && enabled && devicesLive ? (selected?.deviceId ?? null) : null,
  );

  // Switched on but the chosen device has vanished from the list, or it is
  // still listed and would not open. Either way it will not be recorded.
  const status: DeviceStatus = !enabled ? "off" : error || !selected ? "error" : "on";

  // The remembered device even when switched off, so the tooltip can say what
  // turning it back on would pick. Falls back to the kind when nothing is
  // known yet.
  const name = selected?.label ?? selectedLabel ?? kind;
  const label = unavailable
    ? `No ${kind} available`
    : status === "error"
      ? `${name} — ${error ?? "unavailable"}`
      : `${name} ${status}`;

  // The only place the device's name appears. A glyph, a dot and a chevron say
  // what kind of device this is and what state it is in, but not which one —
  // so this is load-bearing here in a way it is not on the buttons beside it.
  // Shares the button's ref with the anchor measurement above; see
  // `IconButton` for why the merged ref has to be stable.
  const tooltip = useTooltip(label, "top");
  const triggerRef = useCallback(
    (node: HTMLButtonElement | null) => {
      trigger.current = node;
      tooltip.ref(node);
    },
    [tooltip.ref],
  );

  return (
    <button
      {...tooltip}
      ref={triggerRef}
      type="button"
      className={cn(
        "no-drag flex h-[30px] items-center gap-1 rounded-full px-1.5 text-dock-fg",
        "disabled:opacity-35 [&_svg]:flex-none",
        open ? "bg-dock-hover" : "not-disabled:hover:bg-dock-hover",
      )}
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      disabled={unavailable}
      onClick={openMenu}
    >
      {/* At the size the icon buttons draw theirs, so the row reads as one
          line of controls rather than this one sitting a size down. */}
      <span
        className={cn(
          "grid flex-none place-items-center [&_svg]:size-[18px]",
          enabled ? "text-dock-fg" : "text-dock-muted",
        )}
        aria-hidden="true"
      >
        {!enabled ? (
          <OffIcon />
        ) : meter ? (
          // The glyph twice: the second copy is clipped to the level and
          // coloured, so the icon itself fills rather than sitting next to a
          // separate bar the panel has no room for.
          <span className="relative grid place-items-center" ref={levelRef}>
            <OnIcon />
            <span
              className="meter-fill absolute inset-0 grid place-items-center text-dock-meter"
              aria-hidden="true"
            >
              <OnIcon />
            </span>
          </span>
        ) : (
          <OnIcon />
        )}
      </span>
      <span
        className={cn("size-1.5 flex-none rounded-full", STATUS_COLOUR[status])}
        aria-hidden="true"
      />
      {/* Turned to point at the menu while it is up: the list opens above the
          panel, so a chevron still pointing down under an open menu points at
          nothing. The same easing as the tooltip's slide, so the two motions
          in this panel read as one. */}
      <span
        className={cn(
          "flex-none text-dock-muted/60 transition-transform duration-200 [&_svg]:size-[9px]",
          "ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none",
          open && "rotate-180",
        )}
        aria-hidden="true"
      >
        <ChevronIcon />
      </span>
    </button>
  );
}
