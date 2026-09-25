/**
 * Every screenshot the documentation uses, as data.
 *
 * A shot names what to render, the environment to draw it in, the fixture
 * state the bridge answers with, the clicks and keys to perform before the
 * capture, and the element to crop to. `scripts/shoot-docs.mjs` reads the
 * steps and the clip off `window.__gallery` and performs them with real input
 * events over the DevTools protocol — real rather than synthetic, because the
 * timeline calls `setPointerCapture`, which throws on a `PointerEvent` that
 * did not come from a pointer.
 *
 * The output file is `apps/web/public/docs/<id>.webp`, and the Markdown refers
 * to it as `/docs/<id>.webp`. Renaming a shot here renames the file, so the
 * pages that use it have to move with it.
 */
import { lazy, type ReactNode } from "react";

import { IDLE_SESSION } from "../src/shared/contract";
import { createBridge, type Fixtures } from "./bridge";
import { DISPLAY, SAFARI, permissions } from "./fixtures";

const Dock = lazy(() => import("../src/renderer/src/dock/Dock").then((m) => ({ default: m.Dock })));
const Welcome = lazy(() =>
  import("../src/renderer/src/welcome/Welcome").then((m) => ({ default: m.Welcome })),
);
const Library = lazy(() =>
  import("../src/renderer/src/workspace/Library").then((m) => ({ default: m.Library })),
);
const EditorRoute = lazy(() =>
  import("../src/renderer/src/editor/EditorRoute").then((m) => ({ default: m.EditorRoute })),
);
const Script = lazy(() =>
  import("../src/renderer/src/script/Script").then((m) => ({ default: m.Script })),
);
const Teleprompter = lazy(() =>
  import("../src/renderer/src/teleprompter/Teleprompter").then((m) => ({
    default: m.Teleprompter,
  })),
);

export type ShotFrameKind =
  | "workspace"
  | "welcome"
  | "script"
  | "dock"
  | "dock-transparent"
  | "island"
  | "island-narrow"
  | "island-plain"
  | "bare";

/** One thing the capture script does before it takes the picture. */
export type Step =
  /** A real mouse click on the centre of the first element matching `selector`
      (and, when given, whose trimmed text is `text`). */
  | { kind: "click"; selector: string; text?: string; at?: number }
  /**
   * The pointer moved onto an element and left there, with no press.
   *
   * `at` is how far along its width to sit, 0 to 1, because what a hover shows
   * often depends on where along the thing the pointer is — the ghost of a text
   * lands under the pointer, not in the middle of the row.
   */
  | { kind: "hover"; selector: string; text?: string; at?: number }
  /** A key press, by `KeyboardEvent.code`. */
  | { kind: "key"; code: string }
  /** Text typed into whatever has focus. */
  | { kind: "type"; text: string }
  /** A click on the timeline ruler, `fraction` of the way along it. */
  | { kind: "seek"; fraction: number }
  /** Wait until `selector` matches something. */
  | { kind: "wait"; selector: string }
  /** Let animations finish. */
  | { kind: "settle"; ms: number }
  /** Scroll the first element matching `selector` to the top of its scroller. */
  | { kind: "scrollTo"; selector: string };

export interface Shot {
  id: string;
  frame: ShotFrameKind;
  /** Makes the bridge this shot renders against. */
  install: () => Promise<void>;
  render: () => ReactNode;
  steps: Step[];
  /**
   * What to crop to: a selector, several (the union of their boxes), or
   * `"frame"` for the whole window the `ShotFrame` drew.
   */
  clip: string | string[] | "frame";
  /**
   * CSS pixels of surroundings to keep around the clip. A dock pill cropped
   * flush loses the shadow that makes it a floating panel; a dialog cropped
   * flush loses the editor it sits over.
   */
  pad?: number;
  /**
   * Trim the clip to this many CSS pixels wide, from its left edge. The
   * timeline is as wide as the window, and a strip that wide shrinks to
   * nothing in a column of prose; the zoom in question sits in its first half.
   */
  maxWidth?: number;
}

/** The recording every editor shot opens, from the server's config. */
let recording = "";

export async function configure(): Promise<void> {
  const response = await fetch("/fixture/config.json");
  const config = (await response.json()) as { recording: string };
  recording = config.recording;
}

