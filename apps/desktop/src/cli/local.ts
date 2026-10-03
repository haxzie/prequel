/**
 * The commands the CLI answers by itself.
 *
 * Everything here is a catalogue that ships in the bundle — the looks, the
 * pointers, the layouts, the frame sizes, the guide — so asking what a project
 * may be set to costs nothing and works with the app closed. That matters more
 * than it sounds: an agent reads the guide and these lists *before* it decides
 * what to do, and launching a menu-bar app to answer a question puts a panel
 * over whatever the user was looking at.
 *
 * Anything that needs the recorder, the library or the screen is in
 * `main/cli/commands.ts` instead, behind the socket.
 */
import { CURSOR_STYLES, cursorTag } from "../shared/contract.js";
import {
  CAMERA_SHAPE_SUMMARY,
  CLI_PROTOCOL,
  COMMANDS,
  LAYOUT_SUMMARY,
  PROJECT_SCHEMA,
  commandName,
} from "../shared/cli.js";
import { FILTERS, READY, type FilterId } from "../shared/filters.js";
import { AUTO_PRESET_ID, FRAME_PRESETS } from "../shared/presets.js";
import { CLICK_SOUNDS, KEY_SOUNDS } from "../shared/project.js";

/**
 * Looks in the order the picker offers them, and only the ones that are ready.
 *
 * `READY` is the gate the editor itself uses, so a look still being drawn in
 * both shader languages cannot be recommended here and then render as nothing.
 */
function filters(): unknown {
  return {
    filters: READY.map((id: FilterId) => {
      const spec = FILTERS[id];
      return {
        id,
        name: spec.label,
        summary: spec.hint,
        // The leaves this look actually reads. Writing the others into
        // `effects` is harmless and does nothing, which is worse than being
        // told — a strength set on a look that ignores strength reads as a
        // filter that is not working.
        params: spec.uses,
        variants: spec.variants.map((variant) => variant.id),
        defaults: spec.defaults,
      };
    }),
  };
}

function cursors(): unknown {
  return {
    cursors: CURSOR_STYLES.map((style) => ({
      id: style.id,
      name: style.label,
      // Which drawn label follows the pointer, when the style has one. A
      // project asking for a tag cannot be rendered headlessly — the label is
      // a bitmap a window draws — so it is named here rather than discovered
      // at render time.
      tag: cursorTag(style.id),
    })),
  };
}

function layouts(): unknown {
  return {
    layouts: Object.entries(LAYOUT_SUMMARY).map(([id, summary]) => ({ id, summary })),
    cameraShapes: Object.entries(CAMERA_SHAPE_SUMMARY).map(([id, summary]) => ({ id, summary })),
  };
}

function presets(): unknown {
  return {
    presets: [
      {
        id: AUTO_PRESET_ID,
        name: "The recording's own size",
        width: null,
        height: null,
        group: "General",
      },
      ...FRAME_PRESETS.map((preset) => ({
        id: preset.id,
        name: preset.label,
        width: preset.width,
        height: preset.height,
        group: preset.group,
      })),
    ],
  };
}

function sounds(): unknown {
  return {
    keyboards: KEY_SOUNDS.map((sound) => ({ id: sound.id, name: sound.label })),
    clicks: CLICK_SOUNDS.map((sound) => ({ id: sound.id, name: sound.label })),
    // Said out loud because it is the rule an agent is most likely to break:
    // the voices are placed by the app, from the key timings in the manifest.
    note: "Which voice each press gets is decided by the app, not by the project file",
  };
}

export function guide(version: string): unknown {
  return {
    protocol: CLI_PROTOCOL,
    version,
    commands: COMMANDS.map((command) => ({
      command: command.path.join(" "),
      name: commandName(command.path),
      summary: command.summary,
      args: command.args ?? [],
      flags: command.flags ?? [],
      returns: command.returns,
      needsApp: command.local !== true,
    })),
    project: {
      summary:
        "Editing is done by editing the recording's own `project.json` — `prequel project path <id>` says where it is. Check it with `prequel project check <id>` before rendering",
      fields: PROJECT_SCHEMA,
    },
  };
}

/**
 * Answers a command without the app, or null when it needs one.
 *
 * Returning null rather than throwing, so the caller has one path: ask here,
 * and fall through to the socket when the answer is not in the bundle.
 */
export function answerLocally(name: string, version: string): unknown | null {
  switch (name) {
    case "guide":
      return guide(version);
    case "version":
      return { version, protocol: CLI_PROTOCOL };
    case "filters.list":
      return filters();
    case "cursors.list":
      return cursors();
    case "layouts.list":
      return layouts();
    case "presets.list":
      return presets();
    case "sounds.list":
      return sounds();
    case "project.schema":
      return { fields: PROJECT_SCHEMA };
    default:
      return null;
  }
}
