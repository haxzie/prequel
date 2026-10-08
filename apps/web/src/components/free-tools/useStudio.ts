"use client";

/**
 * The whole of the browser recorder: permissions, streams, the draw loop, the
 * encoder and the file that comes out.
 *
 * Nothing in here talks to a server, and that is a property of the design
 * rather than a promise in the copy: a recording lives in a `MediaStream`, gets
 * painted into a canvas, is encoded by the browser's own `MediaRecorder` and
 * ends up as a `Blob` behind an object URL. There is no upload step to leave
 * out, because there is no code that could perform one.
 *
 * It is one hook for three tools. `mode` decides which sources are opened and
 * whether there is a picture at all; everything below is shared, because the
 * screen recorder and the webcam recorder differ only in where the frames come
 * from and the voice recorder is the same machine with the canvas unplugged.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buildRenderPlan, type Frame, type Look } from "@/lib/free-tools/layout";
import { FRAME_PRESETS } from "@/lib/free-tools/presets";
import {
  AUDIO_BITRATE,
  negotiateEncoding,
  recordingFilename,
  videoBitrate,
  type Encoding,
} from "@/lib/free-tools/recording";
import type { ToolMode } from "@/lib/free-tools/mode";
import { drawFrame, sourceFrame } from "./compositor";
import { startTicker, type Ticker } from "./ticker";

/**
 * Where the tool is, as one of six things.
 *
 * A single stage rather than a set of booleans: `isRecording && !isPaused &&
 * hasStream` is the same state space with the illegal members left in, and the
 * illegal member that actually happened was a stopped recording still showing a
 * live preview.
 */
export type Stage =
  "unsupported" | "setup" | "ready" | "countdown" | "recording" | "paused" | "review";

export type Settings = {
  framePresetId: string;
  fps: number;
  look: Look;
  /** Record the microphone alongside the picture. */
  mic: boolean;
  micDeviceId: string;
  micGain: number;
  /** Record whatever the shared screen or tab is playing, where the browser offers it. */
  systemAudio: boolean;
  systemGain: number;
  cameraDeviceId: string;
};

export type Recording = {
  url: string;
  filename: string;
  size: number;
  /** Measured while recording, because the container often does not say. */
  durationMs: number;
  label: string;
  /**
   * The take's loudness over time, 0 to 1, one sample every `PEAK_MS`.
   *
   * Collected off the live meter while the recording runs rather than decoded
   * from the finished file. Decoding is the obvious way to draw a waveform and
   * the wrong one here: `decodeAudioData` on half an hour of audio allocates
   * the whole thing as float samples, which is hundreds of megabytes in a tab
   * that has just spent its memory holding the recording.
   *
   * Empty for the video tools, which have a picture to show instead.
   */
  peaks: number[];
};

export type Device = { deviceId: string; label: string };

/**
 * How long one recording may run.
 *
 * Thirty minutes, and it is a memory limit rather than a product decision.
 * Every chunk `MediaRecorder` emits is held in the tab until the file is saved,
 * so a recording is a growing allocation in a page that is also compositing
 * video: at 1080p30 half an hour is comfortably over a gigabyte, and the tab
 * that runs out of it takes the recording with it. The tool stops cleanly at
 * the ceiling, which leaves a file; the alternative leaves nothing.
 */
export const MAX_DURATION_MS = 30 * 60_000;

/** Seconds counted down before recording starts. */
const COUNTDOWN_FROM = 3;

/**
 * How often the waveform is sampled while recording.
 *
 * Ten a second: fine enough that a word is a bump rather than a single spike,
 * coarse enough that half an hour is eighteen thousand numbers.
 */
const PEAK_MS = 100;

/**
 * How often a chunk is flushed out of the encoder.
 *
 * Without a timeslice, `MediaRecorder` holds the entire recording as one buffer
 * and hands it over at `stop`. A second keeps the growing size on screen honest
 * and means a tab that is killed has already parted with most of the data.
 */
const CHUNK_MS = 1000;

