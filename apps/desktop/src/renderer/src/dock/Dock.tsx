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
      // The panel's border is outside the row and inside the window, so it has
      // to be added back — read from the box rather than hardcoded, so it stays
      // right if the border ever changes.
      const borders = element.offsetWidth - element.clientWidth;
      void window.prequel.dock.setWidth(Math.ceil(row.getBoundingClientRect().width) + borders);
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
        // Anchored to the bottom of a window that is taller than the panel:
        // `--panel-inset` of transparent margin for the drop shadow, plus
        // whatever headroom an open drop-up needs above.
        //
        // The width fills the window, which is what lets the window animate its
        // width and take the panel smoothly with it — the natural width lives on
        // the setup row, which is what gets measured and reported to main.
        //
        // The shadow is drawn here rather than by the window: macOS shapes a
        // window's own shadow to the window rectangle, which around a rounded
        // panel reads as a second, squarer border. `overflow-visible` is what
        // lets the drop-ups escape the panel's bounds.
        "dock-theme m-(--panel-inset) mt-auto h-(--panel-height) w-[calc(100%-var(--panel-inset)*2)] " +
        "overflow-visible rounded-xl border border-dock-line bg-dock-bg text-dock-fg " +
        "shadow-[0_4px_14px_rgba(0,0,0,0.45)]"
      }
    >
      {state.view === "setup" ? <SetupPanel state={state} /> : <RecordingView state={state} />}
    </div>
  );
}