function install(overrides: Partial<Fixtures> | ((base: Fixtures) => Partial<Fixtures>) = {}) {
  return async () => {
    const base = createBridge().fixtures;
    const bridge = createBridge(typeof overrides === "function" ? overrides(base) : overrides);
    window.prequel = bridge.api;
  };
}

/** The editor, and a click on one of the Inspector's rail buttons. */
function inspector(id: string, label: string, steps: Step[] = []): Shot {
  return {
    id,
    frame: "workspace",
    install: install(),
    render: () => <EditorRoute name={recording} />,
    steps: [
      { kind: "wait", selector: "[data-panel='timeline']" },
      { kind: "seek", fraction: 0.35 },
      ...steps,
      { kind: "click", selector: `button[aria-label="${label}"]` },
      { kind: "settle", ms: 400 },
    ],
    clip: "[data-panel='inspector']",
  };
}

/** The picker labels the three look shots click, so the selector and the
    registry cannot drift apart silently. */
const LOOK_LABELS = {
  crt: "CRT",
  lcd: "LCD",
  fisheye: "Fish eye",
  bloom: "Glow",
  halftone: "Halftone",
  "window-light": "Window light",
};

const EDITOR_READY: Step[] = [
  { kind: "wait", selector: "[data-panel='timeline']" },
  { kind: "seek", fraction: 0.35 },
  { kind: "settle", ms: 300 },
];

