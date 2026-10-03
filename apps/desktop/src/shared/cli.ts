/**
 * The command line contract: what `prequel` accepts, and how it talks to the app.
 *
 * One catalogue, read by three things — the client parses argv against it, the
 * app checks an arriving command against it, and `prequel guide` prints it. A
 * command described in one of those places and not the others is the failure
 * this file exists to make impossible: an agent reads the guide, sends what it
 * says, and is told the command does not exist.
 *
 * Free of any `electron` or Node import, like `contract.ts` and for the same
 * reason: the CLI is its own bundle and must not pull the main process in to
 * learn a command name.
 */
import { CURSOR_STYLES } from "./contract.js";
import { READY as READY_FILTERS } from "./filters.js";
import { MIC_DENOISE, type CameraShape, type LayoutPreset } from "./project.js";

/**
 * Bumped when a request or response shape changes incompatibly.
 *
 * Sent with every request and checked by the app. The two halves ship in the
 * same bundle, so they can only disagree when the shim in `~/.local/bin` points
 * at an app that has since been replaced — which is exactly what happens when
 * somebody updates Prequel while a shell has the old path cached. Without the
 * check that reads as a command that hangs or answers nonsense.
 */
export const CLI_PROTOCOL = 1;

/**
 * The socket's name inside the app's support directory.
 *
 * A Unix socket rather than a port: there is no number to collide with another
 * app's, nothing to firewall, and the filesystem permissions are the
 * authentication — 0600 beside the auth token that is already there. A local
 * HTTP server would be reachable by every page in every browser on the machine.
 */
export const CLI_SOCKET = "cli.sock";

/**
 * Why a command refused.
 *
 * A fixed set, because an agent branches on these: `busy` means stop the take
 * first, `not_found` means the id is stale and `targets` should be read again,
 * `needs_editor` means this edit cannot be rendered without a person. A message
 * alone would make every one of those a string match.
 */
export type CliErrorCode =
  /** The command line was wrong: an unknown flag, a missing argument. Exit 2. */
  | "usage"
  /** A take is already running. */
  | "busy"
  /** Nothing is recording. */
  | "idle"
  /** No recording, window or display with that id. */
  | "not_found"
  /** macOS has not granted something the command needs. */
  | "denied"
  /** Sharing, and nobody is signed in. */
  | "signed_out"
  /**
   * The edit uses layers only a window can draw — burned-in captions, text
   * overlays, a cursor tag. Rendering it headlessly would quietly produce the
   * video without them.
   */
  | "needs_editor"
  /** This build cannot do it: no iPhone capture, no Windows, an old macOS. */
  | "unsupported"
  /** It was attempted and failed. The message says what macOS or the addon said. */
  | "failed";

export interface CliRequest {
  id: number;
  protocol: number;
  command: string;
  params: Record<string, unknown>;
}

/**
 * One line of the answer.
 *
 * `progress` may arrive any number of times before exactly one `ok` frame, so a
 * render can report frames while it runs without the client having to poll. The
 * id repeats on every frame because the socket is a long-lived connection and a
 * `record stop --render` is two requests deep by the time pixels start moving.
 */
export type CliFrame =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: { code: CliErrorCode; message: string } }
  | { id: number; event: "progress"; data: CliProgress };

export interface CliProgress {
  stage: string;
  done?: number;
  total?: number;
  message?: string;
}

// ── The catalogue ───────────────────────────────────────────────────────────

/** A positional argument. */
export interface CliArgSpec {
  name: string;
  /**
   * How the client should read it.
   *
   * `region` is `x,y,width,height` in points, which is the one argument shape
   * here that is not a single value — written as one token so an area capture
   * is one argument rather than four flags nobody can order correctly.
   */
  kind: "string" | "number" | "region";
  required: boolean;
  summary: string;
}

export interface CliFlagSpec {
  name: string;
  /**
   * What follows it.
   *
   * `optional-string` is the awkward one and it is deliberate: `--camera` with
   * no value means the default camera, `--camera "Studio Display"` names one.
   * The client only consumes the next token when it is not itself a flag.
   */
  value: "none" | "string" | "number" | "optional-string";
  summary: string;
  choices?: readonly string[];
}

