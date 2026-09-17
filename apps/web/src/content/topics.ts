/**
 * The filter vocabulary for `/content`, shared by the glossary and the articles.
 *
 * One list rather than one per registry: the sidebar shows a single "Topic"
 * group over both kinds of page, and two vocabularies would put "Audio" and
 * "Audio and camera" side by side as though they meant different things.
 *
 * Six and not more. There are fourteen pages behind them; a topic with one
 * page in it is a filter that shows the reader an almost empty grid, which
 * reads as a broken page rather than a small one. Add a topic when there are
 * three or more pages to file under it.
 *
 * The key is what goes in the URL (`?topic=audio`), so it is short, lowercase
 * and never changes once shipped; the label is what the sidebar shows.
 */
export const TOPICS = {
  recording: "Recording",
  audio: "Audio and camera",
  editing: "Editing",
  captions: "Captions",
  export: "Export and formats",
  sharing: "Sharing",
} as const;

export type Topic = keyof typeof TOPICS;

export const TOPIC_KEYS = Object.keys(TOPICS) as Topic[];

export function isTopic(value: string): value is Topic {
  return value in TOPICS;
}