export const DEFAULT_LOOK: Look = {
  camera: { on: false, size: 0.2, corner: "bottom-right", shape: "circle", mirrored: true },
};

export function defaultSettings(mode: ToolMode): Settings {
  return {
    // The camera tool opens on a vertical frame, which is what a talking head
    // is almost always posted as. The screen tool matches the source, because
    // reframing a display into 9:16 is a decision and not a default.
    framePresetId: mode === "camera" ? "vertical" : "source",
    fps: 30,
    look: { camera: { ...DEFAULT_LOOK.camera } },
    mic: true,
    micDeviceId: "",
    micGain: 1,
    systemAudio: mode === "screen",
    systemGain: 0.8,
    cameraDeviceId: "",
  };
}

/** What a thrown `DOMException` from a permission prompt actually means. */
function readableError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";

  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Your browser blocked the recording. Allow access when it asks, or check the camera and microphone permissions for this site.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No device matched. Check that a camera and a microphone are connected, then try again.";
    case "NotReadableError":
      return "Another app is already using that device. Close it and try again.";
    case "AbortError":
      // Chrome throws this when the picker is dismissed, which is a decision
      // rather than a fault, so the page says nothing about it.
      return "";
    default:
      return error instanceof Error && error.message
        ? error.message
        : "Something stopped the recording from starting. Try again.";
  }
}