export interface CliCommandSpec {
  /** The words, in order. `["record", "display"]` is `prequel record display`. */
  path: readonly string[];
  summary: string;
  args?: readonly CliArgSpec[];
  flags?: readonly CliFlagSpec[];
  /** One line on what the JSON answer holds, for the guide. */
  returns: string;
  /**
   * Answered by the CLI itself, with no app involved.
   *
   * `guide` and `version` have to work on a Mac where Prequel has never been
   * launched — an agent reads the guide before it does anything else, and
   * launching a menu-bar app to print a command list would put a panel over
   * whatever the user was doing.
   */
  local?: boolean;
  /**
   * Whether the app is started when it is not running.
   *
   * True for nearly everything: the app owns the recorder, the library and the
   * editor. False for the few commands that must not take over the screen just
   * because somebody asked a question.
   */
  launches?: boolean;
}

/** The export options every command that writes a video shares. */
const RENDER_FLAGS: readonly CliFlagSpec[] = [
  {
    name: "out",
    value: "string",
    summary: "Where the video goes. Default: ~/Movies/Prequel/<name>.mp4",
  },
  {
    name: "format",
    value: "string",
    choices: ["h264", "hevc", "gif"],
    summary: "Codec. Default: whatever the project is set to, h264 on a fresh one",
  },
  {
    name: "short-edge",
    value: "number",
    summary: "Scale the frame so its shorter edge is this many pixels. Never upscales",
  },
  { name: "fps", value: "number", summary: "Frames a second. Default: the project's" },
  {
    name: "preset",
    value: "string",
    summary: "Frame preset id, from `prequel presets list`. Changes the shape of the video",
  },
] as const;

/**
 * Everything `prequel` can be asked to do.
 *
 * Ordered as the guide prints it — what to look at, then what to record, then
 * what to do with a recording — rather than alphabetically, because this list
 * is read top to bottom by somebody deciding what to call next.
 */
