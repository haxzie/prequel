import { useEffect, useState } from "react";

import type { MediaDevice } from "../../../shared/contract";

const PSEUDO_DEVICE_IDS = new Set(["default", "communications"]);

/**
 * Cameras or microphones available right now.
 *
 * macOS only reveals device *labels* once access has been granted, so the
 * permission is requested up front — otherwise the drop-up would list a set of
 * anonymous entries the user cannot tell apart. Devices are re-read on
 * `devicechange`, so plugging in a webcam updates the panel without a restart.
 */
export function useMediaDevices(kind: "videoinput" | "audioinput"): MediaDevice[] {
  const [devices, setDevices] = useState<MediaDevice[]>([]);

  useEffect(() => {
    let live = true;

    const read = async () => {
      const all = await navigator.mediaDevices.enumerateDevices();
      if (!live) return;

      setDevices(
        all
          .filter((device) => device.kind === kind && device.deviceId)
          // Chromium synthesises "default" and "communications" entries that
          // duplicate a real device. Left in, a Mac with one built-in mic looks
          // like it has two and grows a chooser arrow for no reason.
          .filter((device) => !PSEUDO_DEVICE_IDS.has(device.deviceId))
          .map((device, index) => ({
            deviceId: device.deviceId,
            label:
              device.label || `${kind === "videoinput" ? "Camera" : "Microphone"} ${index + 1}`,
          })),
      );
    };

    void (async () => {
      await window.prequel.permissions.ensureDevice(
        kind === "videoinput" ? "camera" : "microphone",
      );
      await read();
    })();

    navigator.mediaDevices.addEventListener("devicechange", read);
    return () => {
      live = false;
      navigator.mediaDevices.removeEventListener("devicechange", read);
    };
  }, [kind]);

  return devices;
}