export function useStudio(mode: ToolMode) {
  const [settings, setSettings] = useState<Settings>(() => defaultSettings(mode));
  const [stage, setStage] = useState<Stage>("setup");
  const [error, setError] = useState("");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [countdown, setCountdown] = useState(COUNTDOWN_FROM);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [microphones, setMicrophones] = useState<Device[]>([]);
  const [cameras, setCameras] = useState<Device[]>([]);
  /** False where the browser handed over a screen but no audio with it. */
  const [systemAudioCaptured, setSystemAudioCaptured] = useState(true);
  /**
   * What the source is actually handing over, in pixels.
   *
   * State and not a read off the `<video>` element at render time. A freshly
   * attached element reports a zero width until its metadata lands, and nothing
   * about metadata landing causes a React render — so "Match source" would
   * resolve to the 1920 by 1080 fallback on the first paint and stay there for
   * the whole recording. The element tells us instead, through `loadedmetadata`
   * and through `resize`, which is what fires when a shared window is resized
   * mid take.
   */
  const [sourceSize, setSourceSize] = useState<Frame | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** The off-layout home of the `<video>` elements the canvas draws from. */
  const holderRef = useRef<HTMLDivElement | null>(null);

  const screenVideo = useRef<HTMLVideoElement | null>(null);
  const cameraVideo = useRef<HTMLVideoElement | null>(null);
  const displayStream = useRef<MediaStream | null>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  const micStream = useRef<MediaStream | null>(null);

  const audioContext = useRef<AudioContext | null>(null);
  const micSource = useRef<MediaStreamAudioSourceNode | null>(null);
  const micGainNode = useRef<GainNode | null>(null);
  const systemGainNode = useRef<GainNode | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const ticker = useRef<Ticker | null>(null);
  const startedAt = useRef(0);
  const accumulatedMs = useRef(0);
  const peaks = useRef<number[]>([]);

  /**
   * The live settings, readable from the draw loop.
   *
   * The loop is started once and runs for the length of a recording, so it
   * closes over whatever `settings` was when it started. Dragging the camera
   * size slider would then change the preview for exactly as long as it took
   * React to re-render and never reach the frames being encoded. A ref is the
   * one value both can see.
   */
  const live = useRef(settings);
  live.current = settings;

  /**
   * The container this browser will write, resolved after mount.
   *
   * State set from an effect rather than a value computed while rendering.
   * `MediaRecorder` does not exist on the server, so a computed value is null
   * there and an MP4 here, and the line in the panel that names the format is
   * then a hydration mismatch: React throws the server's markup away and
   * re-renders the whole tool on the client. Null on both sides until the
   * browser has had a chance to answer costs one paint and keeps the tree.
   */
  const [encoding, setEncoding] = useState<Encoding | null>(null);

  useEffect(() => {
    setEncoding(negotiateEncoding(mode === "audio" ? "audio" : "video"));
  }, [mode]);

  useEffect(() => {
    const supported =
      typeof MediaRecorder !== "undefined" &&
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices &&
      (mode !== "screen" || typeof navigator.mediaDevices.getDisplayMedia === "function");

    if (!supported) setStage("unsupported");
  }, [mode]);

  /** Every track on every stream, stopped. This is what turns the indicator off. */
  const releaseStreams = useCallback(() => {
    for (const ref of [displayStream, cameraStream, micStream]) {
      ref.current?.getTracks().forEach((track) => track.stop());
      ref.current = null;
    }
    screenVideo.current?.remove();
    cameraVideo.current?.remove();
    screenVideo.current = null;
    cameraVideo.current = null;

    // The graph is torn down with the streams: a context left open holds the
    // microphone's own indicator on in Safari long after the tracks have gone.
    void audioContext.current?.close();
    audioContext.current = null;
    micSource.current = null;
    micGainNode.current = null;
    systemGainNode.current = null;
    analyser.current = null;
  }, []);

  const stopTicker = useCallback(() => {
    ticker.current?.stop();
    ticker.current = null;
  }, []);

  useEffect(
    () => () => {
      stopTicker();
      releaseStreams();
      if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    },
    [releaseStreams, stopTicker],
  );

  /**
   * Device names, once there is permission to know them.
   *
   * `enumerateDevices` returns entries with an empty `label` until a stream has
   * been granted, so this is called after the first `getUserMedia` rather than
   * on mount. Before that the pickers say "Default", which is the truth.
   */
  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const named = (kind: MediaDeviceKind, fallback: string) =>
        devices
          .filter((device) => device.kind === kind)
          .map((device, index) => ({
            deviceId: device.deviceId,
            label: device.label || `${fallback} ${index + 1}`,
          }));

      setMicrophones(named("audioinput", "Microphone"));
      setCameras(named("videoinput", "Camera"));
    } catch {
      // A browser that refuses to enumerate still records from the defaults,
      // so this is not worth a message on the page.
    }
  }, []);

  /** A muted, playing `<video>` bound to a stream, parked out of the layout. */
  const attach = useCallback((stream: MediaStream, role: "primary" | "bubble") => {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    // Appended rather than left detached, and never `display: none`: a hidden
    // element is allowed to stop decoding, and a stopped decoder is a frozen
    // picture in the recording with a live stream behind it. One transparent
    // pixel is enough to keep it rendering.
    holderRef.current?.appendChild(video);
    void video.play().catch(() => {
      // Autoplay of a muted stream is allowed everywhere, and a rejection here
      // is a tab that was closed mid-start. The stage machine handles that.
    });

    if (role === "primary") {
      const report = () => {
        if (video.videoWidth > 0) {
          setSourceSize({ width: video.videoWidth, height: video.videoHeight });
        }
      };
      video.addEventListener("loadedmetadata", report);
      video.addEventListener("resize", report);
      report();
    }

    return video;
  }, []);

  /**
   * The audio graph's root, made once and kept.
   *
   * Created on the first microphone grant rather than on mount: a context
   * constructed without a user gesture starts suspended, and a suspended context
   * is a level meter that reads zero and a mixdown that records silence.
   */
  const ensureContext = useCallback(() => {
    if (!audioContext.current || audioContext.current.state === "closed") {
      audioContext.current = new AudioContext();
    }
    void audioContext.current.resume();
    return audioContext.current;
  }, []);

  /**
   * The microphone, into the meter.
   *
   * Wired as soon as the device is open, which is what lets the level move
   * before anybody has pressed record. Checking that a microphone works after
   * recording ten minutes with the wrong one selected is the thing this exists
   * to prevent.
   */
  const meterMicrophone = useCallback(
    (stream: MediaStream) => {
      const context = ensureContext();

      if (!analyser.current) {
        const meter = context.createAnalyser();
        meter.fftSize = 2048;
        analyser.current = meter;
      }

      micSource.current?.disconnect();
      const source = context.createMediaStreamSource(stream);
      source.connect(analyser.current);
      micSource.current = source;
    },
    [ensureContext],
  );

  const openCamera = useCallback(
    async (deviceId: string) => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          // A request rather than a constraint. `exact` here is how a webcam
          // that only does 1280 by 720 fails the whole call instead of handing
          // over the frame it has.
          // Asked high because the camera tool crops to the middle of the
          // frame: a 1280 wide webcam cropped to 9:16 leaves 405 pixels to fill
          // 1080, which is a soft picture. A webcam that cannot manage 1920
          // hands over what it has, which is the whole point of `ideal`.
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      cameraStream.current = stream;
      cameraVideo.current = attach(stream, mode === "camera" ? "primary" : "bubble");
      void refreshDevices();
    },
    [attach, mode, refreshDevices],
  );

  const openMicrophone = useCallback(
    async (deviceId: string) => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          // Left to the browser's defaults. Echo cancellation and noise
          // suppression are tuned for calls and are what stops a laptop
          // recording its own speakers back into the take.
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      micStream.current = stream;
      meterMicrophone(stream);
      void refreshDevices();
    },
    [meterMicrophone, refreshDevices],
  );

  /**
   * Ask for the sources and start the preview.
   *
   * Must be called from a click. `getDisplayMedia` requires a user gesture and
   * throws without one, so there is no arrangement in which the picker can be
   * opened on page load, which is also the right behaviour.
   */
  const arm = useCallback(async () => {
    setError("");
    setSystemAudioCaptured(true);

    try {
      if (mode === "screen") {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: live.current.fps } },
          // Asked for whenever the toggle is on. Chrome offers tab and window
          // audio here, Safari and Firefox hand over a video track only, and
          // the page says which happened rather than claiming either.
          audio: live.current.systemAudio,
        });
        displayStream.current = stream;
        screenVideo.current = attach(stream, "primary");
        setSystemAudioCaptured(stream.getAudioTracks().length > 0);

        // The browser's own "Stop sharing" button ends the track without going
        // anywhere near this page's controls. Mid recording that would leave
        // the encoder running on a dead stream, which is a file that ends in a
        // frozen frame; before recording it would leave a live preview of
        // nothing. Both are handled, because both happen.
        stream.getVideoTracks()[0]?.addEventListener("ended", () => {
          if (recorder.current && recorder.current.state !== "inactive") {
            stop();
            return;
          }
          releaseStreams();
          setSourceSize(null);
          setStage("setup");
        });
      }

      if (mode === "camera" || (mode === "screen" && live.current.look.camera.on)) {
        await openCamera(live.current.cameraDeviceId);
      }

      if (mode === "audio" || live.current.mic) {
        await openMicrophone(live.current.micDeviceId);
      }

      setStage("ready");
    } catch (thrown) {
      releaseStreams();
      setError(readableError(thrown));
      setStage("setup");
    }
    // `stop` is read through the closure rather than listed: it is declared
    // below this callback, and naming it in the dependency array would be a
    // cycle between two `useCallback`s that both have to be stable.
  }, [attach, mode, openCamera, openMicrophone, releaseStreams]);

  /** The output frame, which is the preset or the source's own size. */
  const frame = useMemo(() => {
    const preset = FRAME_PRESETS.find((item) => item.id === settings.framePresetId);
    if (preset?.frame) return preset.frame;

    // 16:9 at 1080p until the source reports its own size, so the preview has
    // somewhere to be drawn rather than collapsing to nothing on first paint.
    return sourceSize ?? { width: 1920, height: 1080 };
  }, [settings.framePresetId, sourceSize]);

  /**
   * Paint, from a clock that survives the tab being hidden.
   *
   * One loop for the preview and the recording, started as soon as there is
   * something to show and left running until the streams go. Starting it only
   * at record time would mean the first frames of every file are the first
   * frames the compositor has ever drawn.
   */
  useEffect(() => {
    if (mode === "audio") return;
    if (stage !== "ready" && stage !== "countdown" && stage !== "recording" && stage !== "paused") {
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { alpha: false });
    if (!canvas || !ctx) return;

    // Sized here, where the canvas is known to exist, and not in an effect of
    // its own keyed on the frame. The canvas mounts when the stage leaves
    // "setup", by which point a frame-keyed effect has already run against a
    // null ref and will not run again: the surface keeps its default 300 by 150
    // and the whole recording is encoded at that size. Nothing on the page looks
    // wrong, because CSS scales 300 by 150 up to the same box.
    canvas.width = frame.width;
    canvas.height = frame.height;

    const paint = () => {
      const current = live.current;
      const plan = buildRenderPlan({
        // The camera fills the frame it was pointed at; a shared screen keeps
        // its own proportions inside it. See `Fit` in the layout module.
        fit: mode === "camera" ? "cover" : "contain",
        frame: { width: canvas.width, height: canvas.height },
        source: sourceFrame(mode === "camera" ? cameraVideo.current : screenVideo.current),
        look:
          mode === "camera"
            ? // The camera is the recording in this tool, not a bubble on top of
              // one, so the bubble is never drawn and the stream goes through
              // the screen slot. One compositor, two ways in.
              { ...current.look, camera: { ...current.look.camera, on: false } }
            : current.look,
      });

      drawFrame(ctx, plan, {
        screen: mode === "camera" ? cameraVideo.current : screenVideo.current,
        camera: cameraVideo.current,
      });
    };

    ticker.current = startTicker(settings.fps, paint);
    paint();

    return () => stopTicker();
    // The frame is in the list because changing it resizes the canvas, which
    // has to happen with the loop stopped: a resize clears the surface, and a
    // paint landing mid-resize draws into a canvas that is about to be wiped.
  }, [frame.height, frame.width, mode, settings.fps, stage, stopTicker]);

  /**
   * The audio graph, and the one stream of samples the encoder is given.
   *
   * Built here rather than per source, because a `MediaRecorder` takes exactly
   * one audio track: handing it a microphone track and a system audio track
   * records the first and silently drops the second. The mixdown is a
   * `MediaStreamDestination` with a gain on each input, which is also what makes
   * the two sliders work while a recording is running.
   */
  const mixAudio = useCallback((): MediaStreamTrack | null => {
    const inputs: { stream: MediaStream; gain: number; which: "mic" | "system" }[] = [];
    if (micStream.current && (mode === "audio" || live.current.mic)) {
      inputs.push({ stream: micStream.current, gain: live.current.micGain, which: "mic" });
    }
    const systemTracks = displayStream.current?.getAudioTracks() ?? [];
    if (systemTracks.length > 0 && live.current.systemAudio) {
      inputs.push({
        stream: new MediaStream(systemTracks),
        gain: live.current.systemGain,
        which: "system",
      });
    }
    if (inputs.length === 0) return null;

    const context = ensureContext();
    const destination = context.createMediaStreamDestination();

    for (const input of inputs) {
      const node = context.createGain();
      node.gain.value = input.gain;

      // The microphone is already a source node, built when the device opened
      // so the meter could read it. Making a second one off the same stream
      // works and doubles the microphone into the mix, which sounds like a
      // slight phase smear rather than an obvious fault.
      const source =
        input.which === "mic" && micSource.current
          ? micSource.current
          : context.createMediaStreamSource(input.stream);

      source.connect(node);
      node.connect(destination);

      if (input.which === "mic") micGainNode.current = node;
      else systemGainNode.current = node;
    }

    return destination.stream.getAudioTracks()[0] ?? null;
  }, [ensureContext, mode]);

  /** Gain changes reach a running recording through the nodes, not a restart. */
  useEffect(() => {
    if (micGainNode.current) micGainNode.current.gain.value = settings.micGain;
    if (systemGainNode.current) systemGainNode.current.gain.value = settings.systemGain;
  }, [settings.micGain, settings.systemGain]);

  const begin = useCallback(() => {
    if (!encoding) return;

    const audioTrack = mixAudio();
    const tracks: MediaStreamTrack[] = [];

    if (mode !== "audio") {
      const canvas = canvasRef.current;
      if (!canvas) return;
      // The frames come off the canvas and not off the display track, which is
      // what makes the chosen frame and the camera bubble part of the file
      // rather than a decoration on the preview.
      tracks.push(...canvas.captureStream(settings.fps).getVideoTracks());
    }
    if (audioTrack) tracks.push(audioTrack);

    if (tracks.length === 0) {
      setError("There is nothing to record. Turn on the microphone, or share a screen.");
      return;
    }

    chunks.current = [];
    peaks.current = [];
    setBytes(0);
    accumulatedMs.current = 0;

    const instance = new MediaRecorder(new MediaStream(tracks), {
      ...(encoding.mimeType ? { mimeType: encoding.mimeType } : {}),
      ...(mode === "audio"
        ? {}
        : { videoBitsPerSecond: videoBitrate(frame.width, frame.height, settings.fps) }),
      audioBitsPerSecond: AUDIO_BITRATE,
    });

    instance.ondataavailable = (event) => {
      if (event.data.size === 0) return;
      chunks.current.push(event.data);
      setBytes((size) => size + event.data.size);
    };

    instance.onstop = () => {
      const blob = new Blob(chunks.current, { type: encoding.mimeType || undefined });
      chunks.current = [];

      setRecording({
        url: URL.createObjectURL(blob),
        filename: recordingFilename(
          mode === "audio" ? "voice-recording" : `${mode}-recording`,
          encoding.extension,
        ),
        size: blob.size,
        durationMs: accumulatedMs.current + (Date.now() - startedAt.current),
        label: encoding.label,
        peaks: peaks.current,
      });
      setStage("review");
      stopTicker();
      releaseStreams();
    };

    recorder.current = instance;
    startedAt.current = Date.now();
    instance.start(CHUNK_MS);
    setStage("recording");
  }, [
    encoding,
    frame.height,
    frame.width,
    mixAudio,
    mode,
    releaseStreams,
    settings.fps,
    stopTicker,
  ]);

  /** Three, two, one. The whole reason a screen recording does not open on a click. */
  const start = useCallback(() => {
    setError("");
    setCountdown(COUNTDOWN_FROM);
    setStage("countdown");
  }, []);

  useEffect(() => {
    if (stage !== "countdown") return;

    const timer = setTimeout(() => {
      if (countdown <= 1) begin();
      else setCountdown((value) => value - 1);
    }, 900);

    return () => clearTimeout(timer);
  }, [begin, countdown, stage]);

  const stop = useCallback(() => {
    const instance = recorder.current;
    if (!instance || instance.state === "inactive") return;
    // `stop` fires `ondataavailable` for the tail and then `onstop`, which is
    // where the file is assembled. Nothing else is done here.
    instance.stop();
    recorder.current = null;
  }, []);

  const pause = useCallback(() => {
    const instance = recorder.current;
    if (instance?.state !== "recording") return;
    instance.pause();
    accumulatedMs.current += Date.now() - startedAt.current;
    setStage("paused");
  }, []);

  const resume = useCallback(() => {
    const instance = recorder.current;
    if (instance?.state !== "paused") return;
    instance.resume();
    startedAt.current = Date.now();
    setStage("recording");
  }, []);

  /** The clock on screen, at five updates a second rather than sixty. */
  useEffect(() => {
    if (stage !== "recording") return;

    const tick = () => {
      const total = accumulatedMs.current + (Date.now() - startedAt.current);
      setElapsedMs(total);
      if (total >= MAX_DURATION_MS) stop();
    };

    tick();
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [stage, stop]);

  /**
   * The waveform, sampled off the meter while the take runs.
   *
   * Only where there is no picture: the video tools show the recording back and
   * have no use for it, and eighteen thousand numbers nobody draws is still
   * eighteen thousand numbers.
   */
  useEffect(() => {
    if (mode !== "audio" || stage !== "recording") return;

    const samples = new Uint8Array(1024);
    const timer = setInterval(() => {
      const meter = analyser.current;
      if (!meter) return;

      meter.getByteTimeDomainData(samples);
      let peak = 0;
      // 128 is silence in time domain data, so the distance from it is the
      // amplitude. Doubled, as the live meter doubles it: speech at a sane
      // input gain sits around a quarter of full scale, and a waveform drawn
      // raw would be a flat line with the odd nick in it.
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128) / 128);
      peaks.current.push(Math.min(1, peak * 2));
    }, PEAK_MS);

    return () => clearInterval(timer);
  }, [mode, stage]);

  /** Back to the beginning, and the old file's memory handed back. */
  const reset = useCallback(() => {
    if (recording) URL.revokeObjectURL(recording.url);
    setRecording(null);
    setElapsedMs(0);
    setBytes(0);
    setError("");
    setSourceSize(null);
    releaseStreams();
    setStage("setup");
  }, [recording, releaseStreams]);

  /**
   * Turn the bubble on or off while the preview is live.
   *
   * The camera is a stream and not a setting, so flipping the toggle has to
   * open or close a device. Doing it from the toggle's own handler is what keeps
   * the camera light off when the bubble is off, which is the behaviour anybody
   * would expect and the one a settings-only implementation gets wrong.
   */
  const setCameraOn = useCallback(
    async (on: boolean) => {
      setSettings((current) => ({
        ...current,
        look: { ...current.look, camera: { ...current.look.camera, on } },
      }));

      if (!on) {
        cameraStream.current?.getTracks().forEach((track) => track.stop());
        cameraStream.current = null;
        cameraVideo.current?.remove();
        cameraVideo.current = null;
        return;
      }

      if (stage === "setup" || cameraStream.current) return;

      try {
        await openCamera(live.current.cameraDeviceId);
      } catch (thrown) {
        setError(readableError(thrown));
        setSettings((current) => ({
          ...current,
          look: { ...current.look, camera: { ...current.look.camera, on: false } },
        }));
      }
    },
    [openCamera, stage],
  );

  /** Same shape for the microphone, for the same reason. */
  const setMicOn = useCallback(
    async (on: boolean) => {
      setSettings((current) => ({ ...current, mic: on }));

      if (!on) {
        micStream.current?.getTracks().forEach((track) => track.stop());
        micStream.current = null;
        return;
      }
      if (stage === "setup" || micStream.current) return;

      try {
        await openMicrophone(live.current.micDeviceId);
      } catch (thrown) {
        setError(readableError(thrown));
        setSettings((current) => ({ ...current, mic: false }));
      }
    },
    [openMicrophone, stage],
  );

  /** Swapping a device mid-preview: close the old one, open the named one. */
  const selectDevice = useCallback(
    async (kind: "mic" | "camera", deviceId: string) => {
      setSettings((current) =>
        kind === "mic"
          ? { ...current, micDeviceId: deviceId }
          : { ...current, cameraDeviceId: deviceId },
      );
      if (stage !== "ready") return;

      try {
        if (kind === "mic") {
          micStream.current?.getTracks().forEach((track) => track.stop());
          micStream.current = null;
          if (live.current.mic || mode === "audio") await openMicrophone(deviceId);
        } else {
          cameraStream.current?.getTracks().forEach((track) => track.stop());
          cameraStream.current = null;
          cameraVideo.current?.remove();
          cameraVideo.current = null;
          if (live.current.look.camera.on || mode === "camera") await openCamera(deviceId);
        }
      } catch (thrown) {
        setError(readableError(thrown));
      }
    },
    [mode, openCamera, openMicrophone, stage],
  );

  return {
    stage,
    settings,
    setSettings,
    error,
    elapsedMs,
    bytes,
    countdown,
    recording,
    encoding,
    frame,
    microphones,
    cameras,
    systemAudioCaptured,
    canvasRef,
    holderRef,
    analyser,
    arm,
    start,
    stop,
    pause,
    resume,
    reset,
    setCameraOn,
    setMicOn,
    selectDevice,
  };
}