export const COMMANDS: readonly CliCommandSpec[] = [
  {
    path: ["guide"],
    summary: "Every command, its flags and what it answers with. Read this first",
    returns: "{ protocol, version, commands, project }",
    local: true,
  },
  {
    path: ["version"],
    summary: "The app's version, and the CLI's protocol",
    returns: "{ version, protocol }",
    local: true,
  },
  {
    path: ["status"],
    summary: "Permissions, sign-in, whether a take is running, and where things are on disk",
    returns: "{ running, version, permissions, account, session, paths }",
    // Deliberately not launching. "Is Prequel running?" must be answerable
    // without the answer becoming yes.
    launches: false,
  },
  {
    path: ["open"],
    summary: "Bring the recording panel up, for a person to take over",
    returns: "{ opened: true }",
    launches: true,
  },
  {
    path: ["login"],
    summary: "Sign in. Opens the browser and waits for it",
    returns: "{ account }",
    launches: true,
  },
  { path: ["logout"], summary: "Sign out on this Mac", returns: "{ signedOut: true }" },

  // ── What is there to record ───────────────────────────────────────────────
  {
    path: ["target", "list"],
    summary: "Displays and windows, with the ids `record` takes",
    flags: [
      { name: "displays", value: "none", summary: "Only displays" },
      { name: "windows", value: "none", summary: "Only windows" },
      { name: "app", value: "string", summary: "Only windows owned by this app" },
    ],
    returns: "{ targets: [{ kind, id, title, appName, bounds, scaleFactor }] }",
    launches: true,
  },
  {
    path: ["camera", "list"],
    summary: "Cameras attached to this Mac",
    returns: "{ cameras: [{ id, name }] }",
    launches: true,
  },
  {
    path: ["microphone", "list"],
    summary: "Audio inputs, and which one macOS treats as the default",
    returns: "{ microphones: [{ id, name, default }] }",
    launches: true,
  },

  // ── Recording ─────────────────────────────────────────────────────────────
  {
    path: ["record", "display"],
    summary: "Record a whole display",
    args: [
      {
        name: "id",
        kind: "number",
        required: false,
        summary: "From `target list`. Omitted, the display the pointer is on",
      },
    ],
    flags: [
      {
        name: "camera",
        value: "optional-string",
        summary: "Record a camera track too, by name. No value takes the first camera",
      },
      { name: "microphone", value: "none", summary: "Record the system's default input" },
      { name: "system-audio", value: "none", summary: "Record what the Mac is playing" },
      { name: "fps", value: "number", summary: "Capture frame rate. Default: 60" },
      {
        name: "countdown",
        value: "number",
        summary: "Seconds before capture starts. Default: none, from the CLI",
      },
    ],
    returns: "{ status, target, dir }",
    launches: true,
  },
  {
    path: ["record", "window"],
    summary: "Record one window, whatever is in front of it",
    args: [{ name: "id", kind: "number", required: true, summary: "From `target list`" }],
    flags: [
      { name: "camera", value: "optional-string", summary: "As above" },
      { name: "microphone", value: "none", summary: "As above" },
      { name: "system-audio", value: "none", summary: "As above" },
      { name: "fps", value: "number", summary: "As above" },
      { name: "countdown", value: "number", summary: "As above" },
      { name: "panel", value: "none", summary: "As above" },
    ],
    returns: "{ status, target, dir }",
    launches: true,
  },
  {
    path: ["record", "area"],
    summary: "Record a rectangle of a display",
    args: [
      {
        name: "region",
        kind: "region",
        required: true,
        summary: "x,y,width,height in points, from the display's top left",
      },
    ],
    flags: [
      {
        name: "display",
        value: "number",
        summary: "Which display the rectangle is on. Default: the one the pointer is on",
      },
      { name: "camera", value: "optional-string", summary: "As above" },
      { name: "microphone", value: "none", summary: "As above" },
      { name: "system-audio", value: "none", summary: "As above" },
      { name: "fps", value: "number", summary: "As above" },
      { name: "countdown", value: "number", summary: "As above" },
      { name: "panel", value: "none", summary: "As above" },
    ],
    returns: "{ status, target, crop, dir }",
    launches: true,
  },
  {
    path: ["record", "stop"],
    summary: "Stop the take and keep it",
    flags: [
      {
        name: "render",
        value: "none",
        summary: "Render the first cut straight away and answer with the file",
      },
      ...RENDER_FLAGS,
      {
        name: "open",
        value: "none",
        summary: "Open the recording in the editor for a person to adjust",
      },
    ],
    returns: "{ id, dir, durationMs, zooms, clicks, project, file? }",
  },
  { path: ["record", "pause"], summary: "Pause the take", returns: "{ status }" },
  { path: ["record", "resume"], summary: "Resume a paused take", returns: "{ status }" },
  {
    path: ["record", "cancel"],
    summary: "Stop the take and delete it",
    returns: "{ discarded: true }",
  },
  {
    path: ["record", "status"],
    summary: "What the recorder is doing, and for how long",
    returns: "{ status, elapsedMs, target }",
    launches: false,
  },

  // ── The library ───────────────────────────────────────────────────────────
  {
    path: ["recordings", "list"],
    summary: "Every recording on this Mac, newest first",
    flags: [
      { name: "limit", value: "number", summary: "How many. Default: 20" },
      { name: "offset", value: "number", summary: "Skip this many first" },
    ],
    returns: "{ total, recordings: [{ id, name, createdAt, editedAt, durationMs }] }",
    launches: true,
  },
  {
    path: ["recordings", "show"],
    summary: "One recording: its tracks, its length, what was captured, where its edit lives",
    args: [{ name: "id", kind: "string", required: true, summary: "From `recordings list`" }],
    returns: "{ id, name, dir, durationMs, tracks, zooms, clicks, transcript, project }",
    launches: true,
  },
  {
    path: ["recordings", "open"],
    summary: "Open a recording in the editor",
    args: [{ name: "id", kind: "string", required: true, summary: "From `recordings list`" }],
    returns: "{ opened: true }",
    launches: true,
  },
  {
    path: ["recordings", "delete"],
    summary: "Delete a recording and everything in it. Not reversible",
    args: [{ name: "id", kind: "string", required: true, summary: "From `recordings list`" }],
    returns: "{ deleted: true }",
    launches: true,
  },
  {
    path: ["recordings", "reveal"],
    summary: "Show a recording in Finder",
    args: [{ name: "id", kind: "string", required: true, summary: "From `recordings list`" }],
    returns: "{ revealed: true }",
    launches: true,
  },

  // ── Rendering ─────────────────────────────────────────────────────────────
  {
    path: ["render"],
    summary: "Render a recording's edit to a video file",
    args: [{ name: "id", kind: "string", required: true, summary: "From `recordings list`" }],
    flags: [
      ...RENDER_FLAGS,
      {
        name: "share",
        value: "none",
        summary: "Upload the finished file and answer with its link. Needs sign-in",
      },
    ],
    returns: "{ file, width, height, durationMs, bytes, url? }",
    launches: true,
  },

  // ── The edit ──────────────────────────────────────────────────────────────
  {
    path: ["project", "path"],
    summary: "Where this recording's `project.json` is. Edit that file to edit the video",
    args: [{ name: "id", kind: "string", required: true, summary: "From `recordings list`" }],
    returns: "{ path, exists }",
    launches: true,
  },
  {
    path: ["project", "show"],
    summary: "The edit as it stands, as JSON",
    args: [{ name: "id", kind: "string", required: true, summary: "From `recordings list`" }],
    returns: "The project document",
    launches: true,
  },
  {
    path: ["project", "check"],
    summary: "Whether an edited `project.json` is one the app will load, and what it changed",
    args: [{ name: "id", kind: "string", required: true, summary: "From `recordings list`" }],
    returns: "{ valid, changed: [paths], message? }",
    launches: true,
  },
  {
    path: ["project", "schema"],
    summary: "The shape of `project.json`: the fields, their units and their allowed values",
    returns: "{ sections: [{ path, type, units, values, summary }] }",
    local: true,
  },

  // ── What a project can be set to ──────────────────────────────────────────
  {
    path: ["filters", "list"],
    summary: "Colour looks, for `defaults.effects.filter` and per clip",
    returns: "{ filters: [{ id, name, params, variants }] }",
    local: true,
  },
  {
    path: ["cursors", "list"],
    summary: "Pointer styles, for `defaults.layout.cursorStyle`",
    returns: "{ cursors: [{ id, name, tag }] }",
    local: true,
  },
  {
    path: ["layouts", "list"],
    summary: "Arrangements of the screen and the camera, for `defaults.layout.preset`",
    returns: "{ layouts: [{ id, summary }] }",
    local: true,
  },
  {
    path: ["presets", "list"],
    summary: "Frame sizes, for `frame.presetId`",
    returns: "{ presets: [{ id, name, width, height }] }",
    local: true,
  },
  {
    path: ["backgrounds", "list"],
    summary: "Wallpapers, gradients and solids a project can sit on",
    flags: [
      {
        name: "category",
        value: "string",
        summary: "Only this category of the hosted catalogue",
      },
    ],
    returns: "{ wallpapers, gradients, solids }",
    launches: true,
  },
  {
    path: ["sounds", "list"],
    summary: "Keyboard and click voices, for `defaults.audio.keySound` and `clickSound`",
    returns: "{ keyboards: [{ id, name }], clicks: [{ id, name }] }",
    local: true,
  },
  {
    path: ["scenes", "list"],
    summary: "Saved looks on this Mac, applied to a project as a whole",
    returns: "{ scenes: [{ id, name }] }",
    launches: true,
  },

  // ── Transcripts ───────────────────────────────────────────────────────────
  {
    path: ["transcript", "generate"],
    summary: "Transcribe a recording on this Mac. Nothing is uploaded",
    args: [{ name: "id", kind: "string", required: true, summary: "From `recordings list`" }],
    flags: [{ name: "language", value: "string", summary: "BCP-47, e.g. en-GB. Default: en-US" }],
    returns: "{ words, language, path }",
    launches: true,
  },
  {
    path: ["transcript", "show"],
    summary: "A recording's transcript, if it has one",
    args: [{ name: "id", kind: "string", required: true, summary: "From `recordings list`" }],
    returns: "{ language, words: [{ at, end, text }] }",
    launches: true,
  },

  // ── This tool ─────────────────────────────────────────────────────────────
  {
    path: ["upgrade"],
    summary: "Update Prequel and this command to the current version",
    flags: [
      {
        name: "check",
        value: "none",
        summary: "Say what is available and change nothing",
      },
    ],
    // The restart is the part worth saying out loud: the app quits to install,
    // so anything holding a connection to it loses one, and a take running at
    // the time would be lost. `upgrade` refuses while one is recording.
    returns: "{ status, current, version, cli, restarting }",
    launches: true,
  },
  {
    path: ["skill", "install"],
    summary: "Write the agent skill that teaches this CLI into ~/.claude/skills",
    flags: [
      { name: "dir", value: "string", summary: "Somewhere other than ~/.claude/skills" },
      { name: "print", value: "none", summary: "Write nothing; print the skill instead" },
    ],
    returns: "{ path }",
    local: true,
  },
] as const;

