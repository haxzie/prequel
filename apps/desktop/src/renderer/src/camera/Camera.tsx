import { useEffect, useRef, useState } from "react";

import { useDock } from "../hooks/useDock";
import { CloseIcon } from "../dock/icons";

/**
 * The camera preview bubble.
 *
 * Shows whatever camera the panel has selected, following it live so switching
 * device in the drop-up updates the bubble without reopening anything.
 */
export function Camera() {
  const { preferences, devicesLive } = useDock();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const deviceId = preferences.cameraId;
    // Hiding this window does not unmount it, so without the second condition
    // the camera stays open — and its light stays on — for as long as the app
    // is running. Main says when, because it is the only side that knows the
    // panel has closed or an editor has taken over.
    if (!deviceId || !devicesLive) return;

    let stream: MediaStream | null = null;
    let cancelled = false;

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceId } },
          audio: false,
        });
        // The device can change while we were awaiting; drop a stale stream
        // rather than showing the wrong camera.
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (videoRef.current) videoRef.current.srcObject = stream;
        setError(null);
        void window.prequel.dock.reportCameraError(null);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        // The bubble is the only part of the app that actually opens the
        // device, so it is the only one that can tell the panel the camera is
        // listed but unusable — otherwise the panel shows it as on.
        void window.prequel.dock.reportCameraError(message);
      }
    })();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [preferences.cameraId, devicesLive]);

  return (
    // Same inset as the panel, for the same reason: the window is square, the
    // bubble is round, and a window shadow would be square around it. The ring
    // and shadow are drawn here rather than on the window, and the bubble
    // itself is the drag handle.
    <div
      className={
        "group drag squircle relative m-(--panel-inset) h-[calc(100%-var(--panel-inset)*2)] " +
        "w-[calc(100%-var(--panel-inset)*2)] overflow-hidden rounded-[60%] border-2 " +
        "border-white/22 bg-[#101114] shadow-[0_4px_14px_rgba(0,0,0,0.45)]"
      }
    >
      {error ? (
        <span className="grid h-full w-full place-items-center p-4 text-center text-[11px] text-muted">
          {error}
        </span>
      ) : (
        // Filled regardless of the camera's aspect ratio, and mirrored like
        // every other self-view — an un-mirrored preview reads as wrong when
        // you move.
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover [transform:scaleX(-1)]"
        />
      )}

      {/* Switching the camera off from the bubble itself, which is where you
          are looking when you decide you do not want it. Clearing the device is
          what hides this window — the panel and the bubble are two views of the
          same preference. */}
      <button
        type="button"
        // Appears on hover, inset far enough to clear the squircle's corner.
        // The bubble is a drag handle; this must not be, or the button would
        // move the window instead of being pressed.
        className={
          "no-drag absolute top-[11%] right-[11%] grid size-[26px] place-items-center " +
          "rounded-full bg-black/55 text-white opacity-0 transition-opacity duration-[120ms] " +
          "ease-out group-hover:opacity-100 hover:bg-black/78 [&_svg]:size-[13px]"
        }
        title="Turn camera off"
        onClick={() => {
          void window.prequel.dock.updatePreferences({ cameraId: null, cameraLabel: null });
        }}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
