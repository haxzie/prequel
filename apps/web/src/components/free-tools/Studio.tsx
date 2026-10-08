"use client";

/**
 * The tool itself: the stage, the controls and the transport.
 *
 * One component for all three free tools. `mode` decides which groups appear in
 * the rail and whether the stage shows a picture or a level; everything else is
 * the same screen, because a visitor who has used one of these has used all
 * three and the differences between them are differences in what is being
 * recorded rather than in how the page works.
 *
 * Every decision about *where* something is drawn belongs to
 * `lib/free-tools/layout.ts`, and every decision about *what* is recorded
 * belongs to `useStudio`. This file is the chrome around them.
 */

import {
  Clapperboard,
  Crop,
  Download,
  Mic,
  Monitor,
  RotateCcw,
  Volume2,
  Webcam,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { FRAME_PRESETS, FRAME_RATES } from "@/lib/free-tools/presets";
import { formatDuration, formatSize } from "@/lib/free-tools/recording";
import type { CameraCorner, CameraShape } from "@/lib/free-tools/layout";

import { DownloadDialog } from "./DownloadDialog";
import { Dock } from "./Dock";
import { PlayerBar, PlayerView, usePlayer, type PlayerHandle } from "./Player";
import { Group, Panel, Picker, Segmented, Slider, Toggle } from "./controls";
import type { ToolMode } from "@/lib/free-tools/mode";

import { MAX_DURATION_MS, useStudio } from "./useStudio";

const SHAPES: { value: CameraShape; label: string }[] = [
  { value: "circle", label: "Circle" },
  { value: "squircle", label: "Squircle" },
  { value: "rounded", label: "Rounded" },
  { value: "wide", label: "Wide" },
];

const CORNERS: { value: CameraCorner; label: string }[] = [
  { value: "bottom-right", label: "BR" },
  { value: "bottom-left", label: "BL" },
  { value: "top-right", label: "TR" },
  { value: "top-left", label: "TL" },
];

/**
 * The call to action, on the dark stage.
 *
 * White with black text, and written out rather than `Button`'s primary
 * variant. That variant is `bg-fg text-bg`, which is the right pair on a page
 * of paper and the wrong one inside `editor-theme`: the tokens still resolve to
 * the light theme's, so the loudest button on the site comes out near-black on
 * a near-black stage. Ink on paper, paper on ink.
 *
 * One constant for the two places that need it, so the second cannot drift from
 * the first.
 */
const ON_DARK =
  "inline-flex items-center justify-center gap-2 rounded-full bg-white font-medium text-black transition-colors hover:bg-white/90";

/** A percentage, for a control whose value is a fraction of the frame. */
const percent = (value: number, of: number) => `${Math.round((value / of) * 100)}%`;

/**
 * A gain, as what it multiplies by.
 *
 * Not a percentage. A gain of 1 is the microphone as it comes, and printing
 * that as "50%" of a slider that reaches 2 reads as a microphone recording at
 * half volume, which is the one thing somebody setting a level must not be told
 * wrongly.
 */
const times = (value: number) => `${value.toFixed(1)}x`;

export function Studio({ mode }: { mode: ToolMode }) {
  const studio = useStudio(mode);
  // Held here rather than inside the review branch, so the picture and the
  // transport can be drawn into two different parts of the stage.
  const player = usePlayer(studio.recording);
  // Raised by the download button and by nothing else. The file is already
  // saving when it opens; see the note in `DownloadDialog`.
  const [pitching, setPitching] = useState(false);
  const { settings, setSettings, stage, frame } = studio;
  const look = settings.look;

  const visual = mode !== "audio";
  const live = stage === "recording" || stage === "paused";

  const setCamera = (patch: Partial<typeof look.camera>) =>
    setSettings((current) => ({
      ...current,
      look: { ...current.look, camera: { ...current.look.camera, ...patch } },
    }));

  if (stage === "unsupported") {
    return (
      <div className="rounded-3xl border border-line bg-surface p-10 text-center">
        <h2 className="text-lg font-medium text-fg">This browser cannot record</h2>
        <p className="mx-auto mt-3 max-w-md text-pretty text-muted">
          Recording in a tab needs a browser with MediaRecorder and screen capture. Chrome, Edge,
          Firefox and Safari 17 all have both. Or record on your Mac with Prequel.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* `items-stretch` is the default, and it is what makes the two columns
          the same height: the rail is as tall as its controls, and the stage is
          told to match rather than to size itself to the picture. A preview
          that ended halfway up the panel beside it read as two unrelated
          boxes. */}
      <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
        <div className="flex min-h-0 flex-col gap-4">
          <Stage studio={studio} mode={mode} player={player} onDownload={() => setPitching(true)} />
          <Transport studio={studio} />
          {studio.error ? (
            <p
              role="alert"
              className="rounded-xl border border-negative/30 bg-negative/5 px-4 py-3 text-sm text-pretty text-fg"
            >
              {studio.error}
            </p>
          ) : null}
        </div>

        <Panel>
          {visual ? (
            <Group label="Frame">
              <Picker
                icon={<Crop />}
                label="Output frame"
                value={settings.framePresetId}
                // Locked while recording: the canvas is the encoder's input, and
                // resizing it mid take is a resolution change inside one file.
                // Browsers handle that between "stretched" and "stopped".
                disabled={live}
                options={FRAME_PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))}
                onChange={(framePresetId) =>
                  setSettings((current) => ({ ...current, framePresetId }))
                }
              />
              <Picker
                icon={<Clapperboard />}
                label="Frame rate"
                value={String(settings.fps)}
                disabled={live}
                options={FRAME_RATES.map((fps) => ({ value: String(fps), label: `${fps} fps` }))}
                onChange={(fps) => setSettings((current) => ({ ...current, fps: Number(fps) }))}
              />
              <p className="px-1 text-[11px] leading-snug text-editor-muted">
                {frame.width} by {frame.height}
              </p>
            </Group>
          ) : null}

          {mode === "screen" ? (
            <Group label="Camera">
              {/* No switch here. The dock under the preview owns whether the
                camera is on, and a second switch in the rail would be a second
                answer to the same question. What is left is what the bubble
                looks like once there is one. */}
              {look.camera.on ? (
                <>
                  {studio.cameras.length > 1 ? (
                    <Picker
                      label="Camera"
                      value={settings.cameraDeviceId}
                      options={[
                        { value: "", label: "Default camera" },
                        ...studio.cameras.map((device) => ({
                          value: device.deviceId,
                          label: device.label,
                        })),
                      ]}
                      onChange={(deviceId) => void studio.selectDevice("camera", deviceId)}
                    />
                  ) : null}
                  <Segmented
                    label="Camera shape"
                    options={SHAPES}
                    value={look.camera.shape}
                    onChange={(shape) => setCamera({ shape })}
                  />
                  <Segmented
                    label="Camera corner"
                    options={CORNERS}
                    value={look.camera.corner}
                    onChange={(corner) => setCamera({ corner })}
                  />
                  <Slider
                    label="Size"
                    read={percent(look.camera.size, 0.4)}
                    value={look.camera.size}
                    min={0.1}
                    max={0.4}
                    step={0.01}
                    onChange={(size) => setCamera({ size })}
                  />
                  <Toggle
                    label="Mirror"
                    on={look.camera.mirrored}
                    onChange={(mirrored) => setCamera({ mirrored })}
                  />
                </>
              ) : (
                <p className="px-1 text-[11px] leading-snug text-editor-muted">
                  Turn the camera on in the dock to shape it.
                </p>
              )}
            </Group>
          ) : null}

          {mode === "camera" ? (
            <Group label="Camera">
              {studio.cameras.length > 1 ? (
                <Picker
                  icon={<Webcam />}
                  label="Camera"
                  value={settings.cameraDeviceId}
                  options={[
                    { value: "", label: "Default camera" },
                    ...studio.cameras.map((device) => ({
                      value: device.deviceId,
                      label: device.label,
                    })),
                  ]}
                  onChange={(deviceId) => void studio.selectDevice("camera", deviceId)}
                />
              ) : null}
              <Toggle
                label="Mirror"
                on={look.camera.mirrored}
                onChange={(mirrored) => setCamera({ mirrored })}
              />
            </Group>
          ) : null}

          <Group label="Sound">
            {/* The microphone's switch is on the dock as well, for the reason the
              camera's is. The level and the device stay here: both are set once
              and then left, and neither belongs on a bar that is read in the
              second before a take starts. */}
            {settings.mic || mode === "audio" ? (
              <>
                {studio.microphones.length > 1 ? (
                  <Picker
                    icon={mode === "audio" ? <Mic /> : undefined}
                    label="Microphone"
                    value={settings.micDeviceId}
                    options={[
                      { value: "", label: "Default microphone" },
                      ...studio.microphones.map((device) => ({
                        value: device.deviceId,
                        label: device.label,
                      })),
                    ]}
                    onChange={(deviceId) => void studio.selectDevice("mic", deviceId)}
                  />
                ) : null}
                <Slider
                  label="Microphone level"
                  read={times(settings.micGain)}
                  value={settings.micGain}
                  min={0}
                  max={2}
                  step={0.05}
                  onChange={(micGain) => setSettings((current) => ({ ...current, micGain }))}
                />
              </>
            ) : (
              <p className="px-1 text-[11px] leading-snug text-editor-muted">
                Turn the microphone on in the dock to pick a device.
              </p>
            )}

            {mode === "screen" ? (
              <>
                <Toggle
                  icon={<Volume2 />}
                  label="Screen audio"
                  on={settings.systemAudio}
                  disabled={stage !== "setup"}
                  onChange={(systemAudio) =>
                    setSettings((current) => ({ ...current, systemAudio }))
                  }
                  note={
                    stage === "setup"
                      ? "Tick Share audio in the browser's picker. Chrome and Edge offer it for a tab or a window."
                      : studio.systemAudioCaptured
                        ? undefined
                        : "Your browser shared the picture without the sound. Record the microphone, or try sharing a tab in Chrome."
                  }
                />
                {settings.systemAudio && studio.systemAudioCaptured ? (
                  <Slider
                    label="Screen level"
                    read={times(settings.systemGain)}
                    value={settings.systemGain}
                    min={0}
                    max={2}
                    step={0.05}
                    onChange={(systemGain) =>
                      setSettings((current) => ({ ...current, systemGain }))
                    }
                  />
                ) : null}
              </>
            ) : null}
          </Group>

          <p className="px-1 text-[11px] leading-relaxed text-editor-muted">
            Recorded and saved in this tab. Nothing is uploaded.
            {studio.encoding ? ` Saves as ${studio.encoding.label}.` : ""}
          </p>
        </Panel>
      </div>

      <DownloadDialog open={pitching} surface="recorder" onClose={() => setPitching(false)} />
    </>
  );
}

