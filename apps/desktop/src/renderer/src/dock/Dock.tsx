import { useLayoutEffect, useRef } from "react";

import { useDock } from "../hooks/useDock";
import { RecordingView } from "./RecordingView";
import { SetupPanel } from "./SetupPanel";

/**
 * The bottom panel.
 *
 * Setup and recording are two shapes of one window, so pressing Record reads as
 * the panel collapsing rather than one window closing and another opening.
 */
export function Dock() {
  const state = useDock();
  const panel = useRef<HTMLDivElement>(null);

  // Setup sizes itself to its contents — mostly device names, which run from
  // "Camera" to "MacBook Pro Microphone (Built-in)" — and main has no way to
  // measure text. So the panel reports what it needs and the window follows.
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element || state.view !== "setup") return;

    // The setup row is sized to its contents; the panel is stretched to the
    // window, so measuring the panel itself would just report the window back.
    // Found by attribute rather than by class: the classes here are utilities
    // and rearranging them must not quietly break the measurement.
    const row = element.querySelector("[data-panel='setup']");
    if (!row) return;

    const report = () => {
      void window.prequel.dock.setWidth(Math.ceil(row.getBoundingClientRect().width));
    };

    report();
    // Fonts finish loading, a device is renamed, a chooser appears — all of
    // them change the width without React re-rendering this component.
    const observer = new ResizeObserver(report);
    observer.observe(row);
    return () => observer.disconnect();
  }, [state.view]);

  return (
    <div
      ref={panel}
      data-view={state.view}
      className={
        // The pill is drawn here, inside a transparent window an inset larger
        // all round — the same arrangement as the camera bubble, and for the
        // same reason: macOS shapes a window's shadow to its rectangle, so a
        // shadow cast by a square window around a rounded panel would be
        // square. The margin is what it is cast into.
        //
        // It went the other way for a while, with the window vibrant and macOS
        // drawing the corners. That gave a frosted panel and took the radius
        // with it: Electron's `roundedCorners` is a boolean, and on a 44pt bar
        // the system radius reads as a full pill. Drawing it here is what makes
        // the roundness ours to pick. `--dock-bg` is a fill now rather than a
        // scrim over a material — see `dock-theme`.
        //
        // `flex-1` rather than a height: `#root` is a flex column, so the panel
        // takes what the margins leave, which is exactly `PANEL_HEIGHT`. The
        // natural width lives on the setup row, which is what gets measured and
        // reported to main.
        //
        // The top margin is `DOCK_HEADROOM`, not the inset: the tooltips over
        // the buttons are drawn into it. Main grows the window by the same
        // amount — see `DockWindow.windowSize` — and the two must agree, or
        // the panel is drawn either over the band or short of it.
        //
        // `overflow-hidden` is load-bearing, not tidiness. The setup row is
        // `w-max` and main animates the window to a reported width over
        // `RESIZE_MS`, so for those frames the row is wider than the window it
        // sits in — and an overflowing descendant of `body` puts a horizontal
        // scrollbar on the document. Turning a camera on is enough to trigger
        // it: the label goes from "Camera" to the device's own name, the row
        // grows, and a scrollbar flicks in and out across the bottom of the
        // pill while the window catches up. Clipped, the name is revealed as
        // the panel widens, which is what the animation is for.
        "dock-theme m-(--panel-inset) mt-(--dock-headroom) flex-1 overflow-hidden rounded-[10px] " +
        "border border-white/12 bg-dock-bg text-dock-fg shadow-[0_4px_14px_rgba(0,0,0,0.45)]"
      }
    >
      {state.view === "setup" ? <SetupPanel state={state} /> : <RecordingView state={state} />}
    </div>
  );
}