export const SHOTS: readonly Shot[] = [
  // ── The teleprompter ──────────────────────────────────────────────────────
  {
    id: "teleprompter",
    frame: "island",
    install: install((base) => ({
      dock: { ...base.dock, preferences: { ...base.dock.preferences, teleprompter: true } },
    })),
    render: () => <Teleprompter />,
    steps: [{ kind: "settle", ms: 500 }],
    clip: "frame",
    pad: 40,
  },

  {
    id: "teleprompter-narrow",
    frame: "island-narrow",
    install: install((base) => ({
      dock: {
        ...base.dock,
        preferences: { ...base.dock.preferences, teleprompter: true, teleprompterWidth: "narrow" },
      },
      teleprompterPosition: { position: 0, lost: false, level: 0 },
    })),
    render: () => <Teleprompter />,
    steps: [{ kind: "settle", ms: 500 }],
    clip: "frame",
    pad: 40,
  },
  {
    id: "teleprompter-plain",
    frame: "island-plain",
    install: install((base) => ({
      dock: { ...base.dock, preferences: { ...base.dock.preferences, teleprompter: true } },
      teleprompter: { ...base.teleprompter, notch: null },
    })),
    render: () => <Teleprompter />,
    steps: [{ kind: "settle", ms: 500 }],
    clip: "frame",
    pad: 40,
  },
  {
    id: "script-window",
    frame: "script",
    install: install((base) => ({
      dock: { ...base.dock, preferences: { ...base.dock.preferences, teleprompter: true } },
    })),
    render: () => <Script />,
    steps: [{ kind: "settle", ms: 300 }],
    clip: "frame",
    pad: 40,
  },
  {
    id: "dock-teleprompter",
    frame: "dock",
    install: install((base) => ({
      dock: { ...base.dock, preferences: { ...base.dock.preferences, teleprompter: true } },
    })),
    render: () => <Dock />,
    steps: [],
    clip: "[data-view='setup']",
    pad: 28,
  },

  // ── The dock ──────────────────────────────────────────────────────────────
  {
    id: "dock-setup",
    frame: "dock",
    install: install(),
    render: () => <Dock />,
    steps: [],
    clip: "[data-view='setup']",
    pad: 28,
  },
  {
    id: "dock-setup-window",
    frame: "dock",
    install: install((base) => ({
      dock: {
        ...base.dock,
        activeMode: "window",
        selection: { mode: "window", target: SAFARI, crop: null, label: "Safari — Inbox" },
      },
    })),
    render: () => <Dock />,
    steps: [],
    clip: "[data-view='setup']",
    pad: 28,
  },
  {
    id: "dock-permissions",
    frame: "dock",
    install: install({ permissions: permissions({ accessibility: false }) }),
    render: () => <Dock />,
    steps: [],
    clip: "[data-view='setup']",
    pad: 28,
  },
  {
    id: "dock-recording",
    frame: "dock",
    install: install((base) => ({
      dock: {
        ...base.dock,
        view: "recording",
        session: { ...IDLE_SESSION, status: "recording", target: DISPLAY, elapsedMs: 83_000 },
      },
    })),
    render: () => <Dock />,
    steps: [],
    clip: "[data-view='recording']",
    pad: 28,
  },

  // ── Windows ───────────────────────────────────────────────────────────────
  {
    id: "welcome-permissions",
    frame: "welcome",
    install: install({
      permissions: permissions({ camera: false, microphone: false, accessibility: false }),
    }),
    render: () => <Welcome startAt="permissions" />,
    steps: [{ kind: "settle", ms: 300 }],
    clip: "frame",
  },
  {
    id: "projects",
    frame: "workspace",
    install: install(),
    render: () => <Library section="projects" onSection={() => {}} onOpen={() => {}} />,
    steps: [{ kind: "settle", ms: 800 }],
    clip: "frame",
  },
  {
    id: "settings",
    frame: "workspace",
    install: install(),
    render: () => <Library section="settings" onSection={() => {}} onOpen={() => {}} />,
    steps: [{ kind: "settle", ms: 300 }],
    clip: "frame",
  },

  // ── The editor ────────────────────────────────────────────────────────────
  {
    id: "editor",
    frame: "workspace",
    install: install(),
    render: () => <EditorRoute name={recording} />,
    steps: [
      ...EDITOR_READY,
      { kind: "click", selector: 'button[aria-label="Layout"]' },
      { kind: "settle", ms: 400 },
    ],
    clip: "frame",
  },
  inspector("inspector-presets", "Presets"),
  inspector("inspector-layout", "Layout"),
  inspector("inspector-background", "Background"),
  inspector("inspector-recording", "Recording"),
  inspector("inspector-camera", "Camera"),
  inspector("inspector-audio", "Audio"),
  inspector("inspector-cursor", "Cursor"),
  // A named pointer: the blue tag chosen and a name typed, with the tag
  // drawn beside the pointer in the preview. The whole frame, since the
  // point of the shot is the preview and the panel together.
  {
    id: "cursor-tag",
    frame: "workspace",
    install: install(),
    render: () => <EditorRoute name={recording} />,
    steps: [
      ...EDITOR_READY,
      { kind: "click", selector: 'button[aria-label="Cursor"]' },
      { kind: "settle", ms: 300 },
      { kind: "click", selector: 'button[aria-label="Blue name tag"]' },
      { kind: "click", selector: 'input[placeholder="Who is pointing"]' },
      { kind: "type", text: "Musthaq" },
      // Past the name's settle and the draw.
      { kind: "settle", ms: 900 },
    ],
    clip: "frame",
  },
  inspector("inspector-captions", "Captions"),
  inspector("inspector-filters", "Filters"),
  // A look actually on the picture, rather than the panel that chooses it.
  // The whole frame, because the point of the shot is the preview: this is the
  // only place a filter is *seen* rather than asserted, and the WebGL pass it
  // goes through is the one the tests cannot reach.
  {
    id: "filter-applied",
    frame: "workspace",
    install: install(),
    render: () => <EditorRoute name={recording} />,
    steps: [
      ...EDITOR_READY,
      { kind: "click", selector: 'button[aria-label="Filters"]' },
      { kind: "settle", ms: 300 },
      { kind: "click", selector: 'button[aria-label^="Chromatic aberration"]' },
      // Past the write, the plan rebuild and a draw or two.
      { kind: "settle", ms: 900 },
    ],
    clip: "frame",
  },
  // Four looks on the real composition, and the riskiest shaders in the set:
  // two ruled masks, a dot screen, and the one gobo built from noise. The pixel
  // tests prove the export draws *something* for every look; only these show
  // whether it is the right something, and only these reach the WebGL path at
  // all.
  //
  // The LCD earns its place: it shipped sampling each cell's centre, which
  // downsampled the recording by the cell size and left no readable text
  // anywhere in the frame. Nothing asserted caught that — it takes a picture.
  ...(["crt", "lcd", "fisheye", "bloom", "halftone", "window-light"] as const).map((look) => ({
    id: `filter-${look}`,
    frame: "workspace" as const,
    install: install(),
    render: () => <EditorRoute name={recording} />,
    steps: [
      ...EDITOR_READY,
      { kind: "click" as const, selector: 'button[aria-label="Filters"]' },
      { kind: "settle" as const, ms: 300 },
      { kind: "click" as const, selector: `button[aria-label^="${LOOK_LABELS[look]}"]` },
      { kind: "settle" as const, ms: 900 },
    ],
    clip: "frame" as const,
  })),
  inspector("inspector-logo", "Logo"),
  // `Z` adds a zoom at the playhead and selects it, which is what swaps the
  // panel to the zoom's own three tabs.
  {
    id: "inspector-zoom",
    frame: "workspace",
    install: install(),
    render: () => <EditorRoute name={recording} />,
    steps: [...EDITOR_READY, { kind: "key", code: "KeyZ" }, { kind: "settle", ms: 400 }],
    clip: "[data-panel='inspector']",
  },
  {
    id: "inspector-angle",
    frame: "workspace",
    install: install(),
    render: () => <EditorRoute name={recording} />,
    steps: [
      ...EDITOR_READY,
      { kind: "key", code: "KeyZ" },
      { kind: "click", selector: 'button[aria-label="Angle"]' },
      { kind: "settle", ms: 400 },
    ],
    clip: "[data-panel='inspector']",
  },
  {
    id: "inspector-focus",
    frame: "workspace",
    install: install(),
    render: () => <EditorRoute name={recording} />,
    steps: [
      ...EDITOR_READY,
      { kind: "key", code: "KeyZ" },
      { kind: "click", selector: 'button[aria-label="Focus"]' },
      { kind: "settle", ms: 400 },
    ],
    clip: "[data-panel='inspector']",
  },
  // `T` adds a text at the playhead and selects it, which swaps the panel to
  // the text's own three tabs. The settle is longer than a zoom's: the field
  // bitmaps are drawn after a 120 ms pause and then fetched.
  // The outline that follows the pointer along a text row, showing where a
  // text would land and how long it would be. It only exists while nothing is
  // pressed, so `hover` is the only step that can reach it — a click would have
  // added the text before the picture was taken.
  {
    id: "timeline-text-ghost",
    frame: "workspace",
    install: install(),
    render: () => <EditorRoute name={recording} />,
    steps: [
      ...EDITOR_READY,
      { kind: "hover", selector: "[data-text-row='0']", at: 0.35 },
      { kind: "settle", ms: 400 },
    ],
    clip: "[data-panel='timeline']",
  },
  {
    id: "zz-ghost-with-text",
    frame: "workspace",
    install: install(),
    render: () => <EditorRoute name={recording} />,
    // A text already on the row, then hover well away from it.
    steps: [
      ...EDITOR_READY,
      { kind: "key", code: "KeyT" },
      { kind: "settle", ms: 900 },
      { kind: "hover", selector: "[data-text-row='0']", at: 0.12 },
      { kind: "settle", ms: 500 },
    ],
    clip: "[data-panel='timeline']",
  },
  {
    id: "editor-text",
    frame: "workspace",
    install: install(),
    render: () => <EditorRoute name={recording} />,
    // The click on the tab already showing is a no-op that takes the pointer
    // off the ruler: paused and hovered, the preview follows the hover, which
    // is the text's own first frame — the one frame it is not yet visible on.
    steps: [
      ...EDITOR_READY,
      { kind: "key", code: "KeyT" },
      { kind: "click", selector: 'button[aria-label="Text"]' },
      { kind: "settle", ms: 1200 },
    ],
    clip: "frame",
  },
  {
    id: "inspector-text",
    frame: "workspace",
    install: install(),
    render: () => <EditorRoute name={recording} />,
    steps: [...EDITOR_READY, { kind: "key", code: "KeyT" }, { kind: "settle", ms: 800 }],
    clip: "[data-panel='inspector']",
  },
  {
    id: "inspector-text-style",
    frame: "workspace",
    install: install(),
    render: () => <EditorRoute name={recording} />,
    steps: [
      ...EDITOR_READY,
      { kind: "key", code: "KeyT" },
      { kind: "click", selector: 'button[aria-label="Style"]' },
      { kind: "settle", ms: 800 },
    ],
    clip: "[data-panel='inspector']",
  },
  {
    id: "inspector-text-motion",
    frame: "workspace",
    install: install(),
    render: () => <EditorRoute name={recording} />,
    steps: [
      ...EDITOR_READY,
      { kind: "key", code: "KeyT" },
      { kind: "click", selector: 'button[aria-label="Style"]' },
      { kind: "scrollTo", selector: "[data-section='enter']" },
      { kind: "settle", ms: 600 },
    ],
    clip: "[data-panel='inspector']",
  },
  {
    id: "timeline-text",
    frame: "workspace",
    install: install(),
    render: () => <EditorRoute name={recording} />,
    // Two, so the spare row above the first is on show with a text under it.
    steps: [
      ...EDITOR_READY,
      { kind: "key", code: "KeyT" },
      { kind: "key", code: "KeyT" },
      { kind: "settle", ms: 800 },
    ],
    clip: "[data-panel='timeline']",
    maxWidth: 720,
  },
  {
    id: "timeline-zoom",
    frame: "workspace",
    install: install(),
    render: () => <EditorRoute name={recording} />,
    steps: [...EDITOR_READY, { kind: "key", code: "KeyZ" }, { kind: "settle", ms: 400 }],
    clip: "[data-panel='timeline']",
    maxWidth: 720,
  },
  {
    id: "playback-controls",
    frame: "workspace",
    install: install(),
    render: () => <EditorRoute name={recording} />,
    steps: EDITOR_READY,
    clip: "[data-panel='transport']",
  },
  {
    id: "frame-bar-presets",
    frame: "workspace",
    install: install(),
    render: () => <EditorRoute name={recording} />,
    steps: [
      ...EDITOR_READY,
      { kind: "click", selector: "[data-panel='frame-bar'] button[aria-haspopup='listbox']" },
      { kind: "wait", selector: "[role='listbox']" },
      { kind: "settle", ms: 300 },
    ],
    clip: ["[data-panel='frame-bar']", "[role='listbox']"],
    pad: 16,
  },
  {
    id: "caption-editor",
    frame: "workspace",
    install: install(),
    render: () => <EditorRoute name={recording} />,
    steps: [
      ...EDITOR_READY,
      { kind: "click", selector: 'button[aria-label="Captions"]' },
      { kind: "click", selector: "[data-panel='inspector'] button", text: "Edit captions" },
      { kind: "settle", ms: 500 },
    ],
    clip: "[data-panel='inspector']",
  },
  {
    id: "export-dialog",
    frame: "workspace",
    install: install(),
    render: () => <EditorRoute name={recording} />,
    steps: [
      ...EDITOR_READY,
      { kind: "click", selector: "button", text: "Export" },
      { kind: "wait", selector: "[role='dialog'][aria-label='Export']" },
      { kind: "settle", ms: 400 },
    ],
    clip: "[role='dialog'][aria-label='Export']",
    pad: 40,
  },
  {
    id: "export-done",
    frame: "workspace",
    install: install(),
    render: () => <EditorRoute name={recording} />,
    steps: [
      ...EDITOR_READY,
      { kind: "click", selector: "button", text: "Export" },
      { kind: "wait", selector: "[role='dialog'][aria-label='Export']" },
      { kind: "click", selector: "[role='dialog'][aria-label='Export'] button", text: "Export" },
      { kind: "wait", selector: "[role='dialog'] video" },
      { kind: "settle", ms: 1200 },
    ],
    clip: "[role='dialog'][aria-label='Export']",
    pad: 40,
  },
  {
    id: "upgrade-dialog",
    frame: "workspace",
    install: install({ licence: { status: "expired" } }),
    render: () => <EditorRoute name={recording} />,
    steps: [
      ...EDITOR_READY,
      { kind: "click", selector: "button", text: "Export" },
      { kind: "wait", selector: "[role='dialog'][aria-label='Upgrade to export']" },
      { kind: "settle", ms: 400 },
    ],
    clip: "[role='dialog'][aria-label='Upgrade to export']",
    pad: 40,
  },
];
