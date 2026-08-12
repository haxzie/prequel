import { useEffect, useRef } from "react";

/**
 * The dB window the meter maps onto its full height.
 *
 * Not the range a signal can occupy — that is -Infinity to 0 — but the range
 * worth *showing*. A quiet room measures around -41 dBFS on a laptop
 * microphone, so a floor much below that leaves the icon permanently a quarter
 * full and the meter says nothing. The ceiling sits below 0 because speech
 * peaks well short of clipping, and reserving the top of the meter for volumes
 * nobody reaches wastes most of it.
 */
const FLOOR_DB = -42;
const CEILING_DB = -6;

/** Below this the meter reads empty, so room tone does not shimmer. */
const DEAD_ZONE = 0.03;

/**
 * How much of the previous level survives each frame on the way down.
 *
 * Rises are applied instantly and falls are damped, which is what makes a
 * meter readable — an undamped one flickers on every syllable and an evenly
 * smoothed one hides transients entirely.
 */
const RELEASE = 0.82;

/**
 * Live input level for a microphone, as a `--level` custom property.
 *
 * Returns a ref to attach to the element that should be filled. The value is
 * written straight to that element's style rather than held in React state:
 * this updates every animation frame, and re-rendering the panel 60 times a
 * second to move one clip path would be absurd.
 *
 * The stream is released whenever the panel is hidden. Otherwise the menu-bar
 * microphone indicator would stay lit for as long as the app was running,
 * which is both alarming and untrue.
 */
export function useAudioLevel(deviceId: string | null) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!deviceId || !element) return;

    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let frame = 0;
    let level = 0;
    let disposed = false;

    const release = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      void context?.close();
      context = null;
      level = 0;
      element.style.setProperty("--level", "0");
    };

    const listen = async () => {
      if (disposed || stream) return;

      try {
        const opened = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: deviceId },
            // Raw input. The meter should show what the microphone hears, not
            // what a noise suppressor decided to leave behind — and the
            // recording itself does not go through this path anyway.
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });

        // The device can change, or the panel close, while we were awaiting.
        if (disposed) {
          opened.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = opened;

        context = new AudioContext();
        await context.resume();

        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.2;
        context.createMediaStreamSource(stream).connect(analyser);

        const samples = new Uint8Array(analyser.fftSize);

        const tick = () => {
          analyser.getByteTimeDomainData(samples);

          let sum = 0;
          for (let i = 0; i < samples.length; i += 1) {
            const value = (samples[i]! - 128) / 128;
            sum += value * value;
          }

          // dB rather than raw amplitude: loudness is logarithmic, and a linear
          // meter spends its whole range on the loudest few percent.
          const rms = Math.sqrt(sum / samples.length);
          const db = 20 * Math.log10(Math.max(rms, 1e-6));
          const scaled = (db - FLOOR_DB) / (CEILING_DB - FLOOR_DB);
          const target = scaled < DEAD_ZONE ? 0 : Math.min(1, scaled);

          level = target > level ? target : level * RELEASE + target * (1 - RELEASE);
          element.style.setProperty("--level", level.toFixed(3));

          frame = requestAnimationFrame(tick);
        };

        tick();
      } catch {
        // No access, or the device vanished. The dot already reports that; the
        // meter just stays empty.
        element.style.setProperty("--level", "0");
      }
    };

    const onVisibility = () => {
      if (document.hidden) release();
      else void listen();
    };

    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) void listen();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      release();
    };
  }, [deviceId]);

  return ref;
}
