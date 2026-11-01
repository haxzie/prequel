/**
 * Drawing caption and title bitmaps off the main thread.
 *
 * Every pixel in a caption is painted into an `OffscreenCanvas` and encoded as
 * a PNG, and neither step touches the DOM — `captionBitmap.ts` imports two
 * types and nothing else. So the whole of it can run here, and on a long
 * recording it has to: a twenty-minute take is thousands of cues, and done on
 * the main thread it is thousands of encodes interleaved with the preview's
 * own `requestAnimationFrame` loop. The drawing was never the slow part
 * — a layer paints in under a tenth of a millisecond and encodes in about
 * one — but it was in the way.
 *
 * ## Fonts
 *
 * The one thing that does not come for free. A worker has its own font set, so
 * a face the editor registered on `document.fonts` is simply not here and the
 * canvas quietly falls back — which is the worst kind of failure, because it
 * renders. Every face a batch needs is therefore registered here first, from
 * the same `prequel-media://font/` URL the editor uses. The CSP allows it:
 * `font-src 'self' prequel-media:`.
 *
 * Cached by the name they were registered under, because a batch is one chunk
 * of a redraw and the next chunk wants the same faces.
 */
import type { CaptionStyle, Cue } from "../../../shared/captions";
import type { Size } from "../../../shared/layout";
import { type CueLayer, type CueOptions, rasteriseCue } from "./captionBitmap";

/** A face the batch needs, named as `useFonts` names it. */
export interface WorkerFace {
  family: string;
  /** The file under `prequel-media://font/`. */
  file: string;
  weight: number;
  italic: boolean;
}

export interface DrawRequest {
  id: number;
  cues: Cue[];
  style: CaptionStyle;
  options: CueOptions;
  faces: WorkerFace[];
}

/** One cue's result, or null where it would not draw. */
export interface DrawnCue {
  /** The pixels, which the caller writes and then throws away. */
  layers: CueLayer[];
  bitmap: Size;
  /** The bitmap as a fraction of the frame it was laid out against. */
  size: Size;
}

export interface DrawReply {
  id: number;
  /** One entry per cue in the request, in order. Null where it failed. */
  drawn: (DrawnCue | null)[];
}

/**
 * This worker's own global, typed.
 *
 * The renderer's `lib` is the DOM one, so `self` here is a `Window` as far as
 * TypeScript is concerned — which has a `postMessage` that takes options
 * where a worker's takes transferables. Narrowed once, rather than cast at
 * each of the three uses.
 */
const worker = self as unknown as {
  fonts: FontFaceSet;
  onmessage: ((event: MessageEvent<DrawRequest>) => void) | null;
  postMessage: (message: DrawReply, transfer: Transferable[]) => void;
};

/** Faces already registered, by the key `useFonts` would give them. */
const registered = new Map<string, Promise<boolean>>();

function fontUrl(file: string): string {
  return `prequel-media://font/${encodeURIComponent(file)}`;
}

/**
 * Registers a face on this worker's own font set, once.
 *
 * Failure is swallowed to a `false`: a face that will not load means the
 * canvas draws the fallback, which is a caption in the wrong face rather than
 * no caption at all. The editor has already warned about the same file on its
 * own thread, so saying it twice would only double the noise in the log.
 */
async function ensure(face: WorkerFace): Promise<boolean> {
  const key = `${face.family}|${String(face.weight)}|${face.italic ? "i" : "n"}`;
  const known = registered.get(key);
  if (known) return known;

  const loading = (async () => {
    try {
      const loaded = new FontFace(face.family, `url(${fontUrl(face.file)})`, {
        weight: String(face.weight),
        style: face.italic ? "italic" : "normal",
      });
      // The worker's own set rather than `document.fonts`: the two are
      // unrelated, and a face registered on the editor's thread is simply not
      // here.
      worker.fonts.add(loaded);
      await loaded.load();
      return loaded.status === "loaded";
    } catch {
      return false;
    }
  })();

  registered.set(key, loading);
  return loading;
}

worker.onmessage = (event: MessageEvent<DrawRequest>) => {
  const request = event.data;

  void (async () => {
    // Every face first, and awaited. A cue drawn while its face is still
    // loading is drawn in the fallback and cached under a name that says it is
    // the real one — so it would stay wrong until something else invalidated
    // it.
    await Promise.all(request.faces.map(ensure));

    const drawn: (DrawnCue | null)[] = [];
    const moving: ArrayBuffer[] = [];

    for (const cue of request.cues) {
      try {
        const { layout, layers } = await rasteriseCue(cue, request.style, request.options);
        for (const layer of layers) moving.push(layer.bytes.buffer as ArrayBuffer);
        drawn.push({ layers, bitmap: layout.bitmap, size: layout.size });
      } catch {
        // One cue that would not draw is one missing caption, and the rest of
        // the recording is still worth captioning. Reported by the caller,
        // which is the side that knows which cue this was.
        drawn.push(null);
      }
    }

    const reply: DrawReply = { id: request.id, drawn };
    // Transferred, not copied. A chunk is a megabyte or so of PNG and copying
    // it back across the thread boundary would spend most of what moving the
    // work here just saved.
    worker.postMessage(reply, moving);
  })();
};