/**
 * Other words that mean a command.
 *
 * Kept because the first thing anybody types is the plural they happen to think
 * of, and a screen recorder's CLI refusing `prequel targets list` because the
 * command is `target list` is a tool that argues about grammar. `monitor` is
 * here because that is what people call a display when they are not Apple.
 */
export const WORD_ALIASES: Readonly<Record<string, string>> = {
  targets: "target",
  // Only in the position after `record`, where `record monitor 1` is what
  // somebody types who does not call a screen a display. As a first word they
  // are questions, and `BARE_WORD_DEFAULTS` answers them.
  monitor: "display",
  monitors: "display",
  displays: "display",
  screens: "display",
  cameras: "camera",
  microphones: "microphone",
  mic: "microphone",
  mics: "microphone",
  recording: "recordings",
  transcripts: "transcript",
  filter: "filters",
  cursor: "cursors",
  layout: "layouts",
  preset: "presets",
  background: "backgrounds",
  sound: "sounds",
  scene: "scenes",
  ls: "list",
  rm: "delete",
  remove: "delete",
  export: "render",
  help: "guide",
};

/**
 * Commands that may be typed with their first word alone.
 *
 * `prequel targets` is what an agent reaches for before it has read anything,
 * and answering it is cheaper than explaining that it needed `list` on the end.
 * Only where there is exactly one sensible completion — `record` is not here,
 * because recording the wrong thing is worse than being asked to say which.
 */
