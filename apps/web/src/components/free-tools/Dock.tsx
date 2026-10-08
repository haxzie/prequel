"use client";

/**
 * The app's dock, on the web.
 *
 * The desktop app puts one bar at the bottom of the screen: the camera, the
 * microphone, and a red button. This is that bar, floating over the bottom of
 * the preview, drawn from `dock-theme` — the app's own fill, radius, shadow and
 * red, copied into `globals.css` rather than imported, under the rule that the
 * site shares no code with `apps/desktop`.
 *
 * It is the same bar in both states, which is the part worth keeping: pressing
 * record collapses the controls and leaves a clock, rather than swapping one
 * bar for another. The app does that so the window does not appear to close and
 * reopen; here it is so the eye does not lose the thing it was just looking at.
 *
 * The device *pickers* stay in the rail. This bar answers "is the camera on",
 * which is the question asked immediately before recording, and it is the only
 * place that answers it: the rail's toggles came out when this went in, because
 * two controls for one state is two things to keep in step.
 */

import { Mic, MicOff, Pause, Play, Video, VideoOff } from "lucide-react";
import type { ReactNode } from "react";

import type { ToolMode } from "@/lib/free-tools/mode";
import { formatDuration, formatSize } from "@/lib/free-tools/recording";

import type { useStudio } from "./useStudio";

/** The square control, at the size the app draws it. */
const BUTTON =
  "grid size-[30px] place-items-center rounded-lg transition-colors disabled:opacity-35 [&_svg]:size-[17px]";

/**
 * A device control: wider than square, because it carries a glyph and a dot.
 *
 * Written out rather than `BUTTON` with a `flex` appended. Both are display
 * utilities of the same specificity, so which one won would come down to their
 * order in the generated stylesheet rather than the order they were written in
 * — and `grid` won, which stacked the status dot underneath the glyph instead
 * of beside it.
 */
const DEVICE =
  "flex h-[30px] items-center gap-1.5 rounded-lg px-2 transition-colors [&_svg]:size-[17px]";

/** Short and centred, so the rule reads as a divider inside the bar. */
const DIVIDER = "h-[18px] w-px flex-none self-center bg-dock-line";

export function Dock({
  studio,
  mode,
}: {
  studio: ReturnType<typeof useStudio>;
  mode: ToolMode;
}): ReactNode {
  const { stage, settings } = studio;
  const live = stage === "recording" || stage === "paused";
  const armed = stage !== "setup";

  // The camera is a bubble on a screen recording and the subject of a camera
  // recording, so only one of the three tools has a camera to switch off. The
  // microphone is a choice everywhere except the voice recorder, where it is
  // the recording.
  const showCamera = mode === "screen";
  const showMic = mode !== "audio";

  return (
    <div
      className={
        "dock-theme pointer-events-auto flex items-center gap-1.5 rounded-[10px] bg-dock-bg p-1.5 " +
        "text-dock-fg shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
      }
    >
      {live ? (
        // The clock takes the left of the bar while a take runs, which is where
        // the mode buttons were. The size beside it is the honest version of
        // "how long can this go on": a browser recording is held in the tab,
        // and a number growing in front of somebody is a better warning than a
        // sentence they read once.
        <div className="flex items-center gap-2 pr-1 pl-2">
          <span
            className={`size-[9px] rounded-full ${
              stage === "paused" ? "bg-dock-muted" : "animate-pulse bg-dock-record"
            }`}
            aria-hidden
          />
          <span className="text-[15px] font-semibold tabular-nums">
            {formatDuration(studio.elapsedMs)}
          </span>
          <span className="text-[11px] text-dock-muted tabular-nums">
            {formatSize(studio.bytes)}
          </span>
        </div>
      ) : null}

      {!live && (showCamera || showMic) ? (
        <div className="flex items-center gap-0.5 rounded-lg bg-dock-group p-0.5">
          {showCamera ? (
            <Device
              on={settings.look.camera.on}
              label={settings.look.camera.on ? "Turn the camera off" : "Turn the camera on"}
              onClick={() => void studio.setCameraOn(!settings.look.camera.on)}
              on_icon={<Video />}
              off_icon={<VideoOff />}
            />
          ) : null}
          {/* Between the two devices, so the tray reads as two controls rather
              than one wide one: both are a glyph and a dot, and side by side
              without a rule the four marks run together into a row of four. */}
          {showCamera && showMic ? <span className={DIVIDER} /> : null}
          {showMic ? (
            <Device
              on={settings.mic}
              label={settings.mic ? "Turn the microphone off" : "Turn the microphone on"}
              onClick={() => void studio.setMicOn(!settings.mic)}
              on_icon={<Mic />}
              off_icon={<MicOff />}
            />
          ) : null}
        </div>
      ) : null}

      {live ? (
        <button
          type="button"
          aria-label={stage === "paused" ? "Resume" : "Pause"}
          title={stage === "paused" ? "Resume" : "Pause"}
          onClick={stage === "paused" ? studio.resume : studio.pause}
          className={`${BUTTON} text-dock-fg hover:bg-dock-hover`}
        >
          {stage === "paused" ? <Play /> : <Pause />}
        </button>
      ) : null}

      {/* Only where there is something to its left. The voice recorder has no
          camera and no microphone switch — the microphone is the recording —
          so its bar is the red button alone, and a rule with nothing before it
          reads as a control that failed to draw. */}
      {live || showCamera || showMic ? <span className={DIVIDER} /> : null}

      {/*
        One button for both ends of a take, and it is the only red on the page.
        Two buttons in the same place would mean the thing under the pointer at
        the end of a recording is not the thing that was there at the start, and
        stopping is the click nobody should have to aim for.

        A filled pill with the word on it rather than a glyph alone. The dock is
        the one surface here a visitor meets with no instructions, and "Record"
        spelled out is what tells them the countdown is about to start. The glyph
        beside it is the state: a disc to begin, a square to end.

        Disabled until a source is shared, because there is nothing to record
        yet, and the title says which click comes first.
      */}
      <button
        type="button"
        disabled={!armed}
        title={armed ? (live ? "Stop and save" : "Start recording") : "Choose what to record first"}
        onClick={live ? studio.stop : studio.start}
        className="flex h-[30px] items-center gap-2 rounded-full bg-dock-record px-3.5 text-[13px] font-medium text-white transition-[filter,opacity] hover:brightness-[1.12] disabled:opacity-35 disabled:hover:brightness-100"
      >
        <span
          className={`bg-white transition-all duration-200 motion-reduce:transition-none ${
            live ? "size-[10px] rounded-[2px]" : "size-[11px] rounded-full"
          }`}
          aria-hidden
        />
        {live ? "Stop" : "Record"}
      </button>
    </div>
  );
}

/**
 * A device: its glyph, and a dot to the right saying whether it is live.
 *
 * The dot is what the app puts here, and it earns its six pixels: a glyph that
 * changes between a camera and a crossed-out camera is read as an icon before
 * it is read as a state, and the dot is the state on its own. To the right of
 * the glyph and not under it, which is where the app has it and the only place
 * it reads as a status light rather than as part of the drawing.
 */
function Device({
  on,
  label,
  onClick,
  on_icon,
  off_icon,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
  on_icon: ReactNode;
  off_icon: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`${DEVICE} ${
        on ? "text-dock-fg hover:bg-dock-hover" : "text-dock-muted hover:bg-dock-hover"
      }`}
    >
      {on ? on_icon : off_icon}
      <span
        className={`size-1.5 flex-none rounded-full ${on ? "bg-dot-on" : "bg-dot-off"}`}
        aria-hidden
      />
    </button>
  );
}
