/**
 * The emoji a comment can name, and the ones the picker offers.
 *
 * Shortcodes because people type them — `:tada:` arrives in comments from
 * anybody whose day is spent in Slack or GitHub, and rendered as literal text
 * it reads as a product that does not know what it is looking at. The map is
 * short on purpose: these are the ones that actually get typed, and a full
 * table is forty kilobytes shipped to every viewer of every share link so that
 * `:white_check_mark:` works.
 *
 * Unicode emoji typed or pasted directly need nothing from this — they are
 * characters, and they render as characters.
 */
export const EMOJI: Record<string, string> = {
  smile: "😄",
  grin: "😁",
  joy: "😂",
  rofl: "🤣",
  wink: "😉",
  blush: "😊",
  heart_eyes: "😍",
  thinking: "🤔",
  neutral_face: "😐",
  grimacing: "😬",
  sob: "😭",
  scream: "😱",
  open_mouth: "😮",
  sunglasses: "😎",
  nerd: "🤓",
  partying: "🥳",
  pray: "🙏",
  raised_hands: "🙌",
  clap: "👏",
  wave: "👋",
  "+1": "👍",
  thumbsup: "👍",
  "-1": "👎",
  thumbsdown: "👎",
  ok_hand: "👌",
  muscle: "💪",
  eyes: "👀",
  brain: "🧠",
  heart: "❤️",
  broken_heart: "💔",
  fire: "🔥",
  sparkles: "✨",
  star: "⭐",
  tada: "🎉",
  rocket: "🚀",
  boom: "💥",
  zap: "⚡",
  bulb: "💡",
  warning: "⚠️",
  x: "❌",
  white_check_mark: "✅",
  heavy_check_mark: "✔️",
  question: "❓",
  bug: "🐛",
  wrench: "🔧",
  hammer: "🔨",
  lock: "🔒",
  mag: "🔍",
  memo: "📝",
  books: "📚",
  chart: "📈",
  clock: "⏰",
  hourglass: "⌛",
  coffee: "☕",
  popcorn: "🍿",
  cake: "🎂",
  "100": "💯",
  shipit: "🚢",
  ghost: "👻",
  robot: "🤖",
  alien: "👽",
};

/**
 * What the composer's picker shows, in the order it shows them.
 *
 * The same characters the map above resolves to, chosen rather than generated:
 * a grid in alphabetical order of shortcode puts 🐛 beside ❤️ and reads as a
 * dump of a table, which is what it would be.
 */
export const PICKER = [
  "😄",
  "😂",
  "😍",
  "🤔",
  "😮",
  "😬",
  "😭",
  "😎",
  "🥳",
  "🙌",
  "👏",
  "👍",
  "👎",
  "👌",
  "🙏",
  "👀",
  "❤️",
  "🔥",
  "✨",
  "🎉",
  "🚀",
  "💡",
  "⚡",
  "💯",
  "✅",
  "❌",
  "⚠️",
  "🐛",
  "🔧",
  "📝",
  "⏰",
  "☕",
] as const;