export const BARE_WORD_DEFAULTS: Readonly<
  Record<string, { path: readonly string[]; params?: Readonly<Record<string, unknown>> }>
> = {
  target: { path: ["target", "list"] },
  camera: { path: ["camera", "list"] },
  microphone: { path: ["microphone", "list"] },
  recordings: { path: ["recordings", "list"] },
  filters: { path: ["filters", "list"] },
  cursors: { path: ["cursors", "list"] },
  layouts: { path: ["layouts", "list"] },
  presets: { path: ["presets", "list"] },
  backgrounds: { path: ["backgrounds", "list"] },
  sounds: { path: ["sounds", "list"] },
  scenes: { path: ["scenes", "list"] },
  skill: { path: ["skill", "install"] },
  // The two that carry a flag with them. `prequel windows` is what gets typed
  // when the question is "what can I record", and answering it with every
  // display as well is a list to filter rather than an answer.
  windows: { path: ["target", "list"], params: { windows: true } },
  display: { path: ["target", "list"], params: { displays: true } },
};

/** The dotted name a command travels as. */
export function commandName(path: readonly string[]): string {
  return path.join(".");
}

export function findCommand(path: readonly string[]): CliCommandSpec | undefined {
  const name = commandName(path);
  return COMMANDS.find((command) => commandName(command.path) === name);
}

// ── The project document, described ─────────────────────────────────────────

/**
 * What an agent needs to know before it edits `project.json`.
 *
 * Written out rather than generated: the types say `number`, and what somebody
 * about to write one needs is that it is a fraction of the frame's shorter edge
 * and that 0.08 is a sensible padding. Every list of allowed values is read off
 * the real constant beside it, so a look added to `filters.ts` cannot leave
 * this list behind.
 *
 * The timeline is the part worth reading twice: a cut is a slice of *source*
 * time, in nanoseconds on the recording's own clock, and the slices are played
 * in the order they appear. Deleting a stretch means ending one slice early and
 * starting the next after it — there is no "delete" to write.
 */
export interface ProjectFieldNote {
  path: string;
  type: string;
  units?: string;
  values?: readonly string[];
  summary: string;
}

/**
 * Every arrangement, with the line `layouts list` prints for it.
 *
 * A `Record` keyed by the union rather than an array of ids, so adding a
 * fifteenth layout to `LayoutPreset` does not compile until it has a
 * description here. An array would have left the new one off the list the agent
 * reads, which is indistinguishable from the app not having it.
 */
export const LAYOUT_SUMMARY: Record<LayoutPreset, string> = {
  "over-full": "The camera over a full-bleed screen",
  "over-padded": "The camera over a padded screen, on the background",
  "over-column": "The camera in a portrait column over the right of the screen",
  "over-column-left": "The same column, on the left",
  beside: "Screen and camera side by side, camera right",
  "beside-left": "Side by side, camera left",
  stacked: "Camera above, screen below",
  split: "The frame split down the middle between the two",
  "screen-full": "The screen alone, full bleed",
  "screen-padded": "The screen alone, padded on the background",
  "screen-inset": "The screen alone, inset further still",
  "camera-full": "The camera alone, filling the frame",
  "camera-padded": "The camera alone, padded",
  "camera-inset": "The camera alone, inset further still",
  custom: "Wherever the two were last dragged to. Reads its box from the settings",
};

