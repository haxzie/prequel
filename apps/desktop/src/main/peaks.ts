/**
 * The waveform's peaks for one audio file of a recording.
 *
 * Main's job rather than the renderer's, for one reason: a renderer decodes
 * audio with `decodeAudioData`, which holds the whole file as native-rate PCM
 * before it resamples — twice over, and once per call in flight. An hour-long
 * take came to tens of gigabytes and killed the editor on open, every time.
 * Rust streams the file through `AVAssetReader` instead and never holds more
 * than one decoder chunk, so the length of a take no longer decides whether it
 * opens. The pass is in `prequel-render`'s `peaks.rs`; this file is the path
 * checks, the cache and the dedup around it.
 *
 * Cached as a file beside the track, the way the cleaned microphone is: a
 * second open reads a few hundred kilobytes rather than decoding an hour
 * again, and the editor can ask on every settings change without deciding
 * which of them is the first.
 */

import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

import { libraryParts } from "../shared/library.js";
import { libraryFile } from "./library.js";
import { log } from "./log.js";
import { getRecorder } from "./recorder.js";
import { insideRecordings } from "./session.js";

/**
 * Passes already running, by the file they are reading.
 *
 * The editor asks for every audio track as soon as it opens and again when the
 * cleaned microphone lands, which can be within the same frame. One decode per
 * file, with the second caller waiting on the first, keeps a long take from
 * being read twice at once — which is exactly the shape that used to run the
 * renderer out of memory.
 */
const running = new Map<string, Promise<Float32Array>>();

/**
 * The name the peaks of `file` are kept under, beside it.
 *
 * `mic.m4a` → `mic.peaks`, `2/mic.clean-strong.m4a` → `2/mic.clean-strong.peaks`.
 * One per source file, so the cleaned microphone — a different file with a
 * different shape — has its own and never answers for the raw one.
 */
export function peaksName(file: string): string {
  const dir = dirname(file);
  const stem = basename(file).replace(/\.[^.]+$/, "");
  const name = `${stem}.peaks`;
  return dir === "." ? name : `${dir}/${name}`;
}

/**
 * The peaks of one audio file, read from the cache or made.
 *
 * `file` is relative to `dir`, as the manifest records it. Both are checked
 * rather than trusted, for the reason `cleanMic` checks them: they arrive from
 * a renderer, and a `..` in either is how a path in a window becomes a read —
 * and here a write — outside the recordings directory.
 */
export async function audioPeaks(dir: string, file: string): Promise<Float32Array> {
  if (!insideRecordings(dir)) {
    throw new Error(`PEAKS_REFUSED: ${dir} is not a recording`);
  }

  // One of ours, which lives on the shelf rather than in the recording — see
  // `shared/library.ts`. Resolved by the parser, which refuses anything that
  // is not a shelf and a bare name, so this route needs no guard of its own.
  const shelved = libraryFile(file);
  const source = shelved ?? resolve(dir, file);

  if (!shelved) {
    const within = relative(dir, source);
    if (within.startsWith("..") || resolve(dir, within) !== source) {
      throw new Error(`PEAKS_REFUSED: ${file} is not inside the recording`);
    }
  }
  if (!existsSync(source)) {
    throw new Error(`PEAKS_MISSING: ${file} is not there`);
  }

  // Cached beside the recording either way — the peaks are cheap, the picture
  // they draw is this timeline's, and a shelf shared by every project is not
  // somewhere to write per-project crumbs. `peaksName` is given the bare name,
  // so a reference does not put its prefix into a file name.
  const cache = join(dir, peaksName(libraryParts(file)?.file ?? file));
  const cached = await readCache(cache);
  if (cached) return cached;

  const already = running.get(source);
  if (already) return already;

  const pass = (async () => {
    const started = Date.now();
    const recorder = await getRecorder();
    const peaks = await recorder.audioPeaks(source);
    log(
      "info",
      `peaks for ${file}: ${String(Math.round(peaks.length / 20))}s of audio in ` +
        `${String(((Date.now() - started) / 1000).toFixed(1))}s`,
    );
    await writeCache(cache, peaks);
    return peaks;
  })();

  running.set(source, pass);
  try {
    return await pass;
  } finally {
    running.delete(source);
  }
}

/**
 * The cached peaks, or null if there is no usable cache.
 *
 * Raw little-endian `f32`, nothing else: there is no version to check because
 * there is nothing that could change — twenty raw amplitudes a second is the
 * whole format. A file whose length is not a whole number of floats is a
 * write that never finished, and is remade rather than trusted.
 */
export async function readCache(path: string): Promise<Float32Array | null> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    return null;
  }
  if (bytes.byteLength % 4 !== 0) return null;

  // Copied out of the Node buffer rather than viewed: a `Buffer` from
  // `readFile` can sit at an odd offset inside a larger pool allocation, and a
  // `Float32Array` over it throws on alignment.
  const out = new Float32Array(bytes.byteLength / 4);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = bytes.readFloatLE(index * 4);
  }
  return out;
}

/**
 * Written under a neighbouring name and moved into place, so a quit part way
 * through leaves no short file under the name the next open will trust.
 */
export async function writeCache(path: string, peaks: Float32Array): Promise<void> {
  const partial = `${path}.partial`;
  try {
    await writeFile(partial, Buffer.from(peaks.buffer, peaks.byteOffset, peaks.byteLength));
    await rename(partial, path);
  } catch (cause) {
    // The peaks are already in hand; a cache that could not be written costs
    // the next open a decode, not this one its waveform.
    console.warn(`[peaks] could not cache ${path}:`, cause);
  }
}
