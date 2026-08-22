/**
 * Electron accelerators, and the keycaps that show them.
 *
 * One module because the same chord is drawn in three places — the settings
 * window, the tray's context menu and the welcome flow — and until now each
 * one hard-coded its own copy of `⇧⌘R`. A remappable shortcut turns three
 * copies into three ways to be wrong.
 *
 * Imports nothing from `electron` or Node, like `contract.ts`: main registers
 * the accelerator, the renderer draws it, and both need this.
 */

/** The modifiers, in the order macOS draws them: `⌃⌥⇧⌘`. */
const MODIFIERS = [
  { id: "Control", token: "Ctrl", glyph: "⌃", label: "Control" },
  { id: "Alt", token: "Alt", glyph: "⌥", label: "Option" },
  { id: "Shift", token: "Shift", glyph: "⇧", label: "Shift" },
  { id: "Command", token: "Cmd", glyph: "⌘", label: "Command" },
] as const;

export type ModifierId = (typeof MODIFIERS)[number]["id"];

/** The aliases Electron accepts, folded onto one id each. */
const ALIASES: Record<string, ModifierId> = {
  ctrl: "Control",
  control: "Control",
  alt: "Alt",
  option: "Alt",
  altgr: "Alt",
  shift: "Shift",
  cmd: "Command",
  command: "Command",
  super: "Command",
  meta: "Command",
  commandorcontrol: "Command",
  cmdorctrl: "Command",
};

/**
 * A key as it should be drawn.
 *
 * `id` is what lets the renderer swap in a real icon component — `⌘` and `⇧`
 * are drawn from Lucide rather than as text, because a glyph character renders
 * at whatever weight the text font gives it. `glyph` is the fallback and is
 * what a plain-text surface (the tray, a log line) uses.
 */
export type AcceleratorKey = {
  id: ModifierId | "Key";
  glyph: string;
  label: string;
};

/** Named keys whose glyph is not just the token. */
const KEY_GLYPHS: Record<string, string> = {
  Escape: "⎋",
  Esc: "⎋",
  Space: "␣",
  Tab: "⇥",
  Backspace: "⌫",
  Delete: "⌦",
  Return: "↩",
  Enter: "↩",
  Up: "↑",
  Down: "↓",
  Left: "←",
  Right: "→",
};

/**
 * Splits an accelerator into modifiers and one key.
 *
 * Returns null for anything that is not a usable chord, which is what the
 * settings field checks before it offers to save.
 */
export function parseAccelerator(
  accelerator: string,
): { modifiers: ModifierId[]; key: string } | null {
  const parts = accelerator
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const modifiers = new Set<ModifierId>();
  let key: string | null = null;

  for (const part of parts) {
    const modifier = ALIASES[part.toLowerCase()];
    if (modifier) {
      modifiers.add(modifier);
      continue;
    }
    // Two keys is not a chord Electron can register, and silently keeping the
    // last one would bind something the user did not ask for.
    if (key !== null) return null;
    key = part.length === 1 ? part.toUpperCase() : part;
  }

  if (key === null) return null;
  return { modifiers: MODIFIERS.filter((m) => modifiers.has(m.id)).map((m) => m.id), key };
}

/**
 * The canonical spelling of a chord: `Shift+Cmd+R`.
 *
 * Electron accepts the modifiers in any order and under several names, so two
 * strings that bind the same keys can compare unequal. Everything that stores
 * or compares an accelerator goes through here first.
 */
export function normaliseAccelerator(accelerator: string): string | null {
  const parsed = parseAccelerator(accelerator);
  if (!parsed) return null;
  const tokens = MODIFIERS.filter((m) => parsed.modifiers.includes(m.id)).map((m) => m.token);
  return [...tokens, parsed.key].join("+");
}

/** The keys to draw, left to right. Empty when the accelerator is unusable. */
export function formatAccelerator(accelerator: string): AcceleratorKey[] {
  const parsed = parseAccelerator(accelerator);
  if (!parsed) return [];

  const keys: AcceleratorKey[] = MODIFIERS.filter((m) => parsed.modifiers.includes(m.id)).map(
    (m) => ({ id: m.id, glyph: m.glyph, label: m.label }),
  );

  return [...keys, { id: "Key", glyph: KEY_GLYPHS[parsed.key] ?? parsed.key, label: parsed.key }];
}

/** `⇧⌘R`, for a tooltip, a menu item or a log line. */
export function acceleratorGlyphs(accelerator: string): string {
  return formatAccelerator(accelerator)
    .map((key) => key.glyph)
    .join("");
}

/**
 * Whether a chord is safe to register system-wide.
 *
 * A global shortcut with no modifier — or with only Shift — takes that key away
 * from every other application, so binding `R` would stop the letter R reaching
 * anything else on the Mac. Electron will happily register it; nothing else
 * stops the user.
 */
export function isBindable(accelerator: string): boolean {
  const parsed = parseAccelerator(accelerator);
  if (!parsed) return false;
  return parsed.modifiers.some((id) => id !== "Shift");
}

/** The physical keys that are only ever part of a chord, never the end of one. */
const MODIFIER_CODES = /^(Meta|Control|Alt|Shift)(Left|Right)$/;

/**
 * The chord a keydown describes, or null while one is still being typed.
 *
 * Reads `event.code` rather than `event.key`, because `key` is what the
 * modifiers produced — `⌥R` gives `®`, and on a non-US layout it gives
 * something else again. `code` is the physical key, which is what Electron
 * binds and what the user pressed.
 */
export function acceleratorFromEvent(event: {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): string | null {
  if (MODIFIER_CODES.test(event.code)) return null;

  const key = keyFromCode(event.code);
  if (!key) return null;

  const tokens: string[] = [];
  if (event.ctrlKey) tokens.push("Ctrl");
  if (event.altKey) tokens.push("Alt");
  if (event.shiftKey) tokens.push("Shift");
  if (event.metaKey) tokens.push("Cmd");

  return [...tokens, key].join("+");
}

function keyFromCode(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1] ?? null;

  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1] ?? null;

  const fn = /^F([0-9]{1,2})$/.exec(code);
  if (fn) return code;

  switch (code) {
    case "Space":
      return "Space";
    case "Escape":
      return "Escape";
    case "Enter":
    case "NumpadEnter":
      return "Return";
    case "Tab":
      return "Tab";
    case "Backspace":
      return "Backspace";
    case "Delete":
      return "Delete";
    case "ArrowUp":
      return "Up";
    case "ArrowDown":
      return "Down";
    case "ArrowLeft":
      return "Left";
    case "ArrowRight":
      return "Right";
    case "Comma":
      return ",";
    case "Period":
      return ".";
    case "Slash":
      return "/";
    case "Backslash":
      return "\\";
    case "Minus":
      return "-";
    case "Equal":
      return "=";
    case "BracketLeft":
      return "[";
    case "BracketRight":
      return "]";
    case "Semicolon":
      return ";";
    case "Quote":
      return "'";
    case "Backquote":
      return "`";
    default:
      return null;
  }
}