type StudioHandle = ReturnType<typeof useStudio>;

/**
 * The stage: one canvas, sized to the output frame.
 *
 * The canvas is deliberately the full output resolution and is scaled down by
 * CSS, which is the opposite of the rule the desktop renderer follows. It holds
 * there because that canvas is only ever a preview; here the same surface is
 * what `captureStream` encodes, so it has to be the real frame. A second,
 * screen-sized canvas for the preview would be a second draw path to the same
 * picture, and the file is the one that matters.
 */
function Stage({
  studio,
  mode,
  player,
  onDownload,
}: {
  studio: StudioHandle;
  mode: ToolMode;
  player: PlayerHandle;
  onDownload: () => void;
}) {
  const { stage, frame, recording } = studio;

  return (
    /* The floor stays at every width, and `lg:min-h-0` is gone from it.

       Stretching the stage to the rail is right while the rail is the taller of
       the two, which it is for the screen and camera tools. The voice recorder
       has one group in its rail, so with no floor the stage collapsed to the
       height of a slider and a sentence: the invitation overflowed its own box
       and the dock landed on top of the button. A floor makes the stage the
       taller one there, and the rail stretches to it instead. */
    <div className="editor-theme squircle dot-grid relative flex min-h-[26rem] flex-1 overflow-hidden rounded-3xl bg-editor-bg ring-1 ring-black/20">
      {/*
        The picture's box, positioned rather than flowed.

        It has to be a definite height for the canvas inside it to be capped by
        one: a percentage `max-height` resolves to `none` through a flex or grid
        chain whose height is indefinite, and the canvas then lays out at its
        intrinsic size, which here is up to 1920 pixels wide. Insets off a
        stretched shell give it that height without asking anything of the
        chain above.

        The bottom inset is the dock's lane. Nothing is drawn under the bar.
      */}
      <div className="absolute inset-3 bottom-20 flex items-center justify-center sm:inset-5 sm:bottom-20">
        {stage === "setup" ? <Invitation studio={studio} mode={mode} /> : null}

        {stage === "review" && recording ? (
          <PlayerView
            player={player}
            recording={recording}
            kind={mode === "audio" ? "audio" : "video"}
          />
        ) : null}

        {stage !== "setup" && stage !== "review" ? (
          <div className="relative flex size-full items-center justify-center">
            {mode === "audio" ? (
              <Level studio={studio} />
            ) : (
              /* `max-h-full` and `max-w-full` on the canvas itself, with no
                 width or height of its own. A canvas carries its intrinsic
                 size as an aspect ratio, so one capped on both axes shrinks to
                 fit whichever runs out first and keeps its proportions without
                 a wrapper to hold them. */
              <canvas
                ref={studio.canvasRef}
                className="max-h-full max-w-full rounded-xl"
                style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
              />
            )}

            {stage === "countdown" ? (
              // Over the whole box rather than over the canvas: the scrim is
              // what makes a white number legible on a bright frame, and a
              // preview of a document is a bright frame.
              <div className="absolute inset-0 flex items-center justify-center bg-editor-scrim">
                <span
                  key={studio.countdown}
                  className="animate-hero-rise font-mono text-6xl font-medium text-white tabular-nums"
                >
                  {studio.countdown}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* One lane, in every state. The dock before and during a take, the
          player's bar after it: Record, Download and Record again all land in
          the same place, which is the whole point of putting the review's
          controls here rather than under its own player.

          Over the bottom of the preview rather than under it, which is where
          the app puts the dock. `pointer-events-none` on the lane and back on
          for the bar, so the dead space either side of it does not swallow a
          click meant for the picture. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
        {stage === "review" && recording ? (
          <PlayerBar
            player={player}
            recording={recording}
            onReset={studio.reset}
            onDownload={onDownload}
          />
        ) : (
          <Dock studio={studio} mode={mode} />
        )}
      </div>

      {/* The `<video>` elements the compositor draws from. One transparent pixel
          each, inside the document: a `display: none` element is allowed to stop
          decoding, and a stopped decoder is a frozen picture in the file with a
          live stream behind it. */}
      <div
        ref={studio.holderRef}
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 size-px overflow-hidden opacity-0"
      />
    </div>
  );
}

/** What the stage says before anything has been shared. */
function Invitation({ studio, mode }: { studio: StudioHandle; mode: ToolMode }) {
  const copy = {
    screen: {
      icon: <Monitor className="size-7" strokeWidth={1.5} />,
      title: "Pick a screen, a window or a tab",
      body: "Your browser asks which one, and shows you the frame before anything is recorded.",
      action: "Choose what to record",
    },
    camera: {
      icon: <Webcam className="size-7" strokeWidth={1.5} />,
      title: "Turn on your camera",
      body: "Your browser asks for the camera and the microphone. You see yourself before anything is recorded.",
      action: "Turn on camera",
    },
    audio: {
      icon: <Mic className="size-7" strokeWidth={1.5} />,
      title: "Turn on your microphone",
      body: "Your browser asks for the microphone, then the level moves as you speak.",
      action: "Turn on microphone",
    },
  }[mode];

  return (
    /* No tall padding. The box this sits in centres it already, and the padding
       was height the shortest stage did not have: 160px of it is what pushed
       the microphone tool's invitation out through the bottom of the frame. */
    <div className="flex max-w-md flex-col items-center gap-4 px-4 py-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-white/5 text-editor-muted ring-1 ring-white/10">
        {copy.icon}
      </span>
      <h2 className="text-lg font-medium text-editor-fg">{copy.title}</h2>
      <p className="text-sm leading-relaxed text-pretty text-editor-muted">{copy.body}</p>
      <button
        type="button"
        onClick={() => void studio.arm()}
        className={`${ON_DARK} mt-2 h-11 px-6 text-sm`}
      >
        {copy.action}
      </button>
    </div>
  );
}

/**
 * The microphone's level, drawn straight into a canvas.
 *
 * Painted rather than put through React state, which is the rule the desktop
 * renderer follows for anything that changes per frame: sixty state updates a
 * second re-render a tree to move one bar. `requestAnimationFrame` is right
 * here, where the worker clock is not, because a meter nobody can see does not
 * need to keep time.
 */
function Level({ studio }: { studio: StudioHandle }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const samples = new Uint8Array(1024);
    let frame = 0;

    const paint = () => {
      frame = requestAnimationFrame(paint);

      const analyser = studio.analyser.current;
      const width = (canvas.width = canvas.clientWidth * (window.devicePixelRatio || 1));
      const height = (canvas.height = canvas.clientHeight * (window.devicePixelRatio || 1));

      ctx.clearRect(0, 0, width, height);
      if (!analyser) return;

      analyser.getByteTimeDomainData(samples);
      const bars = 64;
      const step = Math.floor(samples.length / bars);
      const gap = width / bars;

      for (let bar = 0; bar < bars; bar += 1) {
        let peak = 0;
        for (let i = 0; i < step; i += 1) {
          // 128 is silence in time domain data, so the distance from it is the
          // amplitude. Doubled because speech at a sane input gain sits around
          // a quarter of full scale and a meter that never leaves the floor
          // reads as a microphone that is not working.
          peak = Math.max(peak, Math.abs((samples[bar * step + i] ?? 128) - 128) / 128);
        }
        const level = Math.min(1, peak * 2);
        // A floor of four device pixels, so silence is a baseline across the
        // middle rather than nothing at all: a meter that disappears when
        // nobody is speaking is indistinguishable from a meter that is broken.
        const barHeight = Math.max(4, level * height * 0.9);
        ctx.fillStyle = `rgba(236, 238, 241, ${0.25 + level * 0.75})`;
        ctx.fillRect(bar * gap + gap * 0.25, (height - barHeight) / 2, gap * 0.5, barHeight);
      }
    };

    paint();
    return () => cancelAnimationFrame(frame);
  }, [studio.analyser]);

  return (
    // Fills the box rather than standing at a fixed 176px inside it. The voice
    // recorder has no picture, so the meter is the whole of what the stage has
    // to show, and a short strip floating in the middle of it read as something
    // that had failed to load.
    <div className="flex size-full items-center justify-center px-6 py-10">
      <canvas ref={canvasRef} className="size-full" aria-hidden />
    </div>
  );
}

/**
 * The one thing the dock cannot say.
 *
 * Record, pause and stop are on the dock, the clock is on the dock, and the
 * button says "Record" on its face, so the line that used to sit here
 * explaining what pressing it would do has gone: a sentence under a labelled
 * button is a caption on a thing that already reads.
 *
 * What is left is the warning before a take reaches the ceiling, which is a
 * sentence and has nowhere else to go.
 */
function Transport({ studio }: { studio: StudioHandle }) {
  const { stage } = studio;
  const remaining = MAX_DURATION_MS - studio.elapsedMs;
  if (stage !== "recording" && stage !== "paused") return null;
  if (remaining >= 120_000) return null;

  return (
    <p className="px-1 text-sm text-muted">
      {formatDuration(Math.max(0, remaining))} left in this take. It saves by itself at the ceiling.
    </p>
  );
}
