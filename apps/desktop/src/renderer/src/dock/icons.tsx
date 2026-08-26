/**
 * Panel iconography.
 *
 * Drawn inline rather than pulled from a set: there are eight of them, they all
 * need to inherit `currentColor` for the active/off states, and a dependency
 * would be more weight than the shapes.
 */
const box = { viewBox: "0 0 20 20", "aria-hidden": true } as const;

export function ScreenIcon() {
  return (
    <svg {...box}>
      <rect
        x="2"
        y="4"
        width="16"
        height="11"
        rx="1.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M7 17.5h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function WindowIcon() {
  return (
    <svg {...box}>
      <rect
        x="2.5"
        y="3.5"
        width="12"
        height="9"
        rx="1.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.45"
      />
      <rect
        x="5.5"
        y="7.5"
        width="12"
        height="9"
        rx="1.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export function AreaIcon() {
  return (
    <svg {...box}>
      {/* Dashed marquee: the shape of a drag-selected region. */}
      <rect
        x="3"
        y="4"
        width="14"
        height="12"
        rx="1.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeDasharray="3 2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CameraIcon() {
  return (
    <svg {...box}>
      <rect
        x="2"
        y="5"
        width="11"
        height="10"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M13 9.2l4.2-2.4v6.4L13 10.8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CameraOffIcon() {
  return (
    <svg {...box}>
      <rect
        x="2"
        y="5"
        width="11"
        height="10"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M13 9.2l4.2-2.4v6.4L13 10.8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M3 17 17 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function MicIcon() {
  return (
    <svg {...box}>
      <rect
        x="7.5"
        y="2.5"
        width="5"
        height="9"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MicOffIcon() {
  return (
    <svg {...box}>
      <rect
        x="7.5"
        y="2.5"
        width="5"
        height="9"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M3 17 17 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg {...box}>
      <path
        d="M5.5 5.5l9 9M14.5 5.5l-9 9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Opens a device chooser. Points down because the menu comes up. */
export function ChevronIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M2.5 4.5 6 8l3.5-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="4" y="3" width="3" height="10" rx="1" fill="currentColor" />
      <rect x="9" y="3" width="3" height="10" rx="1" fill="currentColor" />
    </svg>
  );
}

export function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 3.5v9l8-4.5-8-4.5Z" fill="currentColor" />
    </svg>
  );
}

export function StopIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  );
}

/**
 * A bin, for discarding the take.
 *
 * Stroked rather than filled like its neighbours: Pause and Stop are solid
 * blocks because they are the two things this pill is for, and a third solid
 * shape beside them reads as equally routine. This one throws the recording
 * away.
 */
export function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor">
      <path
        d="M3 4.5h10M6.5 4.5V3.5a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1M4.5 4.5l.5 8a1 1 0 0 0 1 .95h4a1 1 0 0 0 1-.95l.5-8"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * A permission is missing.
 *
 * A triangle rather than a circle with an `i` in it: the panel already spends
 * circles on device status dots, and at 18px beside them this has to read as
 * "something is wrong" rather than as another state light.
 */
export function WarningIcon() {
  return (
    <svg {...box} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M10 3.2 18 16.8H2z" />
      <path d="M10 8.2v3.4" strokeLinecap="round" />
      <path d="M10 14.2h.01" strokeLinecap="round" />
    </svg>
  );
}