/** Every camera outline, with the same compile-time guarantee as the layouts. */
export const CAMERA_SHAPE_SUMMARY: Record<CameraShape, string> = {
  circle: "A circle",
  squircle: "Apple's rounded square",
  rounded: "A rounded rectangle",
  wide: "The camera's own proportions, corners rounded",
  portrait: "The same crop stood on end",
  blob: "The outline the recording fitted to the person, so a raised hand is not cropped",
};

export const PROJECT_SCHEMA: readonly ProjectFieldNote[] = [
  {
    path: "version",
    type: "number",
    summary: "Must stay as it is. A project with any other version is ignored, not migrated",
  },
  {
    path: "recordingId",
    type: "string",
    summary: "The manifest's id. Changing it makes the app ignore the whole file",
  },
  { path: "name", type: "string", summary: "What the library calls this recording" },
  {
    path: "frame",
    type: "{ width, height, presetId }",
    units: "output pixels",
    summary: "The shape of the finished video. `presets list` has the ids",
  },
  {
    path: "tracks[0].slices[]",
    type: "{ id, source: { start, end }, speed, overrides }",
    units: "nanoseconds of source time",
    summary:
      "The cut. Slices play in array order; a gap between one slice's end and the next's start is what a removed stretch is",
  },
  {
    path: "tracks[0].slices[].speed",
    type: "number",
    summary: "0.25 to 4. 1 is as recorded",
  },
  {
    path: "tracks[0].slices[].overrides",
    type: "{ layout?, background?, watermark?, audio?, captions?, effects? }",
    summary:
      "Per-clip settings, each a partial of the same section in `defaults`. Flat leaves only",
  },
  {
    path: "zooms[]",
    type: "{ id, source: { start, end }, target, scale, … }",
    units: "nanoseconds of source time",
    summary: "Push-ins, sorted and never overlapping. The recorder writes the first pass",
  },
  {
    path: "defaults.layout.preset",
    type: "string",
    values: Object.keys(LAYOUT_SUMMARY),
    summary: "How the screen and the camera share the frame",
  },
  {
    path: "defaults.layout.cameraShape",
    type: "string",
    values: Object.keys(CAMERA_SHAPE_SUMMARY),
    summary: "The camera's outline. `blob` follows the person the recording matted",
  },
  {
    path: "defaults.layout.cursorStyle",
    type: "string",
    values: CURSOR_STYLES.map((style) => style.id),
    summary: "Which pointer is drawn. `cursors list` has the names",
  },
  {
    path: "defaults.layout.*X / *Y / *Width / *Height / padding",
    type: "number",
    units: "a fraction of the frame's shorter edge",
    summary:
      "Never pixels, so a look survives 16:9 → 9:16. 0.5 is the middle, 1 is the whole shorter edge",
  },
  {
    path: "defaults.background.background",
    type: '{ kind: "solid" | "gradient" | "image", … }',
    summary:
      "What sits behind the screen, as a whole object — the one setting here that is not a flat leaf. An image's `path` is relative to the recording's own folder, so a background has to be copied in beside it. `backgrounds list` has the catalogue",
  },
  {
    path: "defaults.effects.filter",
    type: "string | null",
    values: READY_FILTERS,
    summary: "A colour look over the whole picture. `filters list` has the parameters",
  },
  {
    path: "defaults.audio",
    type: "{ micVolume, systemVolume, keySound, clickSound, … }",
    summary:
      "Gains are 0–1. `keySound` and `clickSound` name voices from `sounds list`; the app decides which voice each press gets, not this file",
  },
  {
    path: "defaults.captions.captionsOn",
    type: "boolean",
    summary:
      "Burned-in captions. A project with these on cannot be rendered from the CLI — the cues are drawn as bitmaps by a window, and a headless render would write the video without them",
  },
  {
    path: "texts[]",
    type: "TextTrack[]",
    summary:
      "Titles and callouts. Same limit as captions: a project with any cannot be rendered from the CLI",
  },
  {
    path: "output",
    type: "{ fps, format, shortEdge }",
    summary: "What `render` uses when no flag overrides it",
  },
  {
    path: "micDenoise",
    type: "string",
    values: MIC_DENOISE,
    summary: "Apple's sound isolation over the microphone track",
  },
];
