import { useEffect, useRef, type ComponentType } from "react";

import type { MediaDevice } from "../../../shared/contract";
import { withoutDeviceIds } from "../../../shared/contract";
import { useAudioLevel } from "../hooks/useAudioLevel";
import { useDock } from "../hooks/useDock";
import { cn } from "../lib/cn";
import { ChevronIcon } from "./icons";
import { IconButton } from "./IconButton";

/** The dot's colour per state. Amber for a live mic, green for a running
    camera — a mic that is merely on is not the same as one that is hearing you. */
const STATUS_COLOUR: Record<DeviceStatus, Record<"camera" | "microphone", string>> = {
  on: { camera: "bg-dot-on", microphone: "bg-dot-live" },
  off: { camera: "bg-dot-off", microphone: "bg-dot-off" },
  error: { camera: "bg-dock-record", microphone: "bg-dock-record" },
};

/**
 * What the status dot next to a device is saying.
 *
 * `error` is not decorative: a device can be listed and still be unusable —
 * unplugged between enumeration and use, or refusing to open — and without it
 * the panel would show a broken camera as merrily on right up until the
 * recording came back without it.
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
   * Opens or closes the chooser, reporting the centre of the control that did
   * it in window coordinates.
   *
   * The menu is its own window now, so main places it — and the only frame
   * this renderer can measure in is its own window's.
   */
  onToggle: (anchorX: number) => void;
  /**
   * Reports the whole device, not just its id: the label is what the native
   * recorder can resolve, since Chromium's ids are salted per origin.
   */
  onSelect: (device: MediaDevice | null) => void;
  OnIcon: ComponentType;
  OffIcon: ComponentType;
}

/**
 * A device toggle, a status dot, and a chevron that opens the chooser.
 *
 * The icon click toggles the device on and off; the chevron opens the list.
 * That split matters because the common action by far is "turn my camera on
 * with the same one as last time", which should not require picking from a menu.
 */
export function DeviceMenu({
  kind,
  devices,
  selectedId,
  selectedLabel,
  error,
  meter,
  open,
  onToggle,
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

  // The chooser's anchor: this control's centre, handed to main when it opens.
  // Nudging a menu back inside the screen edge used to happen here against
  // `window.innerWidth`, and belongs to main now — the edge that matters is the
  // display's, not this window's.
  const trigger = useRef<HTMLButtonElement>(null);
  const toggle = () => {
    const box = trigger.current?.getBoundingClientRect();
    onToggle(box ? box.left + box.width / 2 : 0);
  };

  const levelRef = useAudioLevel(
    meter && enabled && devicesLive ? (selected?.deviceId ?? null) : null,
  );

  // Switched on but the chosen device has vanished from the list, or it is
  // still listed and would not open. Either way it will not be recorded.
  const status: DeviceStatus = !enabled ? "off" : error || !selected ? "error" : "on";

  // With exactly one device there is nothing to choose between, so turning it
  // on picks it — no menu, no decision.
  const flip = () => {
    if (enabled) {
      onSelect(null);
      return;
    }
    const fallback = selected ?? devices[0];
    if (fallback) onSelect(fallback);
  };

  // The remembered device even when switched off, so it is clear what turning
  // it back on would pick. Falls back to the kind when nothing is known yet.
  const chosen = selected?.label ?? selectedLabel ?? null;
  const display = chosen ? withoutDeviceIds(chosen) : kind === "camera" ? "Camera" : "Microphone";
  const name = chosen ?? kind;
  const label = unavailable
    ? `No ${kind} available`
    : status === "error"
      ? `${name} — ${error ?? "unavailable"}`
      : `${name} ${status}`;

  return (
    <div className="flex items-center gap-0.5">
      <IconButton
        off={!enabled}
        title={unavailable ? label : `Turn ${kind} ${enabled ? "off" : "on"}`}
        aria-pressed={enabled}
        disabled={unavailable}
        onClick={flip}
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
      </IconButton>

      {/* The state, the name and the chevron are one control: they all answer
          "which device is this, and can I change it", so making only the
          chevron clickable turns a wide, obvious target into a 16px one. */}
      <button
        ref={trigger}
        type="button"
        className={cn(
          "no-drag flex h-[30px] items-center gap-1.5 rounded-lg px-1.5 text-xs text-dock-fg",
          "disabled:opacity-35 [&_svg]:size-[11px] [&_svg]:flex-none [&_svg]:text-dock-muted",
          open ? "bg-dock-hover" : "not-disabled:hover:bg-dock-hover",
        )}
        title={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={unavailable}
        onClick={toggle}
      >
        <span
          className={cn("size-1.5 flex-none rounded-full", STATUS_COLOUR[status][kind])}
          aria-hidden="true"
        />
        {/* Sized to the name, capped so one long device cannot push the panel
            across the screen. Long names are the norm — "MacBook Pro Microphone
            (Built-in)" — and the panel cannot grow to fit them, so they clip
            with the full name on hover. */}
        <span className={cn("max-w-[132px] truncate text-left", !enabled && "text-dock-muted")}>
          {display}
        </span>
        <ChevronIcon />
      </button>
    </div>
  );
}
