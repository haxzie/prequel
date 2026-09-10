/**
 * Writing a value into an element that may want to animate it.
 *
 * The playback loop sets the timecode sixty times a second and must not go
 * through React to do it — see `useEditorPlayback`. That is why it holds
 * elements and writes `textContent`, and it is also why a digit cannot simply
 * be animated: the loop owns the text, and the thing that would animate it owns
 * the DOM under it.
 *
 * So the element says how it wants to be written to. A component that draws its
 * value as sliding digits registers a writer here; anything else is written the
 * way it always was. The loop calls `writeTicker` and never knows which it got.
 */
const writers = new WeakMap<HTMLElement, (text: string) => void>();

/** Takes over how this element's value is written. Returns the undo. */
export function registerTicker(element: HTMLElement, write: (text: string) => void): () => void {
  writers.set(element, write);
  return () => writers.delete(element);
}

/**
 * Puts a value on an element, through its writer if it has one.
 *
 * A `WeakMap` lookup per call, which is what the per-frame path pays for this.
 * The alternative — a property on the element — is a hidden field on a DOM node
 * that survives the component that put it there.
 */
export function writeTicker(element: HTMLElement, text: string): void {
  const write = writers.get(element);
  if (write) write(text);
  else element.textContent = text;
}
