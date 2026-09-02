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
        // The panel *is* the window now, so it fills it: the window is vibrant,
        // and a frosted material fills the window's rectangle, so any part of
        // the window the panel did not cover would be frosted desktop hanging
        // in mid-air.
        //
        // No radius, no border, no shadow, and no margin to cast one into.
        // macOS draws the corners and the shadow around a vibrant window
        // itself, and a CSS pill inside it would be a second, inset outline
        // around the frosted one. `--dock-bg` is a scrim over the material
        // rather than a fill — see `dock-theme`.
        //
        // Filling the window is also what lets the window animate its width and
        // take the panel smoothly with it; the natural width lives on the setup
        // row, which is what gets measured and reported to main.
        "dock-theme size-full bg-dock-bg text-dock-fg"
      }
    >
      {state.view === "setup" ? <SetupPanel state={state} /> : <RecordingView state={state} />}
    </div>
  );
}
